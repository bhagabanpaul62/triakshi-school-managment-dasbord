import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, users, withConsole, withSchool } from "@smw/db";
import { ForbiddenError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryPushSender, useServices, type Mail } from "@smw/integrations";
import notificationsFeature from "./feature";
import { deliverDue, DeliveryService, NO_BUDGET, PushTestService, sendAccountMail } from "./delivery";
import { runDigest } from "./digest";
import { PreferenceService } from "./prefs";
import { NotificationWriter } from "./writer";
import { isSuppressed, mailWebhook } from "./email-health";
import { commDeliveries, commSettings, emailSuppressions, mailUsage, notificationPrefs, notifications, pushSubscriptions } from "./schema";

process.env.MAIL_DAILY_LIMIT = "10";
process.env.MAIL_WEBHOOK_SECRET = "s3cret";
process.env.VAPID_PUBLIC_KEY = "pub";
process.env.VAPID_PRIVATE_KEY = "priv";

// `db.failNext` makes the next console queries fail: used right after a mail or push went out, to see that nothing is sent twice.
const db = vi.hoisted(() => ({ failNext: 0 }));
vi.mock("@smw/db", async (orig) => {
  const m = await orig<typeof import("@smw/db")>();
  return { ...m, withConsole: ((fn: never) => (db.failNext-- > 0 ? Promise.reject(new Error("db down")) : m.withConsole(fn))) as typeof m.withConsole };
});

class Flaky extends MemoryEmailSender {
  fail: (m: Mail) => unknown = () => null;
  after: (() => void) | null = null;
  async send(m: Mail) { const e = this.fail(m); if (e) throw e; await super.send(m); this.after?.(); }
}
const mail = new Flaky();
const push = new MemoryPushSender();

const DAY = new Date("2026-11-25T10:30:00+05:30");
const NIGHT = new Date("2026-11-25T21:00:00+05:30");
const due = new Date(DAY.getTime() - 60_000);
const SECRET = "the-marks-are-42";

let a: TestSchool, b: TestSchool, seq = 0;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "dl"));
  useServices({ email: mail, push });
});
afterAll(closeDb);
beforeEach(async () => {
  db.failNext = 0; mail.after = null;
  mail.sent.length = 0; push.sent.length = 0; push.gone.clear(); push.failing.clear(); mail.fail = () => null;
  await withConsole(async (tx) => {
    const ids = [a.id, b.id];
    for (const t of [commDeliveries, notifications, pushSubscriptions, emailSuppressions, mailUsage, notificationPrefs, commSettings]) await tx.delete(t).where(inArray(t.schoolId, ids));
    await tx.execute(sql`delete from students where school_id in (${a.id}, ${b.id})`);
    await tx.execute(sql`delete from guardians where school_id in (${a.id}, ${b.id})`);
    for (const s of [a, b]) for (const [role, id] of Object.entries(s.users)) await tx.update(users).set({ email: `${role}@${s.slug}.test`, status: "active", emailVerifiedAt: null }).where(eq(users.id, id));
  });
});

interface Put { channel?: "email" | "push"; priority?: number; mode?: "instant" | "digest"; title?: string; body?: string; href?: string; groupKey?: string; privateBody?: boolean; urgent?: boolean; topic?: "work.update" | "notice.published" | "homework.new"; readAt?: Date; nextAt?: Date }
async function put(s: TestSchool, userId: string, o: Put = {}) {
  return withSchool(s.id, async (tx) => {
    const [n] = await tx.insert(notifications).values({ schoolId: s.id, userId, topic: o.topic ?? "work.update", title: o.title ?? `Title ${++seq}`, body: o.body ?? "Body", href: o.href ?? "/app/x", groupKey: o.groupKey ?? null, privateBody: o.privateBody ?? false, urgent: o.urgent ?? false, readAt: o.readAt ?? null }).returning();
    const [d] = await tx.insert(commDeliveries).values({ schoolId: s.id, sourceKey: `notification:${n!.id}`, notificationId: n!.id, userId, channel: o.channel ?? "email", mode: o.mode ?? "instant", priority: o.priority ?? 4, nextAt: o.nextAt ?? due }).returning();
    return d!;
  });
}
const row = async (s: TestSchool, id: string) => (await withSchool(s.id, (tx) => tx.select().from(commDeliveries).where(eq(commDeliveries.id, id))))[0]!;
const run = (s: TestSchool, now = DAY) => deliverDue({ schoolId: s.id, now });
const used = async (s: TestSchool, day = "2026-11-25") => (await withSchool(s.id, (tx) => tx.select().from(mailUsage).where(eq(mailUsage.day, day))))[0]?.count ?? 0;
const subscribe = (s: TestSchool, userId: string, endpoint = `https://push.test/${crypto.randomUUID()}`) =>
  withSchool(s.id, (tx) => tx.insert(pushSubscriptions).values({ schoolId: s.id, userId, endpoint, p256dh: "p", auth: "a" })).then(() => endpoint);
/** Make logins without their own email, tied to one primary guardian address. */
async function family(s: TestSchool, userIds: string[], guardian: string) {
  await withConsole(async (tx) => {
    const [g] = [...(await tx.execute(sql`insert into guardians (id, school_id, name, email) values (gen_random_uuid(), ${s.id}, 'Guardian', ${guardian}) returning id`))] as { id: string }[];
    for (const uid of userIds) {
      await tx.update(users).set({ email: null }).where(eq(users.id, uid));
      const [st] = [...(await tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id) values (gen_random_uuid(), ${s.id}, ${`A${crypto.randomUUID().slice(0, 8)}`}, ${`Kid ${uid.slice(0, 4)}`}, ${uid}) returning id`))] as { id: string }[];
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id, is_primary) values (gen_random_uuid(), ${s.id}, ${st!.id}, ${g!.id}, true)`);
    }
  });
}

describe("deliverDue: email", () => {
  it("sends most urgent first", async () => {
    await put(a, a.users.teacher, { priority: 4, title: "P4" });
    await put(a, a.users.student, { priority: 3, title: "P3" });
    await put(a, a.users.admin, { priority: 2, title: "P2" });
    expect(await run(a)).toMatchObject({ sent: 3 });
    expect(mail.sent.map((m) => m.subject.split(" · ")[0])).toEqual(["P2", "P3", "P4"]);
  });

  it("keeps to the daily limit, defers once to 06:00 tomorrow, and lets urgent mail past a school's share", async () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(await put(a, a.users.admin, { title: `N${i}` }));
    // 60% of 10 is 6 for ordinary mail, and one school may use half of that
    expect(await run(a)).toMatchObject({ sent: 3, deferred: 3 });
    const left = (await Promise.all(rows.map((r) => row(a, r.id)))).filter((r) => r.state === "pending");
    expect(left).toHaveLength(3);
    expect(left[0]).toMatchObject({ reason: NO_BUDGET, tries: 0 });
    expect(left[0]!.nextAt.toISOString()).toBe("2026-11-26T00:30:00.000Z");
    await put(a, a.users.admin, { priority: 2, title: "Urgent" });
    expect(await run(a)).toMatchObject({ sent: 1, deferred: 0 });
    expect(await run(a)).toMatchObject({ sent: 0 });
    expect(mail.sent).toHaveLength(4);
    expect(await run(a, new Date("2026-11-26T07:00:00+05:30"))).toMatchObject({ sent: 3 });
    expect(await used(a, "2026-11-26")).toBe(3);
    expect((await row(a, left[0]!.id)).reason).toBeNull();
  });

  it("one busy school cannot starve another: ordinary mail is 60% of the limit, half of that per school", async () => {
    for (let i = 0; i < 8; i++) await put(a, a.users.admin, { title: `A${i}` });
    await put(b, b.users.admin, { title: "B0" });
    await run(a); await run(b);
    expect(mail.sent.filter((m) => m.to.includes(`@${a.slug}.`))).toHaveLength(3);
    expect(mail.sent.filter((m) => m.to.includes(`@${b.slug}.`))).toHaveLength(1);
  });

  it("urgent and safety mail may use the limit except the fifth kept for codes, which account mail always gets", async () => {
    for (let i = 0; i < 12; i++) await put(i % 2 ? a : b, (i % 2 ? a : b).users.admin, { priority: i % 2 ? 1 : 2, title: `U${i}` });
    await run(a); await run(b);
    expect(mail.sent).toHaveLength(8);
    const before = await used(a);
    await sendAccountMail(a.id, { to: "x@y.test", subject: "Your code", text: "123456" }, DAY);
    await sendAccountMail(a.id, { to: "x@y.test", subject: "Your code", text: "654321" }, DAY);
    expect(mail.sent).toHaveLength(10);
    expect(await used(a)).toBe(before + 2);
  });

  it("account mail that fails to send is not counted", async () => {
    mail.fail = () => new Error("smtp down");
    await expect(sendAccountMail(a.id, { to: "x@y.test", subject: "Your code", text: "1" }, DAY)).rejects.toThrow("smtp down");
    expect(await used(a)).toBe(0);
  });

  it("waits out quiet hours except for urgent and safety, and obeys a person's own hours", async () => {
    const slow = await put(a, a.users.admin, { priority: 4, title: "Slow" });
    await put(a, a.users.teacher, { priority: 2, title: "Safety" });
    expect(await run(a, NIGHT)).toMatchObject({ sent: 1, deferred: 1 });
    expect((await row(a, slow.id)).nextAt.toISOString()).toBe("2026-11-26T01:30:00.000Z");
    expect(mail.sent.map((m) => m.subject)).toEqual(["Safety · School ADL"]);
    await withSchool(a.id, (tx) => tx.insert(notificationPrefs).values({ schoolId: a.id, userId: a.users.student, quietFrom: "10:00", quietTo: "12:00" }));
    const mine = await put(a, a.users.student, { title: "Mine" });
    await put(a, a.users.accountant, { title: "Other person" });
    await run(a);
    expect((await row(a, mine.id)).nextAt.toISOString()).toBe("2026-11-25T06:30:00.000Z");
    expect(mail.sent.map((m) => m.to)).toContain(`accountant@${a.slug}.test`);
    expect(mail.sent.map((m) => m.to)).not.toContain(`student@${a.slug}.test`);
  });

  it("skips what was read in the app, and people who are off", async () => {
    const read = await put(a, a.users.admin, { readAt: new Date() });
    const off = await put(a, a.users.teacher);
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, a.users.teacher)));
    expect(await run(a)).toMatchObject({ sent: 0, skipped: 2 });
    expect((await row(a, read.id))).toMatchObject({ state: "skipped", reason: "Already read in the app" });
    expect((await row(a, off.id)).state).toBe("skipped");
    expect(mail.sent).toHaveLength(0);
  });

  it("sends brothers and sisters with one guardian address as one mail naming them", async () => {
    await family(a, [a.users.student, a.users.teacher], "mum@home.test");
    const r1 = await put(a, a.users.student, { title: "Sports day", body: "Friday", href: "/app/events" });
    const r2 = await put(a, a.users.teacher, { title: "Sports day", body: "Friday", href: "/app/events" });
    await put(a, a.users.accountant, { title: "Sports day", body: "Friday", href: "/app/events" });
    expect(await run(a)).toMatchObject({ sent: 3 });
    const toMum = mail.sent.filter((m) => m.to === "mum@home.test");
    expect(toMum).toHaveLength(1);
    expect(toMum[0]!.text).toMatch(/^For (student adl and teacher adl|teacher adl and student adl)/);
    expect([(await row(a, r1.id)).state, (await row(a, r2.id)).state, (await row(a, r1.id)).address]).toEqual(["sent", "sent", "mum@home.test"]);
    expect(await used(a)).toBe(2);
  });

  it("uses the guardian's email only when the login has none, and says so when there is nobody", async () => {
    await family(a, [a.users.student], "mum@home.test");
    await put(a, a.users.student, { title: "Fee due" });
    const nobody = await put(a, a.users.teacher, { title: "No address" });
    await withConsole((tx) => tx.update(users).set({ email: null }).where(eq(users.id, a.users.teacher)));
    await run(a);
    expect(mail.sent.map((m) => m.to)).toEqual(["mum@home.test"]);
    expect(await row(a, nobody.id)).toMatchObject({ state: "skipped" });
    expect((await row(a, nobody.id)).reason).toMatch(/No email address/);
    // School B's guardian is never used for school A
    await family(b, [b.users.student], "other@home.test");
    expect(mail.sent.some((m) => m.to === "other@home.test")).toBe(false);
  });

  it("never lets private text out to an address that is not the person's own verified one", async () => {
    await family(a, [a.users.student], "mum@home.test");
    await put(a, a.users.student, { title: "A teacher wrote", body: SECRET, privateBody: true, topic: "work.update" });
    await put(a, a.users.admin, { title: "Own unverified", body: SECRET, privateBody: true });
    await run(a);
    expect(mail.sent).toHaveLength(2);
    for (const m of mail.sent) { expect(`${m.subject}${m.text}${m.html}`).not.toContain(SECRET); expect(m.text).toContain("Sign in to read"); }
    mail.sent.length = 0;
    await withConsole((tx) => tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, a.users.accountant)));
    await put(a, a.users.accountant, { title: "Verified", body: SECRET, privateBody: true });
    await run(a);
    expect(mail.sent[0]!.text).toContain(SECRET);
  });

  it("tries again after 1, 5, 15, 60 and 240 minutes, then gives up with the reason", async () => {
    mail.fail = () => new Error("smtp down");
    const r = await put(a, a.users.admin, { priority: 3 });
    let t = DAY;
    for (const wait of [1, 5, 15, 60, 240]) {
      await run(a, t);
      const x = await row(a, r.id);
      expect(x.state).toBe("pending");
      expect(x.nextAt.getTime() - t.getTime()).toBe(wait * 60_000);
      t = x.nextAt;
    }
    await run(a, t);
    expect(await row(a, r.id)).toMatchObject({ state: "failed", tries: 6 });
    expect((await row(a, r.id)).reason).toContain("smtp down");
    expect(await used(a)).toBe(0);
  });

  it("marks an address the mailbox refused, and stops mailing it until the office says it works", async () => {
    mail.fail = () => Object.assign(new Error("550 no such user"), { responseCode: 550 });
    const r = await put(a, a.users.admin);
    expect(await run(a)).toMatchObject({ skipped: 1 });
    expect((await row(a, r.id)).state).toBe("bounced");
    mail.fail = () => null;
    const next = await put(a, a.users.admin);
    await run(a);
    expect(await row(a, next.id)).toMatchObject({ state: "skipped" });
    expect(mail.sent).toHaveLength(0);
    const svc = new DeliveryService(a.as.admin);
    expect((await svc.suppressed()).map((s) => s.address)).toEqual([`admin@${a.slug}.test`]);
    await svc.worksAgain(`admin@${a.slug}.test`);
    const again = await put(a, a.users.admin);
    await run(a);
    expect((await row(a, again.id)).state).toBe("sent");
  });

  it("one school's or one address's failure does not stop the rest", async () => {
    mail.fail = (m) => (m.to === `admin@${a.slug}.test` ? new Error("boom") : null);
    const bad = await put(a, a.users.admin), ok = await put(a, a.users.teacher), other = await put(b, b.users.admin);
    await deliverDue({ now: DAY });
    expect((await row(a, bad.id)).state).toBe("pending");
    expect((await row(a, bad.id)).tries).toBe(1);
    expect([(await row(a, ok.id)).state, (await row(b, other.id)).state]).toEqual(["sent", "sent"]);
  });

  it("two drains at the same time never send twice", async () => {
    for (let i = 0; i < 6; i++) await put(a, a.users.admin, { priority: 2, title: `D${i}` });
    const [x, y] = await Promise.all([run(a), run(a)]);
    expect(x.sent + y.sent).toBe(6);
    expect(mail.sent).toHaveLength(6);
    expect(new Set(mail.sent.map((m) => m.subject)).size).toBe(6);
  });

  it("adds one-click unsubscribe, except on must-tell topics", async () => {
    await put(a, a.users.admin, { title: "Optional" });
    await run(a);
    expect(mail.sent[0]!.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.sent[0]!.headers!["List-Unsubscribe"]).toMatch(/^<http.*\/unsubscribe\?t=/);
  });
});

describe("deliverDue: push", () => {
  it("sends a short text, hides private words, and groups by tag", async () => {
    await subscribe(a, a.users.admin);
    await put(a, a.users.admin, { channel: "push", title: "New message", body: SECRET, privateBody: true, groupKey: "thread:1" });
    await put(a, a.users.admin, { channel: "push", title: "Notice", body: "Public text" });
    expect(await run(a)).toMatchObject({ sent: 2 });
    expect(push.sent[0]!.payload).toMatchObject({ title: "New message", body: "Open the app to read", tag: "thread:1", href: "/app/x" });
    expect(JSON.stringify(push.sent)).not.toContain(SECRET);
    expect(push.sent[1]!.payload.body).toBe("Public text");
  });

  it("skips with no device, and removes devices that are gone", async () => {
    const none = await put(a, a.users.teacher, { channel: "push" });
    const dead = await subscribe(a, a.users.admin);
    const r = await put(a, a.users.admin, { channel: "push" });
    push.gone.add(dead);
    await run(a);
    expect(await row(a, none.id)).toMatchObject({ state: "skipped", reason: "No device" });
    expect((await row(a, r.id)).state).toBe("skipped");
    expect(await withSchool(a.id, (tx) => tx.select().from(pushSubscriptions))).toHaveLength(0);
  });

  it("retries when the push service is down, and keeps the device", async () => {
    const ep = await subscribe(a, a.users.admin);
    push.failing.add(ep);
    const r = await put(a, a.users.admin, { channel: "push" });
    await run(a);
    expect(await row(a, r.id)).toMatchObject({ state: "pending", tries: 1 });
    expect(await withSchool(a.id, (tx) => tx.select().from(pushSubscriptions))).toHaveLength(1);
  });

  it("buzzes a phone once per group in 5 minutes, but never holds back urgent", async () => {
    await subscribe(a, a.users.admin);
    const first = await put(a, a.users.admin, { channel: "push", groupKey: "g" });
    await run(a);
    expect(push.sent).toHaveLength(1);
    // The notification grew: the writer adds another push for it.
    const again = (priority: number) => withSchool(a.id, async (tx) => (await tx.insert(commDeliveries).values({ schoolId: a.id, sourceKey: `notification:${first.notificationId}:${++seq}`, notificationId: first.notificationId, userId: a.users.admin, channel: "push", priority, nextAt: due }).returning())[0]!);
    const second = await again(4);
    await run(a);
    expect(push.sent).toHaveLength(1);
    const x = await row(a, second.id);
    expect(x.state).toBe("pending");
    expect(x.nextAt.getTime()).toBeGreaterThan(DAY.getTime());
    expect(x.nextAt.getTime() - DAY.getTime()).toBeLessThanOrEqual(5 * 60_000);
    await withSchool(a.id, (tx) => tx.update(notifications).set({ urgent: true }).where(eq(notifications.id, first.notificationId!)));
    await again(1);
    await run(a);
    expect(push.sent).toHaveLength(2);
  });

  it("holds push in quiet hours too, and drains urgent only when asked", async () => {
    await subscribe(a, a.users.admin);
    const late = await put(a, a.users.admin, { channel: "push" });
    await put(a, a.users.admin, { channel: "push", priority: 1 });
    await deliverDue({ schoolId: a.id, now: NIGHT, urgentOnly: true });
    expect(push.sent).toHaveLength(1);
    await deliverDue({ schoolId: a.id, now: NIGHT });
    expect(push.sent).toHaveLength(1);
    expect((await row(a, late.id)).state).toBe("pending");
  });
});

describe("test push", () => {
  it("sends to the caller's own devices only, and says what to do when there is none", async () => {
    await expect(new PushTestService(a.as.admin).send()).rejects.toThrow(/Please fix/);
    await subscribe(a, a.users.admin);
    await subscribe(a, a.users.teacher);
    expect(await new PushTestService(a.as.admin).send()).toBe(1);
    expect(push.sent).toHaveLength(1);
    const dead = await subscribe(a, a.users.student);
    push.gone.add(dead);
    await expect(new PushTestService(a.as.student).send()).rejects.toThrow();
    expect(await withSchool(a.id, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, a.users.student)))).toHaveLength(0);
  });
});

describe("runDigest", () => {
  const digest = (o: Put = {}) => ({ mode: "digest" as const, ...o });

  it("sends one grouped mail per address at the person's hour, skipping what was read", async () => {
    await put(a, a.users.admin, digest({ title: "Notice one", topic: "notice.published" }));
    await put(a, a.users.admin, digest({ title: "Notice two", topic: "notice.published" }));
    await put(a, a.users.admin, digest({ title: "Homework set", topic: "homework.new" }));
    const read = await put(a, a.users.admin, digest({ title: "Seen already", readAt: new Date() }));
    await put(a, a.users.admin, digest({ title: "Private one", body: SECRET, privateBody: true }));
    expect(await runDigest({ hour: 8, now: DAY, schoolId: a.id })).toMatchObject({ mails: 0 });
    expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 1, notifications: 4, skipped: 1 });
    const m = mail.sent[0]!;
    expect(m.text).toMatch(/Notices\n- Notice two[\s\S]*- Notice one/);
    expect(m.text).toContain("Homework");
    expect(m.text).not.toContain("Seen already");
    expect(m.text).toContain("(sign in to read)");
    expect(m.text).not.toContain("Private one");
    expect(m.text).not.toContain(SECRET);
    expect(m.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.text).toMatch(/Stop these emails: http.*&g=notices/);
    expect((await row(a, read.id)).reason).toBe("Already read in the app");
    expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 0 });
  });

  it("uses the person's chosen hour, and runs once even when started twice", async () => {
    await withSchool(a.id, (tx) => tx.insert(notificationPrefs).values({ schoolId: a.id, userId: a.users.teacher, digestHour: 8 }));
    await put(a, a.users.teacher, digest());
    await put(a, a.users.student, digest());
    expect(await runDigest({ hour: 8, now: DAY, schoolId: a.id })).toMatchObject({ mails: 1 });
    expect(mail.sent[0]!.to).toBe(`teacher@${a.slug}.test`);
    const [x, y] = await Promise.all([runDigest({ hour: 18, now: DAY, schoolId: a.id }), runDigest({ hour: 18, now: DAY, schoolId: a.id })]);
    expect(x.mails + y.mails).toBe(1);
    expect(mail.sent).toHaveLength(2);
  });

  it("a late run still sends to people whose hour passed today and who got nothing yet; not a second one after they did", async () => {
    await withSchool(a.id, (tx) => tx.insert(notificationPrefs).values({ schoolId: a.id, userId: a.users.teacher, digestHour: 8 }));
    await put(a, a.users.teacher, digest({ title: "Missed" }));
    expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 1 });
    await put(a, a.users.teacher, digest({ title: "After" }));
    expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 0 });
    expect(await runDigest({ hour: 8, now: new Date("2026-11-26T08:05:00+05:30"), schoolId: a.id })).toMatchObject({ mails: 1 });
  });

  it("takes more than 2000 rows in rounds until none is left", async () => {
    const people = Object.values(a.users).slice(0, 2);
    await withSchool(a.id, async (tx) => {
      const [n] = await tx.insert(notifications).values({ schoolId: a.id, userId: people[0]!, topic: "work.update", title: "Many" }).returning();
      const rows = Array.from({ length: 2100 }, (_, i) => ({ schoolId: a.id, sourceKey: `bulk:${i}`, notificationId: n!.id, userId: people[0]!, channel: "email" as const, mode: "digest" as const, priority: 4, nextAt: due }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(commDeliveries).values(rows.slice(i, i + 500));
    });
    const r = await runDigest({ hour: 18, now: DAY, schoolId: a.id });
    expect(r.notifications + r.skipped).toBe(2100);
    expect(await withSchool(a.id, (tx) => tx.select().from(commDeliveries).where(eq(commDeliveries.state, "pending")))).toHaveLength(0);
  });

  it("shows at most 15 lines a group", async () => {
    for (let i = 0; i < 20; i++) await put(a, a.users.admin, digest({ title: `Line ${String(i).padStart(2, "0")}`, topic: "homework.new" }));
    await runDigest({ hour: 18, now: DAY, schoolId: a.id });
    expect(mail.sent[0]!.text.match(/^- Line/gm)).toHaveLength(15);
    expect(mail.sent[0]!.text).toContain("...and 5 more");
  });

  it("hands rows back when the send fails, and counts against the daily limit when it works", async () => {
    mail.fail = () => new Error("smtp down");
    const r = await put(a, a.users.admin, digest());
    expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 0 });
    expect(await row(a, r.id)).toMatchObject({ state: "pending", tries: 1 });
    expect(await used(a)).toBe(0);
    mail.fail = () => null;
    expect(await runDigest({ hour: 18, now: new Date(DAY.getTime() + 60_000), schoolId: a.id })).toMatchObject({ mails: 1 });
    expect(await used(a)).toBe(1);
  });
});

describe("after a mail or push went out", () => {
  it("a failure saving the result never releases the row or gives the mail unit back", async () => {
    const r = await put(a, a.users.admin, { title: "Once" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mail.after = () => { db.failNext = 1; };
    try { expect(await run(a)).toMatchObject({ sent: 1, retried: 0, failed: 0 }); } finally { db.failNext = 0; mail.after = null; spy.mockRestore(); }
    expect(mail.sent).toHaveLength(1);
    expect(await used(a)).toBe(1);
    expect(await row(a, r.id)).toMatchObject({ state: "pending", tries: 0 });
    expect(await run(a)).toMatchObject({ sent: 0 });
    expect(mail.sent).toHaveLength(1);
  });

  it("the same holds for a digest and for a push", async () => {
    const d = await put(a, a.users.admin, { mode: "digest", title: "Digest once" });
    const p = await put(a, a.users.teacher, { channel: "push", title: "Push once" });
    await subscribe(a, a.users.teacher);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const realSend = push.send.bind(push);
    push.send = async (...args) => { const r = await realSend(...args); db.failNext = 2; return r; };
    mail.after = () => { db.failNext = 1; };
    try {
      expect(await runDigest({ hour: 18, now: DAY, schoolId: a.id })).toMatchObject({ mails: 1, failed: 0 });
      db.failNext = 0; mail.after = null;
      expect(await run(a)).toMatchObject({ sent: 1, retried: 0 });
    } finally { db.failNext = 0; mail.after = null; push.send = realSend; spy.mockRestore(); }
    expect(mail.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
    expect((await row(a, d.id)).tries).toBe(0);
    expect((await row(a, p.id)).tries).toBe(0);
  });

  it("stops starting new batches once the time is spent", async () => {
    await put(a, a.users.admin);
    expect(await deliverDue({ schoolId: a.id, now: DAY, maxMs: 0 })).toMatchObject({ sent: 0 });
    expect(await run(a)).toMatchObject({ sent: 1 });
  });
});

describe("urgent rows and links", () => {
  it("an urgent row of any topic goes out at once, even in quiet hours; the same row not urgent waits", async () => {
    await withSchool(a.id, (tx) => NotificationWriter.insert(tx, a.id, [
      { userId: a.users.admin, topic: "holiday.declared", subject: { type: "t", id: "1" }, title: "School closed tomorrow", urgent: true },
      { userId: a.users.teacher, topic: "homework.new", subject: { type: "t", id: "1" }, title: "Homework" },
    ]));
    const rows = await withSchool(a.id, (tx) => tx.select().from(commDeliveries).where(eq(commDeliveries.channel, "email")));
    expect(rows.find((r) => r.userId === a.users.admin)).toMatchObject({ priority: 1, mode: "instant" });
    expect(rows.find((r) => r.userId === a.users.teacher)).toMatchObject({ priority: 4, mode: "digest" });
    await withSchool(a.id, (tx) => tx.update(commDeliveries).set({ nextAt: due }));
    expect(await run(a, NIGHT)).toMatchObject({ sent: 1 });
    expect(mail.sent[0]!.subject).toContain("School closed tomorrow");
  });

  it("without a signing secret the mail has no unsubscribe link and says to open settings", async () => {
    const spy = vi.spyOn(PreferenceService, "unsubscribeUrlFor").mockResolvedValue(null);
    try {
      await put(a, a.users.admin, { title: "Plain" });
      await put(a, a.users.teacher, { mode: "digest", title: "Plain digest" });
      await run(a);
      await runDigest({ hour: 18, now: DAY, schoolId: a.id });
    } finally { spy.mockRestore(); }
    expect(mail.sent).toHaveLength(2);
    for (const m of mail.sent) {
      expect(m.headers).toBeUndefined();
      expect(m.text).toContain("open Settings in the app");
      expect(m.text).not.toContain("unsubscribe");
    }
  });
});

describe("mail webhook and the delivery screen", () => {
  const post = (secret: string | null, body: unknown, via: "query" | "header" = "header") =>
    mailWebhook(new Request(`http://x.test/api/webhooks/mail${secret && via === "query" ? `?secret=${secret}` : ""}`, { method: "POST", body: JSON.stringify(body), headers: secret && via === "header" ? { "x-webhook-secret": secret } : {} }));

  it("refuses a wrong or missing secret", async () => {
    expect((await post("wrong", { event: "hard_bounce", email: `admin@${a.slug}.test` })).status).toBe(401);
    expect((await post(null, { event: "hard_bounce", email: `admin@${a.slug}.test` })).status).toBe(401);
    expect((await post("s3cret", { event: "hard_bounce", email: `admin@${a.slug}.test` }, "query")).status).toBe(401);
    expect(await withConsole((tx) => tx.select().from(emailSuppressions).where(eq(emailSuppressions.schoolId, a.id)))).toHaveLength(0);
  });

  it("marks bounces and spam in every school that holds the address, and ignores soft bounces", async () => {
    expect((await post("s3cret", { event: "soft_bounce", email: `admin@${a.slug}.test` })).status).toBe(200);
    expect(await withConsole((tx) => tx.select().from(emailSuppressions).where(eq(emailSuppressions.schoolId, a.id)))).toHaveLength(0);
    expect((await post("s3cret", [{ event: "hard_bounce", email: `Admin@${a.slug}.test` }, { event: "spam", email: `teacher@${a.slug}.test` }])).status).toBe(200);
    expect((await post("s3cret", { event: "hard_bounce", email: `admin@${a.slug}.test` })).status).toBe(200);
    const rows = await withConsole((tx) => tx.select().from(emailSuppressions).where(inArray(emailSuppressions.schoolId, [a.id, b.id])));
    expect(rows.map((r) => `${r.schoolId === a.id ? "a" : "b"}:${r.reason}`).sort()).toEqual(["a:bounced", "a:spam"]);
    expect((await post("s3cret", "not an object")).status).toBe(200);
    expect(await withSchool(a.id, (tx) => isSuppressed(tx, `ADMIN@${a.slug}.test`))).toBe(true);
    expect(await withSchool(a.id, (tx) => isSuppressed(tx, `student@${a.slug}.test`))).toBe(false);
    expect(await withSchool(a.id, (tx) => isSuppressed(tx, null))).toBe(false);
  });

  it("shows admins last week's numbers, problems, today's allowance, and retries failures", async () => {
    mail.fail = () => new Error("smtp down");
    const r = await put(a, a.users.admin, { priority: 3 });
    let t = DAY;
    for (let i = 0; i < 6; i++) { await run(a, t); t = (await row(a, r.id)).nextAt; }
    mail.fail = () => null;
    await put(a, a.users.teacher, { priority: 3 });
    await run(a, t);
    const svc = new DeliveryService(a.as.admin);
    // The screen is about "today", so the clock stands on the day the mails were sent.
    vi.useFakeTimers({ now: DAY, toFake: ["Date"] });
    const s = await svc.summary().finally(() => vi.useRealTimers());
    expect(s.byChannel).toEqual(expect.arrayContaining([{ channel: "email", state: "failed", n: 1 }, { channel: "email", state: "sent", n: 1 }]));
    expect(s.problems[0]).toMatchObject({ state: "failed", n: 1 });
    expect(s.problems[0]!.reason).toContain("smtp down");
    expect(s.quota).toMatchObject({ limit: 10, forNotices: 6 });
    expect(s.quota.left).toBeLessThanOrEqual(5);
    expect(await svc.retry([r.id])).toBe(1);
    expect(await row(a, r.id)).toMatchObject({ state: "pending", tries: 0 });
    expect((await new DeliveryService(b.as.admin).summary()).byChannel).toEqual([]);
    await expect(new DeliveryService(a.as.teacher).summary()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DeliveryService(a.as.teacher).retry("all")).rejects.toBeInstanceOf(ForbiddenError);
  });
});


