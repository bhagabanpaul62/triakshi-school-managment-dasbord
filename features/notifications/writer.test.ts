import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, users, withConsole, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "./feature";
import { channelsFor, priorityOf } from "./channels";
import { commDeliveries, commSettings, notificationPrefs, notifications } from "./schema";
import { NotificationWriter } from "./writer";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "w"));
});
afterAll(closeDb);
beforeEach(async () => {
  await withSchool(a.id, async (tx) => { await tx.delete(commDeliveries); await tx.delete(notifications); await tx.delete(notificationPrefs); await tx.delete(commSettings); });
});

const put = (...rows: Parameters<typeof NotificationWriter.insert>[2]) => withSchool(a.id, (tx) => NotificationWriter.insert(tx, a.id, rows));
const rowsOf = (userId: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
const sends = () => withSchool(a.id, (tx) => tx.select().from(commDeliveries));
const student = () => a.users.student;

describe("channelsFor", () => {
  it("goes topic default, then school, then the person; must-tell ignores both", () => {
    expect(channelsFor("notice.published")).toEqual({ push: true, email: "digest" });
    expect(channelsFor("notice.published", {}, { notices: { push: false, email: "instant" } })).toEqual({ push: false, email: "instant" });
    expect(channelsFor("notice.published", { notices: { push: true, email: "off" } }, { notices: { push: false, email: "instant" } })).toEqual({ push: true, email: "off" });
    expect(channelsFor("account.security", { account: { push: false, email: "off" } }, { account: { push: false, email: "off" } })).toEqual({ push: true, email: "instant" });
    expect(priorityOf("fees.due")).toBe(3);
    expect(priorityOf("homework.new")).toBe(4);
    expect(priorityOf("homework.new", true)).toBe(1);
  });
});

describe("NotificationWriter.insert", () => {
  it("accepts a topic or the temporary kind, trims, and drops off-app links", async () => {
    expect(await put({ userId: student(), topic: "fees.due", title: "Fee due", href: "/app/fees" }, { userId: student(), topic: "exam.result", title: "Result", href: "//evil.example/app" })).toBe(2);
    const rows = await rowsOf(student());
    expect(rows.find((r) => r.title === "Fee due")).toMatchObject({ topic: "fees.due", href: "/app/fees", count: 1 });
    expect(rows.find((r) => r.title === "Result")).toMatchObject({ topic: "exam.result", href: null });
  });

  it("only writes for active people of this school", async () => {
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, a.users.teacher)));
    expect(await put({ userId: b.users.student, topic: "work.update", title: "Leak" }, { userId: a.users.teacher, topic: "work.update", title: "Off" })).toBe(0);
    expect(await rowsOf(a.users.teacher)).toHaveLength(0);
    expect(await withSchool(b.id, (tx) => tx.select().from(notifications))).toHaveLength(0);
    await withConsole((tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, a.users.teacher)));
  });

  it("groups unread rows by key: one row, count up, newest words, bumped time", async () => {
    await put({ userId: student(), topic: "message.new", title: "1 new message", groupKey: "thread:1" });
    const [first] = await rowsOf(student());
    await put({ userId: student(), topic: "message.new", title: "2 new messages", body: "latest", href: "/app/messages", groupKey: "thread:1" },
      { userId: student(), topic: "message.new", title: "3 new messages", groupKey: "thread:1" });
    const rows = await rowsOf(student());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first!.id, count: 3, title: "3 new messages", body: null });
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(first!.createdAt.getTime());
    // once read, the next one starts a fresh row
    await withSchool(a.id, (tx) => tx.update(notifications).set({ readAt: new Date() }));
    await put({ userId: student(), topic: "message.new", title: "again", groupKey: "thread:1" });
    expect(await rowsOf(student())).toHaveLength(2);
  });

  it("writes 12,000 rows in one call without hitting the parameter limit", async () => {
    const rows = Array.from({ length: 12_000 }, (_, i) => ({ userId: student(), topic: "notice.published" as const, title: `Notice ${i}` }));
    expect(await put(...rows)).toBe(12_000);
    expect(await rowsOf(student())).toHaveLength(12_000);
    expect(await sends()).toHaveLength(24_000);
  }, 120_000);
});

describe("deliveries", () => {
  it("plans push and email from the topic, the school and the person", async () => {
    await put({ userId: student(), topic: "notice.published", title: "Notice" }, { userId: a.users.teacher, topic: "work.update", title: "Other" });
    const all = await sends();
    const mine = all.filter((d) => d.userId === student());
    expect(mine.map((d) => `${d.channel}:${d.mode}`).sort()).toEqual(["email:digest", "push:instant"]);
    expect(mine[0]).toMatchObject({ state: "pending", priority: 4 });
    expect(all.filter((d) => d.userId === a.users.teacher).map((d) => d.channel)).toEqual(["email"]);

    await withSchool(a.id, async (tx) => {
      await tx.insert(commSettings).values({ schoolId: a.id, settings: { channelDefaults: { fees: { push: false, email: "off" } } } });
      await tx.insert(notificationPrefs).values({ schoolId: a.id, userId: a.users.admin, groups: { notices: { push: false, email: "instant" } } });
    });
    await put({ userId: student(), topic: "fees.payment", title: "Paid" }, { userId: a.users.admin, topic: "notice.published", title: "N" });
    const now = await sends();
    expect(now.filter((d) => d.userId === a.users.admin).map((d) => `${d.channel}:${d.mode}`)).toEqual(["email:instant"]);
    // the school turned the fees group off; the earlier notice keeps its two sends
    expect(now.filter((d) => d.userId === student())).toHaveLength(2);
  });

  it("must-tell topics always push and email instantly; urgent ones go first", async () => {
    await withSchool(a.id, (tx) => tx.insert(notificationPrefs).values({ schoolId: a.id, userId: student(), groups: { account: { push: false, email: "off" } } }));
    await put({ userId: student(), topic: "account.security", title: "New sign-in" }, { userId: student(), topic: "homework.new", title: "HW", urgent: true });
    const d = await sends();
    expect(d.filter((x) => x.priority === 1)).toHaveLength(4);
    expect(d.filter((x) => x.channel === "email" && x.mode === "instant")).toHaveLength(2); // the security mail, and the urgent homework one
  });

  it("honours deliverAfter", async () => {
    const at = new Date(Date.now() + 3 * 3_600_000);
    await put({ userId: student(), topic: "notice.published", title: "Later", deliverAfter: at });
    expect((await sends()).every((d) => d.nextAt.getTime() === at.getTime())).toBe(true);
  });

  it("a grouped row that grows inside 5 minutes gets one push held for the end of the gap, not dropped and not repeated", async () => {
    const row = { userId: student(), topic: "message.new" as const, title: "m", groupKey: "t" };
    await put(row);
    await put(row);
    let pushes = (await sends()).filter((d) => d.channel === "push");
    expect(pushes).toHaveLength(2);
    const first = pushes.find((p) => p.sourceKey.split(":").length === 2)!, held = pushes.find((p) => p.sourceKey.includes(":at:"))!;
    expect(held.nextAt.getTime() - first.createdAt.getTime()).toBe(5 * 60_000);
    await put(row);
    expect((await sends()).filter((d) => d.channel === "push")).toHaveLength(2);
    // time passes: the held push is due and the last one is old, so the next growth pushes at once
    await withSchool(a.id, (tx) => tx.update(commDeliveries).set({ createdAt: new Date(Date.now() - 10 * 60_000), nextAt: new Date(Date.now() - 5 * 60_000) }));
    await put(row);
    pushes = (await sends()).filter((d) => d.channel === "push");
    expect(pushes).toHaveLength(3);
    expect(pushes.map((p) => p.sourceKey).some((k) => /^notification:[0-9a-f-]+:4$/.test(k))).toBe(true);
    await put({ ...row, urgent: true });
    expect((await sends()).filter((d) => d.channel === "push")).toHaveLength(4);
    expect((await sends()).filter((d) => d.channel === "email")).toHaveLength(1);
  });

  it("seen and done skip pending sends; rewrite changes the words", async () => {
    const subject = { type: "notice", id: "n1" };
    await put({ userId: student(), topic: "notice.answer", title: "Answer", subject, action: true }, { userId: a.users.teacher, topic: "notice.published", title: "Old", subject });
    await withSchool(a.id, async (tx) => {
      expect(await NotificationWriter.rewrite(tx, a.id, subject, { title: "Corrected", body: "New text" })).toBe(2);
      expect(await NotificationWriter.seen(tx, a.id, subject, a.users.teacher)).toBe(1);
    });
    let d = await sends();
    expect(d.filter((x) => x.userId === a.users.teacher).every((x) => x.state === "skipped" && x.reason === "Already read in the app")).toBe(true);
    expect(d.filter((x) => x.userId === student()).every((x) => x.state === "pending")).toBe(true);
    expect((await rowsOf(a.users.teacher))[0]).toMatchObject({ title: "Corrected", body: "New text" });

    await withSchool(a.id, async (tx) => { expect(await NotificationWriter.done(tx, a.id, subject)).toBe(1); });
    d = await sends();
    expect(d.every((x) => x.state === "skipped")).toBe(true);
    expect((await rowsOf(student()))[0]).toMatchObject({ action: true });
    expect((await rowsOf(student()))[0]!.doneAt).not.toBeNull();
    expect((await rowsOf(student()))[0]!.readAt).not.toBeNull();
  });

  it("seen is limited to the school and person it names", async () => {
    await put({ userId: student(), topic: "notice.published", title: "A", subject: { type: "n", id: "1" } });
    await withSchool(b.id, (tx) => NotificationWriter.seen(tx, b.id, { type: "n", id: "1" }));
    expect((await rowsOf(student()))[0]!.readAt).toBeNull();
    expect((await sends()).every((d) => d.state === "pending")).toBe(true);
  });
});
