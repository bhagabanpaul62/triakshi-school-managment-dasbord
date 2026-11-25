import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ReadOnlyError, ValidationError } from "@smw/feature-kit";
import { notifications } from "@smw/feature-notifications/schema";
import { MemoryStorage, useServices } from "@smw/integrations";
import { AnnouncementService, CircularService, FeedService, NoticeService, ReportService, ResponseService, fanOut, announcementsVerifyLookups, AnnouncementCategoryService, TemplateService, NoticeFileService } from "./service";
import { build, type Fx } from "./fixtures";
import { expireNotices, lateJoiners, publishDue, responseReminders } from "./jobs";
import { publishNow } from "./quick";
import { announcementRecipients, announcementResponses, announcementVersions, announcements } from "./schema";

let fx: Fx, other: Fx;
const A = () => fx.school.as;
const ALL = { include: [{ type: "everyone" }], exclude: [] };
const section = (id: string) => ({ include: [{ type: "section", id }], exclude: [] });
const notes = (userId: string, noticeId?: string) => withSchool(fx.school.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), noticeId ? eq(notifications.subjectId, noticeId) : undefined)));
const rec = (id: string) => withSchool(fx.school.id, (tx) => tx.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id)));
const row = async (id: string) => (await withSchool(fx.school.id, (tx) => tx.select().from(announcements).where(eq(announcements.id, id))))[0]!;
const sql_ = (q: ReturnType<typeof sql>) => withSchool(fx.school.id, (tx) => tx.execute(q));
const pastDue = (id: string) => sql_(sql`update announcements set due_at = now() - interval '2 days' where id = ${id}::uuid`);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  fx = await build("n1");
  other = await build("n2");
});
afterAll(closeDb);

describe("write, publish, undo", () => {
  it("a draft saves with half the fields and the second save changes the same row", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ title: "Half" });
    await svc.saveDraft({ id, body: "Now with a body", audience: JSON.stringify(section(fx.ids.s5a!)) });
    const v = await svc.get(id);
    expect(v.notice).toMatchObject({ title: "Half", state: "draft", body: "Now with a body" });
    expect(v.audienceText).toContain("5");
    expect(v.can).toMatchObject({ edit: true, publish: true, undo: false, delete: true });
    expect(v.preview?.total).toBe(2);
  });

  it("publish is held for 30 seconds (3): undo leaves nobody with anything, and the job later sends nothing", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ title: "Undo me", body: "x", audience: section(fx.ids.s5a!) });
    const sent = await svc.publish(id);
    expect(sent.state).toBe("sending");
    expect(sent.sendAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect((await svc.get(id)).can.undo).toBe(true);
    await svc.undo(id);
    expect((await row(id)).state).toBe("draft");
    await publishDue(new Date(Date.now() + 3_600_000));
    expect(await rec(id)).toHaveLength(0);
    expect(await notes(fx.school.users.student, id)).toHaveLength(0);
    await expect(svc.undo(id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("once the 30 seconds are over the job sends it and undo is refused", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ title: "Too late", body: "x", audience: section(fx.ids.s5a!) });
    await svc.publish(id);
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where id = ${id}::uuid`);
    await expect(svc.undo(id)).rejects.toThrow(/already on its way/);
    await publishDue(new Date());
    expect((await row(id)).state).toBe("published");
    expect((await rec(id)).map((r) => r.name).sort()).toEqual(["Ann", "Bob"]);
    expect(await notes(fx.school.users.student, id)).toHaveLength(1);
  });

  it("an urgent alert needs confirming with the count, goes at once and cannot be undone or scheduled", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ type: "urgent", title: "Heavy rain", body: "School is closed.", audience: ALL });
    await expect(svc.publish(id)).rejects.toThrow(/people at once/);
    const out = await svc.publish(id, { confirmed: true });
    expect(out.state).toBe("published");
    const n = await row(id);
    expect(n.response).toEqual({ kind: "ack" });
    const mine = await notes(fx.school.users.student, id);
    expect(mine[0]).toMatchObject({ topic: "urgent.alert", urgent: true, action: true });
    await expect(svc.undo(id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("who may do what (1, 2, 12)", () => {
  it("1: a staff-only notice never reaches the website, by service or by direct SQL", async () => {
    const admin = new NoticeService(A().admin);
    await expect(admin.saveDraft({ title: "Staff meeting", body: "x", audience: { include: [{ type: "staff" }], exclude: [] }, website: true })).rejects.toMatchObject({ fieldErrors: { website: expect.any(String) } });
    const { id: staffOnly } = await admin.saveDraft({ title: "Staff meeting", body: "x", audience: { include: [{ type: "staff" }], exclude: [] } });
    await expect(sql_(sql`update announcements set website = true where id = ${staffOnly}::uuid`)).rejects.toThrow();
    // switching a public notice to a narrower audience quietly turns the website flag off
    const { id } = await admin.saveDraft({ title: "Open day", body: "Come and see", audience: ALL, website: true });
    expect((await row(id)).website).toBe(true);
    await admin.saveDraft({ id, audience: section(fx.ids.s5a!) });
    expect((await row(id)).website).toBe(false);

    const news = new AnnouncementService(A().admin);
    await publishNow(A().admin, { title: "Public one", body: "Everyone may read", audience: ALL, website: true });
    await publishNow(A().admin, { title: "Private one", body: "Class only", audience: section(fx.ids.s5a!) });
    await publishNow(A().admin, { title: "Website only", body: "No bell for this", websiteOnly: true });
    const titles = (await news.publicNews()).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["Public one", "Website only"]));
    expect(titles).not.toContain("Private one");
    expect(titles).not.toContain("Open day"); // a draft
    const webOnly = (await new NoticeService(A().admin).list({ tab: "live", q: "Website only" })).rows[0]!;
    expect(webOnly).toMatchObject({ audienceLabel: "Website only", recipients: 0 });
  });

  it("1: a teacher cannot put anything on the website", async () => {
    await expect(new NoticeService(A().teacher).saveDraft({ title: "Mine", body: "x", audience: ALL, website: true })).rejects.toMatchObject({ fieldErrors: { website: expect.any(String) } });
  });

  it("2: a teacher cannot edit, publish, withdraw or correct another person's notice, and sees only their own and what is sent to them", async () => {
    const t1 = new NoticeService(A().teacher), t2 = new NoticeService(fx.as(fx.ids.teacher2!, "teacher"));
    const { id } = await t1.saveDraft({ title: "T1 draft", body: "x", audience: section(fx.ids.s5a!) });
    await expect(t2.saveDraft({ id, title: "Hijack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(t2.publish(id)).rejects.toBeInstanceOf(NotFoundError);
    await t1.publish(id);
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where id = ${id}::uuid`);
    await publishDue(new Date());
    // t2 is not on the notice: invisible. An admin can still see it and act on it.
    await expect(t2.get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(t2.withdraw(id, "not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(t2.correct({ id, edits: { title: "Changed" } })).rejects.toBeInstanceOf(NotFoundError);
    expect((await t2.list({ tab: "live" })).rows.some((r) => r.id === id)).toBe(false);
    expect((await t1.list({ tab: "live" })).rows.some((r) => r.id === id)).toBe(true);
    // t1 is on the notice list of the class teacher; another teacher who is on the audience can read but still not change
    const { id: all } = await new NoticeService(A().admin).saveDraft({ title: "For all staff", body: "x", audience: { include: [{ type: "staff" }], exclude: [] } });
    await new NoticeService(A().admin).publish(all);
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where id = ${all}::uuid`);
    await publishDue(new Date());
    expect((await t2.get(all)).notice.title).toBe("For all staff");
    await expect(t2.withdraw(all, "I don't like it")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t2.correct({ id: all, edits: { title: "Mine now" } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("2: a teacher beyond their own sections needs approval; fee lists are never theirs", async () => {
    const t = new NoticeService(A().teacher);
    const { id } = await t.saveDraft({ title: "Whole school", body: "x", audience: ALL });
    await expect(t.publish(id)).rejects.toThrow(/needs approval/);
    expect((await t.get(id)).can).toMatchObject({ publish: false, submit: true });
    await expect(t.saveDraft({ title: "Dues", body: "x", audience: { include: [{ type: "fee_overdue", days: 10 }], exclude: [] } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("12: urgent is for those holding urgent and never about fees", async () => {
    await expect(new NoticeService(A().teacher).saveDraft({ type: "urgent", title: "Alert", body: "x", audience: section(fx.ids.s5a!) })).rejects.toBeInstanceOf(ForbiddenError);
    const cats = new AnnouncementCategoryService(A().admin);
    const fees = (await cats.options()).find((c) => c.name === "Fees")!;
    await expect(new NoticeService(A().admin).saveDraft({ type: "urgent", categoryId: fees.id, title: "Fee alert", body: "x", audience: ALL })).rejects.toMatchObject({ fieldErrors: { type: expect.any(String) } });
  });

  it("12: an urgent alert reaches everyone in the middle of the night on every channel the topic allows", async () => {
    const { id } = await publishNow(A().admin, { type: "urgent", title: "Night alert", body: "Stay home", audience: ALL });
    const rows = await withSchool(fx.school.id, (tx) => tx.execute(sql`select n.urgent, d.channel, d.priority from notifications n join comm_deliveries d on d.notification_id = n.id where n.subject_id = ${id} and n.user_id = ${fx.school.users.student}::uuid`));
    expect(rows.every((r) => r.urgent === true && Number(r.priority) === 1)).toBe(true);
    expect(new Set(rows.map((r) => r.channel))).toEqual(new Set(["push", "email"]));
  });
});

describe("approval (10)", () => {
  it("a teacher sends beyond their reach for approval; the author cannot approve; edits by the approver keep the difference", async () => {
    const t = new NoticeService(A().teacher), admin = new NoticeService(A().admin);
    const { id } = await t.saveDraft({ title: "Sports day", body: "On Friday", audience: ALL });
    const sub = await t.submit(id);
    expect(sub).toMatchObject({ state: "waiting", approvers: ["admin n1"] });
    // the admin was told, with an action row
    expect((await notes(fx.school.users.admin)).find((n) => n.subjectId === id)).toMatchObject({ topic: "notice.approval", action: true });
    await expect(t.approve({ id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t.saveDraft({ id, title: "Edit while waiting" })).rejects.toBeInstanceOf(ConflictError);
    const v = await admin.get(id);
    expect(v.can).toMatchObject({ approve: true, askChanges: true, reject: true, approveNeedsReason: false });
    const done = await admin.approve({ id, edits: { title: "Sports Day on Friday" } });
    expect(done.state).toBe("sending");
    const after = await admin.get(id);
    expect(after.notice).toMatchObject({ title: "Sports Day on Friday", version: 2, approvedBy: fx.school.users.admin });
    expect(after.versions).toHaveLength(1);
    expect(after.versions[0]).toMatchObject({ version: 1, note: "As sent for approval", snapshot: expect.objectContaining({ title: "Sports day" }) });
    // the writer was told, and the approval row is closed
    expect((await notes(fx.school.users.teacher)).some((n) => n.title.startsWith("Approved:"))).toBe(true);
    expect((await notes(fx.school.users.admin)).find((n) => n.subjectId === id)?.doneAt).toBeTruthy();
  });

  it("ask for changes and reject go back to the writer with the words; recall takes it back", async () => {
    const t = new NoticeService(A().teacher), admin = new NoticeService(A().admin);
    const { id } = await t.saveDraft({ title: "Fete", body: "x", audience: ALL });
    await t.submit(id);
    await admin.askChanges({ id, note: "Add the time" });
    expect((await t.get(id)).review).toEqual({ kind: "changes", note: "Add the time" });
    await t.submit(id);
    await admin.reject({ id, reason: "Not this term" });
    expect((await t.get(id)).review).toEqual({ kind: "rejected", note: "Not this term" });
    await t.submit(id);
    await t.recall(id);
    expect((await row(id)).state).toBe("draft");
    await t.deleteDraft(id);
    expect(await sql_(sql`select 1 from announcements where id = ${id}::uuid`)).toHaveLength(0);
  });

  it("the only approver may approve their own with a typed reason", async () => {
    const solo = await build("n3", { features: ["announcements", "notifications"] });
    const grants = new Set(["announcements:read", "announcements:draft", "announcements:publish", "announcements:approve"]);
    const user = await withSchool(solo.school.id, async (tx) => {
      await tx.execute(sql`insert into school_roles (id, school_id, name, base, grants) values (gen_random_uuid(), ${solo.school.id}::uuid, 'Coordinator', 'staff', ${sql.raw(`array['${[...grants].join("','")}']`)}::text[])`);
      const [u] = await tx.insert(users).values({ schoolId: solo.school.id, role: "staff", loginId: "coord", name: "Coord", email: "c@x.test", roleId: sql`(select id from school_roles where name = 'Coordinator')` as never }).returning();
      return u!;
    });
    const ctx = solo.as(user.id, "staff", { grants });
    const svc = new NoticeService(ctx);
    await new SettingsHelper(solo.school.as.admin).wholeSchoolNeedsApproval();
    const { id } = await svc.saveDraft({ title: "Everything changes", body: "x", audience: ALL });
    await svc.submit(id);
    // an admin exists, so the coordinator is not the only approver
    await expect(svc.approve({ id, reason: "I wrote it" })).rejects.toThrow(/cannot approve your own/);
    await withSchool(solo.school.id, (tx) => tx.execute(sql`update users set status = 'disabled' where role = 'admin'`));
    expect((await svc.get(id)).can).toMatchObject({ approve: true, approveNeedsReason: true });
    await expect(svc.approve({ id })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    const out = await svc.approve({ id, reason: "No other approver is available" });
    expect(out.state).toBe("sending");
    expect((await svc.get(id)).notice.approvalReason).toBe("No other approver is available");
  });
});

class SettingsHelper {
  constructor(private ctx: Fx["school"]["as"]["admin"]) {}
  async wholeSchoolNeedsApproval() {
    const { CommSettingsService } = await import("@smw/feature-notifications/settings");
    await new CommSettingsService(this.ctx).save({ approvalFor: { families: false, wholeSchool: true, website: true } });
  }
}

describe("circular numbers (11)", () => {
  it("20 parallel publishes get numbers 1 to 20 with no gap and no repeat; a withdrawn number stays in the register", async () => {
    const admin = new NoticeService(A().admin);
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => admin.saveDraft({ type: "circular", title: `Circular ${i}`, body: "Please note.", audience: section(fx.ids.s5a!) }).then((d) => d.id)));
    const sent = await Promise.all(ids.map((id) => admin.publish(id)));
    const numbers = sent.map((s) => s.number!).sort();
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `CIR/2026-27/${String(i + 1).padStart(3, "0")}`));
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where state = 'sending'`);
    await publishDue(new Date());
    await admin.withdraw(ids[3]!, "Sent by mistake");
    const reg = await new CircularService(A().admin).register();
    expect(reg.session).toBe("2026-27");
    expect(reg.rows).toHaveLength(20);
    expect(reg.rows.filter((r) => r.state === "withdrawn").map((r) => r.number)).toEqual([sent[3]!.number]);
    const pdf = await new CircularService(A().admin).registerPdf();
    expect(Buffer.from(pdf.bytes.slice(0, 4)).toString()).toBe("%PDF");
    await expect(new CircularService(A().teacher).register()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an undone circular keeps its number for when it is sent again", async () => {
    const admin = new NoticeService(A().admin);
    const { id } = await admin.saveDraft({ type: "circular", title: "Undo circular", body: "x", audience: section(fx.ids.s5a!) });
    const first = await admin.publish(id);
    await admin.undo(id);
    const again = await admin.publish(id);
    expect(again.number).toBe(first.number);
  });

  it("the circular PDF is made, and its QR token finds exactly the circular, with its standing and no text", async () => {
    const { id, number } = await publishNow(A().admin, { type: "circular", title: "Uniform change", body: "From Monday **all** wear the new tie.\n\nसोमवार से सभी बच्चे नई टाई पहनेंगे।", audience: ALL });
    const pdf = await new CircularService(A().admin).pdf(id);
    expect(Buffer.from(pdf.bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(pdf.fileName).toBe(`circular-${number!.replace(/\//g, "-")}.pdf`);
    await expect(new CircularService(A().admin).pdf((await publishNow(A().admin, { title: "Plain", body: "x", audience: ALL })).id)).rejects.toBeInstanceOf(ConflictError);
    const { verifyToken } = await import("./verify");
    const found = await withSchool(fx.school.id, (tx) => announcementsVerifyLookups.circular!(tx, verifyToken(fx.school.id, id)));
    expect(found).toMatchObject({ number, ok: true, status: "Genuine", studentName: null, title: "Uniform change", text: null });
    expect(found).not.toHaveProperty("amountPaise");
    expect(await withSchool(fx.school.id, (tx) => announcementsVerifyLookups.circular!(tx, "0".repeat(32)))).toBeNull();
    const web = await publishNow(A().admin, { type: "circular", title: "On the website", body: "Open to all", audience: ALL, website: true });
    expect(await withSchool(fx.school.id, (tx) => announcementsVerifyLookups.circular!(tx, verifyToken(fx.school.id, web.id)))).toMatchObject({ text: "Open to all" });
    await new NoticeService(A().admin).withdraw(web.id, "Wrong circular");
    expect(await withSchool(fx.school.id, (tx) => announcementsVerifyLookups.circular!(tx, verifyToken(fx.school.id, web.id)))).toMatchObject({ ok: false, status: "Withdrawn by the school", text: null });
    await new NoticeService(A().admin).withdraw(id, "Wrong circular");
    expect(await withSchool(fx.school.id, (tx) => announcementsVerifyLookups.circular!(tx, verifyToken(fx.school.id, id)))).toMatchObject({ ok: false, status: "Withdrawn by the school" });
    // another school's lookup never finds it
    expect(await withSchool(other.school.id, (tx) => announcementsVerifyLookups.circular!(tx, verifyToken(fx.school.id, id)))).toBeNull();
  });
});

const feedOf = (userId: string, role: "student" | "teacher" = "student", extra = {}) => new FeedService(fx.as(userId, role, extra));

describe("correct and withdraw (4, 5)", () => {
  it("4: an audience change tells only the added, closes it for the removed, keeps both versions; notify again tells the rest", async () => {
    const { id } = await publishNow(A().admin, { title: "Reading week", body: "Bring a book", audience: section(fx.ids.s5a!), response: { kind: "ack" } });
    expect((await rec(id)).map((r) => r.name).sort()).toEqual(["Ann", "Bob"]);
    const annBell = (await notes(fx.school.users.student, id)).length;
    const admin = new NoticeService(A().admin);
    const out = await admin.correct({ id, note: "Moved to class 5B", edits: { title: "Reading week (5B)", audience: section(fx.ids.s5b!) } });
    expect(out).toMatchObject({ version: 2, added: 1, removed: 2 });
    const people = await rec(id);
    expect(people.filter((p) => !p.removedAt).map((p) => p.name)).toEqual(["Cy"]);
    expect(people.filter((p) => p.removedAt).map((p) => p.name).sort()).toEqual(["Ann", "Bob"]);
    // Cy is told; Ann loses it with a note and her "answer me" row is closed
    expect((await notes(fx.ids.cyUser!, id))[0]).toMatchObject({ title: "Reading week (5B)", topic: "notice.answer" });
    const ann = await notes(fx.school.users.student);
    expect(ann.filter((n) => n.subjectId === id)).toHaveLength(annBell);
    expect(ann.find((n) => n.subjectId === id)).toMatchObject({ doneAt: expect.anything(), readAt: expect.anything() });
    expect(ann.some((n) => n.title === "No longer for you: Reading week (5B)")).toBe(true);
    await expect(feedOf(fx.school.users.student).open(id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await feedOf(fx.school.users.student).feed()).rows.some((r) => r.noticeId === id)).toBe(false);
    const view = await admin.get(id);
    expect(view.versions).toEqual([expect.objectContaining({ version: 1, note: "Moved to class 5B", snapshot: expect.objectContaining({ title: "Reading week" }) })]);
    expect(view.stats?.recipients).toBe(1);
    // fixing a typo without notify again: nobody gets a new bell row; with it, everyone remaining does
    await admin.correct({ id, edits: { body: "Bring any book" } });
    expect((await notes(fx.ids.cyUser!, id)).length).toBe(1);
    await admin.correct({ id, edits: { body: "Bring any two books" } }, { notifyAgain: true });
    expect((await notes(fx.ids.cyUser!, id))[0]).toMatchObject({ count: 2, title: "Updated: Reading week (5B)" });
    // people already answered, the question can no longer change
    await feedOf(fx.ids.cyUser!).open(id);
    await new ResponseService(fx.as(fx.ids.cyUser!)).respond({ noticeId: id, answer: { kind: "ack" }, byName: "Cy Parent", byRelation: "Father" });
    await expect(admin.correct({ id, edits: { response: { kind: "consent", reasonForNo: false } } })).rejects.toMatchObject({ fieldErrors: { response: expect.any(String) } });
  });

  it("5: a withdrawn notice shows its reason, hides its words and rewrites its bell row", async () => {
    const { id } = await publishNow(A().admin, { title: "Holiday on Friday", body: "School closed Friday", audience: section(fx.ids.s5a!), response: { kind: "ack" } });
    await new NoticeService(A().admin).withdraw(id, "Holiday moved to Saturday");
    const bell = (await notes(fx.school.users.student, id))[0]!;
    expect(bell).toMatchObject({ title: "Withdrawn by the school", body: "Holiday moved to Saturday" });
    expect(bell.doneAt).toBeTruthy();
    const open = await feedOf(fx.school.users.student).open(id);
    expect(open).toMatchObject({ content: null, withdrawn: { reason: "Holiday moved to Saturday" }, answering: "closed", files: [] });
    const item = (await feedOf(fx.school.users.student).feed()).rows.find((r) => r.noticeId === id)!;
    expect(item).toMatchObject({ withdrawn: true, title: "Withdrawn by the school", excerpt: "Holiday moved to Saturday", needsAnswer: false });
    await expect(new ResponseService(A().student).respond({ noticeId: id, answer: { kind: "ack" }, byName: "Ann Parent", byRelation: "Mother" })).rejects.toThrow(/withdrew/);
    await expect(new NoticeService(A().admin).withdraw(id, "again")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("who gets it (6, 7)", () => {
  it("6: a student who left gets nothing new, and a family that joins late gets live notices quietly", async () => {
    const { id } = await publishNow(A().admin, { title: "Class 5 picnic", body: "Next week", audience: { include: [{ type: "class", id: fx.ids.c5! }], exclude: [] } });
    expect((await rec(id)).map((r) => r.name).sort()).toEqual(["Ann", "Bob", "Cy"]);
    expect(await notes(fx.ids.leaverUser!, id)).toHaveLength(0);
    // Dia joins 5B after it was sent
    const dia = await withSchool(fx.school.id, async (tx) => {
      const [u] = await tx.insert(users).values({ schoolId: fx.school.id, role: "student", loginId: "l-dia", name: "Login dia", email: "dia@x.test" }).returning();
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id) values (gen_random_uuid(), ${fx.school.id}::uuid, 'S-Dia', 'Dia', ${fx.ids.c5}::uuid, ${fx.ids.s5b}::uuid, 'active', ${u!.id}::uuid)`);
      return u!.id;
    });
    expect(await lateJoiners(new Date())).toBeGreaterThanOrEqual(1);
    const dias = (await rec(id)).find((r) => r.name === "Dia")!;
    expect(dias).toMatchObject({ joinedLate: true, userId: dia });
    const bell = (await notes(dia, id))[0]!;
    expect(bell.title).toBe("Class 5 picnic");
    const sends = await withSchool(fx.school.id, (tx) => tx.execute(sql`select state, reason from comm_deliveries where notification_id = ${bell.id}::uuid`));
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.every((s) => s.state === "skipped" && s.reason === "Joined after it was sent")).toBe(true);
    // running the job again adds nobody
    expect(await lateJoiners(new Date())).toBe(0);
    // and not after 30 days
    await sql_(sql`update announcements set published_at = now() - interval '31 days' where id = ${id}::uuid`);
    await withSchool(fx.school.id, (tx) => tx.execute(sql`delete from announcement_recipients where announcement_id = ${id}::uuid and name = 'Dia'`));
    expect(await lateJoiners(new Date())).toBe(0);
  });

  it("7: 12,000 families: publish returns at once, every recipient exists once, and rerunning adds none", async () => {
    const big = await build("n4");
    const { addBulkFamilies } = await import("./fixtures");
    await addBulkFamilies(big, 12_000);
    const admin = new NoticeService(big.school.as.admin);
    const { id } = await admin.saveDraft({ title: "Open day", body: "Saturday", audience: { include: [{ type: "section", id: big.ids.s6a! }], exclude: [] } });
    const t0 = Date.now();
    await admin.publish(id);
    const publishMs = Date.now() - t0;
    expect(publishMs).toBeLessThan(2_000);
    const t1 = Date.now();
    const first = await fanOut(big.school.id, id, new Date(Date.now() + 120_000));
    const fanMs = Date.now() - t1;
    expect(first.recipients).toBe(12_001); // the 12,000 plus Nolo (no login)
    expect(first.notified).toBe(12_000);
    const count = async () => Number((await withSchool(big.school.id, (tx) => tx.execute(sql`select count(*) n, count(distinct person_key) d from announcement_recipients where announcement_id = ${id}::uuid`)))[0]!.n);
    expect(await count()).toBe(12_001);
    expect(await fanOut(big.school.id, id)).toEqual({ recipients: 0, notified: 0 });
    expect(await count()).toBe(12_001);
    const notified = await withSchool(big.school.id, (tx) => tx.execute(sql`select count(*) n from notifications where subject_id = ${id}`));
    expect(Number(notified[0]!.n)).toBe(12_000);
    process.stderr.write(`[measured] publish ${publishMs} ms, fan-out of 12,001 recipients ${fanMs} ms\n`);
    expect(fanMs).toBeLessThan(60_000);
  }, 120_000);
});

const answerAs = (userId: string, noticeId: string, answer: unknown, extra: Record<string, unknown> = {}) =>
  new ResponseService(fx.as(userId)).respond({ noticeId, answer, byName: "A Parent", byRelation: "Mother", ...extra });
const logins = () => ({ ann: fx.school.users.student, bob: fx.ids.bobUser!, cy: fx.ids.cyUser! });

describe("answers (8, 9)", () => {
  it("8: consent yes, no with a reason, a change, a lock after the due date, a paper answer; the report adds up", async () => {
    const teacher = new NoticeService(A().teacher);
    const { id: draft } = await teacher.saveDraft({ title: "Trip to the museum", body: "Friday 9 am", audience: section(fx.ids.s5a!), response: { kind: "consent", reasonForNo: true }, dueAt: new Date(Date.now() + 3 * 864e5).toISOString() });
    await teacher.publish(draft);
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where id = ${draft}::uuid`);
    await publishDue(new Date());
    const id = draft, L = logins();
    // only open notices ask: Ann says yes
    expect((await feedOf(L.ann).feed()).rows.find((r) => r.noticeId === id)).toMatchObject({ needsAnswer: true, answered: false });
    expect((await notes(L.ann, id))[0]).toMatchObject({ topic: "notice.answer", action: true, doneAt: null });
    await expect(answerAs(L.ann, id, { kind: "consent", yes: false })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await expect(answerAs(L.ann, id, { kind: "ack" })).rejects.toBeInstanceOf(ValidationError);
    await expect(answerAs(L.ann, id, { kind: "consent", yes: true }, { byRelation: "Cousin" })).rejects.toBeInstanceOf(ValidationError);
    expect(await answerAs(L.ann, id, { kind: "consent", yes: true })).toMatchObject({ changed: false });
    expect((await notes(L.ann, id))[0]!.doneAt).toBeTruthy();
    // Bob says no with a reason, then changes his mind
    await answerAs(L.bob, id, { kind: "consent", yes: false, reason: "Away that day" });
    expect(await answerAs(L.bob, id, { kind: "consent", yes: true }, { byName: "Bob Father", byRelation: "Father" })).toMatchObject({ changed: true });
    const mine = (await feedOf(L.bob).open(id)).recipients[0]!;
    expect(mine.answer).toMatchObject({ answer: { kind: "consent", yes: true }, byName: "Bob Father", byRelation: "Father", onPaper: false });
    // an outsider (Cy is not in 5A) cannot answer
    await expect(answerAs(L.cy, id, { kind: "consent", yes: true })).rejects.toBeInstanceOf(NotFoundError);
    // the report adds up to the recipients
    const report = new ReportService(A().teacher);
    expect(await report.funnel(id)).toMatchObject({ recipients: 2, answered: 2, yes: 2, no: 0, other: 0, notAnswered: 0, onPaper: 0 });
    // after the last date: locked for families, but staff can still write down a paper answer for someone else
    await pastDue(id);
    await expect(answerAs(L.bob, id, { kind: "consent", yes: false, reason: "x" })).rejects.toThrow(/locked/);
    expect((await feedOf(L.bob).open(id)).answering).toBe("locked");
    expect((await feedOf(L.bob).feed()).rows.find((r) => r.noticeId === id)?.needsAnswer).toBe(false);
  });

  it("8: a paper answer for a family without a login, with a slip, is marked everywhere and adds to the report", async () => {
    const { id } = await publishNow(A().admin, { title: "Vaccination consent", body: "Please say yes or no", audience: section(fx.ids.s6a!), response: { kind: "consent", reasonForNo: false } });
    const report = new ReportService(A().admin);
    const before = await report.people(id);
    const nolo = before.rows.find((r) => r.name === "Nolo")!;
    expect(nolo).toMatchObject({ hasLogin: false, reached: false, answer: null });
    const slip = { name: "slip.jpg", type: "image/jpeg", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
    const service = new ResponseService(A().admin);
    await expect(service.recordPaper({ noticeId: id, recipientId: nolo.recipientId, answer: { kind: "consent", yes: true }, byName: "Nolo Mother", byRelation: "Mother" }, { ...slip, type: "text/html" })).rejects.toBeInstanceOf(ValidationError);
    await service.recordPaper({ noticeId: id, recipientId: nolo.recipientId, answer: { kind: "consent", yes: true }, byName: "Nolo Mother", byRelation: "Mother" }, slip);
    const after = (await report.people(id)).rows.find((r) => r.name === "Nolo")!;
    expect(after).toMatchObject({ onPaper: true, hasSlip: true, answerText: "Yes", byName: "Nolo Mother" });
    expect(await report.funnel(id)).toMatchObject({ recipients: 1, answered: 1, yes: 1, onPaper: 1, notAnswered: 0, reached: 1 }); // a paper answer shows the family has it
    expect(await report.slipUrl(id, nolo.recipientId)).toMatch(/^memory:\/\//);
    // a teacher who is not on it cannot write on it, a family cannot record paper
    await expect(new ResponseService(fx.as(fx.ids.teacher2!, "teacher")).recordPaper({ noticeId: id, recipientId: nolo.recipientId, answer: { kind: "consent", yes: false }, byName: "Nolo Mother", byRelation: "Mother" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ResponseService(A().student).recordPaper({ noticeId: id, recipientId: nolo.recipientId, answer: { kind: "consent", yes: false }, byName: "Nolo Mother", byRelation: "Mother" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("8: siblings on one login answer per child", async () => {
    // Make Bob's login also the family of Cy: two children, one login.
    await sql_(sql`update students set user_id = ${fx.ids.bobUser}::uuid where id = ${fx.ids.cy}::uuid`);
    const { id } = await publishNow(A().admin, { title: "Sibling poll", body: "Pick", audience: { include: [{ type: "class", id: fx.ids.c5! }], exclude: [] }, response: { kind: "poll", options: ["A", "B"], multiple: false } });
    const L = logins();
    const feed = (await feedOf(L.bob).feed()).rows.filter((r) => r.noticeId === id);
    expect(feed.map((r) => r.childName).sort()).toEqual(["Bob", "Cy"]);
    await expect(answerAs(L.bob, id, { kind: "poll", choices: ["A"] })).rejects.toMatchObject({ fieldErrors: { recipientId: expect.any(String) } });
    const opened = await feedOf(L.bob).open(id);
    const bobR = opened.recipients.find((r) => r.name === "Bob")!, cyR = opened.recipients.find((r) => r.name === "Cy")!;
    await answerAs(L.bob, id, { kind: "poll", choices: ["A"] }, { recipientId: bobR.recipientId });
    // one child answered, one not: the bell row stays open until both are answered
    expect((await notes(L.bob, id))[0]!.doneAt).toBeNull();
    await answerAs(L.bob, id, { kind: "poll", choices: ["B"] }, { recipientId: cyR.recipientId });
    expect((await notes(L.bob, id))[0]!.doneAt).toBeTruthy();
    const after = (await feedOf(L.bob).open(id)).recipients;
    expect(after.find((r) => r.name === "Bob")!.answer?.answer).toEqual({ kind: "poll", choices: ["A"] });
    expect(after.find((r) => r.name === "Cy")!.answer?.answer).toEqual({ kind: "poll", choices: ["B"] });
    await expect(answerAs(L.bob, id, { kind: "poll", choices: ["A"] }, { recipientId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    await sql_(sql`update students set user_id = ${fx.ids.cyUser}::uuid where id = ${fx.ids.cy}::uuid`);
  });

  it("a short form with a file question stores the file privately", async () => {
    const spec = { kind: "form", questions: [{ id: "size", label: "T-shirt size", kind: "choice", required: true, options: ["S", "M", "L"] }, { id: "pic", label: "Photo", kind: "file", required: false }] };
    const { id } = await publishNow(A().admin, { title: "Sports kit", body: "Sizes", audience: section(fx.ids.s5b!), response: spec });
    const svc = new ResponseService(fx.as(fx.ids.cyUser!));
    await svc.respond({ noticeId: id, answer: { kind: "form", values: { size: "M" } }, byName: "Cy Parent", byRelation: "Mother" }, { pic: { name: "me.png", type: "image/png", size: 2, bytes: new Uint8Array([1, 2]) } });
    const stored = (await sql_(sql`select answer from announcement_responses r join announcement_recipients p on p.id = r.recipient_id where p.announcement_id = ${id}::uuid`))[0]!.answer as { values: Record<string, string> };
    expect(stored.values.pic).toMatch(new RegExp(`^${fx.school.id}/private/announcements/`));
  });

  it("9: a nudge reaches only those who have not answered, once a day each; the daily job shares the same gate", async () => {
    const { id } = await publishNow(A().admin, { title: "Consent please", body: "x", audience: section(fx.ids.s5a!), response: { kind: "ack" }, dueAt: new Date(Date.now() + 2 * 864e5).toISOString() });
    const L = logins();
    await answerAs(L.ann, id, { kind: "ack" });
    const report = new ReportService(A().admin);
    expect(await report.nudge(id)).toEqual({ sent: 1, alreadyToday: 0 });
    expect((await notes(L.bob, id))[0]).toMatchObject({ count: 2, title: "Reminder: Consent please" });
    expect((await notes(L.ann, id))[0]!.count).toBe(1);
    expect(await report.nudge(id)).toEqual({ sent: 0, alreadyToday: 1 });
    expect(await responseReminders(new Date())).toBeGreaterThanOrEqual(0);
    expect((await notes(L.bob, id))[0]!.count).toBe(2);
    await sql_(sql`update announcement_recipients set nudged_at = now() - interval '25 hours' where announcement_id = ${id}::uuid`);
    expect(await report.nudge(id)).toMatchObject({ sent: 1 });
    await pastDue(id);
    await expect(report.nudge(id)).rejects.toThrow(/last date/);
  });

  it("9: the reminder job picks notices due in two days, today or yesterday, and skips ones with reminders off", async () => {
    const mk = (title: string, days: number, reminders = { before: true, onDay: true, after: true }) => publishNow(A().admin, { title, body: "x", audience: section(fx.ids.s5b!), response: { kind: "ack" }, dueAt: new Date(Date.now() + days * 864e5).toISOString(), reminders });
    const two = await mk("Due in two", 2), far = await mk("Due far", 9), off = await mk("Reminders off", 2, { before: false, onDay: true, after: true });
    await responseReminders(new Date());
    const got = async (id: string) => (await notes(fx.ids.cyUser!, id))[0]!.count;
    expect(await got(two.id)).toBe(2);
    expect(await got(far.id)).toBe(1);
    expect(await got(off.id)).toBe(1);
  });
});

describe("the family feed and the report", () => {
  it("24: needs-your-answer first, then pinned, then newest; archive holds expired; unread count and open mark seen with the bell", async () => {
    const mk = (title: string, o: Record<string, unknown> = {}) => publishNow(A().admin, { title, body: `${title} text`, audience: section(fx.ids.s5a!), ...o });
    const plain = await mk("Plain old");
    const pinned = await mk("Pinned one", { pinnedUntil: new Date(Date.now() + 864e5).toISOString() });
    const asks = await mk("Asks you", { response: { kind: "ack" }, dueAt: new Date(Date.now() + 864e5).toISOString() });
    const later = await mk("Newest plain");
    const feed = feedOf(fx.school.users.student);
    const order = (await feed.feed({ pageSize: 100 })).rows.map((r) => r.title);
    expect(order.indexOf("Asks you")).toBe(0);
    expect(order.indexOf("Pinned one")).toBeLessThan(order.indexOf("Newest plain"));
    expect(order.indexOf("Newest plain")).toBeLessThan(order.indexOf("Plain old"));
    const before = await feed.unreadCount();
    expect(before).toBeGreaterThanOrEqual(4);
    // opening clears the row, the bell and the pending push of this notice, once
    const open = await feed.open(plain.id);
    expect(open.content).toMatchObject({ title: "Plain old", body: "Plain old text" });
    expect(await feed.unreadCount()).toBe(before - 1);
    const bell = (await notes(fx.school.users.student, plain.id))[0]!;
    expect(bell.readAt).toBeTruthy();
    const pending = await withSchool(fx.school.id, (tx) => tx.execute(sql`select count(*) n from comm_deliveries where notification_id = ${bell.id}::uuid and state = 'pending'`));
    expect(Number(pending[0]!.n)).toBe(0);
    // filters and archive
    expect((await feed.feed({ q: "pinned" })).rows.map((r) => r.title)).toEqual(["Pinned one"]);
    await sql_(sql`update announcements set expires_at = now() - interval '1 minute' where id in (${later.id}::uuid, ${pinned.id}::uuid)`);
    expect(await expireNotices(new Date())).toBeGreaterThanOrEqual(2);
    const archive = (await feed.feed({ tab: "archive" })).rows.map((r) => r.title);
    expect(archive).toEqual(expect.arrayContaining(["Newest plain", "Pinned one"]));
    expect((await feed.feed({ pageSize: 100 })).rows.map((r) => r.title)).not.toContain("Pinned one");
    expect(asks.id).toBeTruthy();
  });

  it("the second language shows when the family picked it, with a switch", async () => {
    await sql_(sql`insert into comm_settings (id, school_id, settings) values (gen_random_uuid(), ${fx.school.id}::uuid, '{"languages":["hi"]}'::jsonb) on conflict (school_id) do update set settings = comm_settings.settings || '{"languages":["hi"]}'::jsonb`);
    const { id } = await publishNow(A().admin, { title: "Holiday", body: "Closed on Monday", lang2: "hi", title2: "छुट्टी", body2: "सोमवार को बंद", audience: section(fx.ids.s5a!) });
    const feed = feedOf(fx.school.users.student);
    expect(await feed.open(id)).toMatchObject({ content: { lang: null, title: "Holiday" }, other: { lang: "hi", title: "छुट्टी" } });
    expect(await feed.open(id, { lang: "hi" })).toMatchObject({ content: { lang: "hi", title: "छुट्टी" }, other: { lang: null, title: "Holiday" } });
    await sql_(sql`insert into notification_prefs (id, school_id, user_id, language) values (gen_random_uuid(), ${fx.school.id}::uuid, ${fx.school.users.student}::uuid, 'hi')`);
    expect((await feed.open(id)).content?.lang).toBe("hi");
    await expect(new NoticeService(A().admin).saveDraft({ title: "x1", body: "x", lang2: "fr", title2: "t", body2: "b", audience: ALL }).then(async (d) => new NoticeService(A().admin).publish(d.id))).rejects.toMatchObject({ fieldErrors: { lang2: expect.any(String) } });
  });

  it("18: the report: funnel, people with channel results and reasons, by section, csv, resend, sign sheet; only for the writer and managers", async () => {
    const { id } = await publishNow(A().admin, { title: "Report me", body: "x", audience: { include: [{ type: "class", id: fx.ids.c5! }, { type: "class", id: fx.ids.c6! }], exclude: [] }, response: { kind: "consent", reasonForNo: false } });
    const L = logins();
    await feedOf(L.ann).open(id);
    await answerAs(L.ann, id, { kind: "consent", yes: true });
    await answerAs(L.cy, id, { kind: "consent", yes: false });
    // a push to Bob failed
    await sql_(sql`update comm_deliveries set state = 'failed', reason = 'Device is gone' where channel = 'push' and notification_id in (select id from notifications where subject_id = ${id} and user_id = ${L.bob}::uuid)`);
    await sql_(sql`update comm_deliveries set state = 'sent' where channel = 'email' and notification_id in (select id from notifications where subject_id = ${id} and user_id = ${L.bob}::uuid)`);
    const report = new ReportService(A().admin);
    const f = await report.funnel(id);
    expect(f).toMatchObject({ recipients: 5, seen: 2, answered: 2, yes: 1, no: 1, other: 0, notAnswered: 3, onPaper: 0 }); // Ann, Bob, Cy, Dia (joined earlier) and Nolo
    expect(f.reached).toBe(3); // Ann and Cy opened it, Bob's email went out
    expect(f.yes + f.no + f.other + f.notAnswered).toBe(f.recipients);
    const people = await report.people(id, { pageSize: 10 });
    expect(people.total).toBe(5);
    const bob = people.rows.find((r) => r.name === "Bob")!;
    expect(bob.channels).toEqual({ push: { state: "failed", reason: "Device is gone" }, email: { state: "sent", reason: null } });
    expect(people.rows.find((r) => r.name === "Nolo")).toMatchObject({ hasLogin: false, channels: { push: null, email: null } });
    expect((await report.people(id, { filter: "unanswered" })).rows.map((r) => r.name).sort()).toEqual(["Bob", "Dia", "Nolo"]);
    expect((await report.people(id, { filter: "unreached" })).rows.map((r) => r.name).sort()).toEqual(["Dia", "Nolo"]);
    expect((await report.people(id, { filter: "answered", q: "an" })).rows.map((r) => r.name)).toEqual(["Ann"]);
    expect((await report.bySection(id)).map((s) => [s.label, s.recipients, s.seen, s.answered])).toEqual([["Class 5 A", 2, 1, 1], ["Class 5 B", 2, 1, 1], ["Class 6 A", 1, 0, 0]]);
    const csv = (await report.csv(id)).csv;
    expect(csv.split("\r\n")[0]).toContain('"Name","Class"');
    expect(csv).toContain('"Ann","Class 5 A","Yes","Yes"');
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(6);
    // resend: Bob and Dia have not opened it, Nolo has no login
    expect(await report.resend(id, "unseen")).toEqual({ sent: 2, noLogin: 1 });
    expect((await notes(L.bob, id))[0]!.count).toBe(2);
    const sheet = await report.signSheetPdf(id);
    expect(Buffer.from(sheet.bytes.slice(0, 4)).toString()).toBe("%PDF");
    // access: the writer and managers only; a teacher who is only a reader cannot
    await expect(new ReportService(A().teacher).funnel(id)).rejects.toThrow();
    await expect(new ReportService(A().student).funnel(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(A().admin).funnel((await new NoticeService(A().admin).saveDraft({ title: "d", body: "d", audience: ALL })).id)).rejects.toThrow(/not been sent/);
  });
});

describe("scheduling, lists, copies", () => {
  it("schedule, quiet-hours warning, unschedule, send now, and the job sends what is due", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ title: "Scheduled one", body: "x", audience: section(fx.ids.s5a!) });
    await expect(svc.schedule(id, new Date(Date.now() - 1000))).rejects.toMatchObject({ fieldErrors: { scheduledAt: expect.any(String) } });
    // 22:00 India time is inside the 20:00-07:00 quiet hours
    const night = new Date(); night.setUTCDate(night.getUTCDate() + 2); night.setUTCHours(16, 30, 0, 0);
    const s = await svc.schedule(id, night);
    expect(s.quietUntil).not.toBeNull();
    expect((await svc.list({ tab: "scheduled" })).rows.map((r) => r.id)).toContain(id);
    await svc.unschedule(id);
    expect((await row(id)).state).toBe("draft");
    await svc.schedule(id, new Date(Date.now() + 120_000));
    await publishDue(new Date());
    expect((await row(id)).state).toBe("scheduled");
    await publishDue(new Date(Date.now() + 240_000));
    expect((await row(id)).state).toBe("published");
    expect(await rec(id)).toHaveLength(2);
    const { id: later } = await svc.saveDraft({ title: "Send it now", body: "x", audience: section(fx.ids.s5a!) });
    await svc.schedule(later, new Date(Date.now() + 3_600_000));
    await svc.sendNow(later);
    expect((await row(later)).state).toBe("published");
    expect(await rec(later)).toHaveLength(2);
  });

  it("tabs, counts and filters follow state and author; duplicate copies the words not the dates; only drafts delete", async () => {
    const t = new NoticeService(A().teacher), admin = new NoticeService(A().admin);
    const { id } = await t.saveDraft({ title: "Teacher draft zebra", body: "x", audience: section(fx.ids.s5a!), response: { kind: "ack" } });
    const counts = await t.counts();
    expect(counts.drafts).toBeGreaterThanOrEqual(1);
    expect((await t.list({ tab: "drafts", q: "zebra" })).rows.map((r) => r.id)).toEqual([id]);
    expect((await new NoticeService(fx.as(fx.ids.teacher2!, "teacher")).list({ tab: "drafts", q: "zebra" })).rows).toEqual([]);
    expect((await admin.list({ tab: "drafts", q: "zebra", author: fx.school.users.teacher, needs: "answer" })).rows).toHaveLength(1);
    expect((await admin.list({ tab: "drafts", q: "zebra", type: "circular" })).rows).toHaveLength(0);
    const copy = await admin.duplicate(id);
    expect(await admin.get(copy.id)).toMatchObject({ notice: { title: "Teacher draft zebra", state: "draft", createdBy: fx.school.users.admin, response: { kind: "ack" } } });
    await admin.deleteDraft(copy.id);
    await publishNow(A().admin, { title: "Sent already", body: "x", audience: section(fx.ids.s5a!) });
    const sent = (await admin.list({ tab: "live", q: "Sent already" })).rows[0]!;
    expect(sent).toMatchObject({ recipients: 2, seen: 0, answered: 0, state: "published" });
    await expect(admin.deleteDraft(sent.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(new NoticeService(A().student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new NoticeService(A().student).saveDraft({ title: "Hi" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("history cannot be rewritten: an update or delete on a version is refused by the database", async () => {
    const { id } = await publishNow(A().admin, { title: "Versioned", body: "one", audience: section(fx.ids.s5a!) });
    await new NoticeService(A().admin).correct({ id, edits: { body: "two" } });
    await expect(sql_(sql`update announcement_versions set note = 'edited' where announcement_id = ${id}::uuid`)).rejects.toThrow();
    await expect(sql_(sql`delete from announcement_versions where announcement_id = ${id}::uuid`)).rejects.toThrow();
    expect(await withSchool(fx.school.id, (tx) => tx.select().from(announcementVersions).where(eq(announcementVersions.announcementId, id)))).toHaveLength(1);
  });

  it("categories are there from the start; templates are ready; a template makes a draft; files are private", async () => {
    const cats = new AnnouncementCategoryService(A().admin);
    expect((await cats.options()).map((c) => c.name)).toEqual(["General", "Academic", "Exam", "Fees", "Holiday", "Event", "Transport", "Health", "Staff"]);
    await expect(new AnnouncementCategoryService(A().teacher).create({ name: "Mine" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cats.create({ name: "general" })).rejects.toBeInstanceOf(ConflictError);
    const extra = await cats.create({ name: "Library" });
    await cats.remove(extra.id);
    const fees = (await cats.options()).find((c) => c.name === "Fees")!;
    await publishNow(A().admin, { title: "Uses fees", body: "x", audience: section(fx.ids.s5a!), categoryId: fees.id });
    await expect(cats.remove(fees.id)).rejects.toThrow(/in use/);

    const templates = new TemplateService(A().teacher);
    const list = await templates.list();
    expect(list.map((t) => t.name)).toEqual(expect.arrayContaining(["Holiday", "Parent-teacher meeting", "Fee due date", "Exam schedule", "Trip consent", "Weather closure", "Lost property", "Data breach"]));
    const trip = list.find((t) => t.name === "Trip consent")!;
    const { id } = await templates.use(trip.id);
    expect((await new NoticeService(A().teacher).get(id)).notice).toMatchObject({ response: { kind: "consent", reasonForNo: true }, state: "draft" });
    // an urgent template is a plain notice for someone who may not send urgent
    const breach = await templates.use(list.find((t) => t.name === "Data breach")!.id);
    expect((await new NoticeService(A().teacher).get(breach.id)).notice.type).toBe("notice");
    await expect(templates.remove(trip.id)).rejects.toBeInstanceOf(ForbiddenError);
    const own = await new TemplateService(A().admin).saveFrom(id, "My trip form");
    await new TemplateService(A().admin).remove(own.id);

    const files = new NoticeFileService(A().teacher);
    const pdf = { name: "Menu List.pdf", type: "application/pdf", size: 5, bytes: new Uint8Array([1, 2, 3, 4, 5]) };
    const f1 = await files.add(id, pdf);
    await expect(files.add(id, { ...pdf, type: "text/html" })).rejects.toBeInstanceOf(ValidationError);
    const v = await new NoticeService(A().teacher).get(id);
    expect(v.files).toMatchObject([{ name: "Menu List.pdf", contentType: "application/pdf" }]);
    const key = (await sql_(sql`select file_key from announcement_files where id = ${f1.id}::uuid`))[0]!.file_key as string;
    expect(key.startsWith(`${fx.school.id}/private/announcements/${id}/`)).toBe(true);
    expect((await files.url(f1.id)).url).toBe(`memory://${key}`);
    // not for a stranger, not for a family while it is a draft, not in a support session
    await expect(new NoticeFileService(fx.as(fx.ids.teacher2!, "teacher")).url(f1.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new NoticeFileService(A().student).url(f1.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new NoticeFileService(fx.as(fx.school.users.teacher, "teacher", { supportStaffId: "s1" })).url(f1.id)).rejects.toBeInstanceOf(ForbiddenError);
    await files.remove(f1.id);
    expect((await new NoticeService(A().teacher).get(id)).files).toEqual([]);
  });

  it("a file on a sent notice is reachable by its recipients only", async () => {
    const { id: draft } = await new NoticeService(A().admin).saveDraft({ title: "With paper", body: "x", audience: section(fx.ids.s5b!) });
    const file = await new NoticeFileService(A().admin).add(draft, { name: "a.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([1, 2, 3]) });
    await new NoticeService(A().admin).publish(draft);
    await sql_(sql`update announcements set send_at = now() - interval '1 second' where id = ${draft}::uuid`);
    await publishDue(new Date());
    expect((await new FeedService(fx.as(fx.ids.cyUser!)).fileUrl(file.id)).name).toBe("a.pdf");
    await expect(new FeedService(A().student).fileUrl(file.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("read-only school, support sessions, other schools (17, 37)", () => {
  it("a read-only school can read and mark seen but cannot send, answer or change", async () => {
    const { id } = await publishNow(A().admin, { title: "Read only test", body: "x", audience: section(fx.ids.s5a!), response: { kind: "ack" } });
    const ro = { readOnly: true };
    const feed = new FeedService(fx.as(fx.school.users.student, "student", ro));
    expect((await feed.open(id)).content?.title).toBe("Read only test");
    expect((await feed.feed()).rows.some((r) => r.noticeId === id && r.seen)).toBe(true);
    await expect(new ResponseService(fx.as(fx.school.users.student, "student", ro)).respond({ noticeId: id, answer: { kind: "ack" }, byName: "Ann Parent", byRelation: "Mother" })).rejects.toBeInstanceOf(ReadOnlyError);
    const admin = new NoticeService(fx.as(fx.school.users.admin, "admin", ro));
    await expect(admin.saveDraft({ title: "no" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(admin.withdraw(id, "because")).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await admin.get(id)).notice.state).toBe("published");
    await expect(new ReportService(fx.as(fx.school.users.admin, "admin", ro)).nudge(id)).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await new ReportService(fx.as(fx.school.users.admin, "admin", ro)).funnel(id)).recipients).toBe(2);
  });

  it("17: a support session gets 'not available' for answers, the report and private files, and reading does not mark seen", async () => {
    const { id } = await publishNow(A().admin, { title: "Support test", body: "x", audience: section(fx.ids.s5a!), response: { kind: "ack" } });
    const support = { supportStaffId: "staff-1" };
    const asStudent = fx.as(fx.school.users.student, "student", support), asAdmin = fx.as(fx.school.users.admin, "admin", support);
    await expect(new ResponseService(asStudent).respond({ noticeId: id, answer: { kind: "ack" }, byName: "Ann Parent", byRelation: "Mother" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(asAdmin).funnel(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(asAdmin).people(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(asAdmin).csv(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(asAdmin).signSheetPdf(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ResponseService(asAdmin).recordPaper({ noticeId: id, recipientId: crypto.randomUUID(), answer: { kind: "ack" }, byName: "Someone", byRelation: "Mother" })).rejects.toBeInstanceOf(ForbiddenError);
    const opened = await new FeedService(asStudent).open(id);
    expect(opened.recipients[0]!.seenAt).toBeNull();
    expect((await notes(fx.school.users.student, id))[0]!.readAt).toBeNull();
    // the notice itself is not private talk: staff can still read it
    expect((await new NoticeService(asAdmin).get(id)).notice.title).toBe("Support test");
  });

  it("37: two schools with the same names share nothing: lists, feeds, reports, recipients, files, public news", async () => {
    await publishNow(other.school.as.admin, { title: "Open day", body: "B school", audience: { include: [{ type: "everyone" }], exclude: [] }, website: true });
    const { id } = await publishNow(A().admin, { title: "Open day", body: "A school", audience: ALL, website: true });
    const inB = new NoticeService(other.school.as.admin);
    expect((await inB.list({ tab: "live" })).rows.every((r) => r.id !== id)).toBe(true);
    await expect(inB.get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(inB.withdraw(id, "hijack")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReportService(other.school.as.admin).funnel(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new FeedService(other.school.as.student).open(id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new FeedService(other.school.as.student).feed()).rows.every((r) => r.noticeId !== id)).toBe(true);
    expect((await new AnnouncementService(other.school.as.admin).publicNews()).map((n) => n.body)).toEqual(["B school"]);
    expect((await new AnnouncementService(A().admin).publicNews()).map((n) => n.body)).not.toContain("B school");
    expect(await withSchool(other.school.id, (tx) => tx.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id)))).toEqual([]);
    expect(await withSchool(other.school.id, (tx) => tx.select().from(notifications).where(eq(notifications.subjectId, id)))).toEqual([]);
  });
});

describe("AnnouncementService for home, the website and the API", () => {
  it("latest puts pinned first; a family sees what was sent to them; the API list pages it", async () => {
    await publishNow(A().admin, { title: "Zed plain", body: "**bold** body", audience: section(fx.ids.s5a!) });
    await publishNow(A().admin, { title: "Zed pinned", body: "x", audience: section(fx.ids.s5a!), pinnedUntil: new Date(Date.now() + 864e5).toISOString() });
    const latest = (await new AnnouncementService(A().admin).latest(50)).filter((n) => n.title.startsWith("Zed"));
    expect(latest[0]).toMatchObject({ title: "Zed pinned", pinned: true });
    expect(latest[1]).toMatchObject({ title: "Zed plain", pinned: false, excerpt: "bold body" });
    const family = await new AnnouncementService(A().student).list({ q: "Zed" });
    expect(family.rows.map((r) => r.title).sort()).toEqual(["Zed pinned", "Zed plain"]);
    expect((await new AnnouncementService(fx.as(fx.ids.cyUser!)).list({ q: "Zed" })).total).toBe(0);
    expect((await new AnnouncementService(A().admin).list({ pageSize: 2 })).rows).toHaveLength(2);
    await expect(new NoticeService(A().admin).saveDraft({ title: "Expired public", body: "x", audience: ALL, website: true, expiresAt: new Date(Date.now() + 50).toISOString() }).then((d) => new NoticeService(A().admin).publish(d.id))).resolves.toBeTruthy();
  });

  it("public news hides an expired or withdrawn notice, and a notice for everyone that is not on the website", async () => {
    const pub = await publishNow(A().admin, { title: "Shown at first", body: "x", audience: ALL, website: true });
    const quiet = await publishNow(A().admin, { title: "For all but not web", body: "x", audience: ALL });
    const news = () => new AnnouncementService(A().admin).publicNews(50).then((r) => r.map((n) => n.title));
    expect(await news()).toContain("Shown at first");
    expect(await news()).not.toContain("For all but not web");
    await new NoticeService(A().admin).withdraw(pub.id, "Wrong date");
    expect(await news()).not.toContain("Shown at first");
    expect(quiet.id).toBeTruthy();
  });
});

describe("what the screens need", () => {
  it("the write page knows what a person may do; a teacher in their own section goes free, beyond it needs approval", async () => {
    const teacher = new NoticeService(A().teacher);
    expect(teacher.mayDo()).toEqual({ draft: true, publish: true, urgent: false, website: false });
    expect(await teacher.reachFor(section(fx.ids.s5a!))).toMatchObject({ mode: "free" });
    expect(await teacher.reachFor(ALL)).toMatchObject({ mode: "approval" });
  });

  it("release sends a notice during its 30 seconds; the author filter lists writers; nudge reaches only the chosen", async () => {
    const svc = new NoticeService(A().admin);
    const { id } = await svc.saveDraft({ title: "Go now", body: "x", audience: section(fx.ids.s5b!), response: { kind: "ack" } });
    await svc.publish(id);
    await svc.release(id);
    expect((await row(id)).state).toBe("published");
    await expect(svc.release(id)).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.authors()).map((a) => a.id)).toContain(fx.school.users.admin);
    const report = new ReportService(A().admin);
    const people = await report.people(id, {});
    expect(await report.nudgeSome(id, [])).toEqual({ sent: 0, alreadyToday: 0 });
    expect(await report.nudgeSome(id, [people.rows[0]!.recipientId])).toMatchObject({ sent: 1 });
    expect(await new FeedService(A().admin).urgentUnopened()).toEqual([]);
  });

  it("the register lists the sessions and the id of each circular", async () => {
    const c = await publishNow(A().admin, { type: "circular", title: "For the register", body: "x", audience: ALL });
    const reg = new CircularService(A().admin);
    expect((await reg.sessions()).length).toBeGreaterThan(0);
    expect((await reg.register()).rows.map((r) => r.id)).toContain(c.id);
  });
});
