import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "@smw/feature-notifications/feature";
import { notifications } from "@smw/feature-notifications/schema";
import { addDays, istDay } from "./dates";
import eventsFeature from "./feature";
import { CalendarFeedService, feedOwner } from "./feed";
import { buildCalendar, eventItem } from "./ics";
import { remindSchool } from "./jobs";
import { RsvpService } from "./rsvp";
import { calendarFeeds, events } from "./schema";
import { EventService } from "./service";
import { asUser, FEATURES, fixture, type Fixture } from "./test-fixture";

let a: TestSchool, b: TestSchool, fx: Fixture;
beforeAll(async () => {
  await registerFeatures([eventsFeature, notificationsFeature]);
  ({ a, b } = await createSchoolPair(FEATURES, "f"));
  fx = await fixture(a);
});
afterAll(closeDb);

const admin = () => new EventService(a.as.admin);
const FAMILIES = JSON.stringify({ include: [{ type: "families" }], exclude: [] });
const feed = (userId = fx.annUser, role: "student" | "teacher" = "student") => new CalendarFeedService(asUser(a, userId, role));

describe("calendar links", () => {
  it("a link is random, only its hash is stored, and the person is found by it", async () => {
    const { token } = await feed().reset();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 bits
    const stored = await withSchool(a.id, (tx) => tx.select().from(calendarFeeds).where(eq(calendarFeeds.userId, fx.annUser)));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await feedOwner(a.id, token)).toMatchObject({ userId: fx.annUser, role: "student" });
    expect(await feed().mine()).toMatchObject({ active: true });
  });

  it("making a new link ends the old one; revoking ends them all; wrong or foreign tokens find nobody", async () => {
    const first = (await feed(fx.bobUser).reset()).token;
    const second = (await feed(fx.bobUser).reset()).token;
    expect(first).not.toBe(second);
    expect(await feedOwner(a.id, first)).toBeNull();
    expect(await feedOwner(a.id, second)).toMatchObject({ userId: fx.bobUser });
    expect(await feedOwner(b.id, second)).toBeNull(); // school B never resolves school A's link
    expect(await feedOwner(a.id, "short")).toBeNull();
    expect(await feedOwner(a.id, "A".repeat(22))).toBeNull();
    await feed(fx.bobUser).revoke();
    expect(await feedOwner(a.id, second)).toBeNull();
    expect(await feed(fx.bobUser).mine()).toMatchObject({ active: false });
  });

  it("a disabled login's link stops working; a support session cannot make one", async () => {
    const { token } = await feed(fx.cyUser).reset();
    await withSchool(a.id, (tx) => tx.execute(`update users set status = 'disabled' where id = '${fx.cyUser}'` as never));
    expect(await feedOwner(a.id, token)).toBeNull();
    await expect(new CalendarFeedService({ ...a.as.admin, supportStaffId: "00000000-0000-4000-8000-000000000009" }).reset()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("what goes into the feed", () => {
  it("only the person's own events, with nothing private, golden-shaped and byte-stable", async () => {
    const own = await admin().create({ title: "Own section", startsAt: `${addDays(istDay(new Date()), 4)}T10:00`, audience: JSON.stringify({ include: [{ type: "section", id: fx.own }], exclude: [] }), description: "Bring a pen", bring: "ID card", rsvpOn: "true", capacity: 5, notify: "false" });
    await admin().create({ title: "Other section", startsAt: `${addDays(istDay(new Date()), 4)}T10:00`, audience: JSON.stringify({ include: [{ type: "section", id: fx.other }], exclude: [] }), notify: "false" });
    await admin().cancel(own.id, { reason: "Teacher unwell" });
    await new RsvpService(asUser(a, fx.bobUser, "student")).answer((await admin().create({ title: "Answered", startsAt: `${addDays(istDay(new Date()), 5)}T10:00`, audience: FAMILIES, rsvpOn: "true", notify: "false" })).id, { answer: "yes" });
    const rows = await new EventService(asUser(a, fx.annUser, "student")).range(new Date(Date.now() - 864e5), new Date(Date.now() + 30 * 864e5), { drafts: false });
    const body = buildCalendar(rows.map((r) => eventItem(r, "school.test")), { name: "School" });
    expect(body).toContain("SUMMARY:Own section");
    expect(body).not.toContain("Other section");
    expect(body).toContain("STATUS:CANCELLED");
    expect(body).toContain("Cancelled: Teacher unwell");
    expect(body).toContain("SEQUENCE:1");
    expect(body).not.toMatch(/Ann|Bob|Nolo|capacity|guests|RSVP/i);
    expect(buildCalendar(rows.map((r) => eventItem(r, "school.test")), { name: "School" })).toBe(body); // same bytes twice: the ETag holds
  });
});

describe("reminders", () => {
  const remind = (now: Date) => withSchool(a.id, (tx) => remindSchool(tx, a.id, now));
  const topic = (id: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(eq(notifications.subjectId, id)));

  it("each offset goes once per event, to people who did not say no", async () => {
    const start = new Date(Date.now() + 26 * 3_600_000);
    const e = await admin().create({ title: "Reminded", startsAt: `${istDay(start)}T${start.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`, audience: FAMILIES, rsvpOn: "true", notify: "false" });
    await new RsvpService(asUser(a, fx.bobUser, "student")).answer(e.id, { answer: "no" });
    expect(await remind(new Date())).toBe(0); // a day and 2 hours are both still ahead
    const dayBefore = new Date(e.startsAt.getTime() - 1440 * 60_000 + 60_000);
    expect(await remind(dayBefore)).toBe(1); // Ann only: Bob said no, Cy's login is disabled, Nolo has no login
    expect(await remind(dayBefore)).toBe(0); // again: nothing
    expect(await remind(new Date(e.startsAt.getTime() - 60 * 60_000))).toBe(1); // the 2-hour reminder
    const got = (await topic(e.id)).filter((n) => n.topic === "event.reminder");
    expect(got.some((n) => n.userId === fx.bobUser)).toBe(false);
    expect(got.map((n) => n.title).sort()).toEqual(["In 2 hours: Reminded", "Tomorrow: Reminded"]);
  });

  it("a cancelled event, a past event and an event with no reminders send nothing; offsets already past at creation never go out", async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000);
    const stamp = `${istDay(soon)}T${soon.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`;
    const e = await admin().create({ title: "Soon", startsAt: stamp, audience: FAMILIES, notify: "false" });
    expect((await withSchool(a.id, (tx) => tx.select().from(events).where(eq(events.id, e.id))))[0]!.remindedFor).toEqual([1440]);
    await admin().cancel(e.id, { reason: "Off" });
    expect(await remind(new Date(Date.now() + 2.5 * 3_600_000))).toBe(0);
    const none = await admin().create({ title: "No reminders", startsAt: stamp, audience: FAMILIES, reminders: "0", notify: "false" });
    expect(none.reminders).toEqual([]);
    expect(await remind(new Date(Date.now() + 2.9 * 3_600_000))).toBe(0);
  });

  it("moving the time lets the reminders be sent for the new time", async () => {
    const later = new Date(Date.now() + 5 * 864e5);
    const stamp = (d: Date) => `${istDay(d)}T${d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`;
    const e = await admin().create({ title: "Moved", startsAt: stamp(later), audience: FAMILIES, notify: "false" });
    await remind(new Date(e.startsAt.getTime() - 1400 * 60_000));
    const moved = new Date(later.getTime() + 2 * 864e5);
    await admin().update(e.id, { title: "Moved", startsAt: stamp(moved), audience: FAMILIES });
    const row = (await withSchool(a.id, (tx) => tx.select().from(events).where(eq(events.id, e.id))))[0]!;
    expect(row.remindedFor).toEqual([]);
  });
});
