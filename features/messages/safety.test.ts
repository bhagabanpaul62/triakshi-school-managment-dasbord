import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { closeDb, eq, migrateDb, sql, withConsole, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { MemoryStorage, useServices } from "@smw/integrations";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { notifications } from "@smw/feature-notifications/schema";
import { retention } from "./jobs";
import { messageReports, messageReviews, messages, messageThreads } from "./schema";
import { SafeguardService } from "./safeguard";
import { MessageService } from "./service";
import seed from "./seed";
import { addUser, build } from "./test-fixture";

let w: Awaited<ReturnType<typeof build>>;
let lead2: Ctx; // a second admin: a lead who is not named
let custom: Ctx; // a safeguarding lead through a custom role
const svc = (c: Ctx) => new MessageService(c);
const guard = (c: Ctx) => new SafeguardService(c);
const sql_ = <T,>(fn: Parameters<typeof withSchool<T>>[1]) => withSchool(w.a.id, fn);
const about = (st: { id: string }, extra: Record<string, unknown> = {}) => ({ studentId: st.id, recipientIds: [], subject: "About", body: "Hello", ...extra });

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  w = await build("s");
  lead2 = await addUser(w.a, "admin", "lead2");
  custom = await addUser(w.a, "staff", "lead", ["messages:use", "messages:safeguard"]);
});
beforeEach(async () => { await migrateDb().execute(sql`update messages set created_at = created_at - interval '90 seconds'`); });
afterAll(closeDb);

/** A family reports a message from a teacher: the teacher is named. */
async function reported(subject: string) {
  const t = await svc(w.own).start(about(w.st1, { subject, body: "Please pay me directly for extra classes." }));
  const view = await svc(w.a.as.student).thread(t.id);
  const msg = view.messages.find((m) => m.sender === w.own.name)!;
  const r = await svc(w.a.as.student).report({ threadId: t.id, messageId: msg.id, category: "pressure", note: "Asked for cash." });
  return { thread: t.id, report: r.id, msg: msg.id };
}

describe("concerns (M10, acceptance 18)", () => {
  it("a report names the sender of the message and holds the conversation; leads are told, the named person is not", async () => {
    const r = await reported("Concern one");
    const row = (await sql_((tx) => tx.select().from(messageReports).where(eq(messageReports.id, r.report))))[0]!;
    expect(row.aboutUserIds).toEqual([w.own.userId]);
    expect(row.reporterName).toBe(w.a.as.student.name);
    expect((await sql_((tx) => tx.select().from(messageThreads).where(eq(messageThreads.id, r.thread))))[0]!.heldAt).not.toBeNull();
    const told = (await sql_((tx) => tx.select({ u: notifications.userId, t: notifications.topic }).from(notifications).where(eq(notifications.subjectId, r.report)))).map((n) => n.u);
    expect(told).toEqual([custom.userId]); // the dedicated lead; admins are the fallback
    expect(told).not.toContain(w.own.userId);
    // the reporter sees the state, and only the state
    expect(await svc(w.a.as.student).myReports()).toEqual([expect.objectContaining({ id: r.report, state: "new", category: "pressure" })]);
  });

  it("a conversation report names the other side; the reporter can add a person; a stranger cannot report", async () => {
    const t = await svc(w.own).start({ studentId: w.st2.id, recipientIds: [w.form.userId], subject: "Concern two", body: "x" });
    await svc(w.student2).report({ threadId: t.id, category: "unsafe", note: "Something is off.", aboutUserIds: [w.form.userId] });
    const [row] = await sql_((tx) => tx.select().from(messageReports).where(eq(messageReports.threadId, t.id)));
    expect(new Set(row!.aboutUserIds)).toEqual(new Set([w.form.userId]));
    await svc(w.student2).report({ threadId: t.id, category: "other", note: "Not sure who.", unsure: true });
    await expect(svc(w.student2).report({ threadId: t.id, category: "other", note: "No choice made" })).rejects.toMatchObject({ fieldErrors: { aboutUserIds: expect.any(String) } });
    const rows = await sql_((tx) => tx.select().from(messageReports).where(eq(messageReports.threadId, t.id)));
    expect(rows.some((x) => x.aboutUserIds.includes(w.own.userId))).toBe(true);
    await expect(svc(w.other).report({ threadId: t.id, category: "other", note: "hello there" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(w.student2).report({ threadId: t.id, category: "other", note: "hi", aboutUserIds: [w.student3.userId] })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc(w.student2).report({ threadId: t.id, category: "nonsense", note: "hi" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the queue never shows, counts or opens a report to a person it names, even an admin", async () => {
    const r = await reported("Concern three");
    const mine = await guard(w.a.as.admin).queue();
    expect(mine.rows.some((x) => x.id === r.report)).toBe(true);
    // an admin named in a report cannot see it
    const t = await svc(lead2).start(about(w.st2, { subject: "Named admin", body: "Admin writes" }));
    const rep = await svc(w.student2).report({ threadId: t.id, category: "abusive", note: "Rude.", unsure: true });
    const named = await guard(lead2).queue();
    expect(named.rows.some((x) => x.id === rep.id)).toBe(false);
    expect(named.open).toBe((await guard(w.a.as.admin).queue()).open - 1);
    await expect(guard(lead2).report(rep.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(guard(lead2).handle({ reportId: rep.id, state: "no_action" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(guard(lead2).open({ threadId: t.id, reason: "I want to read it" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("falls back to admins who are not named when no custom-role lead exists, and says so when nobody can be told", async () => {
    const { leadIds } = await import("./leads");
    const second = await addUser(w.b, "admin", "b2");
    expect(await withSchool(w.b.id, (tx) => leadIds(tx, [w.b.as.admin.userId]))).toEqual([second.userId]);
    expect(await withSchool(w.b.id, (tx) => leadIds(tx, [w.b.as.admin.userId, second.userId]))).toEqual([]); // nobody can be told: the screen shows outside contacts
    // a named lead is skipped even when dedicated
    expect(await withSchool(w.a.id, (tx) => leadIds(tx, [custom.userId]))).toContain(w.a.as.admin.userId);
    await new CommSettingsService(w.a.as.admin).save({ safetyContacts: [{ name: "Child helpline", phone: "1098" }] });
    expect(await guard(w.a.as.admin).contacts()).toEqual([{ name: "Child helpline", phone: "1098" }]);
  });

  it("handling a concern tells the reporter in words; no action releases the hold when nothing else is open", async () => {
    const r = await reported("Concern four");
    await guard(w.a.as.admin).handle({ reportId: r.report, state: "reviewing" });
    expect((await svc(w.a.as.student).myReports()).find((x) => x.id === r.report)!.state).toBe("reviewing");
    await guard(custom).handle({ reportId: r.report, state: "no_action", outcome: "Checked, an honest mistake." });
    expect((await svc(w.a.as.student).myReports()).find((x) => x.id === r.report)!.state).toBe("no_action");
    expect((await sql_((tx) => tx.select().from(messageThreads).where(eq(messageThreads.id, r.thread))))[0]!.heldAt).toBeNull();
    expect((await sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.a.as.student.userId), eq(notifications.subjectId, r.report)))))[0]!.body).toMatch(/no action/i);
    await expect(guard(w.own).handle({ reportId: r.report, state: "action" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard(w.a.as.student).queue()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("held: removing looks the same, the original stays, nothing is deleted or rewritten, everyone can export, retention keeps it", async () => {
    const r = await reported("Concern five");
    await expect(svc(w.own).exportPdf(r.thread)).resolves.toBeDefined();
    await expect(svc(w.a.as.student).exportPdf(r.thread)).resolves.toBeDefined();
    await svc(w.own).remove(r.msg);
    expect((await svc(w.a.as.student).thread(r.thread)).messages.find((x) => x.id === r.msg)).toMatchObject({ removed: true, body: "" });
    const row = () => sql_((tx) => tx.select().from(messages).where(eq(messages.id, r.msg))).then((x) => x[0]!);
    expect((await row()).body).not.toBe("");
    await expect(sql_((tx) => tx.delete(messages).where(eq(messages.id, r.msg)))).rejects.toThrow();
    await expect(sql_((tx) => tx.update(messages).set({ removedAt: null }).where(eq(messages.id, r.msg)))).rejects.toThrow();
    await expect(sql_((tx) => tx.update(messages).set({ body: "changed" }).where(eq(messages.id, r.msg)))).rejects.toThrow();
    await expect(sql_((tx) => tx.delete(messageThreads).where(eq(messageThreads.id, r.thread)))).rejects.toThrow(); // reports restrict the delete
  });
});

describe("review with a reason (M11, acceptance 19)", () => {
  it("opening needs a typed reason, is logged with who and why, and both sides are told", async () => {
    const r = await reported("Review one");
    await expect(guard(w.a.as.admin).open({ threadId: r.thread, reason: "" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await expect(guard(w.a.as.admin).open({ threadId: r.thread, reason: "abc" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await sql_((tx) => tx.select().from(messageReviews).where(eq(messageReviews.threadId, r.thread)))).toHaveLength(0);
    expect(await guard(w.a.as.admin).viewing(r.thread)).toBeNull(); // no logged opening, no reading
    const data = await guard(w.a.as.admin).open({ threadId: r.thread, reason: "Report: pressure to pay for classes", reportId: r.report });
    expect(data.messages.some((m) => m.body.includes("pay me directly"))).toBe(true);
    const logs = await sql_((tx) => tx.select().from(messageReviews).where(eq(messageReviews.threadId, r.thread)));
    expect(logs).toEqual([expect.objectContaining({ reviewerId: w.a.as.admin.userId, reviewerName: w.a.as.admin.name, reason: "Report: pressure to pay for classes", action: "opened", reportId: r.report })]);
    expect((await guard(w.a.as.admin).viewing(r.thread))?.thread.id).toBe(r.thread);
    // the report moved to "reviewing". While it is open nothing in the conversation or the bell hints at it: the standing banner tells both sides in general.
    expect((await guard(w.a.as.admin).report(r.report)).state).toBe("reviewing");
    const view = await svc(w.a.as.student).thread(r.thread);
    expect(view.messages.some((m) => m.kind === "system")).toBe(false);
    expect(view.reviewBanner).toBe(true);
    const told = (u: Ctx) => sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, u.userId), eq(notifications.title, "The school reviewed a conversation you are in"))));
    for (const u of [w.own, w.a.as.student]) expect(await told(u)).toHaveLength(0);
    await guard(w.a.as.admin).open({ threadId: r.thread, reason: "Second look at the files" });
    expect(await sql_((tx) => tx.select().from(messageReviews).where(eq(messageReviews.threadId, r.thread)))).toHaveLength(2);
    // once the report is closed, a review that is not tied to an open report is told once, in the conversation and the bell, without saying who reported
    await guard(w.a.as.admin).handle({ reportId: r.report, state: "no_action", outcome: "Fine" });
    await guard(lead2).open({ threadId: r.thread, reason: "Routine check of this conversation" });
    await guard(lead2).open({ threadId: r.thread, reason: "Same window, no second notice" });
    const after = await svc(w.a.as.student).thread(r.thread);
    expect(after.messages.filter((m) => m.kind === "system")).toEqual([expect.objectContaining({ body: "The school reviewed this conversation to check it is safe." })]);
    for (const u of [w.own, w.a.as.student]) expect(await told(u)).toHaveLength(1);
  });

  it("a named lead gets 'not found' for the conversation and does not see the review in the log", async () => {
    const r = await reported("Review two");
    const named = await addUser(w.a, "admin", "named");
    const t = await svc(named).start(about(w.st2, { subject: "Named", body: "x" }));
    await svc(w.student2).report({ threadId: t.id, category: "abusive", note: "Rude", unsure: true });
    await guard(w.a.as.admin).open({ threadId: t.id, reason: "Reading the report about a colleague" });
    await expect(guard(named).open({ threadId: t.id, reason: "Let me see it" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(guard(named).exportPdf({ threadId: t.id, reason: "Export it please" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await guard(named).log()).some((l) => l.threadId === t.id)).toBe(false);
    expect((await guard(w.a.as.admin).log()).some((l) => l.threadId === t.id)).toBe(true);
    void r;
  });

  it("a custom-role lead with messages:safeguard can review; other staff and families cannot; a logged export has a reason", async () => {
    const r = await reported("Review three");
    await expect(guard(custom).open({ threadId: r.thread, reason: "Looking into the report" })).resolves.toBeDefined();
    for (const who of [w.other, w.a.as.accountant, w.a.as.student, w.a.as.teacher]) await expect(guard(who).open({ threadId: r.thread, reason: "Just curious" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard(custom).exportPdf({ threadId: r.thread, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    const out = await guard(custom).exportPdf({ threadId: r.thread, reason: "Copy for the school's file" });
    expect(Buffer.from(out.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await sql_((tx) => tx.select().from(messageReviews).where(and(eq(messageReviews.threadId, r.thread), eq(messageReviews.action, "exported")))))).toHaveLength(1);
  });

  it("a reviewer sees removed originals and can open the files of that conversation; others cannot", async () => {
    const t = await svc(w.own).start(about(w.st1, { subject: "Original stays" }));
    const m = await svc(w.own).send(t.id, "I will remove this", { files: [{ name: "a.pdf", type: "application/pdf", size: 9, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 1, 1, 1]) }] });
    await svc(w.own).remove(m.id);
    const file = (await sql_((tx) => tx.execute(sql`select id::text as id from message_files where message_id = ${m.id}::uuid`)))[0] as { id: string };
    await expect(guard(w.a.as.admin).viewing(t.id)).resolves.toBeNull();
    await expect(svc(w.a.as.admin).fileLink(file.id)).rejects.toBeInstanceOf(NotFoundError); // not yet reviewing
    await guard(w.a.as.admin).open({ threadId: t.id, reason: "Checking what was removed" });
    const seen = (await guard(w.a.as.admin).viewing(t.id))!.messages.find((x) => x.id === m.id)!;
    expect(seen).toMatchObject({ removed: true, body: "I will remove this" });
    await expect(svc(w.a.as.admin).fileLink(file.id)).resolves.toMatchObject({ name: "a.pdf" });
    await expect(svc(w.a.as.student).fileLink(file.id)).rejects.toBeInstanceOf(NotFoundError); // removed for the family
  });
});

describe("the log and reports cannot be changed (acceptance 19, at the database)", () => {
  it("no app role can update or delete a review line, or change what a report says", async () => {
    const r = await reported("Immutable");
    await guard(w.a.as.admin).open({ threadId: r.thread, reason: "For the log test" });
    const [row] = await sql_((tx) => tx.select().from(messageReviews).where(eq(messageReviews.threadId, r.thread)));
    await expect(sql_((tx) => tx.update(messageReviews).set({ reason: "nothing to see" }).where(eq(messageReviews.id, row!.id)))).rejects.toThrow();
    await expect(sql_((tx) => tx.delete(messageReviews).where(eq(messageReviews.id, row!.id)))).rejects.toThrow();
    await expect(withConsole((tx) => tx.update(messageReviews).set({ reason: "x" }).where(eq(messageReviews.id, row!.id)))).rejects.toThrow();
    await expect(withConsole((tx) => tx.delete(messageReviews).where(eq(messageReviews.id, row!.id)))).rejects.toThrow();
    await expect(sql_((tx) => tx.update(messageReports).set({ note: "never mind" }).where(eq(messageReports.id, r.report)))).rejects.toThrow();
    await expect(sql_((tx) => tx.delete(messageReports).where(eq(messageReports.id, r.report)))).rejects.toThrow();
    await expect(sql_((tx) => tx.update(messages).set({ body: "edited" }).where(eq(messages.id, r.msg)))).rejects.toThrow();
    await expect(sql_((tx) => tx.delete(messages).where(eq(messages.id, r.msg)))).rejects.toThrow();
    expect((await sql_((tx) => tx.select().from(messageReviews).where(eq(messageReviews.id, row!.id))))[0]!.reason).toBe("For the log test");
  });
});

describe("restrictions (M12)", () => {
  it("reply only stops new conversations but not replies; blocked stops everything; lifting restores; the person is told", async () => {
    const t = await svc(w.student3).start({ studentId: w.st3.id, recipientIds: [w.far.userId], subject: "Before the limit", body: "hi" });
    await guard(w.a.as.admin).restrict({ userId: w.student3.userId, kind: "reply_only", reason: "Repeated rude messages", until: "2099-01-01" });
    await expect(svc(w.student3).start({ studentId: w.st3.id, recipientIds: [w.far.userId], subject: "New", body: "x" })).rejects.toMatchObject({ message: expect.stringContaining("limited your messages") });
    await expect(svc(w.student3).send(t.id, "a reply is fine")).resolves.toBeDefined();
    expect((await svc(w.student3).startRules()).canStart).toBe(false);
    await guard(w.a.as.admin).restrict({ userId: w.student3.userId, kind: "blocked", reason: "Still rude", until: "2099-01-01" });
    await expect(svc(w.student3).send(t.id, "blocked now")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc(w.student3).thread(t.id)).block?.reason).toMatch(/switched off/);
    expect(await sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.student3.userId), eq(notifications.title, "Your messages are limited"))))).toHaveLength(2);
    const rows = await guard(w.a.as.admin).restrictions();
    for (const r of rows.filter((x) => x.userId === w.student3.userId)) await guard(w.a.as.admin).lift(r.id);
    await expect(svc(w.student3).send(t.id, "back to normal")).resolves.toBeDefined();
    await expect(guard(w.a.as.admin).restrict({ userId: w.a.as.admin.userId, kind: "blocked", reason: "Myself", until: "2099-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard(w.a.as.admin).restrict({ userId: w.student3.userId, kind: "blocked", reason: "Past date", until: "2020-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(guard(w.own).restrict({ userId: w.student3.userId, kind: "blocked", reason: "Not allowed", until: "2099-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("retention (M22)", () => {
  it("removes student conversations 3 years after the student left plus 30 days notice; held, reported and reviewed ones stay", async () => {
    const mk = async (st: { id: string }, subject: string) => (await svc(w.a.as.admin).start({ studentId: st.id, recipientIds: [], subject, body: "old" })).id;
    const old = await mk(w.st2, "Old and gone");
    const soon = await mk(w.st5, "Leaves soon");
    await sql_(async (tx) => {
      await tx.execute(sql`update students set status = 'left', left_on = (current_date - interval '3 years' - interval '40 days')::date where id = ${w.st2.id}::uuid`);
      await tx.execute(sql`update students set status = 'left', left_on = (current_date - interval '3 years' - interval '10 days')::date where id = ${w.st5.id}::uuid`);
    });
    const kept = await reported("Held one");
    await sql_((tx) => tx.execute(sql`update students set status = 'left', left_on = (current_date - interval '4 years')::date where id = ${w.st1.id}::uuid`));
    const first = await retention(w.a.id);
    expect(first.removed).toBeGreaterThanOrEqual(1);
    const exists = async (id: string) => (await sql_((tx) => tx.select({ id: messageThreads.id }).from(messageThreads).where(eq(messageThreads.id, id)))).length === 1;
    expect(await exists(old)).toBe(false); // left 3 years and 40 days ago: past the 30 days notice
    expect(await exists(soon)).toBe(true); // within the 30 days notice
    expect(await exists(kept.thread)).toBe(true); // held
    // the admins were told about the ones in notice, once
    const told = await sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.a.as.admin.userId), eq(notifications.subjectType, "retention"))));
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toMatch(/will be removed in 30 days/);
    expect((await retention(w.a.id)).removed).toBe(0); // safe to run twice
    expect(await sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.a.as.admin.userId), eq(notifications.subjectType, "retention"))))).toHaveLength(1);
    // the school can set 1 to 7 years
    await new CommSettingsService(w.a.as.admin).save({ retentionYears: 7 });
    await new CommSettingsService(w.a.as.admin).save({ retentionYears: 3 });
    await expect(new CommSettingsService(w.a.as.admin).save({ retentionYears: 9 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("seed", () => {
  it("plays a staff talk, a batch, a closed and a reported conversation through the real services", async () => {
    const school = await build("z");
    const state = {
      teachers: [{ userId: school.own.userId, name: school.own.name }, { userId: school.form.userId, name: school.form.name }],
      students: [school.st1, school.st2, school.st3, school.st5].map((s) => ({ id: s.id, name: s.name, sectionId: s.sectionId ?? undefined, userId: s.userId })),
    };
    await seed(school.a.as.admin, state);
    const admin = (await new MessageService(school.a.as.admin).inbox()).rows.map((r) => r.subject);
    expect(admin).toEqual(expect.arrayContaining(["Term 2 syllabus review", "Fee installment", "Parent-teacher meeting on Saturday", "Library book return"]));
    const closed = (await new MessageService(school.a.as.admin).inbox()).rows.find((r) => r.subject === "Library book return")!;
    expect(closed.state).toBe("closed");
    expect((await new SafeguardService(school.a.as.admin).queue()).rows.some((r) => r.subject === "Extra tuition")).toBe(true);
    // the reported conversation has the teacher and the family only: the admin reviews it without being a member
    const members = await withSchool(school.a.id, (tx) => tx.execute(sql`select m.role from thread_members m join message_threads t on t.id = m.thread_id where t.subject = 'Extra tuition' order by m.role`));
    expect([...members].map((m) => (m as { role: string }).role)).toEqual(["student", "teacher"]);
    expect((await new SafeguardService(school.a.as.admin).log()).length).toBe(1);
  });
});

describe("find a conversation (M11)", () => {
  it("a lead finds one by student, staff member or day, sees people and state only, and never one that names them", async () => {
    const t = await svc(w.a.as.admin).start(about(w.st3, { subject: "Secret subject find", body: "Secret words find" }));
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const byStudent = await guard(lead2).find({ q: "Kabir" });
    const hit = byStudent.find((c) => c.threadId === t.id)!;
    expect(hit).toMatchObject({ state: "open", studentName: "Kabir" });
    expect(hit.people).toContain(w.a.as.admin.name);
    expect(JSON.stringify(hit)).not.toMatch(/Secret/);
    expect((await guard(lead2).find({ q: w.a.as.admin.name })).some((c) => c.threadId === t.id)).toBe(true);
    expect((await guard(lead2).find({ day })).some((c) => c.threadId === t.id)).toBe(true);
    expect((await guard(lead2).find({ q: "Kabir", day: "2000-01-01" })).length).toBe(0);
    await expect(guard(lead2).find({})).rejects.toBeInstanceOf(ValidationError);
    await expect(guard(w.own).find({ q: "Kabir" })).rejects.toBeInstanceOf(ForbiddenError);
    // a report that names a lead hides the conversation from that lead only
    const view = await svc(w.student3).thread(t.id);
    await svc(w.student3).report({ threadId: t.id, messageId: view.messages.find((m) => m.sender === w.a.as.admin.name)!.id, category: "pressure", note: "Asked for cash." });
    expect((await guard(w.a.as.admin).find({ q: "Kabir" })).some((c) => c.threadId === t.id)).toBe(false);
    expect((await guard(lead2).find({ q: "Kabir" })).some((c) => c.threadId === t.id)).toBe(true);
  });
});
