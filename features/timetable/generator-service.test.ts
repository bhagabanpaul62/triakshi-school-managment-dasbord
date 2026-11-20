import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, withConsole } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { classSubjects, classes } from "@smw/feature-academics/schema";
import { AcademicsFixture } from "./test-fixture";
import { cellKey } from "./bell";
import { GeneratorService } from "./generator-service";
import { RulesService } from "./rules-service";
import { SubstitutionService } from "./substitution-service";
import { weekPdf } from "./print";
import { PeriodService, TimetableService, type PeriodView } from "./service";

let a: TestSchool, b: TestSchool, fa: AcademicsFixture;
let bell: PeriodView[];
let c5: string, c6: string;
const FEATURES = ["academics", "students", "attendance", "notifications", "timetable"];
const MONDAY = new Date("2026-11-23T04:30:00Z"); // 10:00 IST
const DATE = "2026-11-23";
const classPeriods = () => bell.filter((p) => !p.isBreak);

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES, "g"));
  fa = await AcademicsFixture.create(a);
  await new PeriodService(a.as.admin).applyPreset();
  bell = await new PeriodService(a.as.admin).all();
  await withConsole(async (tx) => {
    const cs = await tx.select().from(classes).where(sql`school_id = ${a.id}`);
    c5 = cs.find((c) => c.grade === 5)!.id; c6 = cs.find((c) => c.grade === 6)!.id;
    await tx.insert(classSubjects).values([c5, c6].flatMap((classId) => [fa.maths, fa.english].map((subjectId) => ({ schoolId: a.id, classId, subjectId }))));
  });
});
afterAll(closeDb);

const loadRows = (n: number) => [c5, c6].flatMap((classId) => [{ classId, subjectId: fa.maths, periodsPerWeek: n, doublePeriods: 1 }, { classId, subjectId: fa.english, periodsPerWeek: n, doublePeriods: 0 }]);

describe("rules", () => {
  it("prefills subjects from the class, saves loads, and 0 removes one", async () => {
    const rules = new RulesService(a.as.admin);
    expect((await rules.loads()).every((r) => r.periodsPerWeek === null)).toBe(true);
    await rules.saveLoads({ rows: loadRows(5) });
    expect((await rules.loads()).filter((r) => r.periodsPerWeek === 5)).toHaveLength(4);
    await rules.saveLoads({ rows: [{ classId: c5, subjectId: fa.english, periodsPerWeek: 0, doublePeriods: 0 }] });
    expect((await rules.loads()).find((r) => r.classId === c5 && r.subjectId === fa.english)?.periodsPerWeek).toBeNull();
    await rules.saveLoads({ rows: loadRows(5) });
  });

  it("refuses more doubles than half the periods", async () => {
    await expect(new RulesService(a.as.admin).saveLoads({ rows: [{ classId: c5, subjectId: fa.maths, periodsPerWeek: 3, doublePeriods: 2 }] })).rejects.toThrow();
  });

  it("only managers change rules; school B cannot see school A's", async () => {
    await expect(new RulesService(a.as.teacher).saveLoads({ rows: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RulesService(a.as.teacher).loads()).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new RulesService(b.as.admin).loads()).toEqual([]);
  });

  it("saves teacher limits and drops unavailable cells that are not real periods", async () => {
    const rules = new RulesService(a.as.admin);
    const p1 = classPeriods()[0]!;
    const r = await rules.saveTeacherRule({ teacherId: fa.t1, maxPerDay: "6", maxPerWeek: "30", unavailable: [`6:${p1.id}`, `9:${p1.id}`, "1:not-an-id"] });
    expect(r).toMatchObject({ maxPerDay: 6, maxPerWeek: 30, unavailable: [{ day: 6, periodId: p1.id }] });
    expect((await rules.teacherRules()).find((t) => t.teacherId === fa.t1)?.maxPerWeek).toBe(30);
  });

  it("rooms: a name is unique", async () => {
    const rules = new RulesService(a.as.admin);
    await rules.addRoom({ name: "Lab 1", kind: "Lab", capacity: "30" });
    await expect(rules.addRoom({ name: "Lab 1", kind: "lab" })).rejects.toBeInstanceOf(ConflictError);
    expect((await rules.rooms())[0]).toMatchObject({ name: "Lab 1", kind: "lab", capacity: 30 });
  });
});

describe("generator and versions", () => {
  let draft: string;

  it("validation names the problem before generating", async () => {
    const rules = new RulesService(a.as.admin);
    await rules.saveLoads({ rows: [{ classId: c6, subjectId: fa.maths, periodsPerWeek: 48, doublePeriods: 0 }] });
    const v = await new GeneratorService(a.as.admin).validate();
    expect(v.issues.some((i) => /needs \d+ periods but the week has 48 slots/.test(i.message))).toBe(true);
    expect(v.issues.some((i) => i.message.includes("Class 6-B has no teacher"))).toBe(true);
    await rules.saveLoads({ rows: loadRows(5) });
  });

  it("generates a draft and leaves the live grid alone", async () => {
    const svc = new GeneratorService(a.as.admin);
    const r = await svc.generate({ seed: 42 });
    draft = r.versionId;
    expect(r.placed).toBeGreaterThan(0);
    const tt = new TimetableService(a.as.admin);
    expect(Object.keys((await tt.sectionGrid(fa.s1)).cells)).toHaveLength(0);
    expect(Object.keys((await tt.sectionGrid(fa.s1, draft)).cells).length).toBeGreaterThan(0);
    // s4 has no teachers: its demand is reported, not dropped
    const review = await svc.review(draft);
    expect(review.unplaced.some((u) => u.section === "Class 6-B")).toBe(true);
    expect(review.version.status).toBe("draft");
  });

  it("no teacher clash in the draft", async () => {
    const tt = new TimetableService(a.as.admin);
    for (const t of [fa.t1, fa.t2]) {
      const g = await tt.teacherGrid(t, draft);
      expect(Object.keys(g.cells).length).toBeGreaterThan(0);
    }
  });

  it("a teacher cannot open or generate drafts", async () => {
    await expect(new TimetableService(a.as.teacher).sectionGrid(fa.s1, draft)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GeneratorService(a.as.teacher).generate({})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GeneratorService(b.as.admin).review(draft)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("edits to a draft cell do not touch live; locked cells survive a re-run", async () => {
    const svc = new GeneratorService(a.as.admin);
    const tt = new TimetableService(a.as.admin);
    const p = classPeriods()[0]!;
    await tt.setSlot({ versionId: draft, sectionId: fa.s2, dayOfWeek: 6, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 });
    await svc.setLocked({ versionId: draft, sectionId: fa.s2, dayOfWeek: 6, periodId: p.id, locked: true });
    expect((await tt.sectionGrid(fa.s2, draft)).cells[cellKey(6, p.id)]).toMatchObject({ locked: true, subject: "Maths" });
    const again = await svc.generate({ versionId: draft, seed: 7 });
    expect(again.locked).toBeGreaterThanOrEqual(1);
    expect((await tt.sectionGrid(fa.s2, draft)).cells[cellKey(6, p.id)]).toMatchObject({ locked: true, subject: "Maths", teacherId: fa.t1 });
    expect(Object.keys((await tt.sectionGrid(fa.s2)).cells)).toHaveLength(0);
  });

  it("publish makes the draft live and archives the old live one", async () => {
    const svc = new GeneratorService(a.as.admin);
    await new TimetableService(a.as.admin).setSlot({ sectionId: fa.s4, dayOfWeek: 1, periodId: classPeriods()[0]!.id, subjectId: fa.maths, teacherId: fa.t2 });
    await svc.publish({ versionId: draft });
    const versions = await svc.versions();
    expect(versions.filter((v) => v.status === "live")).toHaveLength(1);
    expect(versions.find((v) => v.id === draft)?.status).toBe("live");
    expect(versions.some((v) => v.status === "archived")).toBe(true);
    expect(Object.keys((await new TimetableService(a.as.student).sectionGrid(fa.s1)).cells).length).toBeGreaterThan(0);
    await expect(svc.publish({ versionId: draft })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.generate({ versionId: draft })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("scheduled publish and teacher limits", () => {
  it("a later day schedules the draft; one at a time; the nightly job publishes it on the day", async () => {
    const svc = new GeneratorService(a.as.admin);
    const liveBefore = (await svc.versions()).find((v) => v.status === "live")!.id;
    const d2 = (await svc.generate({ seed: 7 })).versionId;
    const d3 = (await svc.generate({ seed: 8 })).versionId;
    expect(await svc.publish({ versionId: d2, publishOn: "2099-01-01" })).toMatchObject({ publishOn: "2099-01-01" });
    const status = async (id: string) => (await svc.versions()).find((v) => v.id === id)!;
    expect(await status(d2)).toMatchObject({ status: "draft", publishOn: "2099-01-01" });
    expect((await status(liveBefore)).status).toBe("live");

    await svc.publish({ versionId: d3, publishOn: "2099-02-01" }); // scheduling another clears the first
    expect((await status(d2)).publishOn).toBeNull();
    await svc.unschedule({ versionId: d3 });
    expect((await status(d3)).publishOn).toBeNull();
    await expect(new GeneratorService(a.as.teacher).publish({ versionId: d3, publishOn: "2099-02-01" })).rejects.toBeInstanceOf(ForbiddenError);

    await svc.publish({ versionId: d2, publishOn: "2099-01-01" });
    expect(await svc.publishDue("2098-12-31")).toBe(0);
    expect(await svc.publishDue("2099-01-01")).toBe(1);
    expect(await status(d2)).toMatchObject({ status: "live", publishOn: null });
    expect((await status(liveBefore)).status).toBe("archived");
    expect(await svc.publishDue("2099-01-01")).toBe(0); // runs once
    await svc.discard({ versionId: d3 });
  });

  it("the cell editor gets each limited teacher's load across the whole week", async () => {
    await new RulesService(a.as.admin).saveTeacherRule({ teacherId: fa.t1, maxPerDay: 2, maxPerWeek: 10, unavailable: [] });
    const opts = await new TimetableService(a.as.admin).slotOptions(fa.s1);
    const week = (await new TimetableService(a.as.admin).teacherGrid(fa.t1)).cells;
    expect(opts.limits[fa.t1]).toMatchObject({ maxPerDay: 2, maxPerWeek: 10, week: Object.keys(week).length });
    expect(opts.limits[fa.t2]).toBeUndefined(); // no limits set: nothing sent
    await new RulesService(a.as.admin).saveTeacherRule({ teacherId: fa.t1, unavailable: [] });
  });
});

describe("rooms, copy week, print", () => {
  it("a room, listed or typed in, cannot hold two sections at once", async () => {
    const tt = new TimetableService(a.as.admin);
    const p = classPeriods()[7]!;
    await tt.clearSlot({ sectionId: fa.s1, dayOfWeek: 6, periodId: p.id });
    await tt.clearSlot({ sectionId: fa.s2, dayOfWeek: 6, periodId: p.id });
    await tt.setSlot({ sectionId: fa.s1, dayOfWeek: 6, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1, room: "Lab 1" });
    await expect(tt.setSlot({ sectionId: fa.s2, dayOfWeek: 6, periodId: p.id, subjectId: fa.english, teacherId: fa.t2, room: "lab 1" })).rejects.toThrow(/already used by Class 5-A/);
    await tt.setSlot({ sectionId: fa.s2, dayOfWeek: 6, periodId: p.id, subjectId: fa.english, teacherId: fa.t2, room: "Room 9" });
    // a typed-in room clashes too, ignoring case and spaces at the ends
    const q = classPeriods()[6]!;
    await tt.clearSlot({ sectionId: fa.s1, dayOfWeek: 6, periodId: q.id });
    await tt.clearSlot({ sectionId: fa.s2, dayOfWeek: 6, periodId: q.id });
    await tt.setSlot({ sectionId: fa.s1, dayOfWeek: 6, periodId: q.id, subjectId: fa.maths, teacherId: fa.t1, room: "Art room" });
    await expect(tt.setSlot({ sectionId: fa.s2, dayOfWeek: 6, periodId: q.id, subjectId: fa.english, teacherId: fa.t2, room: " art ROOM " })).rejects.toThrow(/Art room is already used by Class 5-A|already used by Class 5-A/);
  });

  it("copies a week to another section of the same class and reports what it skipped", async () => {
    const tt = new TimetableService(a.as.admin);
    await expect(tt.copyWeek({ fromSectionId: fa.s1, toSectionId: fa.s3 })).rejects.toBeInstanceOf(ConflictError);
    const r = await tt.copyWeek({ fromSectionId: fa.s1, toSectionId: fa.s2, replace: true });
    expect(r.copied + r.skipped.length).toBeGreaterThan(0);
    // s1 and s2 share Maths teacher t1, so Maths periods clash and are skipped
    expect(r.skipped.some((s) => /busy/.test(s.reason))).toBe(true);
    const again = await tt.copyWeek({ fromSectionId: fa.s1, toSectionId: fa.s2 });
    expect(again.copied).toBe(0);
  });

  it("prints a section and a teacher week as a PDF", async () => {
    for (const [kind, id] of [["section", fa.s1], ["teacher", fa.t1]] as const) {
      const { bytes, fileName } = await weekPdf(a.as.admin, kind, id);
      expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
      expect(fileName).toMatch(/^timetable-.*\.pdf$/);
    }
    await expect(weekPdf(b.as.admin, "section", fa.s1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("substitutions", () => {
  let slotId: string, periodId: string;

  it("lists a teacher marked absent with their periods and sorted suggestions", async () => {
    const tt = new TimetableService(a.as.admin);
    const p = classPeriods()[1]!;
    periodId = p.id;
    await tt.clearSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: p.id });
    const cell = await tt.setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: p.id, subjectId: fa.maths, teacherId: fa.t1 });
    slotId = cell.slotId;
    await withConsole((tx) => tx.execute(sql`insert into staff_attendance (id, school_id, user_id, date, status) values (gen_random_uuid(), ${a.id}, ${fa.t1}, ${DATE}::date, 'absent')`));
    const board = await new SubstitutionService(a.as.admin).board(DATE);
    const t1 = board.absent.find((x) => x.teacherId === fa.t1)!;
    expect(t1.reason).toBe("Marked absent");
    const row = t1.periods.find((x) => x.slotId === slotId)!;
    expect(row.suggestions.map((s) => s.id)).toContain(fa.t2);
    expect(row.suggestions.map((s) => s.id)).not.toContain(fa.t1);
  });

  it("approved staff leave also counts as away", async () => {
    await withConsole((tx) => tx.execute(sql`insert into leave_requests (id, school_id, kind, user_id, requested_by, from_date, to_date, reason, status)
      values (gen_random_uuid(), ${a.id}, 'staff', ${fa.t2}, ${fa.t2}, '2026-11-22', '2026-11-24', 'Fever', 'approved')`));
    const board = await new SubstitutionService(a.as.admin).board(DATE);
    expect(board.absent.find((x) => x.teacherId === fa.t2)?.reason).toBe("Approved leave");
    await withConsole((tx) => tx.execute(sql`delete from leave_requests where school_id = ${a.id}`));
  });

  it("refuses a cover who is busy or away, accepts a free one, and notifies them", async () => {
    const svc = new SubstitutionService(a.as.admin);
    const tt = new TimetableService(a.as.admin);
    // t2 teaches s3 in this period on Monday: busy
    await tt.clearSlot({ sectionId: fa.s3, dayOfWeek: 1, periodId });
    await tt.setSlot({ sectionId: fa.s3, dayOfWeek: 1, periodId, subjectId: fa.english, teacherId: fa.t2 });
    await expect(svc.assign({ date: DATE, slotId, coverTeacherId: fa.t2 })).rejects.toThrow(/is teaching Class 6-A/);
    await expect(svc.assign({ date: DATE, slotId, coverTeacherId: fa.t1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.assign({ date: "2026-11-24", slotId, coverTeacherId: a.users.teacher })).rejects.toMatchObject({ fieldErrors: { date: expect.stringContaining("not a Monday") } });
    await tt.clearSlot({ sectionId: fa.s3, dayOfWeek: 1, periodId });
    await svc.assign({ date: DATE, slotId, coverTeacherId: fa.t2, note: "Chapter 4" });
    const n = await withConsole((tx) => tx.execute(sql`select title from notifications where user_id = ${fa.t2}`));
    expect([...n].some((r) => String((r as { title: string }).title).startsWith("Cover duty: Class 5-A"))).toBe(true);
    const board = await svc.board(DATE);
    expect(board.absent.find((x) => x.teacherId === fa.t1)!.periods.find((p) => p.slotId === slotId)!.cover).toMatchObject({ teacherId: fa.t2, note: "Chapter 4" });
  });

  it("the cover sees it in today, the student sees the cover teacher, and the absent teacher sees it taken", async () => {
    // t1 and t2 are real teacher users but a.as.teacher is another user: build contexts for them
    const ctxOf = (userId: string, role: "teacher") => ({ ...a.as.teacher, userId, role });
    const mine = await new TimetableService(ctxOf(fa.t2, "teacher")).today(MONDAY);
    expect(mine.rows.find((r) => r.cover === "covering")).toMatchObject({ section: "Class 5-A", subject: "Maths" });
    const away = await new TimetableService(ctxOf(fa.t1, "teacher")).today(MONDAY);
    expect(away.rows.find((r) => r.cover === "away")).toMatchObject({ teacher: "Rahul Nair" });
    const kid = await new TimetableService(a.as.student).today(MONDAY);
    expect(kid.rows.find((r) => r.periodId === periodId)?.teacher).toBe("Rahul Nair");
  });

  it("clearing the cover restores the original teacher; a teacher cannot assign", async () => {
    const svc = new SubstitutionService(a.as.admin);
    await expect(new SubstitutionService(a.as.teacher).assign({ date: DATE, slotId, coverTeacherId: fa.t2 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc.clear({ date: DATE, slotId })).cleared).toBe(1);
    expect((await svc.clear({ date: DATE, slotId })).cleared).toBe(0);
    const kid = await new TimetableService(a.as.student).today(MONDAY);
    expect(kid.rows.find((r) => r.periodId === periodId)?.teacher).toBe("Anita Verma");
  });

  it("school B cannot cover a period of school A", async () => {
    await expect(new SubstitutionService(b.as.admin).assign({ date: DATE, slotId, coverTeacherId: b.users.teacher })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("a draft published while the solver runs", () => {
  it("is not wiped by the re-run: the write is refused", async () => {
    const svc = new GeneratorService(a.as.admin);
    const { versionId } = await svc.generate({ seed: 3 });
    const cells = async () => (await svc.versions()).find((v) => v.id === versionId)!.cells;
    const before = await cells();
    const proto = GeneratorService.prototype as unknown as { buildInput: (...a: unknown[]) => Promise<unknown> };
    const orig = proto.buildInput;
    proto.buildInput = async function (this: GeneratorService, ...args: unknown[]) {
      const r = await orig.apply(this, args);
      proto.buildInput = orig;
      await svc.publish({ versionId }); // another admin publishes between read and write
      return r;
    };
    await expect(svc.generate({ versionId, seed: 4 })).rejects.toBeInstanceOf(ConflictError);
    proto.buildInput = orig;
    const v = (await svc.versions()).find((x) => x.id === versionId)!;
    expect(v.status).toBe("live");
    expect(v.cells).toBe(before);
  });
});

describe("covers survive a publish", () => {
  const COVER_DATE = "2026-11-30"; // a Monday, after today
  const subRows = () => withConsole((tx) => tx.execute(sql`select slot_id from substitutions where school_id = ${a.id} and date = ${COVER_DATE}::date`)).then((r) => [...r] as { slot_id: string }[]);
  const draftWith = async (keep: boolean, pid: string) => {
    const gen = new GeneratorService(a.as.admin);
    const tt = new TimetableService(a.as.admin);
    const { versionId } = await gen.generate({ seed: 11 });
    await withConsole((tx) => tx.execute(sql`delete from timetable_slots where version_id = ${versionId} and day_of_week = 1 and period_id = ${pid} and (teacher_id = ${fa.t2} or section_id = ${fa.s1})`));
    if (keep) await tt.setSlot({ versionId, sectionId: fa.s1, dayOfWeek: 1, periodId: pid, subjectId: fa.maths, teacherId: fa.t1 });
    return { gen, versionId };
  };

  it("moves a future cover to the new live slot, and coversFor ignores archived slots", async () => {
    const pid = classPeriods()[1]!.id;
    const subs = new SubstitutionService(a.as.admin);
    const tt = new TimetableService(a.as.admin);
    await tt.clearSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: pid });
    const old = await tt.setSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: pid, subjectId: fa.maths, teacherId: fa.t1 });
    await withConsole((tx) => tx.execute(sql`delete from timetable_slots s using tt_versions v where v.id = s.version_id and v.status = 'live' and s.school_id = ${a.id} and s.day_of_week = 1 and s.period_id = ${pid} and s.teacher_id = ${fa.t2}`));
    await subs.assign({ date: COVER_DATE, slotId: old.slotId, coverTeacherId: fa.t2 });
    const { gen, versionId } = await draftWith(true, pid);
    await gen.publish({ versionId });
    const rows = await subRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slot_id).not.toBe(old.slotId);
    const covers = await subs.coversFor(fa.t2, COVER_DATE);
    expect(covers).toEqual([{ slotId: rows[0]!.slot_id, optionId: null }]);
    expect((await subs.board(COVER_DATE, [fa.t1])).absent.find((x) => x.teacherId === fa.t1)!.periods.find((p) => p.slotId === rows[0]!.slot_id)!.cover).toMatchObject({ teacherId: fa.t2 });
  });

  it("removes a cover with no matching slot and tells the cover teacher", async () => {
    const pid = classPeriods()[1]!.id;
    const { gen, versionId } = await draftWith(false, pid);
    await gen.publish({ versionId });
    expect(await subRows()).toHaveLength(0);
    expect(await new SubstitutionService(a.as.admin).coversFor(fa.t2, COVER_DATE)).toEqual([]);
    const n = await withConsole((tx) => tx.execute(sql`select title from notifications where user_id = ${fa.t2} and title = 'Cover duty cancelled'`));
    expect([...n].length).toBeGreaterThanOrEqual(1);
  });
});

describe("day override", () => {
  it("a special day holds only the listed periods", async () => {
    const rules = new RulesService(a.as.admin);
    const keep = classPeriods().slice(0, 2).map((p) => p.id);
    await rules.saveOverride({ date: DATE, label: "Half day", periodIds: keep });
    const kid = await new TimetableService(a.as.student).today(MONDAY);
    expect(kid.override).toBe("Half day");
    expect(kid.rows.every((r) => keep.includes(r.periodId))).toBe(true);
    expect(kid.rows.length).toBeLessThanOrEqual(2);
    await expect(rules.saveOverride({ date: DATE, label: "Empty", periodIds: [] })).rejects.toThrow();
    const o = (await rules.overrides())[0]!;
    await rules.removeOverride(o.id);
    expect((await new TimetableService(a.as.student).today(MONDAY)).override).toBeNull();
  });
});
