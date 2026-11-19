import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { AcademicsFixture } from "./test-fixture";
import { presetPeriods, schoolDay } from "./bell";
import { PeriodService, TimetableService, cellKey, type PeriodView } from "./service";

let a: TestSchool, b: TestSchool, fa: AcademicsFixture;
let bell: PeriodView[];
const FEATURES = ["academics", "students", "timetable"];

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES));
  fa = await AcademicsFixture.create(a);
  await new PeriodService(a.as.admin).applyPreset();
  bell = await new PeriodService(a.as.admin).all();
});
afterAll(closeDb);

const classPeriods = () => bell.filter((p) => !p.isBreak);

describe("bell schedule", () => {
  it("the preset is 8 periods of 40 minutes from 8:00 with a 20-minute break after period 4", () => {
    const p = presetPeriods();
    expect(p).toHaveLength(9);
    expect(p[0]).toMatchObject({ name: "Period 1", startsAt: "08:00", endsAt: "08:40" });
    expect(p[4]).toMatchObject({ name: "Break", startsAt: "10:40", endsAt: "11:00", isBreak: true });
    expect(p[8]).toMatchObject({ name: "Period 8", startsAt: "13:00", endsAt: "13:40" });
  });

  it("applying the preset twice is refused", async () => {
    expect(bell).toHaveLength(9);
    await expect(new PeriodService(a.as.admin).applyPreset()).rejects.toBeInstanceOf(ConflictError);
  });

  it("overlapping periods are refused, back-to-back are fine", async () => {
    const svc = new PeriodService(a.as.admin);
    await expect(svc.create({ name: "Extra", startsAt: "08:30", endsAt: "09:00", sortOrder: 20 })).rejects.toThrow(/Overlaps Period 1/);
    const late = await svc.create({ name: "Zero hour", startsAt: "13:40", endsAt: "14:00", sortOrder: 20 });
    expect(late.startsAt).toBe("13:40");
    await expect(svc.update(late.id, { name: "Zero hour", startsAt: "13:30", endsAt: "14:00", sortOrder: 20 })).rejects.toBeInstanceOf(ConflictError);
    await svc.remove(late.id);
  });

  it("a period must end after it starts", async () => {
    await expect(new PeriodService(a.as.admin).create({ name: "Bad", startsAt: "15:00", endsAt: "14:00", sortOrder: 21 }))
      .rejects.toMatchObject({ fieldErrors: { endsAt: expect.any(String) } });
  });

  it("everyone reads the schedule, only the admin changes it", async () => {
    expect(await new PeriodService(a.as.student).all()).toHaveLength(9);
    await expect(new PeriodService(a.as.teacher).create({ name: "X", startsAt: "15:00", endsAt: "15:40", sortOrder: 22 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PeriodService(a.as.parent).applyPreset()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("TimetableService", () => {
  it("sets a slot and reads it back in the section grid", async () => {
    const svc = new TimetableService(a.as.admin);
    const p = classPeriods()[0]!;
    await svc.setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1, room: "Room 5" });
    const grid = await svc.sectionGrid(fa.s1);
    expect(grid.periods).toHaveLength(9);
    expect(grid.cells[cellKey(1, p.id)]).toMatchObject({ subject: "Maths", teacherId: fa.t1, room: "Room 5" });
  });

  it("replacing a cell updates it instead of duplicating", async () => {
    const svc = new TimetableService(a.as.admin);
    const p = classPeriods()[1]!;
    await svc.setSlot({ sectionId: fa.s1, dayOfWeek: 2, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 });
    await svc.setSlot({ sectionId: fa.s1, dayOfWeek: 2, periodId: p.id, subjectId: fa.english, teacherId: fa.t2 });
    const grid = await svc.sectionGrid(fa.s1);
    expect(grid.cells[cellKey(2, p.id)]).toMatchObject({ subject: "English", teacherId: fa.t2 });
    expect(Object.keys(grid.cells).filter((k) => k === cellKey(2, p.id))).toHaveLength(1);
  });

  it("clash: the same teacher in two sections at the same time names the other section", async () => {
    const svc = new TimetableService(a.as.admin);
    const p = classPeriods()[2]!;
    await svc.setSlot({ sectionId: fa.s1, dayOfWeek: 3, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 });
    const err = await svc.setSlot({ sectionId: fa.s2, dayOfWeek: 3, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain("Class 5-A");
    expect(err.message).toContain("Wednesday");
    // another period is fine
    await svc.setSlot({ sectionId: fa.s2, dayOfWeek: 3, periodId: classPeriods()[3]!.id, subjectId: fa.maths, teacherId: fa.t1 });
  });

  it("re-saving the same cell with the same teacher is not a clash", async () => {
    const svc = new TimetableService(a.as.admin);
    const p = classPeriods()[4]!;
    const args = { sectionId: fa.s1, dayOfWeek: 4, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 };
    await svc.setSlot(args);
    await expect(svc.setSlot({ ...args, room: "Lab" })).resolves.toMatchObject({ room: "Lab" });
  });

  it("a break cannot hold a class", async () => {
    const brk = bell.find((p) => p.isBreak)!;
    await expect(new TimetableService(a.as.admin).setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: brk.id, subjectId: fa.maths, teacherId: fa.t1 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("the teacher must be a teacher of this school", async () => {
    await expect(new TimetableService(a.as.admin).setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: classPeriods()[5]!.id, subjectId: fa.maths, teacherId: a.users.student }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("clearSlot empties a cell and is safe to repeat", async () => {
    const svc = new TimetableService(a.as.admin);
    const p = classPeriods()[6]!;
    await svc.setSlot({ sectionId: fa.s1, dayOfWeek: 5, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 });
    expect(await svc.clearSlot({ sectionId: fa.s1, dayOfWeek: 5, periodId: p.id })).toMatchObject({ cleared: 1 });
    expect(await svc.clearSlot({ sectionId: fa.s1, dayOfWeek: 5, periodId: p.id })).toMatchObject({ cleared: 0 });
    expect((await svc.sectionGrid(fa.s1)).cells[cellKey(5, p.id)]).toBeUndefined();
  });

  it("teacherGrid shows the teacher's week with the section of each period", async () => {
    const grid = await new TimetableService(a.as.teacher).teacherGrid(fa.t1);
    const wed = grid.cells[cellKey(3, classPeriods()[2]!.id)];
    expect(wed).toMatchObject({ section: "Class 5-A", subject: "Maths" });
    expect(Object.values(grid.cells).every((c) => c.teacherId === fa.t1)).toBe(true);
  });

  it("autoFill fills only empty cells, keeps existing ones and never double-books a teacher", async () => {
    const svc = new TimetableService(a.as.admin);
    const before = await svc.sectionGrid(fa.s3);
    expect(Object.keys(before.cells)).toHaveLength(0);
    const first = await svc.autoFill(fa.s3);
    expect(first.filled).toBe(48); // 8 periods x 6 days, two teachers, no clash with each other
    const filled = await svc.sectionGrid(fa.s3);
    const again = await svc.autoFill(fa.s3);
    expect(again.filled).toBe(0);
    expect(await svc.sectionGrid(fa.s3)).toEqual(filled);
    // a teacher is in at most one place per cell: lessons counted per section add up to the teacher's own grid
    for (const t of [fa.t1, fa.t2]) {
      let lessons = 0;
      for (const s of [fa.s1, fa.s2, fa.s3]) lessons += Object.values((await svc.sectionGrid(s)).cells).filter((c) => c.teacherId === t).length;
      expect(Object.keys((await svc.teacherGrid(t)).cells)).toHaveLength(lessons);
    }
  });

  it("autoFill around a busy teacher leaves cells empty rather than clashing", async () => {
    const svc = new TimetableService(a.as.admin);
    const existing = Object.keys((await svc.sectionGrid(fa.s2)).cells).length;
    const r = await svc.autoFill(fa.s2); // s2 is taught only by t1, who is already busy in many cells of s1 and s3
    expect(r.empty).toBeGreaterThan(0);
    expect(existing + r.filled + r.empty).toBe(48);
    expect(Object.keys((await svc.sectionGrid(fa.s2)).cells)).toHaveLength(existing + r.filled);
  });

  it("autoFill needs subject teachers", async () => {
    await expect(new TimetableService(a.as.admin).autoFill(fa.s4)).rejects.toThrow(/Assign subject teachers/);
  });

  it("slotOptions lists the subjects with their teachers, the section's own teacher first", async () => {
    const o = await new TimetableService(a.as.admin).slotOptions(fa.s1);
    expect(o.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(["English", "Maths"]));
    expect(o.teachers[fa.maths]![0]!.id).toBe(fa.t1);
    expect(o.defaults[fa.maths]).toBe(fa.t1);
    expect(o.classId).toEqual(expect.any(String));
  });

  it("slotOptions marks teachers busy elsewhere, and teacherLoad counts periods", async () => {
    const svc = new TimetableService(a.as.admin);
    const grid = await svc.sectionGrid(fa.s3);
    const cell = Object.entries(grid.cells)[0]!; // a period of s3 taught by someone
    const [day, periodId] = cell[0].split(":");
    const other = await svc.slotOptions(fa.s1);
    expect(other.busy[`${day}:${periodId}`]?.[cell[1].teacherId!]).toBe(cell[1].section);
    const load = await svc.teacherLoad(fa.s3);
    const row = load.teachers.find((t) => t.id === cell[1].teacherId)!;
    expect(row.here).toBeGreaterThan(0);
    expect(row.total).toBeGreaterThanOrEqual(row.here);
    expect(load.max).toBeGreaterThan(0);
  });

  it("today: a teacher gets their classes, a student gets the section, Sunday is empty", async () => {
    const tue = new Date("2026-11-17T04:30:00Z"); // Tuesday 10:00 in India
    const sun = new Date("2026-11-22T04:30:00Z");
    expect(schoolDay(tue)).toBe(2);
    expect(schoolDay(sun)).toBeNull();
    const teacher = await new TimetableService(a.as.teacher).today(tue); // a.as.teacher is not t1: no classes
    expect(teacher.rows).toEqual([]);
    const asT1 = await new TimetableService({ ...a.as.teacher, userId: fa.t1 }).today(tue);
    expect(asT1.rows.length).toBeGreaterThan(0);
    expect(asT1.rows.every((r) => r.section !== null)).toBe(true);
    const student = await new TimetableService(a.as.student).today(tue);
    expect(student.rows.some((r) => r.isBreak)).toBe(true);
    expect(student.rows.some((r) => r.subject)).toBe(true);
    expect((await new TimetableService(a.as.student).today(sun)).rows).toEqual([]);
    expect((await new TimetableService(a.as.admin).today(tue)).rows).toEqual([]);
  });

  it("students and parents see only their own section and cannot browse teachers", async () => {
    const student = new TimetableService(a.as.student);
    expect((await student.sections()).map((s) => s.id)).toEqual([fa.s1]);
    await expect(student.sectionGrid(fa.s1)).resolves.toBeDefined();
    await expect(student.sectionGrid(fa.s2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(student.teacherGrid(fa.t1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(student.teachers()).rejects.toBeInstanceOf(ForbiddenError);
    const parent = new TimetableService(a.as.parent);
    expect((await parent.sections()).map((s) => s.id)).toEqual([fa.s1]);
    await expect(parent.sectionGrid(fa.s2)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only the admin edits: teacher, student and parent get ForbiddenError", async () => {
    const args = { sectionId: fa.s1, dayOfWeek: 6, periodId: classPeriods()[0]!.id, subjectId: fa.maths, teacherId: fa.t1 };
    for (const who of [a.as.teacher, a.as.student, a.as.parent, a.as.accountant]) {
      const svc = new TimetableService(who);
      await expect(svc.setSlot(args)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.clearSlot(args)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.autoFill(fa.s1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.slotOptions(fa.s1)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("isolation: school B cannot see or change school A's timetable", async () => {
    const fb = await AcademicsFixture.create(b);
    const bSvc = new TimetableService(b.as.admin);
    await new PeriodService(b.as.admin).applyPreset();
    const bBell = await new PeriodService(b.as.admin).all();
    const seenByB = (await new PeriodService(b.as.admin).list()).rows.map((r) => r.id);
    expect(seenByB.some((id) => bell.some((p) => p.id === id))).toBe(false);
    expect((await bSvc.sections()).map((s) => s.id).sort()).toEqual([fb.s1, fb.s2, fb.s3, fb.s4].sort());
    await expect(bSvc.sectionGrid(fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.teacherGrid(fa.t1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: bBell[0]!.id, subjectId: fb.maths, teacherId: fb.t1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.clearSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: classPeriods()[0]!.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.autoFill(fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.slotOptions(fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    expect((await bSvc.teachers()).map((t) => t.id)).not.toContain(fa.t1);
    const aPeriod = bell[0]!;
    await expect(new PeriodService(b.as.admin).get(aPeriod.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PeriodService(b.as.admin).update(aPeriod.id, { name: "Hacked", startsAt: "07:00", endsAt: "07:30", sortOrder: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PeriodService(b.as.admin).remove(aPeriod.id)).rejects.toBeInstanceOf(NotFoundError);
    // A's grid is untouched
    expect(Object.keys((await new TimetableService(a.as.admin).sectionGrid(fa.s1)).cells).length).toBeGreaterThan(0);
  });

  it("deleting a period removes its classes", async () => {
    const svc = new PeriodService(a.as.admin);
    const extra = await svc.create({ name: "Zero hour", startsAt: "07:00", endsAt: "07:40", sortOrder: 30 });
    await new TimetableService(a.as.admin).setSlot({ sectionId: fa.s1, dayOfWeek: 6, periodId: extra.id, subjectId: fa.maths, teacherId: fa.t1 });
    await svc.remove(extra.id);
    expect((await new TimetableService(a.as.admin).sectionGrid(fa.s1)).cells[cellKey(6, extra.id)]).toBeUndefined();
  });
});

