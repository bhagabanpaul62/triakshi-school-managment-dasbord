import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth } from "@smw/auth";
import { closeDb, eq, oneTimeTokens, schools, sql, uuidv7, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import {
  AuditService, ExportService, FilePolicy, ProfileService, SchoolProfileService, UserAdminService,
} from "./service";

let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
const mail = new MemoryEmailSender();
const PNG = { name: "Logo.PNG", type: "image/png", size: 4, bytes: new Uint8Array([137, 80, 78, 71]) };

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["settings"]));
  useServices({ storage, email: mail });
});
afterAll(closeDb);

describe("FilePolicy", () => {
  const caller = { schoolId: "S1", role: "teacher" as const };
  it("public files are open, the rest needs a session, exports need an admin", () => {
    expect(FilePolicy.canRead("S1/public/logo/x.png", { schoolId: "S1", role: null })).toBe(true);
    expect(FilePolicy.canRead("S1/documents/x.pdf", { schoolId: "S1", role: null })).toBe(false);
    expect(FilePolicy.canRead("S1/documents/x.pdf", caller)).toBe(true);
    expect(FilePolicy.canRead("S1/exports/x.json", caller)).toBe(false);
    expect(FilePolicy.canRead("S1/exports/x.json", { schoolId: "S1", role: "admin" })).toBe(true);
  });
  it("never crosses schools or walks up the path", () => {
    expect(FilePolicy.canRead("S2/public/logo/x.png", caller)).toBe(false);
    expect(FilePolicy.canRead("S1/public/../S2/x.png", caller)).toBe(false);
    expect(FilePolicy.canRead("S1/public", caller)).toBe(false);
  });
  it("maps urls to keys and back", () => {
    expect(FilePolicy.keyOf(FilePolicy.url("S1/public/a.png"))).toBe("S1/public/a.png");
    expect(FilePolicy.keyOf("https://elsewhere/a.png")).toBeNull();
  });
});

describe("SchoolProfileService", () => {
  it("admin updates the school; empty optional fields clear", async () => {
    const svc = new SchoolProfileService(a.as.admin);
    const p = await svc.update({ name: "Green Valley Public School", board: "CBSE", city: "Pune", state: "Maharashtra", udiseCode: "27250100101", gstin: "27abcde1234f1z5", timezone: "Asia/Kolkata", academicYearStartMonth: "4" });
    expect(p).toMatchObject({ name: "Green Valley Public School", gstin: "27ABCDE1234F1Z5", academicYearStartMonth: 4 });
    const cleared = await svc.update({ name: "Green Valley Public School", board: "", timezone: "Asia/Kolkata", academicYearStartMonth: 4 });
    expect(cleared.board).toBeNull();
    expect(cleared.city).toBeNull();
  });

  it("rejects bad GSTIN, UDISE and timezone with field errors", async () => {
    const err = await new SchoolProfileService(a.as.admin).update({ name: "X School", gstin: "nope", udiseCode: "123", timezone: "Mars/Base", academicYearStartMonth: 4 }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys(err.fieldErrors)).toEqual(expect.arrayContaining(["gstin", "udiseCode", "timezone"]));
  });

  it("only admins manage the school", async () => {
    await expect(new SchoolProfileService(a.as.teacher).get()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SchoolProfileService(a.as.parent).update({ name: "Hacked", timezone: "Asia/Kolkata", academicYearStartMonth: 4 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: changing school A leaves school B alone", async () => {
    const before = await new SchoolProfileService(b.as.admin).get();
    await new SchoolProfileService(a.as.admin).update({ name: "Only A", timezone: "Asia/Kolkata", academicYearStartMonth: 6 });
    expect(await new SchoolProfileService(b.as.admin).get()).toEqual(before);
    const [aRow] = await withSchool(a.id, (tx) => tx.select({ n: schools.name }).from(schools));
    expect(aRow!.n).toBe("Only A");
  });

  it("logo goes under public/logo, replaces the old file, and rejects non-images", async () => {
    const svc = new SchoolProfileService(a.as.admin);
    const first = await svc.setLogo(PNG);
    const firstKey = FilePolicy.keyOf(first.logoUrl)!;
    expect(firstKey.startsWith(`${a.id}/public/logo/`)).toBe(true);
    expect(storage.files.has(firstKey)).toBe(true);
    expect(FilePolicy.canRead(firstKey, { schoolId: a.id, role: null })).toBe(true);

    const second = await svc.setLogo(PNG);
    expect(storage.files.has(firstKey)).toBe(false);
    expect((await svc.get()).logoUrl).toBe(second.logoUrl);

    await expect(svc.setLogo({ ...PNG, name: "x.pdf", type: "application/pdf" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new SchoolProfileService(a.as.teacher).setLogo(PNG)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("UserAdminService", () => {
  it("lists every login without password hashes, filtered by role and search", async () => {
    const svc = new UserAdminService(a.as.admin);
    const all = await svc.list();
    expect(all.total).toBe(5);
    expect(JSON.stringify(all.rows)).not.toContain("argon2id");
    expect((await svc.list({ filters: { role: "teacher" } })).rows.map((r) => r.role)).toEqual(["teacher"]);
    expect((await svc.list({ q: "accountant" })).rows).toHaveLength(1);
    expect((await svc.list({ filters: { status: "disabled" } })).total).toBe(0);
  });

  it("summarises logins by status and counts the active admins", async () => {
    const svc = new UserAdminService(a.as.admin);
    const sum = await svc.summary();
    expect(sum.total).toBe((await svc.list({ pageSize: 100 })).total);
    expect(sum.total).toBe(sum.active + sum.invited + sum.disabled);
    expect(sum.admins).toBeGreaterThanOrEqual(1);
    await expect(new UserAdminService(a.as.teacher).summary()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only admins use it", async () => {
    await expect(new UserAdminService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new UserAdminService(a.as.accountant).changeRole(a.users.teacher, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new UserAdminService(a.as.student).disable(a.users.teacher)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("changes a staff role, but student and parent logins keep theirs", async () => {
    const svc = new UserAdminService(a.as.admin);
    expect((await svc.changeRole(a.users.accountant, { role: "teacher" })).role).toBe("teacher");
    await svc.changeRole(a.users.accountant, { role: "accountant" });
    await expect(svc.changeRole(a.users.student, { role: "teacher" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.changeRole(a.users.teacher, { role: "student" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the last admin cannot step down; with a second admin they can", async () => {
    const svc = new UserAdminService(a.as.admin);
    const other = new UserAdminService({ ...a.as.accountant, role: "admin" }); // someone else, since nobody changes their own role
    await expect(other.changeRole(a.users.admin, { role: "teacher" })).rejects.toThrow(/last admin/);
    await svc.changeRole(a.users.teacher, { role: "admin" });
    expect((await other.changeRole(a.users.admin, { role: "teacher" })).role).toBe("teacher");
    // the promoted teacher is now the only admin, so they cannot step down either
    await expect(other.changeRole(a.users.teacher, { role: "teacher" })).rejects.toThrow(/last admin/);
    // put things back for the tests below
    await other.changeRole(a.users.admin, { role: "admin" });
    await other.changeRole(a.users.teacher, { role: "teacher" });
  });

  it("disabling signs the person out everywhere; enabling brings them back", async () => {
    const svc = new UserAdminService(a.as.admin);
    const { token } = await new SchoolAuth(a.id).login(`teacher@${a.slug}.test`, "password123");
    expect(await new SchoolAuth(a.id).validate(token)).not.toBeNull();

    expect((await svc.disable(a.users.teacher)).status).toBe("disabled");
    expect(await new SchoolAuth(a.id).validate(token)).toBeNull();
    expect((await svc.list({ filters: { status: "disabled" } })).rows.map((r) => r.id)).toEqual([a.users.teacher]);

    expect((await svc.enable(a.users.teacher)).status).toBe("active");
    expect((await svc.enable(a.users.teacher)).status).toBe("active"); // idempotent
  });

  it("you cannot disable yourself", async () => {
    await expect(new UserAdminService(a.as.admin).disable(a.users.admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it("sends a reset link by email that actually works, and replaces older links", async () => {
    const svc = new UserAdminService(a.as.admin);
    mail.sent.length = 0;
    await svc.resetPassword(a.users.accountant);
    await svc.resetPassword(a.users.accountant);
    expect(mail.sent).toHaveLength(2);
    const sent = mail.sent[1]!;
    expect(sent.to).toBe(`accountant@${a.slug}.test`);
    const token = /token=([\w-]+)/.exec(sent.text)![1]!;
    const live = await withSchool(a.id, (tx) => tx.select().from(oneTimeTokens).where(sql`${oneTimeTokens.userId} = ${a.users.accountant} and ${oneTimeTokens.purpose} = 'reset_password'`));
    expect(live).toHaveLength(1);
    await new SchoolAuth(a.id).resetPassword(token, "brand-new-pass");
    await expect(new SchoolAuth(a.id).login(`accountant@${a.slug}.test`, "brand-new-pass")).resolves.toBeTruthy();
  });

  it("no reset link for a disabled account or one without an email", async () => {
    const svc = new UserAdminService(a.as.admin);
    await svc.disable(a.users.student);
    await expect(svc.resetPassword(a.users.student)).rejects.toBeInstanceOf(ConflictError);
    await svc.enable(a.users.student);
    await withSchool(a.id, (tx) => tx.execute(sql`update users set email = null where id = ${a.users.student}`));
    await expect(svc.resetPassword(a.users.student)).rejects.toBeInstanceOf(ValidationError);
  });

  it("isolation: school B cannot see or change school A's users", async () => {
    const bSvc = new UserAdminService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === a.users.teacher)).toBe(false);
    await expect(bSvc.changeRole(a.users.teacher, { role: "accountant" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.disable(a.users.teacher)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.enable(a.users.teacher)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.resetPassword(a.users.teacher)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ProfileService", () => {
  it("every role reads their own profile", async () => {
    for (const role of ["admin", "teacher", "student"] as const) {
      expect((await new ProfileService(a.as[role]).me()).id).toBe(a.users[role]);
    }
  });
});

describe("AuditService", () => {
  it("lists school activity with actor names, newest first, and filters it", async () => {
    await new SchoolProfileService(a.as.admin).update({ name: "Audit Test School", timezone: "Asia/Kolkata", academicYearStartMonth: 4 });
    const svc = new AuditService(a.as.admin);
    const page = await svc.list();
    expect(page.total).toBeGreaterThan(3);
    expect(page.rows[0]).toMatchObject({ module: "settings", actor: a.as.admin.name, summary: "Updated school details" });
    expect(page.rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(page.rows[1]!.createdAt.getTime());

    expect((await svc.list({ q: "school details" })).rows.every((r) => /school details/i.test(r.summary ?? ""))).toBe(true);
    expect((await svc.list({ filters: { module: "nothing" } })).total).toBe(0);
    expect((await svc.list({ filters: { actor: a.users.admin } })).total).toBeGreaterThan(0);
    expect(await svc.modules()).toContain("settings");
    expect((await svc.actors()).map((x) => x.id)).toContain(a.users.admin);
  });

  it("filters by date range (IST days)", async () => {
    const svc = new AuditService(a.as.admin);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect((await svc.list({ filters: { from: today, to: today } })).total).toBeGreaterThan(0);
    expect((await svc.list({ filters: { from: "2999-01-01" } })).total).toBe(0);
    expect((await svc.list({ filters: { to: "2000-01-01" } })).total).toBe(0);
  });

  it("is admin only", async () => {
    await expect(new AuditService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AuditService(a.as.accountant).modules()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B never sees school A's entries", async () => {
    const aIds = new Set((await new AuditService(a.as.admin).list({ pageSize: 100 })).rows.map((r) => r.id));
    const bRows = (await new AuditService(b.as.admin).list({ pageSize: 100 })).rows;
    expect(bRows.some((r) => aIds.has(r.id))).toBe(false);
    expect((await new AuditService(b.as.admin).actors()).some((x) => x.id === a.users.admin)).toBe(false);
  });
});

describe("ExportService", () => {
  const asJson = async (url: string) => JSON.parse(Buffer.from(await storage.get(url.replace("memory://", ""))).toString());

  it("exports the whole school as JSON without secrets or other schools' rows, and logs it", async () => {
    const svc = new ExportService(a.as.admin);
    const r = await svc.exportSchool();
    const file = await asJson(r.url);
    expect(file.scope).toBe("school");
    expect(file.tables.users).toHaveLength(5);
    expect(file.tables.audit_logs.length).toBeGreaterThan(0);
    expect(file.school.slug).toBe(a.slug);
    const text = JSON.stringify(file);
    expect(text).not.toContain("argon2id");
    expect(text).not.toContain("password_hash");
    expect(file.tables.sessions).toBeUndefined();
    expect(file.tables.one_time_tokens).toBeUndefined();
    expect(file.tables.users.every((u: { school_id: string }) => u.school_id === a.id)).toBe(true);
    expect(text).not.toContain(b.id);
    expect(r.url).toContain(`${a.id}/exports/`);

    const recent = await svc.recent();
    expect(recent[0]).toMatchObject({ id: r.id, scope: "school", status: "ready" });
    expect(recent[0]!.fileKey).toContain(`${a.id}/exports/`);
    expect((await new AuditService(a.as.admin).list({ q: "Exported" })).total).toBeGreaterThan(0);
  });

  it("leaves salaries out unless an admin asks, and never exports sealed numbers", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into pay_profiles (id, school_id, user_id, pan_sealed, pan_last4) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'v1.secret.pan', '234F')`));
    const svc = new ExportService(a.as.admin);
    const plain = await asJson((await svc.exportSchool()).url);
    expect(Object.keys(plain.tables).some((t) => t.startsWith("pay_"))).toBe(false);
    const full = await asJson((await svc.exportSchool({ includePayroll: true })).url);
    expect(full.tables.pay_profiles).toHaveLength(1);
    expect(full.tables.pay_profiles[0].pan_last4).toBe("234F");
    expect(JSON.stringify(full)).not.toContain("v1.secret.pan");
  });

  it("leaves each person's pay out of the ledger too, unless payroll is ticked", async () => {
    const [acc, run, fee, j1, j2, who] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), a.users.teacher];
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into fin_accounts (id, school_id, code, name, type, group_name) values (${acc}, ${a.id}, 'X1', 'Salaries', 'expense', 'Pay')`);
      await tx.execute(sql`insert into fin_journals (id, school_id, number, date, kind, source_key, source_type, source_id, memo) values
        (${j1}, ${a.id}, 'J-X1', '2026-04-30', 'auto', ${`payroll:run:${run}`}, 'payroll_run', ${run}, 'Salary for Asha Rao'),
        (${j2}, ${a.id}, 'J-X2', '2026-04-30', 'auto', ${`fees:test:${fee}`}, 'fees_receipt', ${fee}, 'Fee receipt')`);
      await tx.execute(sql`insert into fin_journal_lines (id, school_id, journal_id, account_id, debit_paise, party_type, party_id, memo) values
        (${uuidv7()}, ${a.id}, ${j1}, ${acc}, 5000000, 'staff', ${who}, 'Asha Rao net pay'), (${uuidv7()}, ${a.id}, ${j1}, ${acc}, 700000, null, null, 'Asha Rao PF'),
        (${uuidv7()}, ${a.id}, ${j2}, ${acc}, 1000, null, null, 'Fee line')`);
    });
    const svc = new ExportService(a.as.admin);
    const plain = await asJson((await svc.exportSchool()).url);
    expect(JSON.stringify(plain)).not.toContain("Asha Rao");
    expect(plain.tables.fin_journal_lines.some((l: { party_type: string | null }) => l.party_type === "staff")).toBe(false);
    expect(plain.tables.fin_journals.map((j: { number: string }) => j.number)).toEqual(expect.arrayContaining(["J-X1", "J-X2"]));
    expect(plain.tables.fin_journal_lines.map((l: { memo: string | null }) => l.memo)).toContain("Fee line");
    const full = await asJson((await svc.exportSchool({ includePayroll: true })).url);
    expect(JSON.stringify(full)).toContain("Asha Rao net pay");
  });

  it("exports one student across the tables that reference them", async () => {
    const mine = uuidv7(), other = uuidv7();
    await withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${mine}, ${a.id}, 'A-1', 'Riya Sharma'), (${other}, ${a.id}, 'A-2', 'Aman Verma')`));
    await withSchool(a.id, (tx) => tx.execute(sql`insert into guardian_consents (id, school_id, student_id, purpose) values (${uuidv7()}, ${a.id}, ${mine}, 'data_processing'), (${uuidv7()}, ${a.id}, ${other}, 'data_processing')`));
    const svc = new ExportService(a.as.admin);
    expect(await svc.studentOptions()).toContainEqual({ value: mine, label: "Riya Sharma (A-1)" });

    const r = await svc.exportStudent({ studentId: mine });
    expect(r.label).toBe("Student: Riya Sharma");
    const file = await asJson(r.url);
    expect(file.scope).toBe("student");
    expect(file.student.name).toBe("Riya Sharma");
    expect(file.tables.guardian_consents).toHaveLength(1);
    expect(JSON.stringify(file)).not.toContain("Aman Verma");
  });

  it("is admin only, and a student of another school is not found", async () => {
    await expect(new ExportService(a.as.teacher).exportSchool()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExportService(a.as.parent).exportStudent({ studentId: uuidv7() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExportService(a.as.teacher).recent()).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await withSchool(a.id, (tx) => tx.execute<{ id: string }>(sql`select id from students limit 1`));
    await expect(new ExportService(b.as.admin).exportStudent({ studentId: row!.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ExportService(a.as.admin).exportStudent({ studentId: "not-an-id" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("isolation: school B's export history and options are its own", async () => {
    expect(await new ExportService(b.as.admin).recent()).toEqual([]);
    expect(await new ExportService(b.as.admin).studentOptions()).toEqual([]);
  });

  it("still works when the school is read-only, but not in a support session", async () => {
    await expect(new ExportService({ ...a.as.admin, readOnly: true }).exportSchool()).resolves.toBeTruthy();
    await expect(new ExportService({ ...a.as.admin, supportStaffId: uuidv7() }).exportSchool()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("read-only schools cannot change settings", async () => {
    await expect(new SchoolProfileService({ ...a.as.admin, readOnly: true }).update({ name: "Nope School", timezone: "Asia/Kolkata", academicYearStartMonth: 4 })).rejects.toThrow(/read-only/);
    const [row] = await withSchool(a.id, (tx) => tx.select({ n: schools.name }).from(schools).where(eq(schools.id, a.id)));
    expect(row!.n).toBe("Audit Test School");
  });
});
