import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, auditLogs, closeDb, eq, sql, withConsole, withSchool } from "@smw/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError, systemCtx, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { ENQUIRY_CONSENT_TEXT } from "@smw/site-templates";
import {
  EnquiryImportService, EnquiryReportService, EnquiryService, EnquirySettingsService, PublicEnquiryService, addWorkingHours, loadEnquirySettings, phoneKeyOf,
} from "./service";
import { EnquiryClock, enquiryJobs } from "./enquiry-jobs";
import { ipKey } from "./enquiry-core";
import { listQueryOf } from "./enquiry-reads";
import { normalizePhone } from "@smw/site-templates";
import { enquiries, enquiryEvents, enquirySettings, enquiryTasks } from "./schema";

const FEATURES = ["announcements", "events", "website", "students"];
let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();
beforeAll(async () => { ({ a, b } = await createSchoolPair(FEATURES, "enq")); useServices({ storage: new MemoryStorage(), email: mail }); });
afterAll(closeDb);
beforeEach(() => { mail.sent.length = 0; PublicEnquiryService.limiter.reset(`${a.id}:1.2.3.4`); PublicEnquiryService.schoolLimiter.reset(a.id); });

const form = (over: Record<string, unknown> = {}) => ({ studentName: "Riya Sharma", parentName: "Sunita Sharma", phone: "9876543210", classApplying: "Class 3", consent: "true", ...over });
const pub = (s: TestSchool = a) => PublicEnquiryService.forSchool(s.id, FEATURES);
const manual = (over: Record<string, unknown> = {}) => ({ studentName: "Aman Verma", parentName: "Raj Verma", phone: "9811111111", ...over });
let n = 0;
/** A phone number nobody used yet, so tests never meet each other's rows. */
const phone = () => `98${String(10_000_000 + ++n * 7).padStart(8, "0")}`;
const add = (svc: EnquiryService, over: Record<string, unknown> = {}) => svc.create(manual({ phone: phone(), ...over }));
const events = (id: string) => withSchool(a.id, (tx) => tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, id)).orderBy(enquiryEvents.createdAt));
const tasks = (id: string) => withSchool(a.id, (tx) => tx.select().from(enquiryTasks).where(eq(enquiryTasks.enquiryId, id)).orderBy(enquiryTasks.dueAt));
const row = (id: string, s = a) => withSchool(s.id, async (tx) => (await tx.select().from(enquiries).where(eq(enquiries.id, id)))[0]!);
const rows = (s: TestSchool, topic: string, subject: string) => withSchool(s.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.topic, topic as never), eq(notifications.subjectId, subject))));
/** A student row, made straight in the table (the students module is not needed to test the link). */
const student = (name = "Test Student", no = `T${++n}`) => withSchool(a.id, async (tx) => ([...(await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (gen_random_uuid(), ${a.id}, ${no}, ${name}) returning id`))] as { id: string }[])[0]!.id);
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T");

const admin = () => new EnquiryService(a.as.admin);
const clerk = () => new EnquiryService(a.as.accountant);

describe("the public form (W10, W11, W12)", () => {
  it("W12: consent is required, and its words and time are kept", async () => {
    await expect(pub().submit(form({ consent: undefined, phone: phone() }), { ip: "1.2.3.4" })).rejects.toMatchObject({ fieldErrors: { consent: expect.any(String) } });
    const p = phone();
    await pub().submit(form({ phone: p }), { ip: "1.2.3.4" });
    const e = (await withSchool(a.id, (tx) => tx.select().from(enquiries).where(eq(enquiries.phoneKey, p))))[0]!;
    expect(e.consentAt).toBeInstanceOf(Date);
    expect(e.consentText).toContain(ENQUIRY_CONSENT_TEXT);
    expect(e.source).toBe("website");
  });

  it("gives a gap-free reference by year, normalises the phone and makes the first next step", async () => {
    await pub().submit(form({ phone: "+91 98765 43211", studentName: "Ref One" }), { ip: "1.2.3.4" });
    await pub().submit(form({ phone: phone(), studentName: "Ref Two" }), { ip: "1.2.3.4" });
    const year = new Date().getFullYear();
    const e = (await admin().list({ q: "Ref One" })).rows[0]!;
    const e2 = (await admin().list({ q: "Ref Two" })).rows[0]!;
    expect(e.ref).toMatch(new RegExp(`^E-${year}-\\d{4}$`));
    expect(Number(e2.ref!.slice(-4))).toBe(Number(e.ref!.slice(-4)) + 1);
    expect(e.phone).toBe("9876543211");
    expect(e.phoneKey).toBe("9876543211");
    expect(phoneKeyOf("+91 98765-43211")).toBe("9876543211");
    const t = await tasks(e.id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "call", doneAt: null });
    expect(e.nextAt?.getTime()).toBe(t[0]!.dueAt.getTime());
    expect(e.callDueAt).toBeInstanceOf(Date);
  });

  it("W10: the owner or the office is told, and the family gets a mail with the reference", async () => {
    await pub().submit(form({ phone: phone(), email: "family@example.com", studentName: "Mail Kid" }), { ip: "1.2.3.4" });
    const e = (await admin().list({ q: "Mail Kid" })).rows[0]!;
    const r = { ref: e.ref };
    const told = await rows(a, "enquiry.new", e.id);
    expect(new Set(told.map((t) => t.userId))).toEqual(new Set([a.users.admin, a.users.accountant]));
    expect(told.every((t) => t.privateBody && t.action)).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "family@example.com" });
    expect(mail.sent[0]!.text).toContain(r.ref!);
    expect((await events(e.id)).map((x) => x.kind)).toEqual(["created", "email"]);
    // Nobody to mail: the enquiry is still taken.
    await pub().submit(form({ phone: phone(), studentName: "No Mail" }), { ip: "1.2.3.4" });
    expect(mail.sent).toHaveLength(1);
  });

  it("W11: the same phone and child within 30 days adds to the first enquiry, with the same success", async () => {
    const p = phone();
    const first = await pub().submit(form({ phone: p, studentName: "Twice Kid", email: "t@example.com" }), { ip: "1.2.3.4" });
    const second = await pub().submit(form({ phone: p, studentName: "twice kid", message: "Any news?" }), { ip: "1.2.3.4" });
    expect(second).toEqual(first);
    expect(second).toEqual({ received: true });
    const all = await admin().list({ q: "Twice Kid" });
    expect(all.total).toBe(1);
    const ev = await events(all.rows[0]!.id);
    expect(ev.map((x) => x.kind)).toContain("again");
    expect(ev.find((x) => x.kind === "again")!.body).toContain("Any news?");
    expect(mail.sent).toHaveLength(1);
    // Another child on the same phone is a new enquiry, and each shows the other.
    await pub().submit(form({ phone: p, studentName: "Sibling Kid" }), { ip: "1.2.3.4" });
    const sib = (await admin().list({ q: "Sibling Kid" })).rows[0]!;
    const d = await admin().detail(sib.id);
    expect(d.duplicates.map((x) => x.studentName)).toEqual(["Twice Kid"]);
    // A month later it is a new enquiry again.
    await withConsole((tx) => tx.execute(sql`update enquiries set created_at = now() - interval '31 days' where id = ${all.rows[0]!.id}`));
    await pub().submit(form({ phone: p, studentName: "Twice Kid" }), { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Twice Kid" })).total).toBe(2);
  });

  it("two posts at once make one row", async () => {
    const p = phone();
    await Promise.all([pub().submit(form({ phone: p, studentName: "Race Kid" }), { ip: "1.2.3.4" }), pub().submit(form({ phone: p, studentName: "Race Kid" }), { ip: "1.2.3.4" })]);
    expect((await admin().list({ q: "Race Kid" })).total).toBe(1);
  });

  it("a filled honeypot or a form sent too fast is accepted and stores nothing; limits hold", async () => {
    const before = (await admin().list()).total;
    expect(await pub().submit(form({ website: "http://spam.example", phone: phone() }), { ip: "1.2.3.4" })).toEqual({ received: true });
    expect((await admin().list()).total).toBe(before);
    // A form sent too fast is not dropped: the person is asked to press Send again, and the same post a moment later goes through.
    const fast = form({ ts: String(Date.now() - 200), phone: phone(), studentName: "Quick Kid" });
    await expect(pub().submit(fast, { ip: "1.2.3.4" })).rejects.toMatchObject({ code: "too_fast" });
    expect((await admin().list({ q: "Quick Kid" })).total).toBe(0);
    await pub().submit({ ...fast, ts: String(Date.now() - 2000) }, { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Quick Kid" })).total).toBe(1);
    // A start time in the future or from yesterday means nothing.
    await pub().submit(form({ ts: String(Date.now() + 3_600_000), phone: phone(), studentName: "Future Kid" }), { ip: "1.2.3.4" });
    await pub().submit(form({ ts: String(Date.now() - 86_400_000), phone: phone(), studentName: "Old Kid" }), { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Future Kid" })).total + (await admin().list({ q: "Old Kid" })).total).toBe(2);
    await pub().submit(form({ ts: String(Date.now() - 20_000), phone: phone(), studentName: "Slow Kid" }), { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Slow Kid" })).total).toBe(1);
    // Ten posts from one address: 8 an hour.
    PublicEnquiryService.limiter.reset(`${a.id}:1.2.3.4`);
    const send = () => pub().submit(form({ phone: phone(), studentName: "Limit Kid" }), { ip: "1.2.3.4" });
    for (let i = 0; i < 8; i++) await send();
    const err = await send().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(429);
    await expect(pub().submit(form({ phone: phone() }), { ip: "5.6.7.8" })).resolves.toMatchObject({ received: true });
    // The whole school, whatever the addresses.
    for (let i = 0; i < 200; i++) PublicEnquiryService.schoolLimiter.take(a.id);
    await expect(pub().submit(form({ phone: phone() }), { ip: "9.9.9.9" })).rejects.toMatchObject({ status: 429 });
  });

  it("takes a question as its own kind, campaign from the address, and refuses a bad session", async () => {
    await pub().submit({ kind: "question", parentName: "Pooja Verma", phone: phone(), message: "Is there a summer camp?", consent: "on", utm_source: "instagram", utm_campaign: "summer" }, { ip: "1.2.3.4" });
    const q = (await admin().list({ filters: { kind: "question" }, q: "Pooja" })).rows[0]!;
    expect(q).toMatchObject({ kind: "question", studentName: "General question", campaign: "instagram / summer" });
    await expect(pub().submit(form({ phone: phone(), session: "1999-00" }), { ip: "1.2.3.4" })).rejects.toMatchObject({ fieldErrors: { session: expect.any(String) } });
    expect(await pub().options(["Class 1", "Class 2"])).toMatchObject({ classes: ["Class 1", "Class 2"], consentText: ENQUIRY_CONSENT_TEXT });
  });

  it("the public service cannot read anything of another school", async () => {
    await pub(b).submit(form({ phone: phone(), studentName: "Only In B" }), { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Only In B" })).total).toBe(0);
    expect((await new EnquiryService(b.as.admin).list({ q: "Only In B" })).total).toBe(1);
    expect(await PublicEnquiryService.forSchool(a.id, ["announcements"]).submit(form(), {}).catch((e) => e)).toBeInstanceOf(Error);
  });
});

describe("stages", () => {
  it("W9-ready rules: closing needs a reason, admitted is only by admitting, a question has three stages", async () => {
    const e = await add(admin());
    await expect(admin().moveTo(e.id, { to: "admitted" })).rejects.toBeInstanceOf(ConflictError);
    await expect(admin().moveTo(e.id, { to: "closed" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    const q = await add(admin(), { kind: "question" });
    await expect(admin().moveTo(q.id, { to: "visit" })).rejects.toBeInstanceOf(ConflictError);
    await admin().moveTo(q.id, { to: "contacted" });
    await expect(admin().moveTo(e.id, { to: "bogus" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps the furthest stage reached across a move back, the waitlist and a close; every move is logged", async () => {
    const e = await add(admin());
    for (const to of ["contacted", "visit", "visited", "applied"] as const) await admin().moveTo(e.id, { to });
    await admin().moveTo(e.id, { to: "contacted" });
    expect(await row(e.id)).toMatchObject({ status: "contacted", reached: "applied" });
    await admin().moveTo(e.id, { to: "waitlist" });
    await admin().moveTo(e.id, { to: "closed", reason: "Fees are too high" });
    const closed = await row(e.id);
    expect(closed).toMatchObject({ status: "closed", reached: "applied", closeReason: "Fees are too high", nextAt: null });
    expect((await tasks(e.id)).every((t) => t.doneAt)).toBe(true);
    const stageLines = (await events(e.id)).filter((x) => x.kind === "stage");
    expect(stageLines).toHaveLength(7);
    // Opened again: back to a stage, with a next step so it never sits without one.
    await admin().moveTo(e.id, { to: "contacted" });
    const open = await row(e.id);
    expect(open).toMatchObject({ status: "contacted", closeReason: null });
    expect(open.nextAt).toBeInstanceOf(Date);
  });

  it("refuses a move when somebody moved it first, and an enquiry that was joined", async () => {
    const e = await add(admin());
    await admin().moveTo(e.id, { to: "contacted" });
    await expect(admin().moveTo(e.id, { to: "visit", from: "new" })).rejects.toThrow(/moved this enquiry to Contacted/);
    expect((await row(e.id)).status).toBe("contacted");
  });

  it("an old closed row keeps its place and reads as 'Not recorded' in the report", async () => {
    const e = await add(admin());
    await withConsole((tx) => tx.execute(sql`update enquiries set status = 'closed', close_reason = null where id = ${e.id}`));
    const r = await new EnquiryReportService(a.as.admin).summary({});
    expect(r.lost.some((l) => l.reason === "Not recorded")).toBe(true);
  });
});

describe("calls, next steps and visits", () => {
  it("a call sets the natural next step, the owner and the first-contact time", async () => {
    const e = await add(admin());
    await withConsole((tx) => tx.execute(sql`update enquiries set owner_id = null where id = ${e.id}`));
    const none = await clerk().logCall(e.id, { outcome: "no_answer" });
    expect(none.ownerId).toBe(a.users.accountant);
    expect((await row(e.id)).firstContactAt).toBeInstanceOf(Date);
    const open = (await tasks(e.id)).filter((t) => !t.doneAt);
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe("Try again");
    await clerk().logCall(e.id, { outcome: "talked", note: "Wants a visit" });
    expect((await row(e.id)).status).toBe("contacted");
    await clerk().logCall(e.id, { outcome: "call_later", laterAt: later(3) });
    await clerk().logCall(e.id, { outcome: "wrong_number" });
    expect((await tasks(e.id)).filter((t) => !t.doneAt)).toHaveLength(1);
    await clerk().logCall(e.id, { outcome: "not_interested" });
    expect(await row(e.id)).toMatchObject({ status: "closed", closeReason: "Not interested", nextAt: null });
    await expect(clerk().logCall(e.id, { outcome: "talked" })).rejects.toBeInstanceOf(ConflictError);
    await expect(clerk().logCall(e.id, { outcome: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("nextAt always follows the earliest open task", async () => {
    const e = await add(admin(), { nextOn: later(5) });
    const soon = await admin().addTask(e.id, { kind: "document", dueAt: later(1), title: "Birth certificate" });
    expect((await row(e.id)).nextAt?.getTime()).toBe(soon.dueAt.getTime());
    await admin().doneTask(soon.id, { outcome: "Received" });
    const left = (await tasks(e.id)).find((t) => !t.doneAt)!;
    expect((await row(e.id)).nextAt?.getTime()).toBe(left.dueAt.getTime());
    await expect(admin().doneTask(soon.id, { outcome: "Again" })).rejects.toBeInstanceOf(ConflictError);
    const moved = await admin().postpone(left.id, { dueAt: later(9) });
    expect((await row(e.id)).nextAt?.getTime()).toBe(moved.dueAt.getTime());
    await expect(admin().addTask(e.id, { kind: "call", dueAt: later(1), ownerId: a.users.teacher })).rejects.toMatchObject({ fieldErrors: { ownerId: expect.any(String) } });
  });

  it("books a visit: stage, next step and a mail with a calendar file; records it afterwards", async () => {
    const withMail = await add(admin(), { email: "visit@example.com" });
    const r = await admin().bookVisit(withMail.id, { at: later(2), note: "Campus tour" });
    expect(r.mailed).toBe("sent");
    expect(r.enquiry.status).toBe("visit");
    const m = mail.sent.at(-1)!;
    expect(m.to).toBe("visit@example.com");
    expect(m.attachments?.[0]).toMatchObject({ filename: "visit.ics" });
    expect(new TextDecoder().decode(m.attachments![0]!.content)).toContain("BEGIN:VEVENT");
    expect((await tasks(withMail.id)).filter((t) => t.kind === "visit" && !t.doneAt)).toHaveLength(1);
    // Booking again moves the slot instead of adding a second one.
    await admin().bookVisit(withMail.id, { at: later(3) });
    expect((await tasks(withMail.id)).filter((t) => t.kind === "visit" && !t.doneAt)).toHaveLength(1);
    const done = await admin().recordVisit(withMail.id, { note: "Liked it" });
    expect(done.status).toBe("visited");
    expect((await tasks(withMail.id)).some((t) => t.title === "Follow up after the visit" && !t.doneAt)).toBe(true);
    const bare = await add(admin());
    expect((await admin().bookVisit(bare.id, { at: later(1) })).mailed).toBe("no-email");
    await expect(admin().bookVisit(bare.id, { at: "2020-01-01T10:00" })).rejects.toMatchObject({ fieldErrors: { at: expect.any(String) } });
  });

  it("WhatsApp opens a link with the text ready and records that it was opened; email needs an address", async () => {
    const e = await add(admin(), { studentName: "Wa Kid", parentName: "Wa Parent", classApplying: "Class 2", email: "wa@example.com" });
    const wa = await admin().whatsapp(e.id, { template: "first-contact" });
    expect(wa.url.startsWith(`https://wa.me/91${e.phoneKey}?text=`)).toBe(true);
    expect(wa.text).toContain("Wa Kid");
    expect(wa.text).toContain(e.ref);
    expect(decodeURIComponent(wa.url.split("text=")[1]!)).toBe(wa.text);
    expect((await events(e.id)).some((x) => x.kind === "whatsapp")).toBe(true);
    const sent = await admin().sendEmail(e.id, { template: "visit-mail" });
    expect(sent.result).toBe("sent");
    expect(mail.sent.at(-1)!.text).toContain("Wa Parent");
    const noMail = await add(admin());
    await expect(admin().sendEmail(noMail.id, { text: "Hello" })).rejects.toMatchObject({ fieldErrors: { email: expect.any(String) } });
    await expect(admin().whatsapp(e.id, { template: "missing" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only gives a next step to a person who works with enquiries", async () => {
    const e = await add(admin());
    expect((await admin().addTask(e.id, { kind: "call", dueAt: later(1), ownerId: a.users.accountant })).ownerId).toBe(a.users.accountant);
  });
});

describe("joining, deleting and admitting", () => {
  it("joins two enquiries of one family: the older reference stays, the timeline moves, the other cannot be edited or opened for action", async () => {
    const p = phone();
    const older = await admin().create(manual({ phone: p, studentName: "Twin A", email: undefined }));
    const newer = await admin().create(manual({ phone: p, studentName: "Twin A", email: "twin@example.com" }));
    await admin().note(newer.id, { text: "Called twice" });
    const kept = await admin().merge({ keepId: newer.id, otherId: older.id });
    expect(kept.id).toBe(older.id);
    expect(kept.email).toBe("twin@example.com");
    expect((await events(older.id)).some((x) => x.body === "Called twice")).toBe(true);
    expect((await events(older.id)).some((x) => x.kind === "merged")).toBe(true);
    const gone = await row(newer.id);
    expect(gone.mergedInto).toBe(older.id);
    expect((await admin().list({ q: "Twin A" })).rows.map((r) => r.id)).toEqual([older.id]);
    await expect(admin().moveTo(newer.id, { to: "contacted" })).rejects.toBeInstanceOf(ConflictError);
    expect((await admin().detail(newer.id)).mergedInto?.id).toBe(older.id);
    await expect(admin().merge({ keepId: older.id, otherId: older.id })).rejects.toBeInstanceOf(ValidationError);
    expect((await withConsole((tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.schoolId, a.id), sql`${auditLogs.summary} like 'Joined two enquiries%'`)))).length).toBeGreaterThan(0);
  });

  it("W9: admitting links the student, closes the next steps and is safe to repeat", async () => {
    const e = await add(admin(), { studentName: "Link Kid" });
    const s1 = await student("Link Kid");
    const first = await admin().markAdmitted(e.id, s1);
    expect(first.already).toBe(false);
    expect(await row(e.id)).toMatchObject({ status: "admitted", convertedStudentId: s1, reached: "admitted", nextAt: null });
    expect((await tasks(e.id)).every((t) => t.doneAt)).toBe(true);
    expect((await events(e.id)).find((x) => x.kind === "admitted")!.detail).toMatchObject({ studentId: s1 });
    expect((await admin().markAdmitted(e.id, s1)).already).toBe(true);
    expect((await events(e.id)).filter((x) => x.kind === "admitted")).toHaveLength(1);
    expect((await admin().detail(e.id)).student).toMatchObject({ id: s1, name: "Link Kid" });
    await expect(admin().markAdmitted(e.id, await student())).rejects.toBeInstanceOf(ConflictError);
    await expect(admin().moveTo(e.id, { to: "contacted" })).rejects.toBeInstanceOf(ConflictError);
    const other = await add(admin());
    await expect(admin().markAdmitted(other.id, s1)).rejects.toThrow(/already came from enquiry/);
    await expect(admin().markAdmitted(other.id, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await expect(admin().remove(e.id)).rejects.toBeInstanceOf(ConflictError);
    // Another school's student is not a student here.
    const bId = await withSchool(b.id, async (tx) => ([...(await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (gen_random_uuid(), ${b.id}, 'B1', 'B Kid') returning id`))] as { id: string }[])[0]!.id);
    await expect(admin().markAdmitted(other.id, bId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows the family of the student who shares the phone", async () => {
    const p = phone();
    const sid = await student("Big Sister");
    await withSchool(a.id, async (tx) => {
      const [g] = [...(await tx.execute(sql`insert into guardians (id, school_id, name, phone) values (gen_random_uuid(), ${a.id}, 'Mum', ${`+91 ${p}`}) returning id`))] as { id: string }[];
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id) values (gen_random_uuid(), ${a.id}, ${sid}, ${g!.id})`);
    });
    const e = await admin().create(manual({ phone: p }));
    expect((await admin().detail(e.id)).siblings.map((s) => s.name)).toEqual(["Big Sister"]);
  });

  it("deleting is for the pipeline right only, and takes the timeline with it", async () => {
    const e = await add(admin());
    await expect(clerk().remove(e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await admin().remove(e.id);
    expect(await withSchool(a.id, (tx) => tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, e.id)))).toHaveLength(0);
    await expect(admin().get(e.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("who may do what", () => {
  it("an accountant works enquiries; only the pipeline right deletes, joins, imports, exports, sets up and gives them away", async () => {
    const e = await add(clerk());
    await clerk().logCall(e.id, { outcome: "talked" });
    await clerk().moveTo(e.id, { to: "visit" });
    await clerk().note(e.id, { text: "x" });
    expect((await clerk().bulk({ ids: [e.id], action: "stage", to: "visited" })).done).toBe(1);
    await expect(clerk().bulk({ ids: [e.id], action: "assign", ownerId: a.users.accountant })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clerk().assign(e.id, a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clerk().merge({ keepId: e.id, otherId: (await add(admin())).id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clerk().remove(e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clerk().exportRows()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EnquiryImportService(a.as.accountant).dryRun({ name: "x.csv", bytes: new TextEncoder().encode("a") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EnquirySettingsService(a.as.accountant).save({ keepMonths: 12 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EnquirySettingsService(a.as.accountant).saveSeats("2026-27", { rows: [] })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new EnquirySettingsService(a.as.accountant).get()).keepMonths).toBeGreaterThan(0);
    expect((await admin().exportRows()).length).toBeGreaterThan(0);
  });

  it("a teacher and a family see nothing; a custom role with only the work grant can work but not delete", async () => {
    for (const role of ["teacher", "student", "parent"] as const) {
      await expect(new EnquiryService(a.as[role]).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new EnquiryService(a.as[role]).create(manual())).rejects.toBeInstanceOf(ForbiddenError);
    }
    const custom: Ctx = { ...a.as.teacher, grants: new Set(["website:enquiries"]) };
    const e = await add(new EnquiryService(custom));
    await new EnquiryService(custom).note(e.id, { text: "ok" });
    await expect(new EnquiryService(custom).remove(e.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new EnquiryService({ ...custom, readOnly: true }).list()).toBeTruthy();
    await expect(new EnquiryService({ ...custom, readOnly: true }).note(e.id, { text: "no" })).rejects.toMatchObject({ code: "read_only" });
  });

  it("isolation: school B cannot see or change A's enquiries", async () => {
    const x = await add(admin(), { studentName: "Only In A" });
    const bSvc = new EnquiryService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === x.id)).toBe(false);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.moveTo(x.id, { to: "contacted" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.logCall(x.id, { outcome: "talked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.merge({ keepId: x.id, otherId: (await add(bSvc)).id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await bSvc.counts()).new).toBe((await bSvc.list({ filters: { stage: "new" } })).total);
    expect((await bSvc.today("all")).fresh.every((i) => i.enquiryId !== x.id)).toBe(true);
  });
});

describe("lists, views and reports", () => {
  it("filters by stage, owner, overdue and no next step; counts every stage", async () => {
    const mine = await add(clerk(), { studentName: "Filter Mine" });
    const late = await add(admin(), { studentName: "Filter Late" });
    await withConsole((tx) => tx.execute(sql`update enquiries set next_at = now() - interval '2 days' where id = ${late.id}`));
    const bare = await add(admin(), { studentName: "Filter Bare" });
    await withConsole((tx) => tx.execute(sql`update enquiries set next_at = null where id = ${bare.id}`));
    expect((await clerk().list({ filters: { owner: "me" }, q: "Filter" })).rows.map((r) => r.id)).toEqual([mine.id]);
    expect((await admin().list({ filters: { overdue: "1" }, q: "Filter" })).rows.map((r) => r.id)).toEqual([late.id]);
    expect((await admin().list({ filters: { nonext: "1" }, q: "Filter" })).rows.map((r) => r.id)).toEqual([bare.id]);
    expect((await admin().list({ filters: { stage: "open" }, q: "Filter" })).total).toBe(3);
    expect(Object.keys(await admin().counts()).sort()).toEqual(["admitted", "applied", "closed", "contacted", "new", "offered", "visit", "visited", "waitlist"]);
    expect((await admin().list({ q: "Filter Late" })).rows[0]).toMatchObject({ overdue: true, nextKind: "call" });
  });

  it("Today lists follow-ups due, visits today and new enquiries nobody called; mine and everyone's", async () => {
    const e = await add(admin(), { studentName: "Today Due" });
    await withConsole((tx) => tx.execute(sql`update enquiry_tasks set due_at = now() - interval '1 hour' where enquiry_id = ${e.id}`));
    const v = await add(admin(), { studentName: "Today Visit" });
    await withConsole((tx) => tx.execute(sql`update enquiries set first_contact_at = now() where id = ${v.id}`));
    await admin().bookVisit(v.id, { at: new Date(Date.now() + 60_000).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T") });
    const t = await admin().today("all");
    expect(t.due.some((i) => i.enquiryId === e.id && i.late)).toBe(true);
    expect(t.visits.some((i) => i.enquiryId === v.id)).toBe(true);
    expect(t.fresh.some((i) => i.enquiryId === e.id)).toBe(true);
    // The accountant's own list leaves out what is owned by somebody else.
    expect((await clerk().today("mine")).due.some((i) => i.enquiryId === e.id)).toBe(false);
  });

  it("the funnel counts the furthest stage; every number has a list link; the seats count offers", async () => {
    const svc = new EnquirySettingsService(a.as.admin);
    await svc.saveSeats("2030-31", { rows: [{ session: "2030-31", className: "Class Seat", seats: 3 }] });
    const e1 = await add(admin(), { classApplying: "Class Seat", session: "2030-31" });
    await add(admin(), { classApplying: "Class Seat", session: "2030-31" });
    await admin().moveTo(e1.id, { to: "offered" });
    expect((await admin().seatsFor(e1.id))).toMatchObject({ seats: 3, taken: 1, left: 2 });
    const r = await new EnquiryReportService(a.as.admin).summary({ session: "2030-31" });
    expect(r.total).toBe(2);
    expect(r.funnel.find((f) => f.stage === "offered")!.n).toBe(1);
    expect(r.funnel.find((f) => f.stage === "new")!.n).toBe(2);
    expect(r.byClass[0]).toMatchObject({ className: "Class Seat", n: 2, taken: 1, seats: 3, left: 2 });
    expect(r.funnel.every((f) => f.href.startsWith("/app/enquiries?view=list"))).toBe(true);
    const link = new URL(`http://x${r.funnel.find((f) => f.stage === "offered")!.href}`).searchParams;
    expect(link.get("reached")).toBe("offered");
    expect((await admin().list({ filters: { reached: "offered", session: "2030-31" } })).total).toBe(1);
    expect(r.owners.length).toBeGreaterThan(0);
  });

  it("bulk changes tell which ones could not change", async () => {
    const ok = await add(admin()), done = await add(admin());
    await admin().markAdmitted(done.id, await student());
    const r = await admin().bulk({ ids: [ok.id, done.id], action: "close", reason: "Not interested" });
    expect(r.done).toBe(1);
    expect(r.skipped[0]).toMatchObject({ ref: done.ref });
    expect((await row(ok.id)).status).toBe("closed");
    const given = await admin().bulk({ ids: [ok.id], action: "assign", ownerId: a.users.accountant });
    expect(given.done).toBe(1);
    expect((await row(ok.id)).ownerId).toBe(a.users.accountant);
    await expect(admin().bulk({ ids: [ok.id], action: "assign", ownerId: a.users.teacher })).rejects.toMatchObject({ fieldErrors: { ownerId: expect.any(String) } });
    await expect(admin().bulk({ ids: [], action: "close", reason: "x" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("settings", () => {
  it("reads defaults from an empty or damaged row, and a damaged field falls back alone", async () => {
    const s = await withSchool(b.id, loadEnquirySettings);
    expect(s).toMatchObject({ firstCallHours: 8, keepMonths: 24, owner: { mode: "none" } });
    expect(s.sources).toContain("walk-in");
    await withSchool(b.id, (tx) => tx.insert(enquirySettings).values({ schoolId: b.id, settings: { keepMonths: "forever", firstCallHours: 4, sources: ["fair"] } }));
    const damaged = await withSchool(b.id, loadEnquirySettings);
    expect(damaged).toMatchObject({ keepMonths: 24, firstCallHours: 4, sources: ["fair"] });
  });

  it("saves a change, rejects a bad owner, and gives new enquiries to people in turn", async () => {
    const svc = new EnquirySettingsService(a.as.admin);
    await expect(svc.save({ owner: { mode: "turn", userIds: [a.users.teacher] } })).rejects.toMatchObject({ fieldErrors: { owner: expect.any(String) } });
    await expect(svc.save({ owner: { mode: "one", userIds: [] } })).rejects.toMatchObject({ fieldErrors: { owner: expect.any(String) } });
    await expect(svc.save({ keepMonths: 2 })).rejects.toBeInstanceOf(ValidationError);
    await svc.save({ owner: { mode: "turn", userIds: [a.users.admin, a.users.accountant] }, firstCallHours: 4 });
    const owners = [] as (string | null)[];
    for (let i = 0; i < 4; i++) { await pub().submit(form({ phone: phone(), studentName: `Turn ${i}` }), { ip: "1.2.3.4" }); owners.push((await admin().list({ q: `Turn ${i}` })).rows[0]!.ownerId); }
    expect(owners[0]).not.toBe(owners[1]);
    expect(owners[0]).toBe(owners[2]);
    expect(owners[1]).toBe(owners[3]);
    // Told only the owner, not the whole office.
    const e = (await admin().list({ q: "Turn 0" })).rows[0]!;
    expect((await rows(a, "enquiry.new", e.id)).map((x) => x.userId)).toEqual([e.ownerId]);
    await svc.save({ owner: { mode: "none", userIds: [] }, firstCallHours: 8 });
  });

  it("seats are saved per session and replace what was there", async () => {
    const svc = new EnquirySettingsService(a.as.admin);
    await svc.saveSeats("2031-32", { rows: [{ session: "2031-32", className: "Class 1", seats: 30 }, { session: "2031-32", className: "Class 2", seats: 25 }] });
    await svc.saveSeats("2031-32", { rows: [{ session: "2031-32", className: "Class 1", seats: 35 }] });
    expect((await svc.seats("2031-32")).map((s) => [s.className, s.seats])).toEqual([["Class 1", 35]]);
    await expect(svc.saveSeats("2031-32", { rows: [{ session: "2032-33", className: "X", seats: 1 }] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("import", () => {
  const csv = (...lines: string[]) => ({ name: "fair.csv", bytes: new TextEncoder().encode(["child_name,parent_name,phone,class,email,date_of_birth,source", ...lines].join("\n")) });

  it("checks every row first: errors, duplicates in the file and in the list", async () => {
    const svc = new EnquiryImportService(a.as.admin);
    const known = await add(admin(), { studentName: "Known Kid", phone: "9000000001" });
    const report = await svc.dryRun(csv("Fair One,Parent One,9000000010,Class 1,,2019-05-01,fair", "Fair One,Parent One,9000000010,Class 1,,,", "Known Kid,Someone,9000000001,,,,", "Bad Phone,Parent,123,,,,", "No Mail,Parent,9000000011,,not-an-email,,"));
    expect(report).toMatchObject({ total: 5, ready: 1, failed: 2, duplicates: 2 });
    expect(report.rows[1]!.duplicateOf).toBe("an earlier row of this file");
    expect(report.rows[2]!.duplicateOf).toBe(known.ref);
    expect(report.rows[3]!.errors[0]).toContain("phone");
    expect(report.rows[3]!.line).toBe(5);
    expect(report.rows[4]!.errors[0]).toContain("email");
    await expect(svc.dryRun({ name: "x.csv", bytes: new TextEncoder().encode("name,phone\nA,1") })).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("missing the column") } });
  });

  it("is all or nothing: one bad row writes nothing; a clean file goes in with a next step for each, duplicates left out", async () => {
    const svc = new EnquiryImportService(a.as.admin);
    const before = (await admin().list()).total;
    await expect(svc.commit(csv("Good Kid,Parent,9000000020,,,,", "Bad Kid,Parent,12,,,,"))).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("1 of 2") } });
    expect((await admin().list()).total).toBe(before);
    const r = await svc.commit(csv("Fair Kid,Fair Parent,9000000030,Class 2,,,", "Fair Kid,Fair Parent,9000000030,Class 2,,,", "Another Kid,Parent,9000000031,,,2018-01-02,social"));
    expect(r).toEqual({ imported: 2, skipped: 1 });
    const kid = (await admin().list({ q: "Fair Kid" })).rows[0]!;
    expect(kid.source).toBe("fair");
    expect(kid.nextAt).toBeInstanceOf(Date);
    expect((await events(kid.id))[0]!.kind).toBe("imported");
    expect(EnquiryImportService.templateCsv()).toContain("child_name");
    expect((await withConsole((tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.schoolId, a.id), sql`${auditLogs.summary} like 'Imported 2 enquiries%'`)))).length).toBe(1);
  });
});

describe("clocks", () => {
  const clock = () => new EnquiryClock(systemCtx(a.id, ["website"]));

  it("reminds once when a next step is due, and once when the first call is late", async () => {
    const e = await add(admin(), { studentName: "Clock Kid" });
    await withConsole((tx) => tx.execute(sql`update enquiry_tasks set due_at = now() - interval '2 hours' where enquiry_id = ${e.id}`));
    await withConsole((tx) => tx.execute(sql`update enquiries set call_due_at = now() - interval '1 hour' where id = ${e.id}`));
    const first = await clock().clock();
    expect(first.reminded).toBeGreaterThan(0);
    expect(first.late).toBeGreaterThan(0);
    const again = await clock().clock();
    expect(again).toEqual({ reminded: 0, late: 0 });
    const told = await rows(a, "enquiry.followup", e.id);
    // The owner (the one who added it) gets both; the other admins hear of the late call. Nobody twice.
    expect(told.filter((t) => t.groupKey?.endsWith(":followup"))).toHaveLength(1);
    expect(told.filter((t) => t.groupKey?.endsWith(":late")).length).toBeGreaterThan(0);
    expect((await row(e.id)).lateToldAt).toBeInstanceOf(Date);
    expect((await tasks(e.id))[0]!.remindedAt).toBeInstanceOf(Date);
    // Called already: never "late".
    const called = await add(admin(), { studentName: "Clock Called" });
    await withConsole((tx) => tx.execute(sql`update enquiries set call_due_at = now() - interval '1 hour', first_contact_at = now() where id = ${called.id}`));
    await clock().clock();
    expect((await row(called.id)).lateToldAt).toBeNull();
  });

  it("a visit reminds on the day, before its hour", async () => {
    const e = await add(admin(), { studentName: "Clock Visit" });
    await admin().bookVisit(e.id, { at: new Date(Date.now() + 20 * 3_600_000).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T") });
    const visit = (await tasks(e.id)).find((t) => t.kind === "visit")!;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const dueDay = visit.dueAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await clock().clock();
    expect(Boolean((await tasks(e.id)).find((t) => t.id === visit.id)!.remindedAt)).toBe(today === dueDay);
  });

  it("retention deletes what nobody touched for the keeping time, keeps admitted children, and writes the count to the audit log", async () => {
    const old = await add(admin(), { studentName: "Retain Old" });
    const fresh = await add(admin(), { studentName: "Retain Fresh" });
    const kept = await add(admin(), { studentName: "Retain Admitted" });
    await admin().markAdmitted(kept.id, await student());
    await withConsole((tx) => tx.execute(sql`update enquiries set stage_at = now() - interval '30 months', updated_at = now() - interval '30 months' where id in (${old.id}, ${kept.id})`));
    const removed = await clock().retention();
    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(admin().get(old.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await admin().get(kept.id)).status).toBe("admitted");
    expect((await admin().get(fresh.id)).id).toBe(fresh.id);
    const logged = await withConsole((tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.schoolId, a.id), sql`${auditLogs.summary} like 'Deleted % enquiries not touched%'`)));
    expect(logged.at(-1)!.meta).toMatchObject({ count: removed, keepMonths: 24 });
    // The keeping time is the school's: 6 months keeps nothing older.
    await new EnquirySettingsService(a.as.admin).save({ keepMonths: 6, confirmRetention: true });
    const mid = await add(admin(), { studentName: "Retain Mid" });
    await withConsole((tx) => tx.execute(sql`update enquiries set stage_at = now() - interval '8 months', updated_at = now() - interval '8 months' where id = ${mid.id}`));
    await clock().retention();
    await expect(admin().get(mid.id)).rejects.toBeInstanceOf(NotFoundError);
    await new EnquirySettingsService(a.as.admin).save({ keepMonths: 24 });
  });

  it("the jobs the worker schedules exist", () => {
    expect(Object.keys(enquiryJobs).sort()).toEqual(["website.enquiry-clock", "website.enquiry-retention"]);
  });

  it("working hours are 9 to 6, Monday to Saturday, in IST", () => {
    const at = (s: string) => new Date(`${s}+05:30`);
    // Wednesday 10:00 + 8 h is closing time; 9 h is Thursday 10:00.
    expect(addWorkingHours(at("2026-11-25T10:00:00"), 8).toISOString()).toBe(at("2026-11-25T18:00:00").toISOString());
    expect(addWorkingHours(at("2026-11-25T10:00:00"), 9).toISOString()).toBe(at("2026-11-26T10:00:00").toISOString());
    // Saturday 17:00 + 2 h: 1 h left on Saturday, Sunday off, Monday 09:00 + 1 h.
    expect(addWorkingHours(at("2026-11-28T17:00:00"), 2).toISOString()).toBe(at("2026-11-30T10:00:00").toISOString());
    // The middle of the night starts at 09:00.
    expect(addWorkingHours(at("2026-11-25T02:00:00"), 1).toISOString()).toBe(at("2026-11-25T10:00:00").toISOString());
    expect(addWorkingHours(at("2026-11-25T10:00:00"), 0).toISOString()).toBe(at("2026-11-25T10:00:00").toISOString());
  });
});

describe("timeline", () => {
  it("is append-only: the service offers no way to change or remove a line", async () => {
    const e = await add(admin());
    await admin().note(e.id, { text: "one" });
    const before = (await events(e.id)).length;
    await admin().update(e.id, { ...manual({ phone: e.phone }), studentName: "Renamed" });
    const after = await events(e.id);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ kind: "edited", body: "Changed studentName" });
    expect(Object.getOwnPropertyNames(EnquiryService.prototype).filter((m) => /event/i.test(m))).toEqual([]);
  });
});

// ---------- the review round ----------

const admitted = async (name: string) => { const e = await add(admin(), { studentName: name }); const sid = await student(name); await admin().markAdmitted(e.id, sid); return { e, sid }; };

describe("a deleted student", () => {
  it("leaves a dead link that can be replaced, reopened or deleted, and the page data says so", async () => {
    const { e, sid } = await admitted("Gone Kid");
    await expect(admin().remove(e.id)).rejects.toBeInstanceOf(ConflictError);
    await withSchool(a.id, (tx) => tx.execute(sql`delete from students where id = ${sid}`));
    const d = await admin().detail(e.id);
    expect(d).toMatchObject({ linkDead: true, student: null });
    const fresh = await student("Gone Kid Again");
    expect((await admin().markAdmitted(e.id, fresh)).already).toBe(false);
    expect((await row(e.id)).convertedStudentId).toBe(fresh);
    // Reopen another one with a dead link, and delete a third.
    const two = await admitted("Gone Two");
    await withSchool(a.id, (tx) => tx.execute(sql`delete from students where id = ${two.sid}`));
    expect((await admin().moveTo(two.e.id, { to: "contacted" })).status).toBe("contacted");
    expect((await row(two.e.id)).convertedStudentId).toBeNull();
    const three = await admitted("Gone Three");
    await withSchool(a.id, (tx) => tx.execute(sql`delete from students where id = ${three.sid}`));
    await expect(clerk().remove(three.e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await admin().remove(three.e.id);
  });
});

describe("students are private to those who may see them", () => {
  it("without students:read the sibling hint says only that a family exists; linking needs students:write", async () => {
    const p = phone();
    const sid = await student("Hidden Sibling");
    await withSchool(a.id, async (tx) => {
      const [g] = [...(await tx.execute(sql`insert into guardians (id, school_id, name, phone) values (gen_random_uuid(), ${a.id}, 'Mum', ${p}) returning id`))] as { id: string }[];
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id) values (gen_random_uuid(), ${a.id}, ${sid}, ${g!.id})`);
    });
    const e = await admin().create(manual({ phone: p }));
    const work: Ctx = { ...a.as.accountant, grants: new Set(["website:enquiries"]) };
    const d = await new EnquiryService(work).detail(e.id);
    expect(d).toMatchObject({ siblings: [], siblingCount: 1, student: null, studentsRead: false });
    await expect(new EnquiryService(work).findStudents("Hidden")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EnquiryService(work).markAdmitted(e.id, sid)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EnquiryService(a.as.accountant).markAdmitted(e.id, sid)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new EnquiryService(a.as.teacher).findStudents("Hidden").catch((x) => x))).toBeInstanceOf(ForbiddenError);
    expect((await admin().findStudents("Hidden")).map((s) => s.label)).toEqual(["Hidden Sibling"]);
  });
});

describe("children who have not started or have left", () => {
  it("a child already accepted counts as a sibling and can be linked; a child who left does not", async () => {
    const p = phone();
    const make = (name: string, status: string) => withSchool(a.id, async (tx) => {
      const [k] = [...(await tx.execute(sql`insert into students (id, school_id, admission_no, name, status) values (gen_random_uuid(), ${a.id}, ${`S${++n}`}, ${name}, ${status}) returning id`))] as { id: string }[];
      const [g] = [...(await tx.execute(sql`insert into guardians (id, school_id, name, phone) values (gen_random_uuid(), ${a.id}, 'Mum', ${p}) returning id`))] as { id: string }[];
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id) values (gen_random_uuid(), ${a.id}, ${k!.id}, ${g!.id})`);
      return k!.id;
    });
    const waiting = await make("Zed Waiting", "joining");
    await make("Zed Gone", "left");
    const e = await admin().create(manual({ phone: p }));
    expect((await admin().detail(e.id)).siblings.map((s) => s.name)).toEqual(["Zed Waiting"]);
    expect((await admin().findStudents("Zed")).map((s) => s.label)).toEqual(["Zed Waiting"]);
    await expect(admin().markAdmitted(e.id, waiting)).resolves.toBeTruthy();
  });
});

describe("phone numbers", () => {
  it("one rule for every way people write a number", () => {
    for (const v of ["+91 98765 43210", "91-98765-43210", "09876543210", "(98765) 43210", "0091 9876543210", "98765 43210"]) expect(normalizePhone(v)).toBe("9876543210");
    expect(normalizePhone("080 2345 6789")).toBe("08023456789");
    expect(normalizePhone("011-2345-6789")).toBe("01123456789");
    expect(normalizePhone("0172 2345678")).toBe("01722345678");
    for (const v of ["123", "5876543210", "+1 415 555 0101", "abcdefghij", ""]) expect(normalizePhone(v)).toBeNull();
  });

  it("the office and the public form store the same normal form", async () => {
    await pub().submit(form({ phone: "09876543299", studentName: "Zero Kid" }), { ip: "1.2.3.4" });
    expect((await admin().list({ q: "Zero Kid" })).rows[0]).toMatchObject({ phone: "9876543299", phoneKey: "9876543299" });
    const land = await admin().create(manual({ phone: "080 2345 6789", studentName: "Land Kid" }));
    expect(land).toMatchObject({ phone: "08023456789", phoneKey: "8023456789" });
    await expect(admin().create(manual({ phone: "12345" }))).rejects.toMatchObject({ fieldErrors: { phone: expect.any(String) } });
  });
});

describe("the thank-you mail", () => {
  it("goes once a day to an address or a phone, keeps the visitor's words out, and has its own daily cap", async () => {
    mail.sent.length = 0;
    const p = phone();
    await pub().submit(form({ phone: p, studentName: "Ack One", parentName: "Evil <script>", email: "ack@example.com" }), { ip: "1.2.3.4" });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).not.toContain("Evil");
    expect(mail.sent[0]!.text).not.toContain("Ack One");
    expect(mail.sent[0]!.text).toMatch(/E-\d{4}-\d{4}/);
    // Same address, other phone: no second mail. Same phone, other address: none either.
    await pub().submit(form({ phone: phone(), studentName: "Ack Two", email: "ACK@example.com" }), { ip: "1.2.3.4" });
    await pub().submit(form({ phone: p, studentName: "Ack Three", email: "other@example.com" }), { ip: "1.2.3.4" });
    expect(mail.sent).toHaveLength(1);
    const skipped = (await admin().list({ q: "Ack Two" })).rows[0]!;
    expect((await events(skipped.id)).at(-1)!.body).toContain("not sent");
    // The school's own cap.
    await withConsole((tx) => tx.execute(sql`insert into enquiry_events (id, school_id, enquiry_id, kind, detail, by_name) select gen_random_uuid(), ${a.id}, ${skipped.id}, 'email', '{"ack":"sent"}'::jsonb, 'Website' from generate_series(1, 40)`));
    await pub().submit(form({ phone: phone(), studentName: "Ack Four", email: "four@example.com" }), { ip: "1.2.3.4" });
    expect(mail.sent).toHaveLength(1);
    await withConsole((tx) => tx.execute(sql`delete from enquiry_events where school_id = ${a.id} and detail->>'ack' = 'sent' and enquiry_id = ${skipped.id}`));
  });

  it("an IPv6 visitor is counted by the /64", () => {
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(ipKey("2001:0db8:1:2::1"));
    expect(ipKey("2001:db8:1:3::1")).not.toBe(ipKey("2001:db8:1:2::1"));
    expect(ipKey("1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("repeats and the public form", () => {
  it("shows no reference, logs a repeat once a day with at most 300 characters, and tells a question needs its text", async () => {
    const p = phone();
    const r1 = await pub().submit(form({ phone: p, studentName: "Rep Kid" }), { ip: "1.2.3.4" });
    const r2 = await pub().submit(form({ phone: p, studentName: "Rep Kid", message: "x".repeat(900) }), { ip: "1.2.3.4" });
    const r3 = await pub().submit(form({ phone: p, studentName: "Rep Kid", message: "again" }), { ip: "1.2.3.4" });
    expect([r1, r2, r3]).toEqual([{ received: true }, { received: true }, { received: true }]);
    const e = (await admin().list({ q: "Rep Kid" })).rows[0]!;
    const again = (await events(e.id)).filter((x) => x.kind === "again");
    expect(again).toHaveLength(1);
    expect(again[0]!.body!.length).toBeLessThan(330);
    await expect(pub().submit({ kind: "question", parentName: "No Words", phone: phone(), consent: "on" }, { ip: "1.2.3.4" })).rejects.toMatchObject({ fieldErrors: { message: expect.any(String) } });
  });

  it("the class must be one of the school's classes when it has them", async () => {
    await withSchool(b.id, (tx) => tx.execute(sql`insert into classes (id, school_id, name, grade) values (gen_random_uuid(), ${b.id}, 'Class 9', 9)`));
    try {
      await expect(pub(b).submit(form({ phone: phone(), classApplying: "Class 99" }), { ip: "1.2.3.4" })).rejects.toMatchObject({ fieldErrors: { classApplying: expect.any(String) } });
      await pub(b).submit(form({ phone: phone(), classApplying: "class 9", studentName: "Nine Kid" }), { ip: "1.2.3.4" });
      expect((await pub(b).options(["Class 9", "Class 8"])).classes).toEqual(["Class 9"]);
    } finally { await withSchool(b.id, (tx) => tx.execute(sql`delete from classes where school_id = ${b.id}`)); }
  });
});

describe("owners who left", () => {
  it("an owner who cannot sign in is not the one told: the people who work enquiries are", async () => {
    const p = phone();
    const e = await clerk().create(manual({ phone: p, studentName: "Left Owner" }));
    expect(e.ownerId).toBe(a.users.accountant);
    await withConsole((tx) => tx.execute(sql`update users set status = 'disabled' where id = ${a.users.accountant}`));
    try {
      await pub().submit(form({ phone: p, studentName: "Left Owner" }), { ip: "1.2.3.4" });
      const told = await rows(a, "enquiry.new", e.id);
      expect(told.map((t) => t.userId)).toEqual([a.users.admin]);
      await withConsole((tx) => tx.execute(sql`update enquiry_tasks set due_at = now() - interval '1 hour' where enquiry_id = ${e.id}`));
      await new EnquiryClock(systemCtx(a.id, ["website"])).clock();
      expect((await rows(a, "enquiry.followup", e.id)).every((t) => t.userId !== a.users.accountant)).toBe(true);
      expect((await rows(a, "enquiry.followup", e.id)).length).toBeGreaterThan(0);
    } finally { await withConsole((tx) => tx.execute(sql`update users set status = 'active' where id = ${a.users.accountant}`)); }
  });
});

describe("joining keeps the furthest stage", () => {
  it("the open, further enquiry wins; steps stay open; a closed result closes the moved steps", async () => {
    const p = phone();
    const older = await admin().create(manual({ phone: p, studentName: "Join Kid" }));
    const newer = await admin().create(manual({ phone: p, studentName: "Join Kid" }));
    await admin().moveTo(newer.id, { to: "visited" });
    await admin().moveTo(older.id, { to: "closed", reason: "Not interested" });
    const kept = await admin().merge({ keepId: older.id, otherId: newer.id });
    expect(kept.id).toBe(older.id);
    expect(kept).toMatchObject({ status: "visited", closeReason: null, ownerId: a.users.admin });
    expect(kept.reached).toBe("visited");
    expect(kept.nextAt).toBeInstanceOf(Date);
    expect((await tasks(older.id)).some((t) => !t.doneAt)).toBe(true);
    const q = phone();
    const c1 = await add(admin(), { phone: q, studentName: "Both Closed" }), c2 = await add(admin(), { phone: q, studentName: "Both Closed" });
    await admin().moveTo(c1.id, { to: "closed", reason: "Not interested" });
    await admin().moveTo(c2.id, { to: "closed", reason: "Too far away" });
    const closed = await admin().merge({ keepId: c1.id, otherId: c2.id });
    expect(closed.status).toBe("closed");
    expect((await tasks(closed.id)).every((t) => t.doneAt)).toBe(true);
    expect((await row(closed.id)).nextAt).toBeNull();
  });
});

describe("finishing a next step", () => {
  it("the last open step asks for the next one, or to close; another open step does not", async () => {
    const e = await add(admin());
    const only = (await tasks(e.id))[0]!;
    await expect(admin().doneTask(only.id, { outcome: "Done" })).rejects.toMatchObject({ fieldErrors: { nextOn: expect.any(String) } });
    expect((await tasks(e.id)).filter((t) => !t.doneAt)).toHaveLength(1);
    await admin().doneTask(only.id, { outcome: "Done", nextKind: "visit", nextOn: later(4) });
    const next = (await tasks(e.id)).find((t) => !t.doneAt)!;
    expect(next.kind).toBe("visit");
    expect((await row(e.id)).nextAt?.getTime()).toBe(next.dueAt.getTime());
    const extra = await admin().addTask(e.id, { kind: "document", dueAt: later(2) });
    await admin().doneTask(extra.id, { outcome: "Received" });
    await admin().doneTask(next.id, { outcome: "Came", closeReason: "Chose another school" });
    expect(await row(e.id)).toMatchObject({ status: "closed", closeReason: "Chose another school", nextAt: null });
  });
});

describe("claiming an admission", () => {
  it("a second press is held, a cancelled one is not, and a student made by a crashed run is found again", async () => {
    const e = await add(admin(), { studentName: "Claim Kid" });
    const first = await admin().startAdmission(e.id);
    expect(first.studentId).toBeNull();
    await expect(admin().startAdmission(e.id)).rejects.toThrow(/being admitted right now/);
    await admin().cancelAdmission(e.id, first.token);
    const second = await admin().startAdmission(e.id);
    // The run dies after the student is made and before its id is saved.
    const sid = await student("Claim Kid");
    const third = await admin().startAdmission(e.id).catch((x) => x);
    expect(third).toBeInstanceOf(ConflictError);
    await withConsole((tx) => tx.execute(sql`update enquiry_events set created_at = created_at - interval '5 minutes' where enquiry_id = ${e.id} and detail ? 'claim'`));
    const found = await admin().startAdmission(e.id);
    expect(found.studentId).toBe(sid);
    expect(second.token).toBeTruthy();
    await admin().saveClaimStudent(e.id, found.token, sid);
    expect((await admin().startAdmission(e.id)).studentId).toBe(sid);
    expect((await admin().markAdmitted(e.id, sid)).already).toBe(false);
    // Claims are never lines of the timeline.
    expect((await admin().detail(e.id)).events.every((x) => !(x.detail as { claim?: string }).claim)).toBe(true);
    await expect(admin().startAdmission(e.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(clerk().startAdmission((await add(admin())).id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reports and spreadsheets match the list", () => {
  const total = async (href: string) => {
    const p = new URL(`http://x${href}`).searchParams;
    return (await admin().list({ ...listQueryOf(Object.fromEntries(p)), pageSize: 1 })).total;
  };

  it("every number of the report equals the rows of the list it links to; questions are left out", async () => {
    const svc = new EnquirySettingsService(a.as.admin);
    await svc.saveSeats("2040-41", { rows: [{ session: "2040-41", className: "Class R", seats: 5 }] });
    const mk = (over: Record<string, unknown>) => add(admin(), { session: "2040-41", classApplying: "Class R", source: "fair", campaign: "spring", ...over });
    const x1 = await mk({}), x2 = await mk({}), x3 = await mk({ source: "phone", classApplying: undefined });
    await add(admin(), { kind: "question", session: "2040-41" });
    await admin().moveTo(x1.id, { to: "offered" });
    await admin().moveTo(x2.id, { to: "closed", reason: "Too far away" });
    await admin().markAdmitted(x3.id, await student());
    await withConsole((tx) => tx.execute(sql`update enquiries set next_at = now() - interval '1 day' where id = ${x1.id}`));
    const r = await new EnquiryReportService(a.as.admin).summary({ session: "2040-41" });
    expect(r.total).toBe(3);
    for (const f of r.funnel) expect(await total(f.href)).toBe(f.n);
    for (const c of r.byClass) { expect(await total(c.href)).toBe(c.n); expect(await total(c.takenHref)).toBe(c.taken); }
    expect(r.byClass.find((c) => c.className === "Class R")).toMatchObject({ n: 2, taken: 1, seats: 5, left: 4 });
    for (const s of r.bySource) { expect(await total(s.href)).toBe(s.n); expect(await total(s.admittedHref)).toBe(s.admitted); }
    for (const c of r.campaigns) { expect(await total(c.href)).toBe(c.n); expect(await total(c.admittedHref)).toBe(c.admitted); }
    for (const l of r.lost) expect(await total(l.href)).toBe(l.n);
    for (const o of r.owners) { expect(await total(o.href)).toBe(o.open); expect(await total(o.lateHref)).toBe(o.late); expect(await total(o.noneHref)).toBe(o.none); }
    expect(await total(r.response.neverHref)).toBe(r.response.never);
  });

  it("the spreadsheet has the rows of the screen, saved views included", async () => {
    await admin().saveView({ name: "Late ones", query: "overdue=1" });
    await admin().saveView({ name: "Late ones", query: "overdue=1&owner=me" });
    expect(await admin().myViews()).toEqual([{ name: "Late ones", query: "overdue=1&owner=me" }]);
    expect(await clerk().myViews()).toEqual([]);
    const views = await admin().myViews();
    for (const raw of [{}, { show: "overdue" }, { show: "my:Late ones" }, { show: "closed", q: "a" }, { stage: "new" }]) {
      const query = listQueryOf(raw, views);
      const screen: string[] = [];
      for (let page = 1; ; page++) { const p = await admin().list({ ...query, page, pageSize: 5 }); screen.push(...p.rows.map((r) => r.id)); if (page >= p.pageCount) break; }
      expect((await admin().exportRows(query)).map((r) => r.id).sort()).toEqual(screen.sort());
    }
    expect(listQueryOf({ show: "my:Late ones" }, views).filters).toMatchObject({ overdue: "1", owner: "me" });
    await expect(admin().saveView({ name: "x", query: "<script>" })).rejects.toBeInstanceOf(ValidationError);
    await admin().removeView("Late ones");
    expect(await admin().myViews()).toEqual([]);
    // Saved views live beside the settings and survive a settings change.
    await admin().saveView({ name: "Keep me", query: "stage=new" });
    await new EnquirySettingsService(a.as.admin).save({ firstCallHours: 8 });
    expect((await admin().myViews()).map((v) => v.name)).toEqual(["Keep me"]);
  });
});

describe("the keeping time", () => {
  it("waitlisted and offered children wait twice as long, and a shorter time says how many would go and needs a tick", async () => {
    const svcS = new EnquirySettingsService(a.as.admin);
    await svcS.save({ keepMonths: 24 });
    const wait = await add(admin(), { studentName: "Keep Wait" }), offer = await add(admin(), { studentName: "Keep Offer" }), plain = await add(admin(), { studentName: "Keep Plain" });
    await admin().moveTo(wait.id, { to: "waitlist" });
    await admin().moveTo(offer.id, { to: "offered" });
    await withConsole((tx) => tx.execute(sql`update enquiries set stage_at = now() - interval '30 months', updated_at = now() - interval '30 months' where id in (${wait.id}, ${offer.id}, ${plain.id})`));
    const clock = new EnquiryClock(systemCtx(a.id, ["website"]));
    expect(await clock.wouldDelete(24)).toBe(1);
    await expect(svcS.save({ keepMonths: 12 })).rejects.toMatchObject({ fieldErrors: { keepMonths: expect.stringContaining("would be deleted") } });
    expect((await withSchool(a.id, loadEnquirySettings)).keepMonths).toBe(24);
    await svcS.save({ keepMonths: 12, confirmRetention: true });
    expect(await clock.wouldDelete(12)).toBe(3);
    await svcS.save({ keepMonths: 24 });
    await clock.retention();
    await expect(admin().get(plain.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await admin().get(wait.id)).status).toBe("waitlist");
    expect((await admin().get(offer.id)).status).toBe("offered");
    await withConsole((tx) => tx.execute(sql`update enquiries set stage_at = now() - interval '50 months', updated_at = now() - interval '50 months' where id in (${wait.id}, ${offer.id})`));
    await clock.retention();
    await expect(admin().get(wait.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
