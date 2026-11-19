import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import notificationsFeature from "./feature";
import { NotificationService, NotificationWriter } from "./service";
import { notifications } from "./schema";
import { runEmailDigest } from "./jobs";

let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();

beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"]));
  useServices({ email: mail });
});
afterAll(closeDb);

const send = (s: TestSchool, userId: string, title: string) =>
  withSchool(s.id, (tx) => NotificationWriter.insert(tx, s.id, [{ userId, kind: "announcement", title, body: "Details", href: "/app/announcements" }]));

describe("NotificationService", () => {
  it("lists only the caller's own notifications, with an unread count", async () => {
    await send(a, a.users.parent, "For the parent");
    await send(a, a.users.teacher, "For the teacher");
    const mine = await new NotificationService(a.as.parent).forUser();
    expect(mine.items.map((n) => n.title)).toEqual(["For the parent"]);
    expect(mine.unread).toBe(1);
  });

  it("marks one and then all as read", async () => {
    await send(a, a.users.student, "One");
    await send(a, a.users.student, "Two");
    const svc = new NotificationService(a.as.student);
    const { items } = await svc.forUser();
    expect((await svc.markRead(items[0]!.id)).updated).toBe(1);
    expect((await svc.forUser()).unread).toBe(1);
    expect((await svc.markRead("all")).updated).toBe(1);
    expect((await svc.forUser()).unread).toBe(0);
    expect((await svc.markRead("not-an-id")).updated).toBe(0);
  });

  it("cannot read or mark another user's notification in the same school", async () => {
    await send(a, a.users.accountant, "Private to accountant");
    const target = (await new NotificationService(a.as.accountant).forUser()).items[0]!;
    expect((await new NotificationService(a.as.parent).markRead(target.id)).updated).toBe(0);
    expect((await new NotificationService(a.as.parent).list()).rows.some((n) => n.id === target.id)).toBe(false);
  });

  it("school B cannot see or mark school A's notifications", async () => {
    await send(a, a.users.admin, "A only");
    const idA = (await new NotificationService(a.as.admin).forUser()).items[0]!.id;
    expect((await new NotificationService(b.as.admin).forUser()).items).toHaveLength(0);
    expect((await new NotificationService(b.as.admin).markRead(idA)).updated).toBe(0);
    const [row] = await withSchool(a.id, (tx) => tx.select().from(notifications).where(eq(notifications.id, idA)));
    expect(row!.readAt).toBeNull();
    // no school set -> zero rows
    expect(await withSchool(b.id, (tx) => tx.select().from(notifications).where(eq(notifications.id, idA)))).toHaveLength(0);
  });

  it("notify checks permission and input", async () => {
    await expect(new NotificationService(a.as.parent).notify([a.users.student], { title: "Hi" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new NotificationService(a.as.admin).notify([a.users.student], { title: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new NotificationService(a.as.admin).notify([a.users.student], { title: "Hi", href: "https://evil.example" })).rejects.toBeInstanceOf(ValidationError);
    expect(await new NotificationService(a.as.admin).notify([a.users.parent, a.users.parent], { title: "Fee due", kind: "fee_due", href: "/app/fees" })).toBe(1);
  });

  it("the writer skips users of another school and drops off-app links", async () => {
    expect(await withSchool(a.id, (tx) => NotificationWriter.insert(tx, a.id, [{ userId: b.users.parent, title: "Leak" }]))).toBe(0);
    await withSchool(a.id, (tx) => NotificationWriter.insert(tx, a.id, [{ userId: a.users.student, title: "Link", href: "//evil.example/app" }]));
    const [n] = (await new NotificationService(a.as.student).forUser()).items.filter((x) => x.title === "Link");
    expect(n?.href).toBeNull();
  });

  it("stores the email digest preference per user", async () => {
    const svc = new NotificationService(a.as.parent);
    expect(await svc.emailDigestEnabled()).toBe(true);
    await svc.setEmailDigest(false);
    await svc.setEmailDigest(false);
    expect(await svc.emailDigestEnabled()).toBe(false);
    await svc.setEmailDigest(true);
    expect(await svc.emailDigestEnabled()).toBe(true);
  });
});

describe("email digest job", () => {
  it("sends one email per user and never emails the same notification twice", async () => {
    await withSchool(b.id, (tx) => tx.delete(notifications).where(and(eq(notifications.schoolId, b.id))));
    mail.sent.length = 0;
    await send(b, b.users.parent, "Fee <b>due</b>");
    await send(b, b.users.parent, "Result published");
    await send(b, b.users.teacher, "Staff meeting");
    const first = await runEmailDigest({ schoolId: b.id });
    expect(first).toMatchObject({ emails: 2, notifications: 3, failed: 0 });
    const toParent = mail.sent.find((m) => m.to === `parent@${b.slug}.test`)!;
    expect(toParent.subject).toContain("2 new notifications");
    expect(toParent.html).toContain("Fee &lt;b&gt;due&lt;/b&gt;");
    const second = await runEmailDigest({ schoolId: b.id });
    expect(second).toMatchObject({ emails: 0, notifications: 0 });
    expect(mail.sent).toHaveLength(2);
  });

  it("skips opted-out users and already-read notifications", async () => {
    mail.sent.length = 0;
    await withSchool(b.id, (tx) => tx.delete(notifications));
    await new NotificationService(b.as.admin).setEmailDigest(false);
    await send(b, b.users.admin, "Opted out");
    await send(b, b.users.student, "Already seen");
    await new NotificationService(b.as.student).markRead("all");
    expect(await runEmailDigest({ schoolId: b.id })).toMatchObject({ emails: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it("releases the claim when sending fails so the next run retries", async () => {
    await withSchool(b.id, (tx) => tx.delete(notifications));
    await new NotificationService(b.as.teacher).setEmailDigest(true);
    await send(b, b.users.teacher, "Retry me");
    useServices({ email: { send: async () => { throw new Error("smtp down"); } } });
    expect(await runEmailDigest({ schoolId: b.id })).toMatchObject({ emails: 0, failed: 1 });
    useServices({ email: mail });
    mail.sent.length = 0;
    expect(await runEmailDigest({ schoolId: b.id })).toMatchObject({ emails: 1, notifications: 1 });
  });
});
