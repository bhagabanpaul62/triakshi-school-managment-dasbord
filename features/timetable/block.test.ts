import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, users, withConsole } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classSubjects, classes, sectionTeachers, subjectGroupSubjects, subjectGroups, subjects } from "@smw/feature-academics/schema";
import { AcademicsFixture } from "./test-fixture";
import { BlockService, type BlockView } from "./block-service";
import { GeneratorService } from "./generator-service";
import { RulesService } from "./rules-service";
import { SubstitutionService } from "./substitution-service";
import { weekPdf } from "./print";
import { PeriodService, TimetableService, cellKey, type PeriodView } from "./service";

let a: TestSchool, b: TestSchool, fa: AcademicsFixture;
let bell: PeriodView[];
let c5: string, hindi: string, sanskrit: string, t3: string, t4: string, kabir: string, riya: string;
let block: BlockView;
const FEATURES = ["academics", "students", "attendance", "notifications", "timetable"];
const MONDAY = new Date("2026-11-23T04:30:00Z");
const DATE = "2026-11-23";
const P = (n: number) => bell.filter((p) => !p.isBreak)[n]!;
const asTeacher = (id: string, name: string): Ctx => ({ ...a.as.teacher, userId: id, name });
const admin = () => new TimetableService(a.as.admin);

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES, "k"));
  fa = await AcademicsFixture.create(a);
  await new PeriodService(a.as.admin).applyPreset();
  bell = await new PeriodService(a.as.admin).all();
  await withConsole(async (tx) => {
    const cs = await tx.select().from(classes).where(sql`school_id = ${a.id}`);
    c5 = cs.find((c) => c.grade === 5)!.id;
    const [h, s] = await tx.insert(subjects).values([{ schoolId: a.id, name: "Hindi" }, { schoolId: a.id, name: "Sanskrit" }]).returning();
    hindi = h!.id; sanskrit = s!.id;
    const [x, y] = await tx.insert(users).values([
      { schoolId: a.id, role: "teacher", loginId: `t3-${a.slug}`, name: "Meera Joshi" }, { schoolId: a.id, role: "teacher", loginId: `t4-${a.slug}`, name: "Dev Shastri" },
    ]).returning();
    t3 = x!.id; t4 = y!.id;
    await tx.insert(classSubjects).values([
      { schoolId: a.id, classId: c5, subjectId: fa.maths }, { schoolId: a.id, classId: c5, subjectId: fa.english },
      { schoolId: a.id, classId: c5, subjectId: hindi, isElective: true }, { schoolId: a.id, classId: c5, subjectId: sanskrit, isElective: true },
    ]);
    const [g] = await tx.insert(subjectGroups).values({ schoolId: a.id, classId: c5, name: "Second language" }).returning();
    await tx.insert(subjectGroupSubjects).values([hindi, sanskrit].map((subjectId) => ({ schoolId: a.id, groupId: g!.id, subjectId })));
    const [year] = await tx.select().from(academicYears).where(sql`school_id = ${a.id}`);
    await tx.execute(sql`insert into students (id, school_id, admission_no, name, section_id) values (gen_random_uuid(), ${a.id}, 'T-2', 'Kabir Rao', ${fa.s2})`);
    const rows = [...(await tx.execute(sql`select id, name from students where school_id = ${a.id}`))] as { id: string; name: string }[];
    riya = rows.find((r) => r.name === "Riya Sharma")!.id; kabir = rows.find((r) => r.name === "Kabir Rao")!.id;
    await tx.execute(sql`insert into student_subjects (id, school_id, student_id, year_id, subject_id) values (gen_random_uuid(), ${a.id}, ${riya}, ${year!.id}, ${hindi}), (gen_random_uuid(), ${a.id}, ${kabir}, ${year!.id}, ${sanskrit})`);
  });
});
afterAll(closeDb);

describe("blocks: definition", () => {
  it("suggests a block from a subject group, and saves it with a teacher per subject", async () => {
    const svc = new BlockService(a.as.admin);
    const ideas = await svc.suggestions();
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ classId: c5, name: "Second language" });
    expect(ideas[0]!.options.map((o) => o.subject).sort()).toEqual(["Hindi", "Sanskrit"]);
    block = await svc.save({ classId: c5, name: "Second language", periodsPerWeek: 3, doubles: 0, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: sanskrit, teacherId: t4 }] });
    expect(block.options).toHaveLength(2);
    expect(await svc.suggestions()).toHaveLength(0);
  });

  it("refuses one teacher in two alternatives, a subject the class does not study, and a single subject", async () => {
    const svc = new BlockService(a.as.admin);
    const base = { classId: c5, name: "Bad", periodsPerWeek: 2, doubles: 0 };
    await expect(svc.save({ ...base, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: sanskrit, teacherId: t3 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ ...base, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: fa.maths, teacherId: t4 }, { subjectId: fa.english, teacherId: fa.t2 }].slice(0, 1) })).rejects.toBeInstanceOf(ValidationError);
    await withConsole((tx) => tx.insert(subjects).values({ schoolId: a.id, name: "French" }));
    const [french] = await withConsole((tx) => tx.select().from(subjects).where(sql`school_id = ${a.id} and name = 'French'`));
    await expect(svc.save({ ...base, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: french!.id, teacherId: t4 }] })).rejects.toMatchObject({ fieldErrors: { options: expect.stringMatching(/class studies/) } });
  });

  it("only the admin manages blocks", async () => {
    await expect(new BlockService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BlockService(a.as.teacher).remove(block.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin().setBlock({ sectionId: fa.s1, dayOfWeek: 1, periodId: P(0).id, blockId: block.id }).then(() => new TimetableService(a.as.teacher).setBlock({ sectionId: fa.s1, dayOfWeek: 2, periodId: P(0).id, blockId: block.id }))).rejects.toBeInstanceOf(ForbiddenError);
    await admin().clearSlot({ sectionId: fa.s1, dayOfWeek: 1, periodId: P(0).id });
  });

  it("school B sees none of it", async () => {
    expect(await new BlockService(b.as.admin).list()).toEqual([]);
    await expect(new BlockService(b.as.admin).remove(block.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new TimetableService(b.as.admin).setBlock({ sectionId: fa.s1, dayOfWeek: 1, periodId: P(0).id, blockId: block.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("blocks: placing and viewing", () => {
  const where = () => ({ dayOfWeek: 1, periodId: P(2).id });

  it("a block placed from one section fills every section of the class", async () => {
    const cell = await admin().setBlock({ sectionId: fa.s1, ...where(), blockId: block.id });
    expect(cell.subject).toBe("Second language: Hindi (Meera Joshi) / Sanskrit (Dev Shastri)");
    for (const s of [fa.s1, fa.s2]) {
      const c = (await admin().sectionGrid(s)).cells[cellKey(1, P(2).id)]!;
      expect(c).toMatchObject({ blockId: block.id, blockName: "Second language" });
      expect(c.options!.map((o) => o.subject)).toEqual(["Hindi", "Sanskrit"]);
    }
    expect((await admin().sectionGrid(fa.s3)).cells[cellKey(1, P(2).id)]).toBeUndefined(); // another class
  });

  it("a teacher sees only their option, a student only the subject they chose", async () => {
    const tg = await new TimetableService(asTeacher(t3, "Meera Joshi")).teacherGrid(t3);
    expect(tg.cells[cellKey(1, P(2).id)]).toMatchObject({ subject: "Hindi", teacher: "Meera Joshi", blockName: "Second language" });
    expect(tg.cells[cellKey(1, P(2).id)]!.options).toHaveLength(1);
    const t4g = await admin().teacherGrid(t4);
    expect(t4g.cells[cellKey(1, P(2).id)]!.subject).toBe("Sanskrit");
    const sg = await new TimetableService(a.as.student).sectionGrid(fa.s1);
    expect(sg.cells[cellKey(1, P(2).id)]).toMatchObject({ subject: "Hindi", teacher: "Meera Joshi" });
  });

  it("today() and the grid agree: the student gets their own subject, teachers their own option", async () => {
    const kid = await new TimetableService(a.as.student).today(MONDAY);
    const row = kid.rows.find((r) => r.periodId === P(2).id)!;
    expect(row).toMatchObject({ subject: "Hindi", teacher: "Meera Joshi", slotId: null });
    expect(row.blockSlotId).toBeTruthy();
    expect(row.optionId).toBe(block.options.find((o) => o.subjectId === hindi)!.id);
    const t = await new TimetableService(asTeacher(t4, "Dev Shastri")).today(MONDAY);
    expect(t.rows.filter((r) => r.subject).map((r) => r.subject)).toEqual(["Sanskrit"]);
  });

  it("an ordinary class cannot go in a block cell, and a busy option teacher is refused elsewhere", async () => {
    await expect(admin().setSlot({ sectionId: fa.s2, ...where(), subjectId: fa.maths, teacherId: fa.t1 })).rejects.toThrow(/block holds the whole class/);
    await admin().setSlot({ sectionId: fa.s3, dayOfWeek: 2, periodId: P(0).id, subjectId: fa.maths, teacherId: t3 });
    await expect(admin().setBlock({ sectionId: fa.s1, dayOfWeek: 2, periodId: P(0).id, blockId: block.id })).rejects.toThrow(/Meera Joshi is already teaching/);
    await expect(admin().setSlot({ sectionId: fa.s3, ...where(), subjectId: fa.maths, teacherId: t3 })).rejects.toThrow(/Meera Joshi is already teaching Hindi in the Second language block/);
  });

  it("a block is refused where any section of the class already has a class, and placing it again changes nothing", async () => {
    await admin().setSlot({ sectionId: fa.s2, dayOfWeek: 3, periodId: P(1).id, subjectId: fa.maths, teacherId: fa.t1 });
    await expect(admin().setBlock({ sectionId: fa.s1, dayOfWeek: 3, periodId: P(1).id, blockId: block.id })).rejects.toBeInstanceOf(ConflictError);
    await admin().setBlock({ sectionId: fa.s1, ...where(), blockId: block.id });
    expect(Object.values((await admin().sectionGrid(fa.s1)).cells).filter((c) => c.blockId)).toHaveLength(1);
  });

  it("changing a block's teacher is refused when the new teacher is busy where it sits", async () => {
    const save = (teacher: string) => new BlockService(a.as.admin).save({ id: block.id, classId: c5, name: "Second language", periodsPerWeek: 3, doubles: 0, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: sanskrit, teacherId: teacher }] });
    await admin().setSlot({ sectionId: fa.s3, ...where(), subjectId: fa.maths, teacherId: fa.t1 });
    await expect(save(fa.t1)).rejects.toThrow(/already teaching/);
    await admin().clearSlot({ sectionId: fa.s3, ...where() });
    await expect(save(fa.t1)).resolves.toBeTruthy();
    await save(t4);
    await admin().clearSlot({ sectionId: fa.s3, dayOfWeek: 2, periodId: P(0).id });
  });

  it("lists the students of a period: a section for an ordinary class, only those who chose the subject for a block", async () => {
    const row = (await new TimetableService(a.as.student).today(MONDAY)).rows.find((r) => r.periodId === P(2).id)!;
    const ref = (o: string) => ({ blockSlotId: row.blockSlotId, optionId: o });
    const hid = block.options.find((o) => o.subjectId === hindi)!.id, sid = block.options.find((o) => o.subjectId === sanskrit)!.id;
    expect((await admin().slotStudents(ref(hid))).map((s) => s.name)).toEqual(["Riya Sharma"]);
    expect((await admin().slotStudents(ref(sid))).map((s) => s.name)).toEqual(["Kabir Rao"]);
    expect((await new TimetableService(asTeacher(t4, "Dev Shastri")).slotStudents(ref(sid))).map((s) => s.name)).toEqual(["Kabir Rao"]);
    await expect(new TimetableService(asTeacher(t4, "Dev Shastri")).slotStudents(ref(hid))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new TimetableService(a.as.student).slotStudents(ref(hid))).rejects.toBeInstanceOf(ForbiddenError);
    const live = await admin().sectionGrid(fa.s2);
    const normal = live.cells[cellKey(3, P(1).id)]!;
    expect((await admin().slotStudents({ slotId: normal.slotId })).map((s) => s.name)).toEqual(["Kabir Rao"]);
  });

  it("copy week skips blocks, and prints show the block", async () => {
    await withConsole((tx) => tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: fa.s2, subjectId: fa.english, teacherId: t4 })); // so the copy has a free teacher
    await admin().setSlot({ sectionId: fa.s1, dayOfWeek: 4, periodId: P(0).id, subjectId: fa.english, teacherId: fa.t2 });
    await admin().clearSlot({ sectionId: fa.s2, dayOfWeek: 3, periodId: P(1).id });
    const r = await admin().copyWeek({ fromSectionId: fa.s1, toSectionId: fa.s2, replace: "" });
    expect(r.copied).toBe(1);
    const cells = Object.values((await admin().sectionGrid(fa.s2)).cells);
    expect(cells.filter((c) => c.blockId)).toHaveLength(1);
    expect(cells).toHaveLength(2);
    const pdf = await weekPdf(a.as.admin, "section", fa.s1);
    expect(pdf.bytes.length).toBeGreaterThan(500);
  });

  it("covers: an absent option teacher's block period is on the board and can be covered", async () => {
    const subs = new SubstitutionService(a.as.admin);
    const board = await subs.board(DATE, [t3]);
    const p = board.absent.find((x) => x.teacherId === t3)!.periods.find((x) => x.periodId === P(2).id)!;
    expect(p).toMatchObject({ subject: "Hindi", optionId: block.options.find((o) => o.subjectId === hindi)!.id });
    await expect(subs.assign({ date: DATE, slotId: p.slotId, optionId: p.optionId, coverTeacherId: t4 })).rejects.toThrow(/Dev Shastri is teaching/);
    await subs.assign({ date: DATE, slotId: p.slotId, optionId: p.optionId, coverTeacherId: fa.t1, note: "Reading" });
    expect((await subs.coversFor(fa.t1, DATE))).toEqual([{ slotId: p.slotId, optionId: p.optionId }]);
    const t1 = (await new TimetableService(asTeacher(fa.t1, "Anita Verma")).today(MONDAY)).rows.find((r) => r.periodId === P(2).id)!;
    expect(t1).toMatchObject({ subject: "Hindi", cover: "covering" });
    const kid = (await new TimetableService(a.as.student).today(MONDAY)).rows.find((r) => r.periodId === P(2).id)!;
    expect(kid.teacher).toBe("Anita Verma");
    expect((await subs.board(DATE, [t3])).absent.find((x) => x.teacherId === t3)!.periods.find((x) => x.periodId === P(2).id)!.cover).toMatchObject({ teacherId: fa.t1 });
    await subs.clear({ date: DATE, slotId: p.slotId, optionId: p.optionId });
    expect(await subs.coversFor(fa.t1, DATE)).toEqual([]);
  });

  it("clearing the cell from any section removes the block for the whole class", async () => {
    const r = await admin().clearSlot({ sectionId: fa.s2, dayOfWeek: 1, periodId: P(2).id });
    expect(r.cleared).toBe(1);
    expect((await admin().sectionGrid(fa.s1)).cells[cellKey(1, P(2).id)]).toBeUndefined();
  });
});

describe("blocks: generator", () => {
  let draft: string;
  const rows = () => [fa.maths, fa.english].map((subjectId) => ({ classId: c5, subjectId, periodsPerWeek: 5, doublePeriods: 0 }));

  it("places the block in the same cells for every section beside compulsory subjects, with no clashes", async () => {
    await new RulesService(a.as.admin).saveLoads({ rows: rows() });
    await new BlockService(a.as.admin).save({ id: block.id, classId: c5, name: "Second language", periodsPerWeek: 4, doubles: 1, options: [{ subjectId: hindi, teacherId: t3 }, { subjectId: sanskrit, teacherId: t4 }] });
    const gen = new GeneratorService(a.as.admin);
    const r = await gen.generate({ seed: 9 });
    draft = r.versionId;
    const review = await gen.review(draft);
    expect(review.unplaced.filter((u) => /Class 5-/.test(u.section) && u.subject === "Second language")).toEqual([]);
    const g1 = (await admin().sectionGrid(fa.s1, draft)).cells, g2 = (await admin().sectionGrid(fa.s2, draft)).cells;
    const blockKeys = (g: typeof g1) => Object.entries(g).filter(([, c]) => c.blockId).map(([k]) => k).sort();
    expect(blockKeys(g1)).toHaveLength(4);
    expect(blockKeys(g1)).toEqual(blockKeys(g2));
    for (const t of [t3, t4, fa.t1, fa.t2]) {
      const keys = Object.keys((await admin().teacherGrid(t, draft)).cells);
      expect(new Set(keys).size).toBe(keys.length);
    }
    // Hindi and Sanskrit teachers teach only the block
    expect(Object.keys((await admin().teacherGrid(t3, draft)).cells)).toHaveLength(4);
    // compulsory periods never sit in a block cell
    for (const g of [g1, g2]) expect(Object.values(g).filter((c) => !c.blockId && c.subjectId === fa.maths).length).toBeLessThanOrEqual(5);
  });

  it("the same seed gives the same draft, and pinning a cell pins the class's block there", async () => {
    const gen = new GeneratorService(a.as.admin);
    const again = await gen.generate({ seed: 9 });
    const keys = async (v: string) => Object.entries((await admin().sectionGrid(fa.s1, v)).cells).map(([k, c]) => `${k}:${c.blockId ?? c.subjectId}`).sort();
    expect(await keys(again.versionId)).toEqual(await keys(draft));
    const cell = Object.entries((await admin().sectionGrid(fa.s1, draft)).cells).find(([, c]) => c.blockId)![0];
    const [day, periodId] = cell.split(":");
    expect((await gen.setLocked({ versionId: draft, sectionId: fa.s1, dayOfWeek: day, periodId, locked: "true" })).changed).toBe(1);
    const rerun = await gen.generate({ versionId: draft, seed: 123 });
    expect((await admin().sectionGrid(fa.s2, rerun.versionId)).cells[cell]).toMatchObject({ blockId: block.id, locked: true });
  });

  it("publishing makes it live for the student", async () => {
    await new GeneratorService(a.as.admin).publish({ versionId: draft });
    const own = Object.values((await new TimetableService(a.as.student).sectionGrid(fa.s1)).cells).filter((c) => c.blockId);
    expect(own).toHaveLength(4);
    expect(own.every((c) => c.subject === "Hindi")).toBe(true);
  });
});
