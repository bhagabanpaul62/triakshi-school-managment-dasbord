import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc } from "drizzle-orm";
import { auditLogs, closeDb, eq, migrateDb, sql, withSchool } from "@smw/db";
import { ForbiddenError, type Ctx } from "@smw/feature-kit";
import { MemoryStorage, useServices } from "@smw/integrations";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { notifications } from "@smw/feature-notifications/schema";
import { BatchService } from "./batch";
import { fileResponse, loadThread, markThreadRead, unreadByThread } from "./core";
import { messageFiles } from "./schema";
import { SafeguardService } from "./safeguard";
import { MessageService } from "./service";
import { addUser, build } from "./test-fixture";

let w: Awaited<ReturnType<typeof build>>;
const svc = (c: Ctx) => new MessageService(c);
const sql_ = <T,>(fn: Parameters<typeof withSchool<T>>[1]) => withSchool(w.a.id, fn);
const about = (st: { id: string }, extra: Record<string, unknown> = {}) => ({ studentId: st.id, recipientIds: [], subject: "About", body: "Hello", ...extra });
const lastAudit = (action: string) => sql_((tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.module, "messages"), eq(auditLogs.action, action))).orderBy(desc(auditLogs.createdAt)).limit(1)).then((r) => r[0]!);

beforeAll(async () => { useServices({ storage: new MemoryStorage() }); w = await build("h"); });
beforeEach(async () => { await migrateDb().execute(sql`update messages set created_at = created_at - interval '90 seconds'`); });
afterAll(closeDb);

describe("Message families checks every student, not only the shape of the list", () => {
  const section = (id: string) => JSON.stringify({ include: [{ type: "section", id }], exclude: [] });

  it("a teacher bound to 'class teacher only' cannot reach a section they only teach a subject in, by preview or send", async () => {
    const settings = new CommSettingsService(w.a.as.admin);
    await settings.save({ teacherMessages: "class_teacher" });
    try {
      await expect(new BatchService(w.own).preview(section(w.s1))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new BatchService(w.own).send({ audience: section(w.s1), subject: "Trip", body: "x", clientId: "hard-batch-0001" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new BatchService(w.form).send({ audience: section(w.s1), subject: "Trip", body: "x", clientId: "hard-batch-0002" })).resolves.toMatchObject({ threads: 3 });
    } finally { await settings.save({ teacherMessages: "taught" }); }
  });

  it("staff without messages:all or manage cannot use it at all; the accountant (all) can", async () => {
    const plain = await addUser(w.a, "staff", "plainh", ["messages:use"]);
    await expect(new BatchService(plain).preview(section(w.s1))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BatchService(w.a.as.accountant).preview(section(w.s1))).resolves.toMatchObject({ families: 3 });
  });
});

describe("a report is invisible to the people it names", () => {
  async function reportedThread() {
    const t = await svc(w.own).start(about(w.st1, { subject: `Held ${Math.random()}`, body: "Pay me directly." }));
    const msg = (await svc(w.a.as.student).thread(t.id)).messages.find((m) => m.sender === w.own.name)!;
    await svc(w.a.as.student).report({ threadId: t.id, messageId: msg.id, category: "pressure", note: "Asked for cash." });
    return t.id;
  }

  it("only the reporter sees the conversation as held, in the thread and in the inbox; the named teacher and the school's reviewer see what they should", async () => {
    const id = await reportedThread();
    expect((await svc(w.a.as.student).thread(id)).thread.held).toBe(true);
    expect((await svc(w.own).thread(id)).thread.held).toBe(false);
    expect((await svc(w.a.as.student).inbox()).rows.find((r) => r.id === id)!.held).toBe(true);
    expect((await svc(w.own).inbox()).rows.find((r) => r.id === id)!.held).toBe(false);
    await sql_(async (tx) => expect((await loadThread(tx, id, { schoolId: w.a.as.admin.schoolId, userId: w.a.as.admin.userId, role: "admin", review: true })).thread.held).toBe(true));
  });

  it("audit lines carry no subject or text, and report and review lines name who they are about", async () => {
    await svc(w.own).start(about(w.st1, { subject: "Secret subject line", body: "Secret body words" }));
    expect((await lastAudit("start")).summary).toBe("Started a conversation");
    const batch = await new BatchService(w.a.as.admin).send({ audience: JSON.stringify({ include: [{ type: "section", id: w.s2 }], exclude: [] }), subject: "Secret batch subject", body: "x", clientId: "hard-batch-0003" });
    expect((await lastAudit("send")).summary).toBe(`Sent a message to ${batch.threads} families`);
    const id = await reportedThread();
    expect((await lastAudit("report")).meta).toEqual({ aboutUserIds: [w.own.userId] });
    await new SafeguardService(w.a.as.admin).open({ threadId: id, reason: "Reading the reported message" });
    expect((await lastAudit("review")).meta).toEqual({ aboutUserIds: [w.own.userId] });
    const everything = (await sql_((tx) => tx.select({ s: auditLogs.summary }).from(auditLogs).where(eq(auditLogs.module, "messages")))).map((r) => r.s).join(" ");
    expect(everything).not.toMatch(/Secret|Held 0\./);
  });
});

describe("marking read and the bell agree with the badge", () => {
  it("the bell row clears only when nothing newer is unread", async () => {
    const { id } = await svc(w.own).start(about(w.st2, { subject: "Bell", body: "first" }));
    const bell = () => sql_((tx) => tx.select({ readAt: notifications.readAt }).from(notifications).where(and(eq(notifications.userId, w.student2.userId), eq(notifications.subjectId, id))));
    expect((await bell())[0]!.readAt).toBeNull();
    // the family has the conversation open at "first"; a newer message lands before the read mark is sent
    const shown = (await sql_((tx) => loadThread(tx, id, w.student2))).newestAt;
    await svc(w.own).send(id, "second, after the page was drawn");
    await sql_(async (tx) => { expect(await markThreadRead(tx, w.student2, id, shown)).toBe(false); });
    expect((await bell())[0]!.readAt).toBeNull();
    const left = () => sql_(async (tx) => (await unreadByThread(tx, w.student2, [id])).get(id) ?? 0);
    expect(await left()).toBe(1);
    // opening it again shows everything: badge zero, bell read
    await svc(w.student2).thread(id);
    expect((await bell())[0]!.readAt).not.toBeNull();
    expect(await left()).toBe(0);
  });
});

describe("support sessions", () => {
  it("every private read path is refused", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Private" }));
    const support = { ...w.a.as.admin, supportStaffId: "00000000-0000-4000-8000-000000000001" } as Ctx;
    for (const call of [() => svc(support).inbox(), () => svc(support).unreadCount(), () => svc(support).thread(id), () => new BatchService(support).list(), () => new SafeguardService(support).queue(), () => svc(support).inboxStudents()]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("files are sent from the module's own route", () => {
  it("members get the bytes with no-store and a disposition; a file whose bytes are not what it says is refused; others get not found", async () => {
    const { id } = await svc(w.own).start(about(w.st1, { subject: "Files" }));
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10]);
    await svc(w.own).send(id, "see attached", { files: [{ name: "plan.pdf", type: "application/pdf", size: PDF.byteLength, bytes: PDF }] });
    await expect(svc(w.own).send(id, "liar", { files: [{ name: "x.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }] })).rejects.toMatchObject({ fieldErrors: { files: expect.any(String) } });
    const [row] = await sql_((tx) => tx.select().from(messageFiles).where(eq(messageFiles.fileName, "plan.pdf")));
    const f = await svc(w.a.as.student).file(row!.id);
    expect(f).toMatchObject({ name: "plan.pdf", type: "application/pdf" });
    expect([...f.bytes]).toEqual([...PDF]);
    const res = fileResponse(f);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="plan.pdf"/);
    await expect(svc(w.student2).file(row!.id)).rejects.toMatchObject({ status: 404 });
  });
});
