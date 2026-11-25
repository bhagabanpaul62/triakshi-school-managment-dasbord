import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, platformNotices, supportFiles, supportMessages, supportNotes, supportTickets, supportViews, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ReadOnlyError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { HelpService, SupportService } from "./service";
import { activeNotices } from "./notices";

let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => {
  useServices({ storage });
  ({ a, b } = await createSchoolPair(["support", "notifications"]));
});
afterAll(closeDb);
// The per-person ticket limit counts the last hour: each test starts with the earlier tickets an old hour behind it.
beforeEach(async () => { await withConsole((tx) => tx.execute(sql`update support_tickets set created_at = created_at - interval '3 hours' where created_at > now() - interval '2 hours'`)); });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const png = (name = "screen.png") => ({ name, type: "image/png", size: PNG.length, bytes: PNG });
const asStaff = (ticketId: string, body = "Looking at it") => withConsole((tx) => tx.insert(supportMessages).values({ schoolId: a.id, ticketId, authorStaffId: crypto.randomUUID(), staffName: "Asha", body }));
const setStatus = (id: string, status: "open" | "pending" | "resolved" | "closed") => withConsole((tx) => tx.update(supportTickets).set({ status, pendingSince: status === "pending" ? new Date() : null }).where(eq(supportTickets.id, id)));

describe("SupportService", () => {
  it("creates a ticket with its first message, a number and a category", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Fee receipts will not print", body: "The PDF is blank.", priority: "high" });
    expect(t).toMatchObject({ status: "open", priority: "high", category: "question" });
    expect(t.number).toBeGreaterThanOrEqual(1001);
    const { messages } = await svc.thread(t.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: "The PDF is blank.", fromStaff: false, author: a.as.admin.name });
    expect((await svc.list()).rows.map((r) => r.id)).toContain(t.id);
  });

  it("keeps the signature other modules call: subject, body, category, priority, context", async () => {
    const t = await new SupportService(a.as.admin).create({ subject: "Help with the wizard step", body: "Stuck on staff", category: "onboarding", priority: "normal", context: { page: "/app/setup/staff?x=1" } });
    expect(t.category).toBe("onboarding");
    expect(t.context).toEqual({ page: "/app/setup/staff" });
  });

  it("asks for a subject and a message, and refuses a page that is not ours", async () => {
    await expect(new SupportService(a.as.admin).create({ subject: "", body: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new SupportService(a.as.admin).create({ subject: "Hello there", body: "x", context: { page: "https://evil.example/app" } })).rejects.toBeInstanceOf(ValidationError);
  });

  // P5: an admin of another role could not ask for help at all.
  it("P5: an accountant and a teacher can ask for help; a family cannot", async () => {
    for (const role of ["accountant", "teacher"] as const) {
      const t = await new SupportService(a.as[role]).create({ subject: `Question from ${role}`, body: "Where is it?" });
      expect(t.createdByUserId).toBe(a.users[role]);
    }
    for (const role of ["student", "parent"] as const) {
      await expect(new SupportService(a.as[role]).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SupportService(a.as[role]).create({ subject: "Hello", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("without support:all a person sees only their own tickets; with it they see the school's", async () => {
    const mine = await new SupportService(a.as.teacher).create({ subject: "Teacher's own question", body: "x" });
    const theirs = await new SupportService(a.as.accountant).create({ subject: "Accountant's own question", body: "y" });
    const teacher = new SupportService(a.as.teacher);
    const ids = (await teacher.list()).rows.map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    await expect(teacher.thread(theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(teacher.reply(theirs.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(teacher.solve(theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(teacher.close(theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    const admin = new SupportService(a.as.admin);
    const all = (await admin.list({ pageSize: 100 })).rows.map((r) => r.id);
    expect(all).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect((await admin.list({ filters: { scope: "mine" }, pageSize: 100 })).rows.map((r) => r.id)).not.toContain(mine.id);
    expect((await admin.thread(theirs.id)).canAll).toBe(true);
  });

  it("finds a ticket by its subject or by its number", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Zebra pattern on report cards", body: "x" });
    expect((await svc.list({ q: "zebra" })).rows.map((r) => r.id)).toEqual([t.id]);
    expect((await svc.list({ q: `T-${t.number}` })).rows.map((r) => r.id)).toEqual([t.id]);
    expect((await svc.list({ q: String(t.number) })).rows.map((r) => r.id)).toEqual([t.id]);
    expect((await svc.list({ q: "100%_" })).rows).toHaveLength(0);
  });

  it("shows staff replies as support, and a school reply puts a waiting ticket back to open", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Login help", body: "Teacher cannot sign in" });
    await asStaff(t.id, "Reset sent.");
    await setStatus(t.id, "pending");
    const { messages, ticket } = await svc.thread(t.id);
    expect(messages.some((m) => m.fromStaff && m.author === "Asha, Triakshi support")).toBe(true);
    expect(ticket.status).toBe("pending");
    expect((await svc.waiting())).toBeGreaterThanOrEqual(1);
    expect((await svc.reply(t.id, { body: "Thanks, works now" })).status).toBe("open");
    expect((await svc.thread(t.id)).ticket.pendingSince).toBeNull();
  });

  // P3: "Resolved" never closed; closing was final for the school.
  it("P3: solve, reopen, rate, close; a closed ticket stays closed and is followed up", async () => {
    const svc = new SupportService(a.as.teacher);
    const t = await svc.create({ subject: "Marks will not save", body: "x" });
    await expect(svc.rate(t.id, { rating: 5 })).rejects.toBeInstanceOf(ConflictError);
    await svc.solve(t.id);
    expect((await svc.thread(t.id)).ticket).toMatchObject({ status: "resolved" });
    expect((await svc.thread(t.id)).ticket.resolvedAt).not.toBeNull();
    await svc.rate(t.id, { rating: 4, note: "Quick" });
    expect((await svc.thread(t.id)).ticket).toMatchObject({ rating: 4, ratingNote: "Quick" });
    await expect(svc.rate(t.id, { rating: 6 })).rejects.toBeInstanceOf(ValidationError);
    await svc.reopen(t.id);
    expect((await svc.thread(t.id)).ticket).toMatchObject({ status: "open", resolvedAt: null });
    await svc.close(t.id);
    await expect(svc.reopen(t.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.reply(t.id, { body: "more" })).rejects.toBeInstanceOf(ConflictError);
    const f = await svc.create({ subject: "Marks again", body: "It is back", followUpOf: t.id });
    expect((await svc.thread(f.id)).followUpOf).toMatchObject({ id: t.id, number: t.number });
    // somebody else's ticket cannot be followed up
    await expect(new SupportService(a.as.accountant).create({ subject: "Snooping", body: "x", followUpOf: t.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a read-only school can still ask for help, but a read-only support session cannot", async () => {
    const t = await new SupportService({ ...a.as.admin, readOnly: true }).create({ subject: "We are read-only", body: "Our plan lapsed" });
    expect(t.status).toBe("open");
    await new SupportService({ ...a.as.admin, readOnly: true }).reply(t.id, { body: "Paid now" });
    await expect(new SupportService({ ...a.as.admin, readOnly: true, supportStaffId: crypto.randomUUID() }).create({ subject: "From support", body: "x" })).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("isolation: school B cannot see, read, reply to, solve or open files of A's ticket", async () => {
    const t = await new SupportService(a.as.admin).create({ subject: "A private matter", body: "x" }, [png()]);
    const bSvc = new SupportService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === t.id)).toBe(false);
    await expect(bSvc.thread(t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.reply(t.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.solve(t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.close(t.id)).rejects.toBeInstanceOf(NotFoundError);
    const [f] = await withConsole((tx) => tx.select().from(supportFiles).where(eq(supportFiles.ticketId, t.id)));
    await expect(bSvc.fileUrl(f!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.fileBytes(f!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ticket limits", () => {
  it("one person may send 10 tickets an hour; the school's ceiling is 60 for everyone together", async () => {
    const [x, y] = [await createSchoolPair(["support"], "lim")].map((p) => p.a);
    const svc = new SupportService(x!.as.teacher);
    for (let i = 0; i < 10; i++) await svc.create({ subject: `Limit test ${i}`, body: "x" });
    await expect(svc.create({ subject: "One too many", body: "x" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.create({ subject: "One too many", body: "x" })).rejects.toThrow(/10 tickets/);
    await new SupportService(x!.as.accountant).create({ subject: "Someone else may still ask", body: "x" });
    await withConsole((tx) => tx.insert(supportTickets).values(Array.from({ length: 60 }, (_, i) => ({ schoolId: x!.id, subject: `Bulk ${i}` }))));
    await expect(new SupportService(x!.as.admin).create({ subject: "School ceiling", body: "x" })).rejects.toThrow(/Your school has sent a lot/);
    void y;
  });
});

describe("files", () => {
  it("stores files under the ticket's private folder, and only the ticket's people can open them", async () => {
    const t = await new SupportService(a.as.teacher).create({ subject: "Blank page on print", body: "see picture" }, [png(), { name: "log.pdf", type: "application/pdf", size: PDF.length, bytes: PDF }]);
    const { messages } = await new SupportService(a.as.teacher).thread(t.id);
    expect(messages[0]!.files.map((f) => f.name).sort()).toEqual(["log.pdf", "screen.png"]);
    expect(messages[0]!.files[0]!.href).toMatch(/^\/api\/support\/files\/[0-9a-f-]{36}$/);
    const rows = await withConsole((tx) => tx.select().from(supportFiles).where(eq(supportFiles.ticketId, t.id)));
    expect(rows.every((r) => r.fileKey.startsWith(`${a.id}/private/support/${t.id}/`))).toBe(true);
    const id = messages[0]!.files.find((f) => f.name === "screen.png")!.href.split("/").pop()!;
    expect((await new SupportService(a.as.teacher).fileBytes(id)).bytes).toEqual(PNG);
    expect((await new SupportService(a.as.teacher).fileUrl(id)).url).toContain(`${a.id}/private/support/${t.id}/`);
    expect((await new SupportService(a.as.admin).fileBytes(id)).name).toBe("screen.png"); // support:all
    await expect(new SupportService(a.as.accountant).fileBytes(id)).rejects.toBeInstanceOf(NotFoundError); // not theirs
    await expect(new SupportService(a.as.teacher).fileBytes("not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a reply can carry files; the bytes decide the type; too many are refused and nothing is left behind", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Files on a reply", body: "x" });
    await svc.reply(t.id, { body: "Here" }, [png("two.png")]);
    expect((await svc.thread(t.id)).messages[1]!.files).toHaveLength(1);
    const before = storage.files.size;
    await expect(svc.reply(t.id, { body: "fake" }, [{ name: "a.pdf", type: "application/pdf", size: PNG.length, bytes: PNG }])).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.reply(t.id, { body: "exe" }, [{ name: "a.exe", type: "application/x-msdownload", size: 4, bytes: new Uint8Array([77, 90, 0, 0]) }])).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ subject: "Six files", body: "x" }, Array.from({ length: 6 }, (_, i) => png(`p${i}.png`)))).rejects.toBeInstanceOf(ValidationError);
    const big = { name: "big.pdf", type: "application/pdf", size: 11 * 1048576, bytes: PDF };
    await expect(svc.create({ subject: "Too big", body: "x" }, [big])).rejects.toBeInstanceOf(ValidationError);
    const four = Array.from({ length: 2 }, (_, i) => ({ name: `s${i}.pdf`, type: "application/pdf", size: 8 * 1048576, bytes: PDF }));
    await expect(svc.create({ subject: "Together too big", body: "x" }, four)).rejects.toMatchObject({ fieldErrors: { files: expect.stringMatching(/Together your files are 16\.0 MB/) } });
    expect(storage.files.size).toBe(before);
  });
});

describe("what the school's database role may touch", () => {
  const mk = () => new SupportService(a.as.admin).create({ subject: "Guard check", body: "hello" });

  it("cannot set the number, the owner, the reply times or a staff status", async () => {
    const t = await mk();
    for (const set of [{ priority: "urgent" }, { assignedStaffId: crypto.randomUUID() }, { replyDueAt: new Date() }, { firstReplyAt: new Date() }, { overdueToldAt: new Date() }, { pendingSince: new Date() }, { remindedAt: new Date() }, { number: 5 }, { category: "billing" }]) {
      await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set(set as never).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
    }
  });

  it("cannot read internal notes or saved replies", async () => {
    const t = await mk();
    await withConsole((tx) => tx.insert(supportNotes).values({ ticketId: t.id, staffId: crypto.randomUUID(), body: "School is difficult" }));
    await expect(withSchool(a.id, (tx) => tx.select().from(supportNotes))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.execute(sql`select * from support_saved_replies`))).rejects.toThrow();
  });

  it("cannot edit or delete a message or a file, or write as staff", async () => {
    const t = await new SupportService(a.as.admin).create({ subject: "Guard messages", body: "hello" }, [png()]);
    await expect(withSchool(a.id, (tx) => tx.update(supportMessages).set({ body: "edited" }).where(eq(supportMessages.ticketId, t.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.delete(supportMessages).where(eq(supportMessages.ticketId, t.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.delete(supportFiles).where(eq(supportFiles.ticketId, t.id)))).rejects.toThrow();
    await withSchool(a.id, (tx) => tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t.id, authorStaffId: crypto.randomUUID(), staffName: "Fake", toldAt: new Date(), body: "fake" }));
    const [fake] = await withConsole((tx) => tx.select().from(supportMessages).where(eq(supportMessages.body, "fake")));
    expect(fake).toMatchObject({ authorStaffId: null, staffName: null, toldAt: null });
    expect((await new SupportService(a.as.admin).thread(t.id)).messages.some((m) => m.fromStaff)).toBe(false);
  });

  it("a new ticket gets its number from the database and starts open with no clock", async () => {
    const [t] = await withSchool(a.id, (tx) => tx.insert(supportTickets).values({ schoolId: a.id, subject: "Sneaky", number: 7, status: "closed", rating: 5, replyDueAt: new Date(0), firstReplyAt: new Date(0) }).returning());
    expect(t!.number).toBeGreaterThanOrEqual(1001);
    expect(t).toMatchObject({ status: "open", rating: null, replyDueAt: null, firstReplyAt: null });
  });

  it("cannot put a ticket on 'waiting for you', cannot reopen a closed one, and rates 1 to 5 on a solved one only", async () => {
    const t = await mk();
    await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set({ status: "pending" }).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set({ rating: 3 }).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
    await new SupportService(a.as.admin).close(t.id);
    await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set({ status: "open" }).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set({ rating: 9 }).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
  });
});

describe("help centre votes and status notices", () => {
  it("records a vote without a person, and refuses families and unknown articles", async () => {
    await new HelpService(a.as.teacher).vote({ article: "take-a-fee", useful: "true" });
    await new HelpService(a.as.accountant).vote({ article: "take-a-fee", useful: "false" });
    const rows = await withSchool(a.id, (tx) => tx.select().from(supportViews).where(eq(supportViews.article, "take-a-fee")));
    expect(rows.map((r) => r.useful).sort()).toEqual([false, true]);
    expect(Object.keys(rows[0]!)).not.toContain("userId");
    await expect(new HelpService(a.as.student).vote({ article: "take-a-fee", useful: "true" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HelpService(a.as.teacher).vote({ article: "no-such-article", useful: "true" })).rejects.toBeInstanceOf(ValidationError);
    await expect(withSchool(a.id, (tx) => tx.update(supportViews).set({ useful: true }).where(eq(supportViews.article, "take-a-fee")))).rejects.toThrow();
  });

  it("a school reads notices for everyone, for its plan, and for itself: not for another school, not before the start, not after the end", async () => {
    const now = new Date(), hour = 3_600_000;
    const base = { tone: "info" as const, body: "Details", startsAt: new Date(now.getTime() - hour) };
    await withConsole((tx) => tx.insert(platformNotices).values([
      { ...base, title: "N-all", audience: "all" },
      { ...base, title: "N-a", audience: "school", schoolId: a.id },
      { ...base, title: "N-b", audience: "school", schoolId: b.id },
      { ...base, title: "N-plan-other", audience: "plan", planKey: "no-such-plan" },
      { ...base, title: "N-future", audience: "all", startsAt: new Date(now.getTime() + hour) },
      { ...base, title: "N-ended", audience: "all", endsAt: new Date(now.getTime() - 1000) },
    ]));
    const titles = (await activeNotices(a.id, 50)).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["N-all", "N-a"]));
    for (const gone of ["N-b", "N-plan-other", "N-future", "N-ended"]) expect(titles).not.toContain(gone);
    await expect(withSchool(a.id, (tx) => tx.insert(platformNotices).values({ title: "Fake", body: "x", startsAt: now }))).rejects.toThrow();
  });
});
