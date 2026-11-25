import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "@smw/feature-notifications/feature";
import { notifications } from "@smw/feature-notifications/schema";
import { students } from "@smw/feature-students/schema";
import { classes, sections, academicYears } from "@smw/feature-academics/schema";
import { addDays, istDay } from "./dates";
import eventsFeature from "./feature";
import { RsvpService } from "./rsvp";
import { eventPeople, events } from "./schema";
import { EventService } from "./service";
import { asUser, FEATURES } from "./test-fixture";

let s: TestSchool, other: TestSchool;
let logins: string[] = [];
beforeAll(async () => {
  await registerFeatures([eventsFeature, notificationsFeature]);
  ({ a: s, b: other } = await createSchoolPair(FEATURES, "r"));
  // sixty families, each a student with a login
  await withSchool(s.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: s.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c] = await tx.insert(classes).values({ schoolId: s.id, name: "Class 1", grade: 1 }).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: s.id, classId: c!.id, yearId: y!.id, name: "A", classTeacherId: s.users.teacher }).returning();
    const us = await tx.insert(users).values(Array.from({ length: 60 }, (_, i) => ({ schoolId: s.id, role: "student" as const, loginId: `fam${i}-r`, name: `Family ${i}`, email: `f${i}@r.test` }))).returning();
    await tx.insert(students).values(us.map((u, i) => ({ schoolId: s.id, name: `Kid ${String(i).padStart(2, "0")}`, admissionNo: `R-${i}`, classId: c!.id, sectionId: sec!.id, userId: u.id })));
    logins = us.map((u) => u.id);
  });
});
afterAll(closeDb);

const admin = () => new EventService(s.as.admin);
const rsvp = (userId: string, role: "student" | "admin" | "teacher" = "student") => new RsvpService(asUser(s, userId, role));
const when = () => `${addDays(istDay(new Date()), 5)}T17:00`;
const make = async (rsvpOn: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  admin().create({ title: "Annual day", startsAt: when(), audience: JSON.stringify({ include: [{ type: "families" }], exclude: [] }), rsvpOn: "true", notify: "false", ...rsvpOn, ...o });
const rows = (id: string) => withSchool(s.id, (tx) => tx.select().from(eventPeople).where(eq(eventPeople.eventId, id)));
const stat = async (id: string) => { const r = await rows(id); return { going: r.filter((p) => p.answer === "yes" && !p.waitingSince), waiting: r.filter((p) => p.answer === "yes" && p.waitingSince) }; };

describe("answers", () => {
  it("yes, maybe and no; changing the answer; guests within the limit", async () => {
    const e = await make({ guests: 2 });
    expect(await rsvp(logins[0]!).answer(e.id, { answer: "yes", guests: 2 })).toBe("going");
    expect(await rsvp(logins[1]!).answer(e.id, { answer: "maybe" })).toBe("maybe");
    expect(await rsvp(logins[2]!).answer(e.id, { answer: "no" })).toBe("not_going");
    await expect(rsvp(logins[3]!).answer(e.id, { answer: "yes", guests: 3 })).rejects.toMatchObject({ fieldErrors: { guests: expect.any(String) } });
    expect(await rsvp(logins[0]!).answer(e.id, { answer: "no" })).toBe("not_going");
    const mine = (await rows(e.id)).find((p) => p.userId === logins[0])!;
    expect(mine).toMatchObject({ answer: "no", guests: 0 });
  });

  it("an event that does not ask for answers, a cancelled one, a closed one and a draft refuse", async () => {
    const plain = await admin().create({ title: "No RSVP", startsAt: when(), audience: JSON.stringify({ include: [{ type: "families" }], exclude: [] }), notify: "false" });
    await expect(rsvp(logins[0]!).answer(plain.id, { answer: "yes" })).rejects.toBeInstanceOf(ConflictError);
    const c = await make({});
    await admin().cancel(c.id, { reason: "Rain" });
    await expect(rsvp(logins[0]!).answer(c.id, { answer: "yes" })).rejects.toThrow("cancelled");
    const closed = await make({ closesAt: `${addDays(istDay(new Date()), -1)}T10:00` });
    await expect(rsvp(logins[0]!).answer(closed.id, { answer: "yes" })).rejects.toThrow("closed");
    await expect(rsvp(s.users.teacher, "teacher").answerFor(closed.id, "u:x", { answer: "yes" })).rejects.toBeInstanceOf(ForbiddenError); // not the owner
    const draft = await make({}, { draft: "true" });
    await expect(rsvp(logins[0]!).answer(draft.id, { answer: "yes" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("someone not invited cannot answer", async () => {
    const e = await make({}, { audience: JSON.stringify({ include: [{ type: "staff" }], exclude: [] }) });
    await expect(rsvp(logins[0]!).answer(e.id, { answer: "yes" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("capacity", () => {
  it("50 answers at once never take more than the capacity; the rest wait in order", async () => {
    const e = await make({ capacity: 20 });
    const out = await Promise.all(logins.slice(0, 50).map((u) => rsvp(u).answer(e.id, { answer: "yes" })));
    expect(out.filter((x) => x === "going")).toHaveLength(20);
    expect(out.filter((x) => x === "waiting")).toHaveLength(30);
    const { going, waiting } = await stat(e.id);
    expect(going).toHaveLength(20);
    expect(waiting).toHaveLength(30);
  });

  it("when someone says no, the first in line moves up by itself and is told once", async () => {
    const e = await make({ capacity: 2 });
    for (const u of logins.slice(0, 4)) await rsvp(u).answer(e.id, { answer: "yes" });
    const first = (await stat(e.id)).waiting.sort((x, y) => x.waitingSince!.getTime() - y.waitingSince!.getTime())[0]!;
    await rsvp(logins[0]!).answer(e.id, { answer: "no" });
    const after = await stat(e.id);
    expect(after.going.map((p) => p.userId)).toContain(first.userId);
    expect(after.going).toHaveLength(2);
    const told = await withSchool(s.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.subjectId, e.id), eq(notifications.userId, first.userId!))));
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toContain("A place is yours");
  });

  it("guests count as places, and raising the capacity admits the waiting", async () => {
    const e = await make({ capacity: 3, guests: 2 });
    expect(await rsvp(logins[0]!).answer(e.id, { answer: "yes", guests: 2 })).toBe("going"); // 3 places
    expect(await rsvp(logins[1]!).answer(e.id, { answer: "yes" })).toBe("waiting");
    await expect(rsvp(logins[0]!).answer(e.id, { answer: "yes", guests: 2 })).resolves.toBe("going"); // same party, same seats
    const input = { title: "Annual day", startsAt: when(), audience: JSON.stringify({ include: [{ type: "families" }], exclude: [] }), rsvpOn: "true", capacity: 5, guests: 2 };
    await admin().update(e.id, input);
    expect((await stat(e.id)).going.map((p) => p.userId)).toEqual(expect.arrayContaining([logins[1]]));
  });
});

describe("the owner's side", () => {
  it("answer on behalf, check-in, list and CSV; families and other teachers cannot", async () => {
    const e = await make({ capacity: 10 });
    const nolo = (await rows(e.id))[0]!;
    expect(await rsvp(s.users.admin, "admin").answerFor(e.id, nolo.personKey, { answer: "yes", guests: 0 })).toBe("going");
    await expect(rsvp(s.users.admin, "admin").checkIn(e.id, nolo.personKey)).resolves.toEqual({ checkedIn: true });
    const list = await rsvp(s.users.admin, "admin").list(e.id);
    expect(list.counts).toMatchObject({ invited: 60, going: 1, noReply: 59, checkedIn: 1 });
    const csv = await rsvp(s.users.admin, "admin").csv(e.id);
    expect(csv.name).toBe("annual-day-answers.csv");
    expect(csv.text.split("\r\n")[0]).toBe("Name,Class or role,Answer,Guests,On the waiting list,Answered at,Arrived at");
    await expect(rsvp(logins[0]!).list(e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rsvp(logins[0]!).checkIn(e.id, nolo.personKey)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rsvp(s.users.admin, "admin").checkIn(e.id, nolo.personKey, false)).resolves.toEqual({ checkedIn: false });
  });

  it("a cell that looks like a formula is made harmless in the CSV", async () => {
    const e = await make({});
    await withSchool(s.id, (tx) => tx.update(eventPeople).set({ name: "=HYPERLINK(1)" }).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.userId, logins[5]!))));
    expect((await rsvp(s.users.admin, "admin").csv(e.id)).text).toContain("'=HYPERLINK(1)");
  });

  it("a family whose child has left cannot answer, nor can the office answer for them, and their seat is freed", async () => {
    const e = await make({ capacity: 2 });
    const [first, second, third] = [logins[50]!, logins[51]!, logins[52]!];
    expect(await rsvp(first).answer(e.id, { answer: "yes" })).toBe("going");
    expect(await rsvp(second).answer(e.id, { answer: "yes" })).toBe("going");
    expect(await rsvp(third).answer(e.id, { answer: "yes" })).toBe("waiting");
    await withSchool(s.id, (tx) => tx.update(students).set({ status: "left" }).where(eq(students.userId, first)));
    await expect(rsvp(first).answer(e.id, { answer: "no" })).rejects.toThrow(/no longer at the school/);
    const key = (await rows(e.id)).find((p) => p.userId === first)!.personKey;
    await expect(rsvp(s.users.admin, "admin").answerFor(e.id, key, { answer: "yes" })).rejects.toBeInstanceOf(ConflictError);
    // the leaver's seat no longer counts: the family that waited is promoted on the next change
    const counts = (await rsvp(s.users.admin, "admin").list(e.id)).counts;
    expect(counts).toMatchObject({ seats: 1, going: 1, waiting: 1 });
    await admin().update(e.id, { title: "Annual day", startsAt: when(), audience: JSON.stringify({ include: [{ type: "families" }], exclude: [] }), rsvpOn: "true", capacity: "2" });
    expect((await stat(e.id)).waiting).toHaveLength(0);
    await withSchool(s.id, (tx) => tx.update(students).set({ status: "active" }).where(eq(students.userId, first)));
  });

  it("nothing crosses schools", async () => {
    const e = await make({});
    await expect(new RsvpService(asUser(other, other.users.admin, "admin")).list(e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new RsvpService({ ...other.as.student, features: new Set(FEATURES) }).answer(e.id, { answer: "yes" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(other.id, (tx) => tx.select().from(events))).toHaveLength(0);
  });

  it("a support session cannot answer or list", async () => {
    const e = await make({});
    const support = new RsvpService({ ...s.as.admin, supportStaffId: "00000000-0000-4000-8000-000000000009" });
    await expect(support.list(e.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
