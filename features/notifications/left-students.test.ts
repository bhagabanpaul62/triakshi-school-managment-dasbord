// A student who left hears only about fees, results and the account; once the 90 days are over, nothing. Proven at the writer, in the bell, in the mail and in the digest.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, withConsole, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryPushSender, useServices } from "@smw/integrations";
import notificationsFeature from "./feature";
import { deliverDue } from "./delivery";
import { runDigest } from "./digest";
import { NotificationService } from "./service";
import { NotificationWriter } from "./writer";
import { commDeliveries, notifications } from "./schema";
import type { TopicKey } from "./topics";

const NOW = new Date("2026-11-25T10:30:00+05:30");
const mail = new MemoryEmailSender();
let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "lv"));
  useServices({ email: mail, push: new MemoryPushSender() });
});
afterAll(closeDb);

const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
async function setStudent(s: TestSchool, status: string, leftOn: string | null) {
  await withConsole(async (tx) => {
    await tx.execute(sql`delete from students where user_id = ${s.users.student}`);
    if (status) await tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, left_on) values (gen_random_uuid(), ${s.id}, ${`A${crypto.randomUUID().slice(0, 8)}`}, 'Kid', ${s.users.student}, ${status}, ${leftOn}::date)`);
  });
}
beforeEach(async () => {
  mail.sent.length = 0;
  await withConsole(async (tx) => { await tx.execute(sql`delete from comm_deliveries where school_id in (${a.id}, ${b.id})`); await tx.execute(sql`delete from notifications where school_id in (${a.id}, ${b.id})`); });
});

const put = (s: TestSchool, userId: string, topic: TopicKey) => withSchool(s.id, (tx) => NotificationWriter.insert(tx, s.id, [{ userId, topic, title: `T ${topic}`, subject: { type: "t", id: topic } }]));
const topicsOf = async (s: TestSchool, userId: string) => (await withSchool(s.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)))).map((r) => r.topic).sort();

describe("the writer", () => {
  it("a left student, or an alumni by promotion, is told about fees, results and the account, and nothing else", async () => {
    for (const status of ["left", "alumni"]) {
      await withSchool(a.id, (tx) => tx.delete(notifications));
      await setStudent(a, status, day(-10));
      for (const t of ["notice.published", "message.new", "urgent.alert", "homework.new", "event.invite", "fees.due", "exam.result", "account.security"] as const) await put(a, a.users.student, t);
      expect(await topicsOf(a, a.users.student)).toEqual(["account.security", "exam.result", "fees.due"]);
    }
  });

  it("after the 90 days, and with no last day, nothing at all", async () => {
    await setStudent(a, "left", day(-91));
    expect(await put(a, a.users.student, "fees.due")).toBe(0);
    await setStudent(a, "alumni", null);
    expect(await put(a, a.users.student, "account.security")).toBe(0);
  });

  it("an active student, a student with no student row and staff hear everything", async () => {
    await setStudent(a, "active", null);
    await put(a, a.users.student, "notice.published");
    await setStudent(a, "", null);
    await put(a, a.users.student, "message.new");
    await put(a, a.users.teacher, "notice.published");
    expect(await topicsOf(a, a.users.student)).toEqual(["message.new", "notice.published"]);
    expect(await topicsOf(a, a.users.teacher)).toEqual(["notice.published"]);
  });

  it("school isolation: school A's left student does not silence school B's active one", async () => {
    await setStudent(a, "left", day(-10));
    await setStudent(b, "active", null);
    await put(b, b.users.student, "notice.published");
    expect(await topicsOf(b, b.users.student)).toEqual(["notice.published"]);
  });
});

describe("the bell and the list", () => {
  it("hide what belongs to modules a left student lost, so no link leads to a refusal", async () => {
    await setStudent(a, "active", null);
    for (const t of ["notice.published", "message.new", "homework.new", "fees.due"] as const) await put(a, a.users.student, t);
    const ctx = { ...a.as.student, features: new Set(["notifications", "fees", "exams", "home", "settings"]), leftUntil: "2027-02-01" };
    const { items } = await new NotificationService(ctx).forUser(10);
    expect(items.map((i) => i.topic)).toEqual(["fees.due"]);
    const all = await new NotificationService({ ...a.as.student, features: new Set(["notifications", "announcements", "messages", "assignments", "fees"]) }).forUser(10);
    expect(all.items).toHaveLength(4);
  });
});

describe("what was queued before the student left", () => {
  async function queued(topic: TopicKey, mode: "instant" | "digest") {
    await setStudent(a, "active", null);
    await put(a, a.users.student, topic);
    await withSchool(a.id, (tx) => tx.delete(commDeliveries).where(eq(commDeliveries.channel, "push")));
    const n = await withSchool(a.id, (tx) => tx.update(commDeliveries).set({ mode, nextAt: new Date(NOW.getTime() - 60_000) }).where(eq(commDeliveries.channel, "email")).returning({ id: commDeliveries.id }));
    expect(n).toHaveLength(1);
  }
  it("a school-wide notice is not mailed to a family that left; their fee notice still is", async () => {
    await queued("notice.published", "instant");
    await setStudent(a, "left", day(-3));
    expect(await deliverDue({ schoolId: a.id, now: NOW })).toMatchObject({ sent: 0, skipped: 1 });
    expect(mail.sent).toHaveLength(0);
    expect((await withSchool(a.id, (tx) => tx.select().from(commDeliveries)))[0]).toMatchObject({ state: "skipped", reason: "The student has left the school." });

    await withSchool(a.id, (tx) => tx.delete(commDeliveries));
    await withSchool(a.id, (tx) => tx.delete(notifications));
    await queued("fees.due", "instant");
    await setStudent(a, "left", day(-3));
    expect(await deliverDue({ schoolId: a.id, now: NOW })).toMatchObject({ sent: 1 });
  });

  it("the digest drops them too, and everything once closed", async () => {
    await queued("notice.published", "digest");
    await setStudent(a, "left", day(-3));
    expect(await runDigest({ hour: 18, now: new Date("2026-11-25T18:30:00+05:30"), schoolId: a.id })).toMatchObject({ mails: 0, skipped: 1 });
    await withSchool(a.id, (tx) => tx.delete(commDeliveries));
    await withSchool(a.id, (tx) => tx.delete(notifications));
    await queued("fees.due", "instant");
    await setStudent(a, "left", day(-95));
    expect(await deliverDue({ schoolId: a.id, now: NOW })).toMatchObject({ sent: 0, skipped: 1 });
  });
});
