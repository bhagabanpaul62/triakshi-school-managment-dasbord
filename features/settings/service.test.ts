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
    expect(FilePolicy.canRead("S1/private/messages/x.pdf", { schoolId: "S1", role: "admin" })).toBe(false);
    expect(FilePolicy.canRead("S1/students/x.pdf", { schoolId: "S1", role: "student" })).toBe(false);
    expect(FilePolicy.canRead("S1/avatars/x.png", { schoolId: "S1", role: "student" })).toBe(true);
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

const asJson = async (url: string) => JSON.parse(Buffer.from(await storage.get(url.replace("memory://", ""))).toString());

describe("ExportService", () => {

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

  describe("private conversations", () => {
    const [s1, s2, th1, th2, m1, m2, m3, cat, rq] = Array.from({ length: 9 }, () => uuidv7());
    beforeAll(async () => {
      await withSchool(a.id, async (tx) => {
        await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${s1}, ${a.id}, 'T-1', 'Talk Kid'), (${s2}, ${a.id}, 'T-2', 'Other Kid')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${th1}, ${a.id}, 'student', 'About Talk Kid', ${s1}), (${th2}, ${a.id}, 'student', 'About Other Kid', ${s2})`);
        await tx.execute(sql`insert into messages (id, school_id, thread_id, sender_name, body, internal) values
          (${m1}, ${a.id}, ${th1}, 'Teacher', 'hello family secret-visible', false), (${m2}, ${a.id}, ${th1}, 'Office', 'staff-only note', true), (${m3}, ${a.id}, ${th2}, 'Teacher', 'other kid talk', false)`);
        await tx.execute(sql`insert into message_files (id, school_id, message_id, file_key, file_name, content_type, size) values (${uuidv7()}, ${a.id}, ${m1}, 'private/messages/x/key.pdf', 'note.pdf', 'application/pdf', 10)`);
        await tx.execute(sql`insert into message_reports (id, school_id, thread_id, category, note, reporter_name) values (${uuidv7()}, ${a.id}, ${th1}, 'safety', 'report-text', 'Teacher')`);
        await tx.execute(sql`insert into request_categories (id, school_id, name) values (${cat}, ${a.id}, 'Certificates')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${rq}, ${a.id}, 'request', 'Request for Talk Kid', ${s1})`);
        await tx.execute(sql`insert into requests (id, school_id, thread_id, number, category_id, student_id, raised_by_name, owner_role, due_at) values (${uuidv7()}, ${a.id}, ${rq}, 'REQ/1', ${cat}, ${s1}, 'Family', 'admin', now())`);
      });
    });
    const PRIVATE = ["message_threads", "thread_members", "messages", "message_files", "message_reports", "message_reviews", "message_restrictions", "message_batches", "saved_replies", "requests", "request_events"];

    it("a school export has none of it unless the admin ticks it with a reason", async () => {
      const svc = new ExportService(a.as.admin);
      const plain = await asJson((await svc.exportSchool()).url);
      for (const t of PRIVATE) expect(plain.tables[t]).toBeUndefined();
      expect(JSON.stringify(plain)).not.toContain("secret-visible");
      await expect(svc.exportSchool({ includePrivate: true })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
      await expect(svc.exportSchool({ includePrivate: true, reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("with the tick and a reason it carries the conversations, and the reason is in the audit log", async () => {
      const r = await new ExportService({ ...a.as.admin, features: new Set(["settings", "messages"]) }).exportSchool({ includePrivate: true, reason: "Court order 14/2026" });
      expect(r.label).toBe("All school data, with private conversations");
      const file = await asJson(r.url);
      expect(file.tables.messages).toHaveLength(3);
      expect(file.tables.requests).toHaveLength(1);
      expect(file.tables.message_reports).toHaveLength(1);
      const rows = await withSchool(a.id, (tx) => tx.execute<{ meta: { reason?: string; includesPrivateConversations?: boolean } }>(sql`select meta from audit_logs where action = 'export'`));
      expect(rows.map((x) => x.meta)).toContainEqual(expect.objectContaining({ includesPrivateConversations: true, reason: "Court order 14/2026" }));
    });

    it("reports and reviews also need the safeguarding permission", async () => {
      const noSafeguard = { ...a.as.admin, grants: new Set(["settings:export", "settings:read", "messages:use"]), features: new Set(["settings", "messages"]) };
      const file = await asJson((await new ExportService(noSafeguard).exportSchool({ includePrivate: true, reason: "Parent asked for a copy" })).url);
      expect(file.tables.messages).toHaveLength(3);
      expect(file.tables.message_reports).toBeUndefined();
      expect(file.tables.message_reviews).toBeUndefined();
    });

    it("never in a support session, even with the tick", async () => {
      await expect(new ExportService({ ...a.as.admin, supportStaffId: uuidv7() }).exportSchool({ includePrivate: true, reason: "Support wants to look" })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("a student's export has their conversations and requests, without staff notes, reports or file paths", async () => {
      const file = await asJson((await new ExportService(a.as.admin).exportStudent({ studentId: s1 })).url);
      expect(file.tables.message_threads.map((t: { id: string }) => t.id).sort()).toEqual([th1, rq].sort());
      expect(file.tables.messages.map((m: { body: string }) => m.body)).toEqual(["hello family secret-visible"]);
      expect(file.tables.message_files).toEqual([expect.objectContaining({ file_name: "note.pdf" })]);
      expect(file.tables.requests).toHaveLength(1);
      expect(file.tables.message_reports).toBeUndefined();
      const text = JSON.stringify(file);
      for (const gone of ["staff-only note", "other kid talk", "report-text", "private/messages", "Other Kid"]) expect(text).not.toContain(gone);
    });

    it("isolation: school B's file never holds school A's talk", async () => {
      const file = await asJson((await new ExportService(b.as.admin).exportSchool({ includePrivate: true, reason: "Checking isolation" })).url);
      expect(file.tables.messages ?? []).toEqual([]);
      expect(JSON.stringify(file)).not.toContain("secret-visible");
    });
  });

  it("never exports push keys, calendar links or unsubscribe hashes", async () => {
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into push_subscriptions (id, school_id, user_id, endpoint, p256dh, auth) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'https://push.test/endpoint-secret', 'k', 'auth-secret')`);
      await tx.execute(sql`insert into calendar_feeds (id, school_id, user_id, token_hash) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'feed-hash-secret')`);
      await tx.execute(sql`insert into notification_prefs (id, school_id, user_id, unsubscribe_hash) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'unsub-hash-secret')`);
    });
    const file = await asJson((await new ExportService(a.as.admin).exportSchool()).url);
    expect(file.tables.push_subscriptions).toBeUndefined();
    expect(file.tables.calendar_feeds).toBeUndefined();
    expect(file.tables.notification_prefs).toHaveLength(1);
    const text = JSON.stringify(file);
    for (const secret of ["endpoint-secret", "auth-secret", "feed-hash-secret", "unsub-hash-secret"]) expect(text).not.toContain(secret);
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

describe("things written about the person who asks", () => {
  it("the audit list hides entries of messages and requests that name the viewer, and shows the rest", async () => {
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into audit_logs (id, school_id, module, action, summary, meta) values
        (${uuidv7()}, ${a.id}, 'messages', 'report', 'ABOUT-ME report opened', ${JSON.stringify({ aboutUserIds: [a.users.admin] })}::jsonb),
        (${uuidv7()}, ${a.id}, 'requests', 'complaint', 'ABOUT-ME complaint', ${JSON.stringify({ aboutUserIds: [a.users.teacher, a.users.admin] })}::jsonb),
        (${uuidv7()}, ${a.id}, 'messages', 'report', 'ABOUT-OTHER report opened', ${JSON.stringify({ aboutUserIds: [a.users.teacher] })}::jsonb)`);
    });
    const rows = await new AuditService(a.as.admin).list({ q: "ABOUT-", pageSize: 50 });
    expect(rows.rows.map((r) => r.summary)).toEqual(["ABOUT-OTHER report opened"]);
    expect(rows.total).toBe(1);
  });

  describe("exports", () => {
    const [s1, th1, th2, m1, m2, cat, rq, rq2, meeting, win] = Array.from({ length: 10 }, () => uuidv7());
    beforeAll(async () => {
      await withSchool(a.id, async (tx) => {
        await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${s1}, ${a.id}, 'AM-1', 'About Kid')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${th1}, ${a.id}, 'student', 'Ordinary talk', ${s1}), (${th2}, ${a.id}, 'student', 'Talk naming the admin', ${s1})`);
        await tx.execute(sql`insert into messages (id, school_id, thread_id, sender_name, body, internal) values (${m1}, ${a.id}, ${th1}, 'Teacher', 'ordinary-body', false), (${m2}, ${a.id}, ${th2}, 'Teacher', 'about-admin-body', false)`);
        await tx.execute(sql`insert into message_reports (id, school_id, thread_id, category, note, reporter_name, about_user_ids) values
          (${uuidv7()}, ${a.id}, ${th2}, 'conduct', 'report-naming-admin', 'Teacher', ${`{${a.users.admin}}`}::uuid[]),
          (${uuidv7()}, ${a.id}, ${th1}, 'conduct', 'report-naming-teacher', 'Teacher', ${`{${a.users.teacher}}`}::uuid[])`);
        await tx.execute(sql`insert into message_reviews (id, school_id, thread_id, reviewer_id, reviewer_name, reason) values (${uuidv7()}, ${a.id}, ${th2}, ${a.users.teacher}, 'Lead', 'review-of-admin-thread')`);
        await tx.execute(sql`insert into request_categories (id, school_id, name) values (${cat}, ${a.id}, 'Complaints')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${rq}, ${a.id}, 'request', 'Complaint about admin', ${s1}), (${rq2}, ${a.id}, 'request', 'Ordinary request', ${s1})`);
        await tx.execute(sql`insert into requests (id, school_id, thread_id, number, category_id, student_id, raised_by_name, owner_role, due_at, about_user_ids) values
          (${uuidv7()}, ${a.id}, ${rq}, 'REQ/AM1', ${cat}, ${s1}, 'Family', 'admin', now(), ${`{${a.users.admin}}`}::uuid[]),
          (${uuidv7()}, ${a.id}, ${rq2}, 'REQ/AM2', ${cat}, ${s1}, 'Family', 'admin', now(), '{}')`);
        await tx.execute(sql`insert into notifications (id, school_id, user_id, topic, title, body, private_body) values
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'message.new', 'New message', 'dm-body-secret', false),
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'homework.new', 'Marks', 'private-flag-secret', true),
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'notice.published', 'Sports day', 'public-body-ok', false)`);
        await tx.execute(sql`insert into meeting_days (id, school_id, title, audience, opens_at, closes_at) values (${meeting}, ${a.id}, 'PTM', '{"include":[{"type":"everyone"}],"exclude":[]}'::jsonb, now(), now() + interval '1 day')`);
        await tx.execute(sql`insert into meeting_windows (id, school_id, meeting_id, teacher_id, day, starts_at, ends_at) values (${win}, ${a.id}, ${meeting}, ${a.users.teacher}, current_date, now(), now() + interval '1 hour')`);
        await tx.execute(sql`insert into meeting_slots (id, school_id, meeting_id, window_id, teacher_id, starts_at, ends_at, student_id, private_note) values (${uuidv7()}, ${a.id}, ${meeting}, ${win}, ${a.users.teacher}, now(), now() + interval '10 minutes', ${s1}, 'staff-only-slot-note')`);
      });
    });
    const svc = () => new ExportService({ ...a.as.admin, features: new Set(["settings", "messages"]) });

    it("a plain school file drops private notification words and the staff note on meeting slots", async () => {
      const file = await asJson((await new ExportService(a.as.admin).exportSchool()).url);
      const text = JSON.stringify(file);
      for (const gone of ["dm-body-secret", "private-flag-secret", "staff-only-slot-note"]) expect(text).not.toContain(gone);
      expect(text).toContain("public-body-ok");
      expect(file.tables.notifications.find((n: { topic: string }) => n.topic === "message.new")).toMatchObject({ title: "New message", body: null });
      expect(file.tables.meeting_slots[0]).not.toHaveProperty("private_note");
    });

    it("with the tick the staff note is kept, but nothing written about the exporter is", async () => {
      const file = await asJson((await svc().exportSchool({ includePrivate: true, reason: "Court order 15/2026" })).url);
      const text = JSON.stringify(file);
      expect(text).toContain("staff-only-slot-note");
      expect(text).toContain("dm-body-secret");
      expect(text).toContain("ordinary-body");
      for (const gone of ["about-admin-body", "Talk naming the admin", "report-naming-admin", "review-of-admin-thread", "Complaint about admin", "REQ/AM1"]) expect(text).not.toContain(gone);
      expect(text).toContain("report-naming-teacher");
      expect(text).toContain("REQ/AM2");
    });

    it("a student's file leaves out the same", async () => {
      const text = JSON.stringify(await asJson((await new ExportService(a.as.admin).exportStudent({ studentId: s1 })).url));
      expect(text).toContain("ordinary-body");
      expect(text).toContain("REQ/AM2");
      expect(text).not.toContain("staff-only-slot-note");
      for (const gone of ["about-admin-body", "Talk naming the admin", "Complaint about admin", "REQ/AM1"]) expect(text).not.toContain(gone);
    });
  });
});
