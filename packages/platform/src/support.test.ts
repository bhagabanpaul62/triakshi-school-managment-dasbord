import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, platformAuditLogs, platformStaff, schools, supportMessages, supportNotes, supportTickets, supportVisits, supportViews, withConsole, withSchool } from "@smw/db";
import { SchoolAuth } from "@smw/auth";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type StaffCtx } from "@smw/feature-kit";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { NoticeService, noticeState, SupportDeskService, SupportLoginService, deskSla, supportMayEnter } from "./index";

vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

const storage = new MemoryStorage();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let me: StaffCtx, boss: StaffCtx, sales: StaffCtx;
let s1: TestSchool, s2: TestSchool;
let n = 0;
const slug = (p: string) => `${p}${Date.now().toString(36)}${n++}`.slice(0, 20);
const HOUR = 3_600_000;

beforeAll(async () => {
  useServices({ storage });
  const rows = await withConsole((tx) => tx.insert(platformStaff).values([
    { email: `me${slug("")}@t.test`, name: "Sam Support", role: "support", passwordHash: "x" },
    { email: `boss${slug("")}@t.test`, name: "Olga Owner", role: "owner", passwordHash: "x" },
  ]).returning());
  me = { staffId: rows[0]!.id, role: "support", name: rows[0]!.name };
  boss = { staffId: rows[1]!.id, role: "owner", name: rows[1]!.name };
  sales = { staffId: crypto.randomUUID(), role: "sales", name: "Sal" };
  s1 = await createTestSchool(slug("pa"), ["support"]);
  s2 = await createTestSchool(slug("pb"), ["support"]);
});

const raise = async (s: TestSchool, subject: string, extra: Partial<typeof supportTickets.$inferInsert> = {}, body = "Please help") =>
  withConsole(async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ schoolId: s.id, subject, createdByUserId: s.users.admin, ...extra }).returning();
    await tx.insert(supportMessages).values({ schoolId: s.id, ticketId: t!.id, authorUserId: s.users.admin, body });
    return t!;
  });
const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);

describe("the queue", () => {
  it("P2: search finds a ticket by subject, number, school name and words in a message", async () => {
    const t = await raise(s1, "Quokka on the timetable page", {}, "The marmalade column is wrong");
    const svc = new SupportDeskService(me);
    expect(ids(await svc.list({ q: "quokka" }))).toEqual([t.id]);
    expect(ids(await svc.list({ q: `T-${t.number}` }))).toEqual([t.id]);
    expect(ids(await svc.list({ q: String(t.number) }))).toEqual([t.id]);
    expect(ids(await svc.list({ q: "marmalade" }))).toEqual([t.id]);
    expect(ids(await svc.list({ q: s1.slug.toUpperCase() })).includes(t.id)).toBe(true);
    expect(ids(await svc.list({ q: "nothing-matches-this-xyz" }))).toEqual([]);
    expect(ids(await svc.list({ q: "100%" }))).toEqual([]);
  });

  it("filters by status, priority, category, school and owner; views pick the right tickets", async () => {
    const svc = new SupportDeskService(me);
    const fresh = await raise(s2, "V new", { priority: "high", category: "billing" });
    const late = await raise(s2, "V late", { replyDueAt: new Date(Date.now() - HOUR) });
    const ontime = await raise(s2, "V ontime", { replyDueAt: new Date(Date.now() + 20 * HOUR) });
    const waiting = await raise(s2, "V waiting", { status: "pending", pendingSince: new Date(), firstReplyAt: new Date() });
    const solved = await raise(s2, "V solved", { status: "resolved", resolvedAt: new Date(), firstReplyAt: new Date() });
    const mine = await raise(s2, "V mine", { assignedStaffId: me.staffId, firstReplyAt: new Date() });
    const only = (view: string) => svc.list({ filters: { view, school: s2.id }, pageSize: 100 }).then(ids);
    expect(await only("new")).toEqual(expect.arrayContaining([fresh.id, late.id, ontime.id]));
    expect(await only("new")).not.toContain(waiting.id);
    expect(await only("overdue")).toEqual([late.id]);
    expect(await only("waiting_school")).toEqual([waiting.id]);
    expect(await only("solved")).toEqual([solved.id]);
    expect(await only("mine")).toEqual([mine.id]);
    expect(await only("waiting_us")).toEqual(expect.arrayContaining([fresh.id, mine.id]));
    expect(ids(await svc.list({ filters: { priority: "high", school: s2.id } }))).toEqual([fresh.id]);
    expect(ids(await svc.list({ filters: { category: "billing", school: s2.id } }))).toEqual([fresh.id]);
    expect(ids(await svc.list({ filters: { assigned: me.staffId, school: s2.id } }))).toEqual([mine.id]);
    expect((await svc.viewCounts()).overdue).toBeGreaterThanOrEqual(1);
    expect(ids(await svc.list({ filters: { plan: "no-such-plan" } }))).toEqual([]);
    expect((await svc.list({ filters: { school: s2.id } })).rows.every((r) => r.schoolId === s2.id)).toBe(true);
    await expect(svc.list({ filters: { view: "bogus" } })).rejects.toBeInstanceOf(ValidationError);
    const row = (await svc.list({ filters: { school: s2.id, view: "overdue" } })).rows[0]!;
    expect(row).toMatchObject({ sla: "overdue", number: late.number });
  });

  it("works out the first-reply state", () => {
    const due = new Date(Date.now() + 100 * HOUR);
    expect(deskSla({ status: "open", replyDueAt: due, firstReplyAt: null })).toBe("ok");
    expect(deskSla({ status: "open", replyDueAt: new Date(Date.now() + HOUR), firstReplyAt: null })).toBe("soon");
    expect(deskSla({ status: "open", replyDueAt: new Date(Date.now() - HOUR), firstReplyAt: null })).toBe("overdue");
    expect(deskSla({ status: "pending", replyDueAt: due, firstReplyAt: new Date() })).toBe("met");
    expect(deskSla({ status: "closed", replyDueAt: due, firstReplyAt: null })).toBe("none");
  });

  it("only owners and support staff", async () => {
    await expect(new SupportDeskService(sales).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportDeskService(sales).report()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a ticket", () => {
  it("a staff reply starts the waiting clock, takes the ticket, and records the first reply; with files and a solve", async () => {
    const t = await raise(s1, "Reply flow");
    const svc = new SupportDeskService(me);
    await svc.reply(t.id, { body: "On it" }, [{ name: "fix.png", type: "image/png", size: PNG.length, bytes: PNG }]);
    const d = await svc.thread(t.id);
    expect(d.t).toMatchObject({ status: "pending", assignedStaffId: me.staffId });
    expect(d.t.firstReplyAt).not.toBeNull();
    expect(d.t.pendingSince).not.toBeNull();
    expect(d.messages.map((m) => !!m.fromStaff)).toEqual([false, true]);
    expect(d.files).toHaveLength(1);
    expect(d.files[0]!.fileKey.startsWith(`${s1.id}/private/support/${t.id}/`)).toBe(true);
    expect((await svc.fileBytes(d.files[0]!.id)).bytes).toEqual(PNG);
    expect((await svc.fileUrl(d.files[0]!.id)).url).toContain(t.id);
    const first = d.t.firstReplyAt;
    await svc.reply(t.id, { body: "Fixed", solve: "true" });
    const after = await svc.thread(t.id);
    expect(after.t).toMatchObject({ status: "resolved", pendingSince: null });
    expect(after.t.resolvedAt).not.toBeNull();
    expect(after.t.firstReplyAt!.getTime()).toBe(first!.getTime());
    await expect(svc.reply(t.id, { body: "x" }, [{ name: "a.pdf", type: "application/pdf", size: PNG.length, bytes: PNG }])).rejects.toBeInstanceOf(ValidationError);
    await svc.setStatus(t.id, "closed");
    await expect(svc.reply(t.id, { body: "more" })).rejects.toBeInstanceOf(ConflictError);
    await svc.setStatus(t.id, "open");
    expect((await svc.thread(t.id)).t).toMatchObject({ status: "open", resolvedAt: null, closedAt: null });
    await expect(svc.reply("not-an-id", { body: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("internal notes are staff only: the school's database role cannot read them", async () => {
    const t = await raise(s1, "Notes");
    const svc = new SupportDeskService(me);
    await svc.addNote(t.id, { body: "They always forget the year" });
    expect((await svc.thread(t.id)).notes.map((x) => [x.body, x.staffName])).toEqual([["They always forget the year", "Sam Support"]]);
    await expect(withSchool(s1.id, (tx) => tx.select().from(supportNotes))).rejects.toThrow();
    await expect(svc.addNote(t.id, { body: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("saved replies: write, edit, use, delete; not for sales", async () => {
    const svc = new SupportDeskService(me);
    const r = await svc.saveReply(undefined, { title: "Receipts blank", body: "Please clear the cache and try again." });
    await svc.saveReply(r.id, { title: "Receipts blank 2", body: "Updated" });
    expect((await svc.savedReplies()).find((x) => x.id === r.id)).toMatchObject({ title: "Receipts blank 2", body: "Updated" });
    const t = await raise(s1, "Saved replies");
    expect((await svc.thread(t.id)).savedReplies.map((x) => x.id)).toContain(r.id);
    await svc.deleteReply(r.id);
    expect((await svc.savedReplies()).some((x) => x.id === r.id)).toBe(false);
    await expect(new SupportDeskService(sales).savedReplies()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.saveReply(crypto.randomUUID(), { title: "Gone", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assigns to anyone on the team, not to a stranger; sets category; priority moves the reply time only before a first reply", async () => {
    const t = await raise(s1, "Assign me");
    const svc = new SupportDeskService(me);
    await svc.assign(t.id, boss.staffId);
    expect((await svc.thread(t.id)).assignee).toBe("Olga Owner");
    await expect(svc.assign(t.id, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await svc.assign(t.id, null);
    expect((await svc.thread(t.id)).t.assignedStaffId).toBeNull();
    await svc.setCategory(t.id, "billing");
    expect((await svc.thread(t.id)).t.category).toBe("billing");
    const due = new Date(Date.now() + 2 * HOUR);
    await svc.setPriority(t.id, "urgent", () => due);
    expect((await svc.thread(t.id)).t).toMatchObject({ priority: "urgent" });
    expect((await svc.thread(t.id)).t.replyDueAt!.getTime()).toBe(due.getTime());
    await svc.reply(t.id, { body: "ok" });
    await svc.setPriority(t.id, "low", () => new Date(0));
    expect((await svc.thread(t.id)).t.replyDueAt!.getTime()).toBe(due.getTime());
    expect(await withConsole((tx) => tx.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "ticket.assign"), eq(platformAuditLogs.schoolId, s1.id))))).not.toHaveLength(0);
  });

  it("the school card and earlier tickets come with the thread", async () => {
    const t = await raise(s1, "Card");
    const d = await new SupportDeskService(me).thread(t.id);
    expect(d.card.openTickets).toBeGreaterThanOrEqual(1);
    expect(d).toMatchObject({ supportAccess: "always" });
    expect(d.earlier.length).toBeGreaterThanOrEqual(1);
    expect(d.earlier.every((e) => e.id !== t.id)).toBe(true);
    expect(d.staff.map((s) => s.name)).toEqual(expect.arrayContaining(["Sam Support", "Olga Owner"]));
  });
});

describe("reports", () => {
  it("counts volume, times, ratings and article votes", async () => {
    const t = await raise(s1, "Report me", { category: "problem", rating: 5 });
    await withConsole(async (tx) => {
      await tx.update(supportTickets).set({ firstReplyAt: new Date(t.createdAt.getTime() + 2 * HOUR), resolvedAt: new Date(t.createdAt.getTime() + 10 * HOUR), replyDueAt: new Date(t.createdAt.getTime() + 3 * HOUR) }).where(eq(supportTickets.id, t.id));
      await tx.insert(supportViews).values([{ schoolId: s1.id, article: "take-a-fee", useful: false }, { schoolId: s1.id, article: "take-a-fee", useful: true }, { schoolId: s1.id, article: "take-a-fee", useful: false }]);
    });
    const r = await new SupportDeskService(me).report(30);
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.byCategory.find((c) => c.category === "problem")!.n).toBeGreaterThanOrEqual(1);
    expect(r.bySchool.length).toBeGreaterThan(0);
    expect(r.firstReply.n).toBeGreaterThanOrEqual(1);
    expect(r.firstReply.medianHours).not.toBeNull();
    expect(r.resolution.n).toBeGreaterThanOrEqual(1);
    expect(r.rating.average).toBeGreaterThan(0);
    expect(r.slaMetPercent).toBeGreaterThanOrEqual(0);
    expect(r.notUseful.find((v) => v.article === "take-a-fee")).toMatchObject({ yes: 1, no: 2 });
  });
});

describe("support access", () => {
  const school = (extra: Partial<typeof schools.$inferInsert>) => withConsole((tx) => tx.update(schools).set(extra).where(eq(schools.id, current.id)));
  let current: TestSchool;
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
  const open = (input: Record<string, unknown>, who = me) => new SupportLoginService(who).create({ schoolId: current.id, reason: "Looking at a fee receipt problem", ...input });

  it("always: staff may enter, and the visit is written for the school to read", async () => {
    current = await createTestSchool(slug("sa"), []);
    const r = await open({});
    expect(r.emergency).toBe(false);
    const [v] = await withConsole((tx) => tx.select().from(supportVisits).where(eq(supportVisits.id, r.visitId)));
    expect(v).toMatchObject({ schoolId: current.id, staffId: me.staffId, staffName: "Sam Support", asUserId: current.users.admin, readOnly: true, emergency: false, reason: "Looking at a fee receipt problem" });
    expect(v!.toldAt).toBeNull();
    await new SchoolAuth(current.id).supportLogin(tokenOf(r.url));
    await expect(withSchool(current.id, (tx) => tx.select().from(supportVisits))).resolves.toHaveLength(1);
    await expect(withSchool(current.id, (tx) => tx.update(supportVisits).set({ reason: "x" }))).rejects.toThrow();
    await expect(withSchool(current.id, (tx) => tx.delete(supportVisits))).rejects.toThrow();
    await expect(withSchool(current.id, (tx) => tx.insert(supportVisits).values({ schoolId: current.id, staffId: me.staffId, staffName: "x", asUserId: current.users.admin, asUserName: "x", reason: "x", readOnly: true }))).rejects.toThrow();
  });

  it("never: refused, with what to do; no visit is written", async () => {
    current = await createTestSchool(slug("sn"), []);
    await school({ supportAccess: "never" });
    await expect(open({})).rejects.toThrow(/does not sign in/);
    await expect(open({}, boss)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await withConsole((tx) => tx.select().from(supportVisits).where(eq(supportVisits.schoolId, current.id)))).toHaveLength(0);
    expect(supportMayEnter({ supportAccess: "never", supportAccessUntil: null })).toBe(false);
  });

  it("until: only before the time", async () => {
    current = await createTestSchool(slug("su"), []);
    await school({ supportAccess: "until", supportAccessUntil: new Date(Date.now() + 24 * HOUR) });
    await expect(open({})).resolves.toMatchObject({ emergency: false });
    await school({ supportAccessUntil: new Date(Date.now() - 1000) });
    await expect(open({})).rejects.toThrow(/limited time/);
    await school({ supportAccessUntil: null });
    await expect(open({})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("emergency: owner only, with a real reason, against the setting; recorded as an emergency and audited", async () => {
    current = await createTestSchool(slug("se"), []);
    await school({ supportAccess: "never" });
    await expect(open({ emergency: "true" }, me)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(open({ emergency: "true", reason: "short reason" }, boss)).rejects.toBeInstanceOf(ValidationError);
    const r = await open({ emergency: "true", reason: "Data loss reported, school cannot reach anyone" }, boss);
    expect(r.emergency).toBe(true);
    const [v] = await withConsole((tx) => tx.select().from(supportVisits).where(eq(supportVisits.id, r.visitId)));
    expect(v).toMatchObject({ emergency: true, staffName: "Olga Owner" });
    expect(await withConsole((tx) => tx.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, "support.emergency"), eq(platformAuditLogs.schoolId, current.id))))).toHaveLength(1);
    // when the school has said yes anyway, an emergency flag is not used
    await school({ supportAccess: "always" });
    expect((await open({ emergency: "true" }, boss)).emergency).toBe(false);
  });
});

describe("notices", () => {
  it("writes, lists by state, ends, and checks the audience", async () => {
    const svc = new NoticeService(me);
    const now = Date.now();
    const running = await svc.create({ title: "Planned work tonight", body: "Short break from 11pm.", tone: "warning" });
    const upcoming = await svc.create({ title: "Later maintenance", body: "Next week.", startsAt: new Date(now + 48 * HOUR).toISOString() });
    const oneSchool = await svc.create({ title: "Just for you", body: "Hello", audience: "school", schoolId: s1.id });
    expect(oneSchool).toMatchObject({ audience: "school", schoolId: s1.id, planKey: null });
    expect((await svc.list("running")).map((n) => n.id)).toEqual(expect.arrayContaining([running.id, oneSchool.id]));
    expect((await svc.list("upcoming")).map((n) => n.id)).toContain(upcoming.id);
    expect((await svc.list("running")).find((x) => x.id === oneSchool.id)!.school).toBe(s1 ? (await withConsole((tx) => tx.select({ n: schools.name }).from(schools).where(eq(schools.id, s1.id))))[0]!.n : "");
    await svc.end(running.id);
    expect((await svc.list("ended")).map((n) => n.id)).toContain(running.id);
    await svc.end(upcoming.id); // not started: removed
    expect((await svc.list()).map((n) => n.id)).not.toContain(upcoming.id);
    await expect(svc.end(running.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.create({ title: "Bad plan", body: "x y z", audience: "plan" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ title: "Bad plan", body: "x y z", audience: "plan", planKey: "no-such" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ title: "Bad school", body: "x y z", audience: "school" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ title: "Backwards", body: "x y z", startsAt: new Date(now + HOUR).toISOString(), endsAt: new Date(now).toISOString() })).rejects.toBeInstanceOf(ValidationError);
    await expect(new NoticeService(sales).create({ title: "Not mine", body: "x y z" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new NoticeService(sales).list()).length).toBeGreaterThan(0); // sales may read
    expect(noticeState({ startsAt: new Date(now + 1000), endsAt: null })).toBe("upcoming");
  });
});
