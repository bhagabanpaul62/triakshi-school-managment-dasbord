import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, platformStaff, supportMessages, supportTickets, supportVisits, withConsole, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices, type Mail } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { SupportJobs } from "./jobs";
import { SupportService } from "./service";
import { addWorkingHours } from "./sla";

let a: TestSchool, b: TestSchool;
const sent: Mail[] = [];
let mailDown = false;
const DAY = 86_400_000;
const jobs = new SupportJobs();
const staffId = crypto.randomUUID();

beforeAll(async () => {
  useServices({ storage: new MemoryStorage(), email: { send: async (m: Mail) => { if (mailDown) throw new Error("smtp down"); sent.push(m); } } });
  ({ a, b } = await createSchoolPair(["support", "notifications"], "j"));
  await withConsole((tx) => tx.insert(platformStaff).values([
    { email: "owner@triakshi.test", name: "Olga Owner", role: "owner", passwordHash: "x" },
    { email: "support@triakshi.test", name: "Sam Support", role: "support", passwordHash: "x" },
    { email: "sales@triakshi.test", name: "Sal Sales", role: "sales", passwordHash: "x" },
    { email: "gone@triakshi.test", name: "Gone", role: "support", passwordHash: "x", status: "disabled" },
  ]));
});
afterAll(closeDb);
beforeEach(async () => { await withConsole((tx) => tx.execute(sql`update support_tickets set created_at = created_at - interval '3 hours' where created_at > now() - interval '2 hours'`)); });

const rows = (schoolId: string, userId: string) => withSchool(schoolId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
const ticket = async (ctx = a.as.teacher, priority = "normal") => new SupportService(ctx).create({ subject: `Job test ${Math.random().toString(36).slice(2, 7)}`, body: "Help please", priority });
const get = async (id: string) => (await withConsole((tx) => tx.select().from(supportTickets).where(eq(supportTickets.id, id))))[0]!;
const mailsFor = (id: string) => sent.filter((m) => m.text.includes(id));

describe("support.tell", () => {
  it("sets the reply time of a new ticket by priority and mails owners and support staff, once", async () => {
    const t = await ticket(a.as.teacher, "urgent");
    expect((await get(t.id)).replyDueAt).toBeNull();
    const r = await jobs.tell();
    expect(r.tickets).toBeGreaterThanOrEqual(1);
    const due = (await get(t.id)).replyDueAt!;
    expect(due.getTime()).toBe(addWorkingHours(t.createdAt, 2).getTime());
    const mails = mailsFor(t.id);
    expect(mails.map((m) => m.to).sort()).toEqual(["owner@triakshi.test", "support@triakshi.test"]);
    expect(mails[0]!.subject).toContain(`T-${t.number}`);
    await jobs.tell();
    expect(mailsFor(t.id)).toHaveLength(2);
    expect((await get(t.id)).replyDueAt!.getTime()).toBe(due.getTime());
  });

  it("tells the writer and everyone who wrote in the ticket about a staff message, once", async () => {
    const t = await ticket(a.as.teacher);
    await new SupportService(a.as.admin).reply(t.id, { body: "I am the principal, adding to this" });
    await withConsole((tx) => tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t.id, authorStaffId: staffId, staffName: "Sam", body: "We fixed the printer setting." }));
    const first = await jobs.tell();
    expect(first.messages).toBeGreaterThanOrEqual(1);
    for (const who of ["teacher", "admin"] as const) {
      const mine = (await rows(a.id, a.users[who])).filter((n) => n.topic === "support.reply" && n.subjectId === t.id);
      expect(mine, who).toHaveLength(1);
      expect(mine[0]).toMatchObject({ href: `/app/support/${t.id}`, title: `Triakshi replied on T-${t.number}` });
    }
    expect((await rows(a.id, a.users.accountant)).filter((n) => n.subjectId === t.id)).toHaveLength(0);
    const [m] = await withConsole((tx) => tx.select().from(supportMessages).where(and(eq(supportMessages.ticketId, t.id), eq(supportMessages.authorStaffId, staffId))));
    expect(m!.toldAt).not.toBeNull();
    await jobs.tell();
    expect((await rows(a.id, a.users.teacher)).filter((n) => n.subjectId === t.id).reduce((n, r) => n + r.count, 0)).toBe(1);
  });

  it("never tells another school", async () => {
    const t = await ticket(a.as.teacher);
    await withConsole((tx) => tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t.id, authorStaffId: staffId, body: "Only for A" }));
    await jobs.tell();
    for (const u of Object.values(b.users)) expect((await rows(b.id, u)).filter((n) => n.subjectId === t.id)).toHaveLength(0);
  });

  it("tells a school's administrators of a support visit, once, whatever its setting", async () => {
    const [v] = await withConsole((tx) => tx.insert(supportVisits).values({ schoolId: a.id, staffId, staffName: "Sam Support", asUserId: a.users.admin, asUserName: "admin a", reason: "Fee receipts problem", readOnly: true }).returning());
    await jobs.tell();
    const n = (await rows(a.id, a.users.admin)).filter((r) => r.subjectId === v!.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ topic: "account.security", href: "/app/settings/access" });
    expect(n[0]!.body).toContain("Fee receipts problem");
    expect((await rows(a.id, a.users.teacher)).filter((r) => r.subjectId === v!.id)).toHaveLength(0);
    await jobs.tell();
    expect((await rows(a.id, a.users.admin)).filter((r) => r.subjectId === v!.id)).toHaveLength(1);
  });
});

describe("a failed mail is not lost", () => {
  it("a new ticket's mail is tried again on the next run, not forgotten", async () => {
    const t = await ticket(a.as.teacher);
    mailDown = true;
    await jobs.tell();
    mailDown = false;
    expect(mailsFor(t.id)).toHaveLength(0);
    expect((await get(t.id)).replyDueAt).toBeNull();
    await jobs.tell();
    expect(mailsFor(t.id)).toHaveLength(2);
    expect((await get(t.id)).replyDueAt).not.toBeNull();
    await jobs.tell();
    expect(mailsFor(t.id)).toHaveLength(2);
  });
  it("after a day it is given up, and the clock stays set", async () => {
    const t = await ticket(a.as.teacher);
    await withConsole((tx) => tx.update(supportTickets).set({ createdAt: new Date(Date.now() - 2 * DAY) }).where(eq(supportTickets.id, t.id)));
    mailDown = true;
    await jobs.tell();
    mailDown = false;
    expect((await get(t.id)).replyDueAt).not.toBeNull();
    await jobs.tell();
    expect(mailsFor(t.id)).toHaveLength(0);
  });
  it("an overdue warning is tried again", async () => {
    const t = await ticket(a.as.teacher, "urgent");
    await withConsole((tx) => tx.update(supportTickets).set({ replyDueAt: new Date(Date.now() - 3_600_000) }).where(eq(supportTickets.id, t.id)));
    mailDown = true;
    await jobs.clock();
    mailDown = false;
    expect((await get(t.id)).overdueToldAt).toBeNull();
    await jobs.clock();
    expect(mailsFor(t.id)).toHaveLength(1);
    expect((await get(t.id)).overdueToldAt).not.toBeNull();
  });
});

describe("support.clock", () => {
  const waiting = async (days: number) => {
    const t = await ticket();
    await withConsole((tx) => tx.update(supportTickets).set({ status: "pending", pendingSince: new Date(Date.now() - days * DAY), firstReplyAt: new Date(Date.now() - days * DAY), replyDueAt: new Date(Date.now() - days * DAY) }).where(eq(supportTickets.id, t.id)));
    return t;
  };

  it("reminds the school after 3 days of waiting, once", async () => {
    const t = await waiting(4);
    const r = await jobs.clock();
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    const n = (await rows(a.id, a.users.teacher)).filter((x) => x.subjectId === t.id);
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain(`T-${t.number}`);
    expect((await get(t.id)).remindedAt).not.toBeNull();
    await jobs.clock();
    expect((await rows(a.id, a.users.teacher)).filter((x) => x.subjectId === t.id).reduce((s, x) => s + x.count, 0)).toBe(1);
    expect((await get(t.id)).status).toBe("pending");
  });

  it("does not remind before 3 days", async () => {
    const t = await waiting(2);
    await jobs.clock();
    expect((await get(t.id)).remindedAt).toBeNull();
  });

  it("marks a ticket solved after 14 days of waiting, tells the school, and closes a solved one after 7 days", async () => {
    const t = await waiting(15);
    await jobs.clock();
    const s = await get(t.id);
    expect(s.status).toBe("resolved");
    expect(s.resolvedAt).not.toBeNull();
    expect((await rows(a.id, a.users.teacher)).some((x) => x.subjectId === t.id && x.title.includes("solved"))).toBe(true);
    await withConsole((tx) => tx.update(supportTickets).set({ resolvedAt: new Date(Date.now() - 8 * DAY) }).where(eq(supportTickets.id, t.id)));
    const r = await jobs.clock();
    expect(r.closed).toBeGreaterThanOrEqual(1);
    expect(await get(t.id)).toMatchObject({ status: "closed" });
    expect((await get(t.id)).closedAt).not.toBeNull();
  });

  it("flags a missed first-reply target once, and mails the owner only", async () => {
    const t = await ticket(a.as.teacher, "urgent");
    await withConsole((tx) => tx.update(supportTickets).set({ replyDueAt: new Date(Date.now() - 3_600_000) }).where(eq(supportTickets.id, t.id)));
    sent.length = 0;
    const r = await jobs.clock();
    expect(r.overdue).toBeGreaterThanOrEqual(1);
    expect((await get(t.id)).overdueToldAt).not.toBeNull();
    const mails = mailsFor(t.id);
    expect(mails.map((m) => m.to)).toEqual(["owner@triakshi.test"]);
    expect(mails[0]!.subject).toContain("Overdue");
    await jobs.clock();
    expect(mailsFor(t.id)).toHaveLength(1);
  });

  it("does not flag a ticket that was answered in time", async () => {
    const t = await ticket();
    await withConsole((tx) => tx.update(supportTickets).set({ replyDueAt: new Date(Date.now() - 3_600_000), firstReplyAt: new Date(Date.now() - 7_200_000) }).where(eq(supportTickets.id, t.id)));
    await jobs.clock();
    expect((await get(t.id)).overdueToldAt).toBeNull();
  });

  it("a school reply to a waiting ticket stops the clock", async () => {
    const t = await waiting(4);
    await new SupportService(a.as.teacher).reply(t.id, { body: "Here is the answer" });
    await jobs.clock();
    expect(await get(t.id)).toMatchObject({ status: "open", pendingSince: null, remindedAt: null });
  });
});
