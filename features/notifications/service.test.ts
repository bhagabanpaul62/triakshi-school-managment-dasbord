import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";

import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "./feature";
import { commDeliveries, notifications } from "./schema";
import { NotificationService, NotificationWriter } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "nv"));
});
afterAll(closeDb);
beforeEach(async () => { for (const s of [a, b]) await withSchool(s.id, async (tx) => { await tx.delete(commDeliveries); await tx.delete(notifications); }); });

const send = (s: TestSchool, userId: string, title: string, extra: Partial<Parameters<typeof NotificationWriter.insert>[2][number]> = {}) =>
  withSchool(s.id, (tx) => NotificationWriter.insert(tx, s.id, [{ userId, topic: "notice.published", title, href: "/app/announcements", ...extra } as never]));
const svc = (s: TestSchool, role: keyof TestSchool["as"], readOnly = false) => new NotificationService({ ...s.as[role], readOnly, features: new Set(["notifications", "requests"]) });

describe("NotificationService", () => {
  it("lists only the caller's own rows and counts unread", async () => {
    await send(a, a.users.accountant, "For the accountant");
    await send(a, a.users.teacher, "For the teacher");
    const mine = await svc(a, "accountant").forUser();
    expect(mine.items.map((n) => n.title)).toEqual(["For the accountant"]);
    expect(mine.unread).toBe(1);
  });

  it("rows of a module the plan does not have are not shown or counted", async () => {
    await send(a, a.users.teacher, "Notice");
    await send(a, a.users.teacher, "Request", { topic: "request.work", href: "/app/requests" });
    const off = new NotificationService({ ...a.as.teacher, features: new Set(["notifications"]) });
    expect((await off.forUser()).items.map((n) => n.title)).toEqual(["Notice"]);
    expect((await off.pulse()).bell).toBe(1);
    expect((await off.list()).total).toBe(1);
    expect((await svc(a, "teacher").pulse()).bell).toBe(2);
  });

  it("pulse gives the bell and Needs action in one call", async () => {
    await send(a, a.users.student, "Plain");
    await send(a, a.users.student, "Approve me", { action: true, subject: { type: "x", id: "1" } });
    const s = svc(a, "student");
    expect(await s.pulse()).toEqual({ bell: 2, needsAction: 1 });
    await s.markRead("all");
    // read, but the action stays until its module closes it
    expect(await s.pulse()).toEqual({ bell: 0, needsAction: 1 });
    await withSchool(a.id, (tx) => NotificationWriter.done(tx, a.id, { type: "x", id: "1" }));
    expect(await s.pulse()).toEqual({ bell: 0, needsAction: 0 });
  });

  it("filters by tab, unread and group, and pages", async () => {
    await send(a, a.users.student, "Notice");
    await send(a, a.users.student, "Fee", { topic: "fees.due" });
    await send(a, a.users.student, "Act", { action: true, topic: "notice.answer" });
    const s = svc(a, "student");
    expect((await s.list()).total).toBe(3);
    expect((await s.list({ filters: { tab: "action" } })).rows.map((r) => r.title)).toEqual(["Act"]);
    expect((await s.list({ filters: { group: "fees" } })).rows.map((r) => r.title)).toEqual(["Fee"]);
    expect((await s.list({ pageSize: 2 })).pageCount).toBe(2);
    await s.markRead("all");
    expect((await s.list({ filters: { unread: "1" } })).total).toBe(0);
  });

  it("marks one and all read, ignores bad ids, and drops pending sends of what was read", async () => {
    await send(a, a.users.student, "One");
    await send(a, a.users.student, "Two");
    const s = svc(a, "student");
    const { items } = await s.forUser();
    expect((await s.markRead(items[0]!.id)).updated).toBe(1);
    expect((await s.pulse()).bell).toBe(1);
    const pending = async () => (await withSchool(a.id, (tx) => tx.select().from(commDeliveries))).filter((d) => d.state === "pending").length;
    expect(await pending()).toBe(2);
    expect((await s.markRead("all")).updated).toBe(1);
    expect(await pending()).toBe(0);
    expect((await s.markRead("nope")).updated).toBe(0);
  });

  it("cannot read or mark another person's row, and school B sees nothing of A", async () => {
    await send(a, a.users.accountant, "Private");
    const id = (await svc(a, "accountant").forUser()).items[0]!.id;
    expect((await svc(a, "teacher").markRead(id)).updated).toBe(0);
    expect((await svc(a, "teacher").list()).rows).toHaveLength(0);
    expect((await svc(b, "admin").markRead(id)).updated).toBe(0);
    expect((await svc(b, "admin").list()).total).toBe(0);
    expect((await svc(a, "accountant").pulse()).bell).toBe(1);
  });

  it("reading and read marks work in a read-only school; the module must be on", async () => {
    await send(a, a.users.student, "Still readable");
    const ro = svc(a, "student", true);
    expect((await ro.pulse()).bell).toBe(1);
    expect((await ro.markRead("all")).updated).toBe(1);
    await expect(new NotificationService({ ...a.as.student, features: new Set() }).pulse()).rejects.toThrow();
  });

  it("a support session sees no private words, changes nothing, and still reads the rest", async () => {
    await send(a, a.users.student, "Plain notice", { body: "open text" });
    await send(a, a.users.student, "Marks inside", { topic: "work.update", body: "secret", privateBody: true });
    await send(a, a.users.student, "Teacher wrote to you", { topic: "message.new", body: "private talk" });
    await send(a, a.users.student, "Your request moved", { topic: "request.update", body: "private request" });
    for (const readOnly of [false, true]) {
      const support = new NotificationService({ ...a.as.student, features: new Set(["notifications", "requests"]), supportStaffId: crypto.randomUUID(), readOnly });
      const rows = [...(await support.list()).rows, ...(await support.forUser()).items];
      const byOld = (t: string) => rows.filter((r) => r.title === t);
      expect(byOld("Plain notice").length).toBeGreaterThan(0);
      expect(byOld("Plain notice")[0]!.body).toBe("open text");
      expect(rows.filter((r) => r.title === "Private" && r.body === null)).toHaveLength(6);
      expect(JSON.stringify(rows)).not.toMatch(/secret|private talk|private request|Marks inside|Teacher wrote|Your request moved/);
      expect((await support.markRead("all")).updated).toBe(0);
    }
    expect((await svc(a, "student").pulse()).bell).toBe(4);
  });
});
