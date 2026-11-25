import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, eq, migrateDb, sql, users, withSchool } from "@smw/db";
import { and } from "drizzle-orm";
import { FeatureOffError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { MemoryStorage, useServices } from "@smw/integrations";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { PreferenceService } from "@smw/feature-notifications/prefs";
import { commDeliveries, notifications } from "@smw/feature-notifications/schema";
import { BatchService } from "./batch";
import { addMember, createThread, loadThread, postMessage, unreadByThread } from "./core";
import { sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { lapse } from "./jobs";
import { messageBatches, messageFiles, messages, messageThreads, threadMembers } from "./schema";
import { MessageService } from "./service";
import { addUser, build } from "./test-fixture";

let w: Awaited<ReturnType<typeof build>>;
const storage = new MemoryStorage();
const svc = (ctx: Ctx) => new MessageService(ctx);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10]);
const pdf = (name = "note.pdf") => ({ name, type: "application/pdf", size: PDF.byteLength, bytes: PDF });

/** The family of a student starts a conversation with a teacher; staff start about a student. */
const about = (st: { id: string }, extra: Record<string, unknown> = {}) => ({ studentId: st.id, recipientIds: [], subject: "About Aarav", body: "Hello", ...extra });

beforeAll(async () => {
  useServices({ storage });
  w = await build("m");
});
// The per-minute limit is real, so each test starts as if the last one happened a while ago.
beforeEach(async () => { await migrateDb().execute(sql`update messages set created_at = created_at - interval '90 seconds'`); });
afterEach(() => vi.useRealTimers());
afterAll(closeDb);

const sql_ = <T,>(fn: (tx: Parameters<Parameters<typeof withSchool>[1]>[0]) => Promise<T>) => withSchool(w.a.id, fn);

describe("who may start a conversation (M3, M4)", () => {
  it("a family writes to its child's teachers and the office, never to other staff or other families", async () => {
    const s = svc(w.a.as.student);
    const people = await s.contacts();
    expect(new Set(people.map((p) => p.id))).toEqual(new Set([w.own.userId, w.form.userId, w.a.as.admin.userId]));
    expect(people.find((p) => p.id === w.own.userId)?.label).toBe("Maths");
    expect(people.find((p) => p.id === w.form.userId)?.label).toBe("Class teacher");
    await expect(s.start(about(w.st1, { recipientIds: [w.own.userId], subject: "Maths doubt" }))).resolves.toHaveProperty("id");
    await expect(s.start(about(w.st1, { recipientIds: [w.a.as.admin.userId], subject: "Fee question" }))).resolves.toHaveProperty("id");
    for (const blocked of [w.other.userId, w.far.userId, w.a.as.accountant.userId, w.student2.userId]) {
      await expect(s.start(about(w.st1, { recipientIds: [blocked], subject: "Nope" }))).rejects.toBeInstanceOf(ForbiddenError);
    }
    // a family cannot pick someone else's child
    await expect(s.start(about(w.st3, { recipientIds: [w.own.userId] }))).rejects.toMatchObject({ fieldErrors: { studentId: expect.any(String) } });
  });

  it("staff pick the student; the family is reached through that student; teachers only for students they teach", async () => {
    expect((await svc(w.own).students()).map((s) => s.name).sort()).toEqual(["Aarav", "Diya", "Nikhil"]); // not Kabir (other section), not Meera (no login)
    const { id } = await svc(w.own).start(about(w.st1));
    const view = await svc(w.own).thread(id);
    expect(view.thread.kind).toBe("student");
    expect(view.members.map((m) => m.userId).sort()).toEqual([w.own.userId, w.a.as.student.userId].sort());
    await expect(svc(w.own).start(about(w.st3))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc(w.a.as.admin).students("kab")).map((s) => s.name)).toEqual(["Kabir"]);
    expect((await svc(w.a.as.accountant).students()).length).toBe(4); // messages:all: every family with a login
    await expect(svc(w.a.as.student).students()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff to staff, and never a family inside a staff conversation", async () => {
    const { id } = await svc(w.own).start({ recipientIds: [w.other.userId, w.a.as.admin.userId], subject: "Staff meeting", body: "3 pm" });
    expect((await svc(w.own).thread(id)).thread.kind).toBe("staff");
    await expect(svc(w.own).start({ recipientIds: [w.a.as.student.userId], subject: "Hi", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(w.a.as.student).start(about(w.st1, { recipientIds: [w.student2.userId] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(w.a.as.parent).start({ recipientIds: [w.own.userId], subject: "Hi", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the school switches: families may start, class-teacher-only, attachments", async () => {
    const settings = new CommSettingsService(w.a.as.admin);
    try {
      await settings.save({ familiesMayStart: false });
      await expect(svc(w.a.as.student).start(about(w.st1, { recipientIds: [w.own.userId] }))).rejects.toBeInstanceOf(ForbiddenError);
      expect((await svc(w.a.as.student).startRules()).canStart).toBe(false);
      await settings.save({ familiesMayStart: true, teacherMessages: "class_teacher" });
      await expect(svc(w.own).start(about(w.st1))).rejects.toBeInstanceOf(ForbiddenError); // teaches Maths, is not the class teacher
      await expect(svc(w.form).start(about(w.st1))).resolves.toHaveProperty("id");
      await settings.save({ attachments: false });
      const { id } = await svc(w.form).start(about(w.st2, { subject: "No files" }));
      await expect(svc(w.form).send(id, "see file", { files: [pdf()] })).rejects.toMatchObject({ fieldErrors: { files: expect.any(String) } });
    } finally { await settings.save({ familiesMayStart: true, teacherMessages: "taught", attachments: true }); }
  });

  it("custom roles: `use` only reaches staff; `all` reaches every family", async () => {
    const plain = await addUser(w.a, "staff", "plain", ["messages:use"]);
    const wide = await addUser(w.a, "staff", "wide", ["messages:use", "messages:all"]);
    expect(await svc(plain).students()).toEqual([]);
    expect((await svc(wide).students()).length).toBe(4);
    await expect(svc(plain).start(about(w.st1))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(wide).start(about(w.st3, { subject: "Wide" }))).resolves.toHaveProperty("id");
    await expect(svc({ ...plain, grants: new Set(["messages:use"]), features: new Set() }).inbox()).rejects.toBeInstanceOf(FeatureOffError);
  });

  it("rejects an empty message and bad input in plain words", async () => {
    await expect(svc(w.a.as.admin).start({ recipientIds: [], subject: "Hi", body: "x" })).rejects.toMatchObject({ fieldErrors: { recipientIds: expect.any(String) } });
    await expect(svc(w.a.as.admin).start(about(w.st1, { body: "  " }))).rejects.toMatchObject({ fieldErrors: { body: expect.any(String) } });
    await expect(svc(w.a.as.admin).start(about(w.st1, { subject: "" }))).rejects.toMatchObject({ fieldErrors: { subject: expect.any(String) } });
  });
});

describe("membership and isolation", () => {
  it("only members can open, reply, mark or fetch a file; the answer is always 'not found'", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { body: "Confidential", files: undefined }));
    for (const who of [w.other, w.form, w.student2, w.a.as.accountant]) {
      await expect(svc(who).thread(id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(svc(who).send(id, "listening")).rejects.toBeInstanceOf(NotFoundError);
      await expect(svc(who).mark(id, "pinned", true)).rejects.toBeInstanceOf(NotFoundError);
      expect((await svc(who).inbox()).rows.some((t) => t.id === id)).toBe(false);
    }
    await expect(svc(w.a.as.student).thread("not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    // the core, used by other modules, refuses the same way
    await expect(sql_((tx) => postMessage(tx, w.other, { threadId: id, body: "hi" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(sql_((tx) => loadThread(tx, id, w.other))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("school B sees nothing of school A, by id, by inbox, by file and by count", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Isolation" }));
    await svc(w.own).send(id, "with a file", { files: [pdf()] });
    const fileId = (await sql_((tx) => tx.select().from(messageFiles)))[0]!.id;
    for (const who of [w.b.as.admin, w.b.as.teacher, w.b.as.student]) {
      await expect(svc(who).thread(id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(svc(who).fileLink(fileId)).rejects.toBeInstanceOf(NotFoundError);
      expect((await svc(who).inbox()).rows).toEqual([]);
      expect(await svc(who).unreadCount()).toBe(0);
    }
    expect(await withSchool(w.b.id, (tx) => tx.select().from(messageThreads))).toEqual([]);
  });

  it("a support session is refused everywhere", async () => {
    const support: Ctx = { ...w.a.as.admin, supportStaffId: "00000000-0000-0000-0000-0000000000aa" };
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Support" }));
    const s = svc(support);
    for (const call of [() => s.inbox(), () => s.unreadCount(), () => s.thread(id), () => s.send(id, "x"), () => s.start(about(w.st1)), () => s.exportPdf(id), () => s.report({ threadId: id, category: "other", note: "x" }), () => s.fileLink(w.st1.id)]) {
      await expect(call()).rejects.toMatchObject({ message: expect.stringContaining("support session") });
    }
    await expect(sql_((tx) => loadThread(tx, id, support))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sql_((tx) => postMessage(tx, support, { threadId: id, body: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no write path bypasses the member check: messages and members are written only in core.ts", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL(".", import.meta.url).pathname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts") && x !== "core.ts" && x !== "schema.ts" && x !== "test-fixture.ts")) {
      const src = readFileSync(dir + f, "utf8");
      expect(src, `${f} inserts into messages or thread_members`).not.toMatch(/insert\((messages|threadMembers|messageFiles)\)/);
      // an update of messages (only "remove") sits behind requireMember
      if (/update\(messages\)/.test(src)) expect(src).toMatch(/requireMember\(tx, this\.ctx, m\.m\.threadId\)/);
    }
  });
});

describe("one family per conversation (M2, acceptance 20)", () => {
  it("is refused through start, addMember, createThread and the SQL trigger, even in parallel", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "One family" }));
    // addMember: a second family login
    await expect(sql_((tx) => addMember(tx, w.own, id, { userId: w.student2.userId }))).rejects.toMatchObject({ message: expect.stringContaining("one family") });
    // createThread with two families, and a staff conversation with a family
    await expect(sql_((tx) => createThread(tx, w.a.as.admin, { kind: "student", subject: "Two", studentId: w.st1.id, members: [{ userId: w.a.as.student.userId }, { userId: w.student2.userId }] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(sql_((tx) => createThread(tx, w.a.as.admin, { kind: "staff", subject: "Staff", members: [{ userId: w.a.as.student.userId }] }))).rejects.toBeInstanceOf(ValidationError);
    // the family of another student is not the family of this one
    await expect(sql_((tx) => createThread(tx, w.a.as.admin, { kind: "student", subject: "Wrong", studentId: w.st1.id, members: [{ userId: w.student2.userId }] }))).rejects.toBeInstanceOf(ValidationError);
    // the database says no even when the service is bypassed
    await expect(sql_((tx) => tx.insert(threadMembers).values({ schoolId: w.a.id, threadId: id, userId: w.student2.userId, name: "x", role: "student" }))).rejects.toThrow();
    // two parallel adds: at most one family is in
    const t = await svc(w.a.as.admin).start({ recipientIds: [w.own.userId], subject: "Staff only", body: "x" });
    const results = await Promise.allSettled([w.student2, w.student3].map((u) => sql_((tx) => addMember(tx, w.own, t.id, { userId: u.userId }))));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(0); // a staff conversation takes no family at all
    const fam = await sql_((tx) => tx.select({ n: sql<number>`count(*) filter (where role in ('student','parent'))::int` }).from(threadMembers).where(eq(threadMembers.threadId, id)));
    expect(fam[0]!.n).toBe(1);
  });

  it("Message families makes one private conversation per student, with a count of seen and replied", async () => {
    const b = new BatchService(w.own);
    const audience = JSON.stringify({ include: [{ type: "section", id: w.s1 }], exclude: [] });
    const preview = await b.preview(audience);
    expect(preview).toMatchObject({ families: 3, withoutLogin: 1 }); // Meera has no login
    const sent = await b.send({ audience, subject: "Trip on Friday", body: "Please send consent.", clientId: "batch-test-0001" });
    expect(sent.threads).toBe(3);
    // a double press sends once
    expect((await b.send({ audience, subject: "Trip on Friday", body: "Please send consent.", clientId: "batch-test-0001" })).batchId).toBe(sent.batchId);
    const threads = await sql_((tx) => tx.select().from(messageThreads).where(eq(messageThreads.batchId, sent.batchId)));
    expect(threads.length).toBe(3);
    for (const t of threads) {
      const fam = await sql_((tx) => tx.select({ role: threadMembers.role }).from(threadMembers).where(eq(threadMembers.threadId, t.id)));
      expect(fam.filter((m) => m.role === "student").length).toBe(1);
      expect(fam.length).toBe(2);
    }
    // one family opens it and answers; another only opens
    const mine = async (ctx: Ctx) => (await svc(ctx).inbox()).rows.find((r) => r.subject === "Trip on Friday")!;
    await svc(w.a.as.student).thread((await mine(w.a.as.student)).id);
    await svc(w.a.as.student).send((await mine(w.a.as.student)).id, "Yes, we will send it.");
    await svc(w.student2).thread((await mine(w.student2)).id);
    const view = await b.get(sent.batchId);
    expect(view).toMatchObject({ total: 3, seen: 2, replied: 1 });
    expect(view.rows.map((r) => r.student).sort()).toEqual(["Aarav", "Diya", "Nikhil"]);
    // families never see each other: Nikhil's family sees one conversation with one teacher
    expect((await svc(w.student4).thread((await mine(w.student4)).id)).members.length).toBe(2);
  });

  it("reach is checked once: a teacher messages own sections only; the office any", async () => {
    const other = JSON.stringify({ include: [{ type: "section", id: w.s2 }], exclude: [] });
    await expect(new BatchService(w.own).preview(other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BatchService(w.own).send({ audience: other, subject: "Hello", body: "x", clientId: "batch-test-0002" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BatchService(w.a.as.admin).send({ audience: other, subject: "Hello", body: "x", clientId: "batch-test-0003" })).resolves.toMatchObject({ threads: 1 });
    await expect(new BatchService(w.a.as.student).options()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BatchService(w.b.as.admin).get((await sql_((tx) => tx.select().from(messageBatches)))[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("limits (M14, acceptance 16)", () => {
  it("the 21st message in a minute is refused with a time; Message families is not affected", async () => {
    const s = svc(w.form);
    const { id } = await s.start(about(w.st5, { subject: "Rate" }));
    for (let i = 0; i < 19; i++) await s.send(id, `m${i}`);
    await expect(s.send(id, "the 21st")).rejects.toMatchObject({ fieldErrors: { body: expect.stringMatching(/Try again at \d/) } });
    const audience = JSON.stringify({ include: [{ type: "section", id: w.s1 }], exclude: [] });
    await expect(new BatchService(w.form).send({ audience, subject: "Still allowed", body: "x", clientId: "batch-test-0004" })).resolves.toMatchObject({ threads: 3 });
    // others are not limited by this person's count
    await expect(svc(w.student4).send(id, "my own count is fresh")).resolves.toBeDefined();
  });

  it("a family may start 10 conversations a day, staff 60, and the refusal says when to try again", async () => {
    for (let i = 0; i < 10; i++) await svc(w.student4).start(about(w.st5, { recipientIds: [w.own.userId], subject: `Question ${i}` }));
    await expect(svc(w.student4).start(about(w.st5, { recipientIds: [w.own.userId], subject: "Question 11" }))).rejects.toMatchObject({ fieldErrors: { body: expect.stringMatching(/You can start a new one (today|tomorrow) at \d/) } });
    const busy = await addUser(w.a, "staff", "sixty", ["messages:use"]);
    for (let i = 0; i < 60; i++) {
      if (i % 15 === 14) await migrateDb().execute(sql`update messages set created_at = created_at - interval '90 seconds'`); // 20 messages a minute is a separate limit
      await svc(busy).start({ recipientIds: [w.other.userId], subject: `Note ${i}`, body: "hi" });
    }
    await expect(svc(busy).start({ recipientIds: [w.other.userId], subject: "Note 61", body: "hi" })).rejects.toMatchObject({ fieldErrors: { body: expect.any(String) } });
  });
});

describe("reading and marks (M7, M15, acceptance 13, 15)", () => {
  it("opening a conversation clears its bell row and pending push and email in one request", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Bell" }));
    const rows = () => sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.a.as.student.userId), eq(notifications.subjectId, id))));
    const before = await rows();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ topic: "message.new", groupKey: `thread:${id}`, subjectType: "thread", privateBody: true, readAt: null });
    const pending = await sql_((tx) => tx.select().from(commDeliveries).where(and(eq(commDeliveries.notificationId, before[0]!.id), eq(commDeliveries.state, "pending"))));
    expect(pending.length).toBeGreaterThan(0);
    await svc(w.a.as.student).thread(id);
    expect((await rows())[0]!.readAt).not.toBeNull();
    expect(await sql_((tx) => tx.select().from(commDeliveries).where(and(eq(commDeliveries.notificationId, before[0]!.id), eq(commDeliveries.state, "pending"))))).toHaveLength(0);
    // more messages group into one unread row with a count
    await svc(w.own).send(id, "again");
    await svc(w.own).send(id, "and again");
    const after = (await rows()).filter((r) => !r.readAt);
    expect(after).toHaveLength(1);
    expect(after[0]!.count).toBe(2);
  });

  it("105 conversations: every one can be reached by keyset pages and the badge equals the sum shown", async () => {
    const fresh = await addUser(w.a, "teacher", "many");
    const [batch] = await sql_((tx) => tx.insert(messageBatches).values({ schoolId: w.a.id, subject: "bulk", audienceLabel: "bulk", createdBy: w.a.as.admin.userId }).returning());
    for (let i = 0; i < 105; i++) {
      await sql_(async (tx) => {
        const t = await createThread(tx, w.a.as.admin, { kind: "staff", subject: `Topic ${i}`, batchId: batch!.id, members: [{ userId: fresh.userId }] });
        await postMessage(tx, w.a.as.admin, { threadId: t.id, body: `hello ${i}`, skipLimit: true });
      });
    }
    const seen = new Set<string>();
    let sum = 0, cursor: string | null = null, pages = 0;
    do {
      const page = await svc(fresh).inbox({ cursor });
      for (const r of page.rows) { expect(seen.has(r.id)).toBe(false); seen.add(r.id); sum += r.unread; }
      cursor = page.next; pages++;
    } while (cursor);
    expect(seen.size).toBe(105);
    expect(pages).toBe(4);
    expect(sum).toBe(105);
    expect(await svc(fresh).unreadCount()).toBe(105);
    // archive one: it leaves the inbox pages, shows under Archived, and the badge still equals what the inbox can show
    const first = (await svc(fresh).inbox()).rows[0]!;
    await svc(fresh).mark(first.id, "archived", true);
    const archived = await svc(fresh).inbox({ view: "archived" });
    expect(archived.rows.map((r) => r.id)).toEqual([first.id]);
    expect((await svc(fresh).inbox({ view: "unread" })).rows.length).toBe(30);
    expect(await svc(fresh).unreadCount()).toBe(105);
    // search finds a message by its words, only among my own
    expect((await svc(fresh).inbox({ q: "hello 77" })).rows.map((r) => r.subject)).toEqual(["Topic 77"]);
    expect((await svc(w.other).inbox({ q: "hello 77" })).rows).toEqual([]);
  });

  it("pin keeps a conversation on top, mute and mark unread work, and reading is exact", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Marks" }));
    const fam = svc(w.a.as.student);
    await fam.thread(id);
    expect((await fam.inbox()).rows.find((r) => r.id === id)!.unread).toBe(0);
    await fam.markUnread(id);
    expect((await fam.inbox()).rows.find((r) => r.id === id)!.unread).toBe(1);
    await fam.thread(id);
    await fam.mark(id, "pinned", true);
    await svc(w.own).start(about(w.st1, { subject: "Newer" }));
    expect((await fam.inbox()).rows[0]!.id).toBe(id);
    await fam.mark(id, "muted", true);
    await svc(w.own).send(id, "muted but still counted");
    expect((await fam.inbox()).rows.find((r) => r.id === id)!.unread).toBe(1);
    expect(await sql_((tx) => tx.select().from(notifications).where(and(eq(notifications.userId, w.a.as.student.userId), eq(notifications.subjectId, id), sql`${notifications.count} > 1`)))).toHaveLength(0);
  });

  it("a message that lands while reading stays unread", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Race" }));
    const view = await sql_(async (tx) => loadThread(tx, id, w.a.as.student));
    await svc(w.own).send(id, "arrives after the page was built");
    const { markThreadRead } = await import("./core");
    await sql_((tx) => markThreadRead(tx, w.a.as.student, id, view.newestAt));
    expect((await sql_((tx) => unreadByThread(tx, w.a.as.student))).get(id)).toBe(1);
  });

  it("Seen: the sender sees Delivered then Seen; a school switch hides staff Seen from families", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Seen" }));
    const mine = async () => (await svc(w.own).thread(id)).messages.find((m) => m.mine)!;
    expect((await mine()).seen).toMatchObject({ by: 0, of: 1 });
    await svc(w.a.as.student).thread(id);
    expect((await mine()).seen).toMatchObject({ by: 1, of: 1 });
    await svc(w.a.as.student).send(id, "ok");
    const settings = new CommSettingsService(w.a.as.admin);
    await settings.save({ showStaffSeen: false });
    try {
      await svc(w.own).send(id, "second");
      expect((await svc(w.a.as.student).thread(id)).messages.every((m) => !m.seen)).toBe(true);
      expect((await svc(w.own).thread(id)).messages.find((m) => m.mine && m.body === "second")!.seen).toMatchObject({ of: 1 });
    } finally { await settings.save({ showStaffSeen: true }); }
  });
});

describe("sending: client id, quiet hours, away, files, removal (M6, M8, M9, M17, M18)", () => {
  it("a double press and a retry store one message, also in parallel", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Dup" }));
    const [x, y] = await Promise.all([svc(w.own).send(id, "once", { clientId: "client-1" }), svc(w.own).send(id, "once", { clientId: "client-1" })]);
    expect(x.id).toBe(y.id);
    await svc(w.own).send(id, "once", { clientId: "client-1" });
    expect(await sql_((tx) => tx.select().from(messages).where(and(eq(messages.threadId, id), eq(messages.clientId, "client-1"))))).toHaveLength(1);
    // a double press on start makes one conversation
    const input = about(w.st2, { subject: "Start dup", clientId: "client-start-1" });
    const [p, q] = await Promise.all([svc(w.own).start(input), svc(w.own).start(input)]);
    expect(p.id).toBe(q.id);
  });

  it("quiet hours: the app shows it now, push and email wait for 7:00; Seen waits too", async () => {
    // Wednesday 2 Dec 2026, 21:30 IST
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T16:00:00Z"));
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Quiet", body: "late evening" }));
    const m = (await sql_((tx) => tx.select().from(messages).where(eq(messages.threadId, id))))[0]!;
    expect(m.deliverAfter?.toISOString()).toBe("2026-12-03T01:30:00.000Z"); // 7:00 IST
    const view = await svc(w.own).thread(id);
    expect(view.holdUntil?.toISOString()).toBe("2026-12-03T01:30:00.000Z");
    expect(view.notice).toMatch(/Will be delivered (today|tomorrow|[A-Z][a-z]{2} \d+ [A-Z][a-z]{2}) 7:00 am/);
    const rows = await sql_((tx) => tx.select({ at: commDeliveries.nextAt }).from(commDeliveries).innerJoin(notifications, eq(notifications.id, commDeliveries.notificationId))
      .where(and(eq(notifications.userId, w.a.as.student.userId), eq(notifications.subjectId, id))));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.at.toISOString()).toBe("2026-12-03T01:30:00.000Z");
    // the family can read it in the app at once
    expect((await svc(w.a.as.student).thread(id)).messages.some((x) => x.body === "late evening")).toBe(true);
    // the sender is not told "Seen" until the morning: set the read time to 22:00 IST that night
    await migrateDb().execute(sql`update messages set created_at = '2026-12-02T16:00:00Z' where id = ${m.id}::uuid`);
    await migrateDb().execute(sql`update thread_members set last_read_at = '2026-12-02T16:30:00Z' where thread_id = ${id}::uuid and user_id = ${w.a.as.student.userId}::uuid`);
    const seenNow = async () => (await sql_((tx) => loadThread(tx, id, w.own))).messages.find((x) => x.id === m.id)!.seen;
    expect(await seenNow()).toMatchObject({ by: 0, of: 1 });
    vi.setSystemTime(new Date("2026-12-03T02:00:00Z"));
    expect(await seenNow()).toMatchObject({ by: 1, of: 1 });
  });

  it("my own hours and an away note are shown to the people who write to me", async () => {
    const { id } = await svc(w.a.as.student).start(about(w.st1, { subject: "Away", recipientIds: [w.own.userId] }));
    await new PreferenceService(w.own).setAway("2099-01-10", "Back after the exams.");
    await new PreferenceService(w.own).saveQuiet({ from: "13:00", to: "14:00" });
    const view = await svc(w.a.as.student).thread(id);
    expect(view.notice).toMatch(/is away until 10 Jan.*Back after the exams/);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T08:00:00Z")); // 13:30 IST: in my hours, and I am away
    const m = await svc(w.a.as.student).send(id, "Question");
    expect(m.deliverAfter).not.toBeNull();
    await new PreferenceService(w.own).setAway(null);
    await new PreferenceService(w.own).saveQuiet(null);
  });

  it("files: pictures and PDFs only, by content, five at most; a member gets a 60 second link, others get 'not found'", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Files" }));
    const fake = { name: "virus.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
    await expect(svc(w.own).send(id, "x", { files: [fake] })).rejects.toMatchObject({ fieldErrors: { files: expect.any(String) } });
    await expect(svc(w.own).send(id, "x", { files: Array.from({ length: 6 }, () => pdf()) })).rejects.toMatchObject({ fieldErrors: { files: expect.any(String) } });
    const png = { name: "p.png", type: "image/png", size: 8, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) };
    const before = storage.files.size;
    await svc(w.own).send(id, "", { files: [pdf("a.pdf"), png] });
    expect(storage.files.size).toBe(before + 2);
    const rows = await sql_((tx) => tx.select().from(messageFiles).where(sql`file_key like ${`${w.a.id}/private/messages/${id}/%`}`));
    expect(rows).toHaveLength(2);
    const spy = vi.spyOn(storage, "signedUrl");
    expect((await svc(w.a.as.student).fileLink(rows[0]!.id)).url).toMatch(/^memory:\/\//);
    expect(spy).toHaveBeenCalledWith(rows[0]!.fileKey, 60);
    for (const who of [w.other, w.student2, w.b.as.admin]) await expect(svc(who).fileLink(rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    // a message that points at another conversation's file key is refused
    await expect(sql_((tx) => postMessage(tx, w.own, { threadId: id, body: "x", files: [{ fileKey: `${w.a.id}/private/messages/other/x.pdf`, fileName: "x", contentType: "application/pdf", size: 1 }] }))).rejects.toBeInstanceOf(ValidationError);
    spy.mockRestore();
  });

  it("remove your own message within 10 minutes; the original stays, held or not", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Remove" }));
    const m = await svc(w.own).send(id, "oops wrong child");
    await expect(svc(w.a.as.student).remove(m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await svc(w.own).remove(m.id);
    const seen = (await svc(w.a.as.student).thread(id)).messages.find((x) => x.id === m.id)!;
    expect(seen).toMatchObject({ removed: true, body: "" });
    expect((await sql_((tx) => tx.select().from(messages).where(eq(messages.id, m.id))))[0]!.body).toBe("oops wrong child");
    const late = await svc(w.own).send(id, "too late");
    await migrateDb().execute(sql`update messages set created_at = now() - interval '11 minutes' where id = ${late.id}::uuid`);
    await expect(svc(w.own).remove(late.id)).rejects.toMatchObject({ message: expect.stringContaining("10 minutes") });
    const held = await svc(w.own).send(id, "reported soon");
    await svc(w.a.as.student).report({ threadId: id, category: "other", note: "Looks wrong to me.", unsure: true });
    // held or not, removing looks the same and says nothing about a report
    await svc(w.own).remove(held.id);
    expect((await svc(w.a.as.student).thread(id)).messages.find((x) => x.id === held.id)).toMatchObject({ removed: true, body: "" });
    expect((await sql_((tx) => tx.select().from(messages).where(eq(messages.id, held.id))))[0]!.body).toBe("reported soon");
    const mine = await svc(w.a.as.student).send(id, "my own words");
    await svc(w.a.as.student).remove(mine.id);
  });

  it("a disabled login cannot be written to; names stay as they were", async () => {
    const { id } = await svc(w.own).start(about(w.st5, { subject: "Gone" }));
    await sql_((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, w.student4.userId)));
    const view = await svc(w.own).thread(id);
    expect(view.block?.reason).toMatch(/can no longer sign in/);
    expect(view.members.find((m) => m.userId === w.student4.userId)!.name).toBe(w.student4.name);
    await expect(svc(w.own).send(id, "hello?")).rejects.toMatchObject({ message: expect.stringContaining("cannot be delivered") });
    await sql_((tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, w.student4.userId)));
  });

  it("a read-only school can read and mark but not send", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Frozen" }));
    const ro = { ...w.a.as.student, readOnly: true };
    expect((await svc(ro).thread(id)).block?.reason).toMatch(/read-only/);
    await svc(ro).mark(id, "pinned", true);
    await expect(svc(ro).send(id, "x")).rejects.toMatchObject({ code: "read_only" });
  });

  it("saved replies: mine are private, the office's are shared, families have none", async () => {
    const mine = await svc(w.own).saveReply({ title: "Thanks", body: "Thank you, noted.", shared: false });
    const shared = await svc(w.a.as.accountant).saveReply({ title: "Office hours", body: "The office is open 9 to 4.", shared: true });
    expect((await svc(w.own).savedReplies()).map((r) => r.title).sort()).toEqual(["Office hours", "Thanks"]);
    expect((await svc(w.other).savedReplies()).map((r) => r.title)).toEqual(["Office hours"]);
    await expect(svc(w.own).saveReply({ title: "Shared", body: "x2", shared: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await svc(w.a.as.student).savedReplies()).toEqual([]);
    await expect(svc(w.other).deleteReply(mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await svc(w.a.as.accountant).deleteReply(shared.id);
  });

  it("internal notes inside a request are never shown, counted or notified to the family; as the office the name is the school's", async () => {
    const t = await sql_((tx) => createThread(tx, w.a.as.admin, { kind: "request", subject: "Certificate", studentId: w.st1.id, members: [{ userId: w.a.as.student.userId }] }));
    await sql_((tx) => postMessage(tx, w.a.as.admin, { threadId: t.id, body: "Please bring the old one.", asOffice: true }));
    await sql_((tx) => postMessage(tx, w.a.as.admin, { threadId: t.id, body: "Parent is hard to reach, call twice.", internal: true }));
    // requests have their own list and badge: never in the Messages inbox or count, counted once by the request counter
    expect((await svc(w.a.as.student).inbox()).rows.some((r) => r.id === t.id)).toBe(false);
    expect((await sql_((tx) => unreadByThread(tx, w.a.as.student))).has(t.id)).toBe(false);
    expect((await sql_((tx) => unreadByThread(tx, w.a.as.student, undefined, true))).get(t.id)).toBe(1);
    const fam = await svc(w.a.as.student).thread(t.id);
    expect(fam.messages.map((m) => m.body)).toEqual(["Please bring the old one."]);
    expect(fam.messages[0]!.sender).toMatch(/^School office \(/);
    expect((await svc(w.a.as.admin).thread(t.id)).messages.map((m) => m.kind)).toEqual(["text", "note"]);
    await expect(sql_((tx) => postMessage(tx, w.a.as.student, { threadId: t.id, body: "sneaky", internal: true }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("lapse (M5, acceptance 21)", () => {
  it("closes the conversation the same night when the teacher stops teaching the student, and an admin can move it", async () => {
    const t = await svc(w.far).start({ studentId: w.st3.id, recipientIds: [], subject: "Art project", body: "How is it going?" });
    // far stops teaching section B
    await sql_((tx) => tx.execute(sql`delete from section_teachers where teacher_id = ${w.far.userId}::uuid`));
    expect(await lapse(w.a.id)).toEqual({ closed: 1 });
    const closed = await svc(w.student3).thread(t.id);
    expect(closed.thread).toMatchObject({ state: "closed", closedReason: expect.stringContaining("no longer teaches Kabir") });
    expect(closed.messages.at(-1)!.kind).toBe("system");
    await expect(svc(w.student3).send(t.id, "hello")).rejects.toMatchObject({ message: expect.stringContaining("closed") });
    expect(closed.block?.reason).toMatch(/closed/);
    expect(await lapse(w.a.id)).toEqual({ closed: 0 }); // safe to run twice
    // the admin moves it to a teacher who now teaches B
    await svc(w.a.as.admin).reassign(t.id, w.other.userId);
    const open = await svc(w.student3).thread(t.id);
    expect(open.thread.state).toBe("open");
    expect(open.members.filter((m) => m.state === "active").map((m) => m.userId).sort()).toEqual([w.student3.userId, w.other.userId].sort());
    await expect(svc(w.student3).send(t.id, "Hello new teacher")).resolves.toBeDefined();
    await expect(svc(w.own).reassign(t.id, w.other.userId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes the teacher out when none teaches the student, and keeps it open while an office member is in it", async () => {
    const tmp = await addUser(w.a, "teacher", "lapsetmp");
    await sql_(async (tx) => {
      const [subject] = await tx.select({ id: subjects.id }).from(subjects).limit(1);
      await tx.insert(sectionTeachers).values({ schoolId: w.a.id, sectionId: w.s2, subjectId: subject!.id, teacherId: tmp.userId });
    });
    const t = await svc(tmp).start({ studentId: w.st3.id, recipientIds: [], subject: "Lapse with office", body: "Hello" });
    await sql_((tx) => tx.insert(threadMembers).values({ schoolId: w.a.id, threadId: t.id, userId: w.a.as.admin.userId, name: w.a.as.admin.name, role: "admin" }));
    await sql_((tx) => tx.execute(sql`delete from section_teachers where teacher_id = ${tmp.userId}::uuid`));
    await lapse(w.a.id);
    const view = await svc(w.student3).thread(t.id);
    expect(view.thread.state).toBe("open");
    expect(view.members.find((m) => m.userId === tmp.userId)?.state).toBe("left");
    expect(view.members.find((m) => m.userId === w.a.as.admin.userId)?.state).toBe("active");
    expect(view.messages.at(-1)).toMatchObject({ kind: "system", body: expect.stringContaining("no longer teaches Kabir") });
    await expect(svc(w.student3).send(t.id, "Still here")).resolves.toBeDefined();
  });

  it("closes a conversation when the student leaves", async () => {
    const t = await svc(w.a.as.admin).start(about(w.st5, { subject: "Leaving" }));
    await sql_((tx) => tx.execute(sql`update students set status = 'left' where id = ${w.st5.id}::uuid`));
    expect((await lapse(w.a.id)).closed).toBeGreaterThanOrEqual(1);
    expect((await svc(w.student4).thread(t.id)).thread.closedReason).toMatch(/has left the school/);
  });
});

describe("export (M20)", () => {
  it("a participant gets a PDF of their own conversation, nobody else", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Export", body: "नमस्ते, कल की परीक्षा के बारे में" }));
    const { bytes, name } = await svc(w.a.as.student).exportPdf(id);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(name).toMatch(/\.pdf$/);
    await expect(svc(w.other).exportPdf(id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
