import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { privacyDue, reminderDue } from "./jobs";
import { DEFAULT_PRIVACY_DAYS, PrivacyService } from "./privacy-service";
import { ExportService } from "./export-service";
import { runExports } from "./export-run";
import { FilePolicy } from "./service";

let a: TestSchool, b: TestSchool;
let kid: string;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["settings", "students"], "-prv"));
  useServices({ storage: new MemoryStorage(), email: new MemoryEmailSender() });
  kid = uuidv7();
  await withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, access_until) values (${kid}, ${a.id}, 'PR-1', 'Privacy Kid', ${a.users.student}, 'left', current_date + 30)`));
});
afterAll(closeDb);

const istDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("raising a request", () => {
  it("a family login asks about its own child, a staff member about themselves; numbers run gap-free by year", async () => {
    const fam = await new PrivacyService(a.as.student).raise({ kind: "access", details: "Please send me everything you hold", contact: "9811111111" });
    expect(fam).toMatchObject({ subjectType: "student", subjectId: kid, subjectName: "Privacy Kid", raisedBy: a.users.student, state: "open" });
    expect(fam.ref).toBe(`P-${istDay().slice(0, 4)}-0001`);
    const staff = await new PrivacyService(a.as.teacher).raise({ kind: "correction", details: "My phone number is wrong in the record" });
    expect(staff).toMatchObject({ subjectType: "staff", subjectId: a.users.teacher });
    expect(staff.ref).toBe(`P-${istDay().slice(0, 4)}-0002`);
    expect(fam.dueOn).toBe(plus(istDay(), DEFAULT_PRIVACY_DAYS));
    expect(fam.steps).toHaveLength(1);
    await expect(new PrivacyService(a.as.teacher).raise({ kind: "access", details: "short" })).rejects.toBeInstanceOf(ValidationError);
    // B's numbers start again at 1.
    expect((await new PrivacyService(b.as.teacher).raise({ kind: "access", details: "Please send me my staff record" })).ref).toMatch(/-0001$/);
  });

  it("the admins hear of it, and the person sees only their own requests", async () => {
    const notes = await withSchool(a.id, (tx) => tx.execute<{ user_id: string; topic: string; href: string }>(sql`select user_id, topic, href from notifications where topic = 'privacy.request'`));
    expect(notes.some((n) => n.user_id === a.users.admin && n.href.startsWith("/app/settings/privacy/"))).toBe(true);
    expect((await new PrivacyService(a.as.student).mine()).map((r) => r.raisedBy)).toEqual([a.users.student]);
    expect((await new PrivacyService(a.as.teacher).mine())).toHaveLength(1);
  });

  it("works in a read-only school, and never in a support session", async () => {
    await expect(new PrivacyService({ ...a.as.teacher, readOnly: true }).raise({ kind: "complaint", details: "A complaint while read-only" })).resolves.toMatchObject({ kind: "complaint" });
    await expect(new PrivacyService({ ...a.as.teacher, supportStaffId: uuidv7() }).raise({ kind: "access", details: "Support asks for me" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PrivacyService({ ...a.as.admin, supportStaffId: uuidv7() }).list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the office writes one down, with an owner who must be an admin", async () => {
    const svc = new PrivacyService(a.as.admin);
    const r = await svc.create({ kind: "erasure", details: "Parent came to the office to ask", subjectType: "student", subjectId: kid, subjectName: "Privacy Kid", raisedByName: "Mrs Rao", contact: "9822222222" });
    expect(r).toMatchObject({ ownerId: a.users.admin, raisedBy: null, raisedByName: "Mrs Rao" });
    await expect(svc.create({ kind: "access", details: "Another ask for data", subjectType: "other", subjectName: "Someone", raisedByName: "Someone", ownerId: a.users.teacher })).rejects.toMatchObject({ fieldErrors: { ownerId: expect.any(String) } });
    expect((await svc.people("privacy"))[0]).toEqual({ id: `student:${kid}`, label: "Privacy Kid", meta: "Student PR-1" });
    expect(await new PrivacyService(b.as.admin).people("privacy")).toEqual([]);
  });
});

describe("working a request", () => {
  let id: string;
  beforeAll(async () => { id = (await new PrivacyService(a.as.admin).create({ kind: "correction", details: "The date of birth is wrong", subjectType: "student", subjectId: kid, subjectName: "Privacy Kid", raisedByName: "Mr Das" })).id; });

  it("a step starts the work; closing needs an outcome in words; closed means closed", async () => {
    const svc = new PrivacyService(a.as.admin);
    expect((await svc.addStep(id, { text: "Checked the birth certificate" })).state).toBe("in_progress");
    await expect(svc.close(id, { state: "done" })).rejects.toMatchObject({ fieldErrors: { outcome: expect.any(String) } });
    const done = await svc.close(id, { state: "done", outcome: "Corrected the date to 12 May 2014" });
    expect(done).toMatchObject({ state: "done", outcome: "Corrected the date to 12 May 2014", closedBy: a.users.admin });
    expect(done.steps.map((s) => s.text)).toEqual(["Written down by the office", "Checked the birth certificate", "Done: Corrected the date to 12 May 2014"]);
    await expect(svc.addStep(id, { text: "One more thing" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.assign(id, a.users.admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it("the person is told of the answer, and can withdraw only their own open request", async () => {
    const mine = await new PrivacyService(a.as.student).raise({ kind: "withdraw_consent", details: "I withdraw the photo consent" });
    const admin = new PrivacyService(a.as.admin);
    await expect(new PrivacyService(a.as.teacher).withdraw(mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await admin.close(mine.id, { state: "refused", outcome: "We need the photo for the ID card by law" });
    const told = await withSchool(a.id, (tx) => tx.execute<{ title: string }>(sql`select title from notifications where user_id = ${a.users.student} and topic = 'privacy.request' and title like ${`%${mine.ref}%`}`));
    expect(told.length).toBeGreaterThan(0);
    await expect(new PrivacyService(a.as.student).withdraw(mine.id)).rejects.toBeInstanceOf(ConflictError);
    const other = await new PrivacyService(a.as.student).raise({ kind: "complaint", details: "Please look at how my data is used" });
    await new PrivacyService(a.as.student).withdraw(other.id);
    expect((await admin.get(other.id)).state).toBe("withdrawn");
  });

  it("an access request makes the person's export in one click, only for an access request about a known person", async () => {
    const svc = new PrivacyService(a.as.admin);
    const acc = await svc.create({ kind: "access", details: "Send everything about the child", subjectType: "student", subjectId: kid, subjectName: "Privacy Kid", raisedByName: "Mr Das" });
    const res = await svc.makeAccessExport(acc.id);
    expect(res).toMatchObject({ label: "Student: Privacy Kid", status: "queued" });
    expect((await svc.get(acc.id)).steps.at(-1)!.text).toMatch(/Made the export/);
    await runExports({ schoolId: a.id });
    const staffAcc = await svc.create({ kind: "access", details: "Send everything about the teacher", subjectType: "staff", subjectId: a.users.teacher, subjectName: "Teacher", raisedByName: "Teacher" });
    expect((await svc.makeAccessExport(staffAcc.id)).label).toMatch(/^Person: /);
    await runExports({ schoolId: a.id });
    const unknown = await svc.create({ kind: "access", details: "Someone not in the records", subjectType: "other", subjectName: "Visitor", raisedByName: "Visitor" });
    await expect(svc.makeAccessExport(unknown.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.makeAccessExport(id)).rejects.toBeInstanceOf(ConflictError);
    expect(await new ExportService(a.as.admin).recent(5)).not.toHaveLength(0);
  });

  it("finishing an erasure closes the request with what was done (only for a deletion request)", async () => {
    const svc = new PrivacyService(a.as.admin);
    const er = await svc.create({ kind: "erasure", details: "Please delete my child's data", subjectType: "student", subjectId: kid, subjectName: "Privacy Kid", raisedByName: "Mr Das" });
    expect((await svc.finishErasure(er.id, "Blanked: phone numbers, address")).state).toBe("done");
    const co = await svc.create({ kind: "correction", details: "A correction to make here", subjectType: "other", subjectName: "Xy", raisedByName: "Xy" });
    await expect(svc.finishErasure(co.id, "nothing")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("the register", () => {
  it("lists with filters in the URL, shows overdue, counts, and keeps the days setting", async () => {
    const svc = new PrivacyService(a.as.admin);
    const late = await svc.create({ kind: "access", details: "An old request that is late", subjectType: "other", subjectName: "Late Person", raisedByName: "Late Person" });
    await withConsole((tx) => tx.execute(sql`update privacy_requests set due_on = ${plus(istDay(), -3)}::date where id = ${late.id}`));
    const row = (await svc.list({ q: "Late Person" })).rows[0]!;
    expect(row).toMatchObject({ id: late.id, overdue: true, daysLeft: -3 });
    expect((await svc.list({ filters: { overdue: "1" } })).rows.map((r) => r.id)).toContain(late.id);
    expect((await svc.list({ filters: { state: "done" } })).rows.every((r) => r.state === "done")).toBe(true);
    expect((await svc.list({ filters: { kind: "erasure" } })).rows.every((r) => r.kind === "erasure")).toBe(true);
    expect((await svc.list({ filters: { owner: "me" } })).rows.every((r) => r.ownerId === a.users.admin)).toBe(true);
    expect((await svc.counts()).overdue).toBeGreaterThanOrEqual(1);

    expect(await svc.days()).toBe(DEFAULT_PRIVACY_DAYS);
    await withSchool(a.id, (tx) => tx.execute(sql`insert into account_settings (id, school_id, settings) values (${uuidv7()}, ${a.id}, '{"alertNewDevice": true}'::jsonb) on conflict (school_id) do nothing`));
    expect(await svc.setDays({ days: 30 })).toBe(30);
    const [s] = await withSchool(a.id, (tx) => tx.execute<{ settings: Record<string, unknown> }>(sql`select settings from account_settings`));
    expect(s!.settings).toMatchObject({ privacyDays: 30 });
    expect((await svc.create({ kind: "access", details: "A fresh request after the change", subjectType: "other", subjectName: "Fresh", raisedByName: "Fresh" })).dueOn).toBe(plus(istDay(), 30));
    await expect(svc.setDays({ days: 3 })).rejects.toBeInstanceOf(ValidationError);
    await svc.setDays({ days: DEFAULT_PRIVACY_DAYS });
  });

  it("admin only (not delegable), and isolated between schools", async () => {
    await expect(new PrivacyService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PrivacyService(a.as.accountant).counts()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PrivacyService(a.as.teacher).create({})).rejects.toBeInstanceOf(ForbiddenError);
    const [one] = (await new PrivacyService(a.as.admin).list()).rows;
    await expect(new PrivacyService(b.as.admin).get(one!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new PrivacyService(b.as.admin).list()).rows.every((r) => r.schoolId === b.id)).toBe(true);
    await expect(new PrivacyService(b.as.admin).addStep(one!.id, { text: "Sneaky step" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("due reminders", () => {
  it("fire 14 days before, on the day, then weekly", () => {
    const due = "2026-06-30";
    expect(reminderDue(due, null, "2026-06-10")).toBe(false);
    expect(reminderDue(due, null, "2026-06-16")).toBe(true);
    expect(reminderDue(due, "2026-06-16", "2026-06-29")).toBe(false);
    expect(reminderDue(due, "2026-06-16", "2026-06-30")).toBe(true);
    expect(reminderDue(due, "2026-06-30", "2026-07-06")).toBe(false);
    expect(reminderDue(due, "2026-06-30", "2026-07-07")).toBe(true);
    expect(reminderDue(due, "2026-07-07", "2026-07-07")).toBe(false);
  });

  it("the job tells the owner once a day and marks it", async () => {
    const svc = new PrivacyService(a.as.admin);
    const r = await svc.create({ kind: "access", details: "A request that falls due soon", subjectType: "other", subjectName: "Soon Person", raisedByName: "Soon Person" });
    await withConsole((tx) => tx.execute(sql`update privacy_requests set due_on = ${plus(istDay(), 5)}::date, reminded_on = null where id = ${r.id}`));
    const count = () => withSchool(a.id, async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from notifications where subject_id = ${r.id} and title like '%due in%'`))[0]!.n);
    await privacyDue();
    const first = await count();
    expect(first).toBe(1);
    await privacyDue();
    expect(await count()).toBe(1);
    const [row] = await withSchool(a.id, (tx) => tx.execute<{ reminded_on: string }>(sql`select reminded_on::text from privacy_requests where id = ${r.id}`));
    expect(row!.reminded_on).toBe(istDay());
  });
});

describe("documents on a request", () => {
  const storage = new MemoryStorage();
  const PDF = (name = "id-proof.pdf") => ({ name, type: "application/pdf", size: 9, bytes: new TextEncoder().encode("%PDF-1.4\n1") });
  let id: string;
  beforeAll(async () => { useServices({ storage }); id = (await new PrivacyService(a.as.teacher).raise({ kind: "access", details: "A copy please, with my ID attached" })).id; });

  it("the person and the office add documents under the private area; the bytes decide the type", async () => {
    const [mine] = await new PrivacyService(a.as.teacher).addFiles(id, [PDF()]);
    expect(mine).toMatchObject({ fileName: "id-proof.pdf", contentType: "application/pdf", uploadedBy: a.users.teacher });
    const [office] = await new PrivacyService(a.as.admin).addFiles(id, [PDF("letter.pdf")]);
    expect(office!.uploadedBy).toBe(a.users.admin);
    const keys = [...storage.files.keys()].filter((k) => k.includes("/private/privacy/"));
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.startsWith(`${a.id}/private/privacy/${id}/`))).toBe(true);
    expect(keys.some((k) => FilePolicy.canRead(k, { schoolId: a.id, role: "admin" }))).toBe(false);
    await expect(new PrivacyService(a.as.teacher).addFiles(id, [{ name: "evil.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([77, 90, 0, 0]) }])).rejects.toThrow(/not a kind of file/);
    await expect(new PrivacyService(a.as.teacher).addFiles(id, [])).rejects.toBeInstanceOf(ValidationError);
    expect((await new PrivacyService(a.as.admin).files(id)).map((f) => f.fileName)).toEqual(["id-proof.pdf", "letter.pdf"]);
  });

  it("opening one gives a 60-second link and is logged; someone else's request is not found", async () => {
    const [f] = await new PrivacyService(a.as.teacher).files(id);
    const link = await new PrivacyService(a.as.teacher).fileLink(id, f!.id);
    expect(link).toMatchObject({ name: "id-proof.pdf", url: expect.stringContaining("/private/privacy/") });
    await new PrivacyService(a.as.admin).fileLink(id, f!.id);
    const logged = await withSchool(a.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'download' and entity = 'Privacy request' and entity_id = ${id}`));
    expect(logged[0]!.n).toBe(2);
    // Another person of the same school, not the office, cannot see or open it; neither can school B.
    await expect(new PrivacyService(a.as.student).files(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PrivacyService(a.as.student).fileLink(id, f!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PrivacyService(a.as.student).addFiles(id, [PDF()])).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PrivacyService(b.as.admin).fileLink(id, f!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PrivacyService(a.as.admin).fileLink(id, uuidv7())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refused in a support session; works read-only; a closed request takes no more", async () => {
    const support = new PrivacyService({ ...a.as.teacher, supportStaffId: uuidv7() });
    await expect(support.files(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.addFiles(id, [PDF()])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.fileLink(id, uuidv7())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PrivacyService({ ...a.as.teacher, readOnly: true }).addFiles(id, [PDF("late.pdf")])).resolves.toHaveLength(1);
    await new PrivacyService(a.as.admin).close(id, { state: "done", outcome: "Sent the copy by hand to the person" });
    await expect(new PrivacyService(a.as.teacher).addFiles(id, [PDF()])).rejects.toBeInstanceOf(ConflictError);
    expect(await new PrivacyService(a.as.teacher).files(id)).toHaveLength(3);
  });
});
