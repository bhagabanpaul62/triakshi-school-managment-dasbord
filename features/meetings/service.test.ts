import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { notifications } from "@smw/feature-notifications/schema";
import { students } from "@smw/feature-students/schema";
import { BookingService, DayService, MeetingService, TAKEN } from "./service";
import { MeetingSchedule } from "./schedule";
import { crowd, fixture, FEATURES, IST_DAY } from "./test-fixture";
import { atIst, istDay } from "./rules";
import { meetingSlots } from "./schema";

let a: TestSchool, b: TestSchool;
let ids: Awaited<ReturnType<typeof fixture>>;
let DAY = "";
let nextDay = 3;
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
const everyoneInA = () => ({ include: [{ type: "section" as const, id: ids.sectionA }], exclude: [] });
const admin = () => new MeetingService(a.as.admin);
/** Each meeting gets its own day: a teacher cannot be in two windows at once. */
const draft = (over: Record<string, unknown> = {}) => { DAY = istDay(new Date(Date.now() + nextDay++ * IST_DAY)); return admin().saveDraft(null, { title: "Term 1 PTM", audience: everyoneInA(), slotMinutes: "10", perFamily: "4", opensAt: hours(-1), closesAt: hours(48), ...over }); };
const win = (teacherIds: string[], over: Record<string, unknown> = {}) => ({ teacherIds, day: DAY, from: "10:00", to: "12:00", place: "Room 5", ...over });
const as = (ctx: Ctx, over: Partial<Ctx> = {}): Ctx => ({ ...ctx, ...over });
const slotsOf = (meetingId: string, teacherId: string) => withSchool(a.id, (tx) => tx.select().from(meetingSlots).where(eq(meetingSlots.meetingId, meetingId)).orderBy(meetingSlots.startsAt)).then((r) => r.filter((s) => s.teacherId === teacherId));
const freeOf = async (m: string, t: string) => (await slotsOf(m, t)).filter((s) => s.state === "open");
const noteCount = (userId: string, topic: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId))).then((r) => r.filter((n) => n.topic === topic));

/** A meeting that is open, with T1 and T2 from 10:00 to 12:00. */
async function openMeeting(over: Record<string, unknown> = {}, teachers = [ids.t1, ids.t2]) {
  const m = await draft(over);
  await admin().addWindows(m.id, win(teachers));
  await admin().open(m.id);
  return m;
}

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES, "m"));
  ids = await fixture(a);
});
afterAll(closeDb);

describe("setup", () => {
  it("builds slots from a window, bulk for several teachers, with a break", async () => {
    const m = await draft();
    await admin().addWindows(m.id, win([ids.t1, ids.t2], { breakFrom: "11:00", breakTo: "11:20" }));
    for (const t of [ids.t1, ids.t2]) {
      const s = await slotsOf(m.id, t);
      expect(s).toHaveLength(12);
      expect(s.filter((x) => x.state === "break")).toHaveLength(2);
    }
    expect(await admin().generateSlots(m.id)).toEqual({ created: 0 });
  });

  it("suggests the class and subject teachers of the audience's sections, and checks before opening", async () => {
    const names = (await admin().suggestTeachers(everyoneInA())).map((t) => t.teacherId).sort();
    expect(names).toEqual([ids.t1, ids.t2].sort());
    const m = await draft({ audience: { include: [{ type: "section", id: ids.sectionA }, { type: "section", id: ids.sectionB }], exclude: [] } });
    await expect(admin().open(m.id)).rejects.toThrow(/Add the teachers/);
    await admin().addWindows(m.id, win([ids.t1]));
    const check = await admin().check(m.id);
    expect(check.problems).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/1 family has no teacher/);
  });

  it("opening tells every family once with an action; a teacher with no window never sees the meeting", async () => {
    const m = await openMeeting();
    const mine = (await noteCount(a.users.student, "meeting.open")).filter((n) => n.subjectId === m.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ action: true, href: `/app/meetings/${m.id}` });
    expect((await noteCount(ids.ctx.meera.userId, "meeting.open")).filter((n) => n.subjectId === m.id)).toHaveLength(0);
    expect((await new MeetingService(ids.ctx.t3).list()).rows.map((r) => r.id)).not.toContain(m.id);
    await expect(new MeetingService(ids.ctx.t3).get(m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(admin().open(m.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("a teacher cannot hold two windows at once, and a window must fit a slot", async () => {
    const m = await draft();
    await admin().addWindows(m.id, win([ids.t1], { from: "14:00", to: "15:00" }));
    await expect(admin().addWindows(m.id, win([ids.t1], { from: "14:30", to: "15:30" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(admin().addWindows(m.id, win([ids.t2], { from: "14:00", to: "14:05" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(admin().addWindows(m.id, win([a.users.student]))).rejects.toBeInstanceOf(ValidationError);
  });

  it("duplicate copies people and times to a new date, close and reopen, cancel tells the booked", async () => {
    const m = await openMeeting({ title: "To duplicate" });
    const copy = await admin().duplicate(m.id, { date: istDay(new Date(Date.now() + 400 * IST_DAY)) });
    expect(copy.state).toBe("draft");
    expect(await slotsOf(copy.id, ids.t1)).toHaveLength(12);
    await new BookingService(a.as.student).book(m.id, { slotId: (await freeOf(m.id, ids.t1))[0]!.id });
    await admin().close(m.id);
    await expect(new BookingService(a.as.student).book(m.id, { slotId: (await freeOf(m.id, ids.t2))[0]!.id })).rejects.toThrow(/closed/);
    await admin().reopen(m.id);
    await admin().cancel(m.id, { reason: "Rain holiday" });
    const told = (await noteCount(a.users.student, "meeting.changed")).filter((n) => n.subjectId === m.id);
    expect(told[0]?.body).toBe("Rain holiday");
    await expect(admin().cancel(m.id, { reason: "again" })).rejects.toBeInstanceOf(ConflictError);
    const view = await new BookingService(a.as.student).forFamily(m.id);
    expect(view.can).toBe(false);
    expect(view.why).toMatch(/Rain holiday/);
  });
});

describe("booking", () => {
  it("a family sees only teachers of their child, and a child outside the audience sees nothing", async () => {
    const m = await openMeeting();
    const v = await new BookingService(a.as.student).forFamily(m.id);
    expect(v.kids).toHaveLength(1);
    expect(v.kids[0]!.teachers.map((t) => t.teacherId).sort()).toEqual([ids.t1, ids.t2].sort());
    expect(v.kids[0]!.teachers.find((t) => t.teacherId === ids.t1)!.why).toMatch(/Class teacher.*Mathematics/);
    expect(v.can).toBe(true);
    await expect(new BookingService(ids.ctx.meera).forFamily(m.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opening the meeting reads its bell rows but keeps the 'book a time' action open until booked", async () => {
    const m = await openMeeting({ title: "Bell" });
    const row = async () => (await noteCount(a.users.student, "meeting.open")).find((n) => n.subjectId === m.id)!;
    expect(await row()).toMatchObject({ readAt: null, action: true, doneAt: null });
    await new BookingService(a.as.student).forFamily(m.id);
    expect(await row()).toMatchObject({ doneAt: null });
    expect((await row()).readAt).not.toBeNull();
    await new BookingService(a.as.student).book(m.id, { slotId: (await freeOf(m.id, ids.t1))[0]!.id });
    expect((await row()).doneAt).not.toBeNull();
  });

  it("books, refuses a second time with the same teacher, enforces the per-family limit", async () => {
    const m = await openMeeting({ title: "Limit", perFamily: "1" });
    const fam = new BookingService(a.as.student);
    const [t1s, t2s] = [await freeOf(m.id, ids.t1), await freeOf(m.id, ids.t2)];
    await fam.book(m.id, { slotId: t1s[0]!.id });
    await expect(fam.book(m.id, { slotId: t2s[3]!.id })).rejects.toThrow(/can book 1 teacher/);
    const loose = await openMeeting({ title: "Same teacher", perFamily: "4" });
    const s = await freeOf(loose.id, ids.t1);
    await new BookingService(ids.ctx.kabir).book(loose.id, { slotId: s[0]!.id });
    await expect(new BookingService(ids.ctx.kabir).book(loose.id, { slotId: s[5]!.id })).rejects.toThrow(/already has a time with/);
  });

  it("refuses a time that clashes for the child or a sibling, and allows another time", async () => {
    const m = await openMeeting({ title: "Siblings" });
    const [t1s, t2s] = [await freeOf(m.id, ids.t1), await freeOf(m.id, ids.t2)];
    await new BookingService(a.as.student).book(m.id, { slotId: t1s[0]!.id });
    const riya = new BookingService(ids.ctx.riya);
    await expect(riya.book(m.id, { slotId: t2s[0]!.id })).rejects.toThrow(/brother or sister/);
    await expect(new BookingService(a.as.student).book(m.id, { slotId: t2s[0]!.id })).rejects.toThrow(/already has a meeting with/);
    await riya.book(m.id, { slotId: t2s[1]!.id });
    // the family page hides what would clash
    const v = await new BookingService(ids.ctx.riya).forFamily(m.id);
    expect(v.kids[0]!.teachers.find((t) => t.teacherId === ids.t1)!.slots.map((s) => s.id)).not.toContain(t1s[0]!.id);
  });

  it("20 families race for one slot: exactly one wins, 19 hear the friendly sentence", async () => {
    const m = await openMeeting({ title: "Race", perFamily: "2" });
    const families = await crowd(a, ids, 20);
    const slot = (await freeOf(m.id, ids.t1))[4]!;
    const results = await Promise.allSettled(families.map((c) => new BookingService(c).book(m.id, { slotId: slot.id })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(lost).toHaveLength(19);
    for (const l of lost) expect(l.reason).toMatchObject({ message: TAKEN });
    expect((await slotsOf(m.id, ids.t1)).filter((s) => s.state === "booked")).toHaveLength(1);
  });

  it("brothers racing for the same hour with different teachers: one wins", async () => {
    const m = await openMeeting({ title: "Brothers race" });
    const [t1s, t2s] = [await freeOf(m.id, ids.t1), await freeOf(m.id, ids.t2)];
    const r = await Promise.allSettled([new BookingService(a.as.student).book(m.id, { slotId: t1s[7]!.id }), new BookingService(ids.ctx.riya).book(m.id, { slotId: t2s[7]!.id })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("changing moves the booking in one step; a gone time keeps the old one", async () => {
    const m = await openMeeting({ title: "Change" });
    const fam = new BookingService(a.as.student);
    const s = await freeOf(m.id, ids.t1);
    await fam.book(m.id, { slotId: s[0]!.id });
    await fam.changeBooking(m.id, { fromSlotId: s[0]!.id, toSlotId: s[2]!.id });
    expect((await slotsOf(m.id, ids.t1)).filter((x) => x.state === "booked").map((x) => x.id)).toEqual([s[2]!.id]);
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: s[4]!.id });
    await expect(fam.changeBooking(m.id, { fromSlotId: s[2]!.id, toSlotId: s[4]!.id })).rejects.toThrow(TAKEN);
    expect((await slotsOf(m.id, ids.t1)).find((x) => x.id === s[2]!.id)!.studentId).toBe(ids.aarav);
    await fam.cancelBooking(m.id, { slotId: s[2]!.id });
    expect((await slotsOf(m.id, ids.t1)).find((x) => x.id === s[2]!.id)!.state).toBe("open");
    await expect(fam.cancelBooking(m.id, { slotId: s[2]!.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a family cannot touch another child's booking or book outside the open hours", async () => {
    const m = await openMeeting({ title: "Rules" });
    const s = await freeOf(m.id, ids.t1);
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: s[0]!.id });
    await expect(new BookingService(a.as.student).cancelBooking(m.id, { slotId: s[0]!.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BookingService(a.as.student).book(m.id, { slotId: s[1]!.id, studentId: ids.kabir })).rejects.toBeInstanceOf(ForbiddenError);
    const late = new (class extends BookingService { protected override now() { return hours(72); } })(a.as.student);
    await expect(late.book(m.id, { slotId: s[1]!.id })).rejects.toThrow(/closed/);
    const early = await draft({ title: "Not yet", opensAt: hours(5), closesAt: hours(30) });
    await admin().addWindows(early.id, win([ids.t1], { from: "13:00", to: "14:00" }));
    await admin().open(early.id);
    const slot = (await freeOf(early.id, ids.t1))[0]!;
    await expect(new BookingService(a.as.student).book(early.id, { slotId: slot.id })).rejects.toThrow(/opens/);
    await new BookingService(a.as.admin).book(early.id, { slotId: slot.id, studentId: ids.aarav });
  });

  it("staff book and cancel for a family; only a manager may", async () => {
    const m = await openMeeting({ title: "On behalf" });
    const s = await freeOf(m.id, ids.t2);
    await expect(new BookingService(a.as.teacher).book(m.id, { slotId: s[0]!.id, studentId: ids.kabir })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BookingService(a.as.admin).book(m.id, { slotId: s[0]!.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(new BookingService(a.as.admin).book(m.id, { slotId: s[0]!.id, studentId: ids.meera })).rejects.toBeInstanceOf(ValidationError);
    await new BookingService(a.as.admin).book(m.id, { slotId: s[0]!.id, studentId: ids.kabir });
    expect((await noteCount(ids.ctx.kabir.userId, "meeting.changed")).some((n) => n.title.includes("A time was booked"))).toBe(true);
    await new BookingService(a.as.admin).cancelBooking(m.id, { slotId: s[0]!.id, studentId: ids.kabir });
    expect((await freeOf(m.id, ids.t2)).map((x) => x.id)).toContain(s[0]!.id);
  });

  it("a child who left cannot book, and drops out of the audience", async () => {
    const m = await openMeeting({ title: "Left" });
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left" }).where(eq(students.id, ids.meera)));
    await withSchool(a.id, (tx) => tx.update(students).set({ sectionId: ids.sectionA }).where(eq(students.id, ids.meera)));
    await expect(new BookingService(ids.ctx.meera).forFamily(m.id)).rejects.toBeInstanceOf(NotFoundError);
    const s = await freeOf(m.id, ids.t1);
    await expect(new BookingService(ids.ctx.meera).book(m.id, { slotId: s[0]!.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new BookingService(a.as.admin).invitedChildren(m.id)).map((c) => c.id)).not.toContain(ids.meera);
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "active", sectionId: ids.sectionB }).where(eq(students.id, ids.meera)));
  });
});

describe("waiting list and window changes", () => {
  it("a full teacher has a waiting list: the first in line is told once, the next only when another time frees", async () => {
    const m = await draft({ title: "Wait", perFamily: "3" });
    await admin().addWindows(m.id, win([ids.t1], { from: "15:00", to: "15:10" }));
    await admin().open(m.id);
    const only = (await freeOf(m.id, ids.t1))[0]!;
    await new BookingService(a.as.student).book(m.id, { slotId: only.id });
    await expect(new BookingService(ids.ctx.kabir).joinWaitlist(m.id, { teacherId: ids.t2 })).rejects.toBeInstanceOf(ConflictError);
    await new BookingService(ids.ctx.kabir).joinWaitlist(m.id, { teacherId: ids.t1 });
    await new BookingService(ids.ctx.riya).joinWaitlist(m.id, { teacherId: ids.t1 });
    await new BookingService(a.as.student).cancelBooking(m.id, { slotId: only.id });
    const told = async (c: Ctx) => (await noteCount(c.userId, "meeting.changed")).filter((n) => n.subjectId === m.id && n.title.includes("free"));
    expect(await told(ids.ctx.kabir)).toHaveLength(1);
    expect(await told(ids.ctx.riya)).toHaveLength(0);
    await new BookingService(ids.ctx.meera).forFamily(m.id).catch(() => null);
    // Kabir does not take it; the same time frees once more (staff cancel and rebook)
    await new BookingService(ids.ctx.riya).book(m.id, { slotId: only.id });
    await new BookingService(ids.ctx.riya).cancelBooking(m.id, { slotId: only.id });
    expect(await told(ids.ctx.kabir)).toHaveLength(1);
    expect(await told(ids.ctx.riya)).toHaveLength(0);
  });

  it("a window change lists the bookings it drops, saves nothing until confirmed, then tells the families and offers new times", async () => {
    const m = await openMeeting({ title: "Window change", perFamily: "3" }, [ids.t1]);
    const s = await freeOf(m.id, ids.t1);
    await new BookingService(a.as.student).book(m.id, { slotId: s[10]!.id }); // 11:40
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: s[1]!.id }); // 10:10
    const winId = (await admin().get(m.id)).windows[0]!.id;
    const before = await slotsOf(m.id, ids.t1);
    const preview = await admin().changeWindow(winId, { to: "11:00" });
    expect(preview.applied).toBe(false);
    expect(preview.dropped.map((d) => d.studentName)).toEqual(["Aarav Sharma"]);
    expect(await slotsOf(m.id, ids.t1)).toEqual(before);
    const done = await admin().changeWindow(winId, { to: "11:00", confirm: "true" });
    expect(done.applied).toBe(true);
    expect((await noteCount(a.users.student, "meeting.changed")).filter((n) => n.subjectId === m.id && n.title.includes("changed"))).toHaveLength(1);
    const live = (await slotsOf(m.id, ids.t1)).filter((x) => x.state !== "removed");
    expect(live).toHaveLength(6);
    expect(live.find((x) => x.studentId === ids.kabir)).toBeTruthy();
    // Aarav can book again
    const v = await new BookingService(a.as.student).forFamily(m.id);
    expect(v.kids[0]!.booked).toHaveLength(0);
    await new BookingService(a.as.student).book(m.id, { slotId: v.kids[0]!.teachers[0]!.slots[0]!.id });
    // a change that drops nothing applies at once
    expect((await admin().changeWindow(winId, { to: "12:00" })).applied).toBe(true);
    expect((await freeOf(m.id, ids.t1)).length).toBeGreaterThan(5);
  });

  it("widening a window offers the new times to the waiting list", async () => {
    const m = await draft({ title: "Widen", perFamily: "3" });
    await admin().addWindows(m.id, win([ids.t2], { from: "16:00", to: "16:10" }));
    await admin().open(m.id);
    const only = (await freeOf(m.id, ids.t2))[0]!;
    await new BookingService(a.as.student).book(m.id, { slotId: only.id });
    await new BookingService(ids.ctx.kabir).joinWaitlist(m.id, { teacherId: ids.t2 });
    const winId = (await admin().get(m.id)).windows[0]!.id;
    await admin().changeWindow(winId, { to: "16:30" });
    expect((await noteCount(ids.ctx.kabir.userId, "meeting.changed")).filter((n) => n.subjectId === m.id && n.title.includes("free"))).toHaveLength(1);
    expect((await admin().removeWindow(winId)).applied).toBe(false);
    expect((await admin().removeWindow(winId, { confirm: "true" })).applied).toBe(true);
    expect((await admin().get(m.id)).windows).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("who may do what", async () => {
    const m = await openMeeting({ title: "Matrix" });
    const body = { title: "x y z", audience: everyoneInA(), slotMinutes: 10, perFamily: 2, opensAt: hours(1), closesAt: hours(5) };
    for (const who of [a.as.student, a.as.teacher, ids.ctx.t3]) {
      await expect(new MeetingService(who).saveDraft(null, body)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new MeetingService(who).open(m.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new MeetingService(who).addWindows(m.id, win([ids.t1]))).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(new MeetingService(a.as.student).get(m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DayService(a.as.student).day(m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BookingService(a.as.teacher).forFamily(m.id)).rejects.toBeInstanceOf(ForbiddenError);
    // class teacher sees only their own windows; an unrelated teacher gets nothing; admin sees all
    expect((await new MeetingService(a.as.teacher).get(m.id)).windows.map((w) => w.teacherId)).toEqual([ids.t1]);
    expect((await admin().get(m.id)).windows).toHaveLength(2);
    await expect(new MeetingService(ids.ctx.t3).get(m.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new MeetingService(a.as.student).list()).rows.map((r) => r.id)).toContain(m.id);
    // custom roles
    const useOnly = as(a.as.teacher, { grants: new Set(["meetings:use"]) });
    const manager = as(a.as.teacher, { grants: new Set(["meetings:use", "meetings:manage"]) });
    const nothing = as(a.as.teacher, { grants: new Set<string>() });
    await expect(new MeetingService(useOnly).close(m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new MeetingService(nothing).list()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new MeetingService(manager).get(m.id)).windows).toHaveLength(2);
    // the parent login is retired; a school without the module refuses
    await expect(new MeetingService(as(a.as.parent)).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new MeetingService(as(a.as.admin, { features: new Set() })).list()).rejects.toThrow(/not enabled/);
    await expect(new MeetingService(as(a.as.admin, { readOnly: true })).close(m.id)).rejects.toThrow(/read-only/);
  });

  it("two schools with the same names never see each other's meetings", async () => {
    const m = await openMeeting({ title: "Only A" });
    expect((await new MeetingService(b.as.admin).list()).total).toBe(0);
    await expect(new MeetingService(b.as.admin).get(m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new MeetingService(b.as.admin).cancel(m.id, { reason: "nope" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BookingService(b.as.student).forFamily(m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DayService(b.as.admin).day(m.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the day", () => {
  /** A meeting with Kabir booked at 10:20 and Aarav at 10:00 with T1, running at `at`. */
  async function running() {
    const m = await openMeeting({ title: "Day", perFamily: "3" });
    const s = await freeOf(m.id, ids.t1);
    await new BookingService(a.as.student).book(m.id, { slotId: s[0]!.id });
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: s[2]!.id });
    return { m, s };
  }
  const at = (d: Date) => class extends DayService { protected override now() { return d; } };

  it("lists in order with a now mark; the teacher marks came, late, missed; a mark too early is refused", async () => {
    const { m, s } = await running();
    const t1 = new DayService(a.as.teacher);
    const v = await t1.day(m.id);
    expect(v.rows.map((r) => r.studentName)).toEqual(["Aarav Sharma", "Kabir Singh"]);
    expect(v).toMatchObject({ date: DAY, dates: [DAY], isToday: false, nextSlotId: null });
    expect(v.rows.every((r) => !r.canMark)).toBe(true);
    await expect(t1.mark(s[0]!.id, { visit: "came" })).rejects.toThrow(/Opens on/);
    const Running = at(atIst(DAY, "10:05"));
    const live = new Running(a.as.teacher);
    expect((await live.day(m.id)).rows[0]!.isNow).toBe(true);
    expect((await live.day(m.id)).nextSlotId).toBe(s[0]!.id);
    await live.mark(s[0]!.id, { visit: "came" });
    await live.mark(s[2]!.id, { visit: "missed" });
    const after = await live.day(m.id);
    expect(after.counts).toMatchObject({ booked: 2, came: 1, missed: 1, unmarked: 0 });
    expect(after.nextSlotId).toBeNull();
    await live.mark(s[2]!.id, { visit: "" });
    expect((await live.day(m.id)).counts.unmarked).toBe(1);
    // another teacher cannot mark it, an admin can
    await expect(new (at(atIst(DAY, "10:05")))(ids.ctx.t2).mark(s[0]!.id, { visit: "late" })).rejects.toBeInstanceOf(NotFoundError);
    await new (at(atIst(DAY, "10:05")))(a.as.admin).mark(s[0]!.id, { visit: "late" });
    expect((await admin().get(m.id)).windows.find((w) => w.teacherId === ids.t1)!.slots.find((x) => x.id === s[0]!.id)!.visit).toBe("late");
  });

  it("a teacher sees only their own list; an admin picks any teacher", async () => {
    const { m } = await running();
    await expect(new DayService(a.as.teacher).day(m.id, ids.t2)).resolves.toMatchObject({ teacher: { id: ids.t1 } });
    expect((await new DayService(a.as.admin).day(m.id, ids.t2)).teacher.id).toBe(ids.t2);
    expect((await new DayService(a.as.admin).day(m.id, ids.t2)).teachers).toHaveLength(2);
    await expect(new DayService(ids.ctx.t3).day(m.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the private note never leaves staff; the shared remark reaches the family only after the time is over", async () => {
    const { m, s } = await running();
    const t1 = new DayService(a.as.teacher);
    await t1.saveNotes(s[0]!.id, { privateNote: "Struggles with fractions, mother worried", sharedRemark: "Doing well in maths" });
    const fam = await new BookingService(a.as.student).forFamily(m.id);
    expect(JSON.stringify(fam)).not.toContain("Struggles");
    expect(fam.kids[0]!.booked[0]!.remark).toBeNull();
    expect(JSON.stringify(await new BookingService(ids.ctx.kabir).forFamily(m.id))).not.toContain("Doing well");
    const after = new (class extends BookingService { protected override now() { return atIst(DAY, "10:30"); } })(a.as.student);
    expect((await after.forFamily(m.id)).kids[0]!.booked[0]!.remark).toBe("Doing well in maths");
    expect((await t1.day(m.id)).rows[0]!.privateNote).toMatch(/Struggles/);
    // another teacher and a family never get the note; clearing works
    await expect(new DayService(ids.ctx.t2).saveNotes(s[0]!.id, { privateNote: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await t1.saveNotes(s[0]!.id, { sharedRemark: "" });
    expect((await t1.day(m.id)).rows[0]!.sharedRemark).toBeNull();
    expect((await t1.day(m.id)).rows[0]!.privateNote).toMatch(/Struggles/);
  });

  it("a support session cannot read or write private notes", async () => {
    const { m, s } = await running();
    await new DayService(a.as.teacher).saveNotes(s[0]!.id, { privateNote: "secret words" });
    const support = new DayService(as(a.as.admin, { supportStaffId: "00000000-0000-0000-0000-0000000000aa" }));
    await expect(support.saveNotes(s[0]!.id, { privateNote: "hack" })).rejects.toBeInstanceOf(ForbiddenError);
    const v = await support.day(m.id, ids.t1);
    expect(v.privateNotesHidden).toBe(true);
    expect(JSON.stringify(v)).not.toContain("secret words");
  });

  it("a walk-in takes a slot starting now, already marked as came; double walk-in is refused", async () => {
    const { m } = await running();
    const Now = at(atIst(DAY, "11:10"));
    const t1 = new Now(a.as.teacher);
    const w = await t1.walkIn(m.id, { studentId: ids.riya });
    const row = (await t1.day(m.id)).rows.find((r) => r.slotId === w.slotId)!;
    expect(row).toMatchObject({ walkIn: true, visit: "came", studentName: "Riya Sharma" });
    await expect(t1.walkIn(m.id, { studentId: ids.riya })).rejects.toBeInstanceOf(ConflictError);
    // Meera is in section B: not invited and not T1's child
    await expect(t1.walkIn(m.id, { studentId: ids.meera })).rejects.toThrow(/not on this meeting's list/);
    expect((await t1.walkInChoices(m.id)).map((k) => k.name)).not.toContain("Meera Iyer");
    await expect(new (at(atIst(istDay(new Date(Date.now() + 40 * IST_DAY)), "11:00")))(a.as.teacher).walkIn(m.id, { studentId: ids.kabir })).rejects.toThrow(/no meeting time/);
  });

  it("a teacher with several days gets one day's list at a time, today first, and can pick another", async () => {
    const m = await draft({ title: "Two days" });
    const first = DAY, second = istDay(new Date(Date.now() + nextDay++ * IST_DAY));
    await admin().addWindows(m.id, win([ids.t1]));
    await admin().addWindows(m.id, win([ids.t1], { day: second, place: "Room 9" }));
    await admin().open(m.id);
    const one = await freeOf(m.id, ids.t1);
    await new BookingService(a.as.student).book(m.id, { slotId: one[0]!.id });
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: one.find((x) => istDay(x.startsAt) === second)!.id });
    const t1 = new DayService(a.as.teacher);
    const v = await t1.day(m.id);
    expect(v).toMatchObject({ date: first, dates: [first, second], place: "Room 5" });
    expect(v.rows.map((r) => r.studentName)).toEqual(["Aarav Sharma"]);
    const v2 = await t1.day(m.id, undefined, second);
    expect(v2).toMatchObject({ date: second, place: "Room 9" });
    expect(v2.rows.map((r) => r.studentName)).toEqual(["Kabir Singh"]);
    const onFirst = new (at(atIst(first, "09:00")))(a.as.teacher);
    expect((await onFirst.day(m.id))).toMatchObject({ date: first, isToday: true });
    expect((await onFirst.day(m.id, undefined, second)).nextSlotId).toBeNull();
    await expect(onFirst.mark(v2.rows[0]!.slotId, { visit: "came" })).rejects.toThrow(/Opens on/);
    await onFirst.mark(v.rows[0]!.slotId, { visit: "came" }); // the slot's own day, before its time: allowed
  });

  it("the family page never claims every teacher when some teachers have no time in the meeting", async () => {
    const m = await openMeeting({ title: "Only T1" }, [ids.t1]);
    const s = await freeOf(m.id, ids.t1);
    await new BookingService(a.as.student).book(m.id, { slotId: s[0]!.id });
    const kid = (await new BookingService(a.as.student).forFamily(m.id)).kids[0]!;
    expect(kid.teachers.every((t) => t.booked)).toBe(true);
    expect(kid.notInMeeting).toEqual(["Teacher T2"]);
  });

  it("the not-came list and csv, and the printed sheets", async () => {
    const { m, s } = await running();
    const live = new (at(atIst(DAY, "10:25")))(a.as.teacher);
    await live.mark(s[2]!.id, { visit: "missed" });
    const list = await new (at(atIst(DAY, "13:00")))(a.as.admin).notCame(m.id);
    expect(list.map((r) => [r.studentName, r.status]).sort()).toEqual([["Aarav Sharma", "Not marked"], ["Kabir Singh", "Did not come"]]);
    expect((await new (at(atIst(DAY, "13:00")))(ids.ctx.t2).notCame(m.id))).toHaveLength(0);
    const csv = await new (at(atIst(DAY, "13:00")))(a.as.admin).notCameCsv(m.id);
    expect(csv.csv.split("\r\n")[0]).toBe("Child,Class,Phone,Teacher,Time,Status");
    expect(csv.csv).toContain("Kabir Singh");
    const sheet = await new DayService(a.as.teacher).teacherSheetPdf(m.id);
    expect(Buffer.from(sheet.bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(Buffer.from((await admin2().roomSheetPdf(m.id)).bytes.slice(0, 4)).toString()).toBe("%PDF");
    await expect(new DayService(a.as.teacher).roomSheetPdf(m.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
  const admin2 = () => new DayService(a.as.admin);
});

describe("jobs", () => {
  it("reminds the day before from 17:00 and one hour before, each once", async () => {
    const m = await openMeeting({ title: "Reminders", perFamily: "3" });
    const s = await freeOf(m.id, ids.t1);
    await new BookingService(a.as.student).book(m.id, { slotId: s[0]!.id }); // 10:00
    const count = async () => (await noteCount(a.users.student, "meeting.reminder")).filter((n) => n.subjectId === m.id);
    const eve = (h: string) => atIst(istDay(new Date(atIst(DAY, "10:00").getTime() - IST_DAY)), h);
    expect(await new MeetingSchedule(a.as.admin, eve("16:30")).reminders()).toBe(0);
    expect(await new MeetingSchedule(a.as.admin, eve("17:15")).reminders()).toBe(1);
    expect(await new MeetingSchedule(a.as.admin, eve("17:30")).reminders()).toBe(0);
    expect(await count()).toHaveLength(1);
    expect((await noteCount(a.users.teacher, "meeting.reminder")).filter((n) => n.subjectId === m.id)).toHaveLength(1);
    expect(await new MeetingSchedule(a.as.admin, atIst(DAY, "09:15")).reminders()).toBe(1);
    expect(await new MeetingSchedule(a.as.admin, atIst(DAY, "09:30")).reminders()).toBe(0);
    expect(await count()).toHaveLength(2);
  });

  it("gives back the time of a child who left", async () => {
    const m = await openMeeting({ title: "Leaver" });
    const s = (await freeOf(m.id, ids.t1))[3]!;
    await new BookingService(ids.ctx.kabir).book(m.id, { slotId: s.id });
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left" }).where(eq(students.id, ids.kabir)));
    expect(await new MeetingSchedule(a.as.admin, hours(1)).tidy()).toBeGreaterThanOrEqual(1);
    expect((await freeOf(m.id, ids.t1)).map((x) => x.id)).toContain(s.id);
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "active" }).where(eq(students.id, ids.kabir)));
  });

  it("closes booking at its closing time and finishes the meeting after its last time", async () => {
    const m = await openMeeting({ title: "Tidy" });
    expect(await new MeetingSchedule(a.as.admin, hours(1)).tidy()).toBe(0);
    await new MeetingSchedule(a.as.admin, hours(49)).tidy();
    expect((await admin().get(m.id)).meeting.state).toBe("closed");
    await new MeetingSchedule(a.as.admin, atIst(DAY, "12:30")).tidy();
    expect((await admin().get(m.id)).meeting.state).toBe("done");
    await expect(admin().cancel(m.id, { reason: "late" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Add to calendar (slotForCalendar)", () => {
  it("shows a booked time to its family, its teacher and a manager, and to nobody else", async () => {
    const m = await openMeeting();
    const slot = (await freeOf(m.id, ids.t1))[0]!.id;
    await new BookingService(a.as.student).book(m.id, { slotId: slot });
    const get = (ctx: Ctx) => new BookingService(ctx).slotForCalendar(slot);
    for (const ctx of [a.as.student, a.as.teacher, a.as.admin]) expect(await get(ctx)).toMatchObject({ id: slot, teacher: expect.any(String), student: "Aarav Sharma" });
    for (const ctx of [ids.ctx.riya, ids.ctx.t2, b.as.admin]) await expect(get(ctx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(get(a.as.student).then(() => new BookingService(a.as.student).slotForCalendar("not-a-slot"))).rejects.toBeInstanceOf(NotFoundError);
  });
});
