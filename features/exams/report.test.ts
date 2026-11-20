import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classSubjects, classes, sections, studentSubjects, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { findClashes, legendFor } from "./grading";
import { AdmitCardService, ComponentService, DateSheetService, ExamService, GradeScaleService, MarksService, RemarkService, ReportCardService, ReportSetupService, ResultService, TermWeightService } from "./service";

let a: TestSchool, b: TestSchool;
const FEATURES = ["academics", "students", "attendance", "exams"];

interface Fx { yearId: string; t1: string; t2: string; classId: string; secA: string; secB: string; maths: string; hindi: string; art: string; s1: string; s2: string; s3: string; s4: string }

/** Class 6, sections A (the teacher is class teacher) and B (nobody). Maths, Hindi (elective, only s1 takes it) and Art (co-scholastic). */
async function build(school: TestSchool, teacher: boolean): Promise<Fx> {
  return withSchool(school.id, async (tx) => {
    const sid = school.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [t1, t2] = await tx.insert(terms).values([
      { schoolId: sid, yearId: year!.id, name: "Term 1", startsOn: "2026-04-01", endsOn: "2026-09-30" },
      { schoolId: sid, yearId: year!.id, name: "Term 2", startsOn: "2026-10-01", endsOn: "2027-03-31" },
    ]).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 6", grade: 6 }).returning();
    const secs = await tx.insert(sections).values([
      { schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: teacher ? school.users.teacher : null },
      { schoolId: sid, classId: cls!.id, yearId: year!.id, name: "B" },
    ]).returning();
    const subs = await tx.insert(subjects).values([{ schoolId: sid, name: "Maths" }, { schoolId: sid, name: "Hindi" }, { schoolId: sid, name: "Art", kind: "co_scholastic" }]).returning();
    await tx.insert(classSubjects).values(subs.map((s) => ({ schoolId: sid, classId: cls!.id, subjectId: s.id, isElective: s.name === "Hindi" })));
    const st = await tx.insert(students).values([
      { schoolId: sid, admissionNo: "R1", name: "Aarav Sharma", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 1, userId: school.users.student },
      { schoolId: sid, admissionNo: "R2", name: "Diya Patel", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 2 },
      { schoolId: sid, admissionNo: "R3", name: "Kabir Singh", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 3 },
      { schoolId: sid, admissionNo: "R4", name: "Meera Nair", classId: cls!.id, sectionId: secs[1]!.id, rollNo: 1 },
    ]).returning();
    await tx.insert(studentSubjects).values({ schoolId: sid, studentId: st[0]!.id, yearId: year!.id, subjectId: subs[1]!.id });
    return { yearId: year!.id, t1: t1!.id, t2: t2!.id, classId: cls!.id, secA: secs[0]!.id, secB: secs[1]!.id, maths: subs[0]!.id, hindi: subs[1]!.id, art: subs[2]!.id, s1: st[0]!.id, s2: st[1]!.id, s3: st[2]!.id, s4: st[3]!.id };
  });
}

let fa: Fx;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES, "-report"));
  fa = await build(a, true);
  await build(b, false); // school B has its own data so isolation checks are meaningful
});
afterAll(closeDb);

/** An exam of Maths and Hindi in a term; `fill` gives the mark for each paper and student, and every sheet row is saved. */
async function exam(name: string, termId: string, max: number, pass: number, fill: (subject: string, studentId: string) => number, dates = ["2026-09-22", "2026-09-30"]) {
  const svc = new ExamService(a.as.admin);
  const { exam: e } = await svc.createWithPapers({ yearId: fa.yearId, termId, name, kind: "other", startsOn: dates[0], endsOn: dates[1], classIds: [fa.classId], subjectIds: [], maxMarks: max, passMarks: pass });
  await svc.transition({ id: e.id, to: "scheduled" });
  await svc.transition({ id: e.id, to: "marks_open" });
  const marks = new MarksService(a.as.admin);
  for (const p of (await svc.detail(e.id)).papers) {
    const sheet = await marks.sheet(p.id);
    await marks.save({ paperId: p.id, entries: JSON.stringify(sheet.rows.map((r) => ({ studentId: r.studentId, marks: fill(p.subjectName, r.studentId), absent: false }))) });
  }
  return { id: e.id, svc, papers: (await svc.detail(e.id)).papers };
}

describe("grade scales and templates", () => {
  it("bands must cover 0-100 once; a good set is saved", async () => {
    const svc = new GradeScaleService(a.as.admin);
    const id = await svc.ensureDefault();
    const band = (grade: string, minPercent: number, maxPercent: number) => ({ grade, minPercent, maxPercent, gradePoint: 0 });
    await expect(svc.saveBands(id, [band("A", 51, 100), band("B", 0, 49)])).rejects.toBeInstanceOf(ValidationError); // gap at 50
    await expect(svc.saveBands(id, [band("A", 50, 100), band("B", 0, 50)])).rejects.toBeInstanceOf(ValidationError); // overlap at 50
    await expect(svc.saveBands(id, [band("A", 40, 100)])).rejects.toBeInstanceOf(ValidationError); // does not reach 0
    await expect(svc.saveBands(id, [band("A", 50, 100), band("B", 0, 49)])).resolves.toMatchObject({ bands: 2 });
    await svc.saveBands(id, [band("A1", 91, 100), band("A2", 81, 90), band("B", 0, 80)]);
    expect(legendFor((await svc.scale()).bands)).toBe("Grading: A1 91-100, A2 81-90, B 0-80. AB = absent.");
  });

  it("co-scholastic scale: needs grades, no repeats; presets are safe to repeat; the coordinator role manages, a teacher does not", async () => {
    const s = new ReportSetupService(a.as.admin);
    await expect(s.saveCoScale({ name: "Dup", grades: [{ grade: "A", description: "x" }, { grade: "a", description: "y" }] })).rejects.toBeInstanceOf(ValidationError);
    const first = await s.applyPreset({ preset: "cbse_co" });
    expect(first.created).toBe(true);
    expect((await s.applyPreset({ preset: "cbse_co" })).created).toBe(false);
    expect((await s.coScales())[0]!.grades.map((g) => g.grade)).toEqual(["A", "B", "C"]);
    const coordinator: Ctx = { ...a.as.teacher, grants: new Set(["exams:read", "exams:manage"]) };
    await expect(new ReportSetupService(coordinator).applyPreset({ preset: "cbse_9" })).resolves.toMatchObject({ preset: "cbse_9" });
    await expect(new ReportSetupService(a.as.teacher).applyPreset({ preset: "cbse_9" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportSetupService(a.as.teacher).saveTemplate({ classBand: "6-8" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B sees none of school A's setup and cannot use its ids", async () => {
    await new ReportSetupService(a.as.admin).saveTemplate({ classBand: "9-10", board: "icse", showGrade: false, showRank: true });
    expect((await new ReportSetupService(b.as.admin).templates()).every((t) => !t.saved)).toBe(true);
    expect(await new ReportSetupService(b.as.admin).coScales()).toEqual([]);
    await expect(new TermWeightService(b.as.admin).save({ termId: fa.t1, weights: [] })).rejects.toBeInstanceOf(ValidationError); // not 100
    await expect(new MarksService(b.as.admin).coSheet(fa.secA, fa.t1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new RemarkService(b.as.admin).sheet(fa.secA, fa.t1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DateSheetService(b.as.admin).forExam(fa.t1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("components", () => {
  it("a paper is the sum of its parts; each part is checked against its max; plain papers still work", async () => {
    const { id, papers, svc } = await exam("Components", fa.t1, 100, 33, () => 50);
    const maths = papers.find((p) => p.subjectName === "Maths")!;
    // marks already entered: parts cannot change
    await expect(new ComponentService(a.as.admin).save({ paperId: maths.id, components: [{ name: "Theory", maxMarks: 80 }, { name: "Internal", maxMarks: 20 }] })).rejects.toBeInstanceOf(ConflictError);
    const fresh = await svc.createWithPapers({ yearId: fa.yearId, termId: fa.t1, name: "Components 2", kind: "other", startsOn: "2026-09-22", endsOn: "2026-09-30", classIds: [fa.classId], subjectIds: [fa.maths], maxMarks: 100, passMarks: 33 });
    await svc.transition({ id: fresh.exam.id, to: "scheduled" });
    const paper = (await svc.detail(fresh.exam.id)).papers[0]!;
    const comps = new ComponentService(a.as.admin);
    await expect(comps.save({ paperId: paper.id, components: [{ name: "Theory", maxMarks: 20 }] })).rejects.toBeInstanceOf(ValidationError); // pass 33 > 20
    await comps.save({ paperId: paper.id, components: [{ name: "Theory", maxMarks: 80 }, { name: "Internal", maxMarks: 20 }] });
    await svc.transition({ id: fresh.exam.id, to: "marks_open" });
    const marks = new MarksService(a.as.admin);
    const sheet = await marks.sheet(paper.id);
    expect(sheet.components.map((c) => c.name).sort()).toEqual(["Internal", "Theory"]);
    expect(sheet.paper.maxMarks).toBe(100);
    const [theory, internal] = [sheet.components.find((c) => c.name === "Theory")!, sheet.components.find((c) => c.name === "Internal")!];
    const entry = (t: number | null, i: number | null) => JSON.stringify([{ studentId: fa.s1, marks: null, absent: false, components: [{ componentId: theory.id, marks: t, absent: false }, { componentId: internal.id, marks: i, absent: false }] }]);
    await expect(marks.save({ paperId: paper.id, entries: entry(81, 10) })).rejects.toBeInstanceOf(ValidationError); // over the part's max
    await expect(marks.save({ paperId: paper.id, entries: entry(70, 21) })).rejects.toBeInstanceOf(ValidationError);
    await expect(marks.save({ paperId: paper.id, entries: entry(70, null) })).rejects.toBeInstanceOf(ValidationError); // every part or none
    await marks.save({ paperId: paper.id, entries: entry(70.5, 18) });
    const row = (await marks.sheet(paper.id)).rows.find((r) => r.studentId === fa.s1)!;
    expect(row.marks).toBe(88.5);
    expect(row.parts[theory.id]).toEqual({ marks: 70.5, absent: false });
    // a plain paper of the first exam still saves a single mark
    const plain = await marks.sheet(maths.id);
    expect(plain.components).toEqual([]);
    expect(id).toBeTruthy();
  });
});

describe("term report card", () => {
  let pt: string, hy: string, annual: string;
  beforeAll(async () => {
    // Term 1: unit test (weight 20, out of 20) + half yearly (weight 80, out of 80). Term 2: annual (weight 100, out of 100).
    const mark = (max: number, pct: number) => (subject: string, id: string) => (subject === "Hindi" ? max : id === fa.s1 ? Math.round((max * pct) / 100) : max * 0.5);
    pt = (await exam("PT 1", fa.t1, 20, 7, mark(20, 100), ["2026-05-04", "2026-05-06"])).id;
    hy = (await exam("Half Yearly", fa.t1, 80, 27, mark(80, 75), ["2026-09-22", "2026-09-30"])).id;
    annual = (await exam("Annual", fa.t2, 100, 33, mark(100, 50), ["2027-03-10", "2027-03-20"])).id;
    for (const id of [pt, hy, annual]) { await new ExamService(a.as.admin).transition({ id, to: "published" }); }
    // exams left over from earlier tests would hide the terms from students
    await withSchool(a.id, (tx) => tx.execute(sql`update exams set status = 'published' where term_id in (${fa.t1}, ${fa.t2})`));
  });

  it("weights must total 100 and only cover the term's own exams", async () => {
    const w = new TermWeightService(a.as.admin);
    await expect(w.save({ termId: fa.t1, weights: [{ examId: pt, weightPercent: 20 }, { examId: hy, weightPercent: 70 }] })).rejects.toMatchObject({ fieldErrors: { weights: expect.stringContaining("add up to 100") } });
    await expect(w.save({ termId: fa.t1, weights: [{ examId: pt, weightPercent: 20 }, { examId: annual, weightPercent: 80 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1)).rejects.toBeInstanceOf(ConflictError); // no weights yet
    await w.save({ termId: fa.t1, weights: [{ examId: pt, weightPercent: 20 }, { examId: hy, weightPercent: 80 }] });
    await w.save({ termId: fa.t2, weights: [{ examId: annual, weightPercent: 100 }] });
    await expect(new TermWeightService(a.as.teacher).save({ termId: fa.t1, weights: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("builds Term 1 and Term 2 blocks, a final column, and skips an elective the student does not take", async () => {
    const card = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1);
    expect(card.blocks.map((x) => x.name)).toEqual(["Term 1", "Term 2"]);
    const maths1 = card.blocks[0]!.subjects.find((s) => s.subject === "Maths")!;
    expect(maths1).toMatchObject({ score: 80, outOf: 100, percent: 80 }); // 20/20 x 20 + 60/80 x 80
    expect(card.blocks[1]!.subjects.find((s) => s.subject === "Maths")).toMatchObject({ score: 50, percent: 50 });
    expect(card.final!.subjects.find((s) => s.subject === "Maths")!.percent).toBe(65); // average of the terms
    expect(card.blocks[0]!.total).toBe(180); // Maths 80 + Hindi 100
    expect(card.rank).toMatchObject({ rank: 1 });
    // s2 does not take Hindi: no Hindi row, no absence, no pending
    const other = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s2);
    expect(other.blocks[0]!.subjects.map((s) => s.subject)).toEqual(["Maths"]);
    expect(other.blocks[0]!.result).toBe("pass");
    const pdf = await new ReportCardService(a.as.admin).termPdf(fa.t1, fa.s1);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const batch = await new ReportCardService(a.as.admin).termBatch(fa.t1, fa.secA);
    expect(batch.bytes.length).toBeGreaterThan(pdf.bytes.length);
    // a student takes only their own card
    await expect(new ReportCardService(a.as.student).termPdf(fa.t1, fa.s1)).resolves.toBeTruthy();
    await expect(new ReportCardService(a.as.student).termPdf(fa.t1, fa.s2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReportCardService(a.as.student).termBatch(fa.t1, fa.secA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportCardService(b.as.admin).termCard(fa.t1, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("electives: papers, results and publish counts use the subjects each student takes", async () => {
    const e = await new ExamService(a.as.admin).detail(hy);
    const hindi = e.papers.find((p) => p.subjectName === "Hindi")!;
    expect(hindi.students).toBe(1);
    expect((await new MarksService(a.as.admin).sheet(hindi.id)).rows.map((r) => r.studentId)).toEqual([fa.s1]);
    const res = await new ResultService(a.as.admin).studentResult(hy, fa.s2);
    expect(res.result.subjects.map((s) => s.subject)).toEqual(["Maths"]);
  });

  it("puts working days and days present for the term on the card, skipping holidays", async () => {
    await withSchool(a.id, async (tx) => {
      const day = (d: string, st: string) => sql`insert into student_attendance (id, school_id, student_id, section_id, date, status) values (gen_random_uuid(), ${a.id}, ${fa.s1}, ${fa.secA}, ${d}, ${st})`;
      for (const [d, st] of [["2026-06-01", "present"], ["2026-06-02", "present"], ["2026-06-03", "late"], ["2026-06-04", "absent"], ["2026-06-05", "present"], ["2026-06-06", "present"]] as const) await tx.execute(day(d, st));
      await tx.execute(sql`insert into attendance_holidays (id, school_id, date, name) values (gen_random_uuid(), ${a.id}, '2026-06-06', 'Holiday')`);
    });
    const card = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1);
    expect(card.blocks[0]!.attendance).toEqual({ working: 5, present: 4 });
    expect(card.blocks[1]!.attendance).toBeNull();
    // a school without the attendance module simply has no line
    const off: Ctx = { ...a.as.admin, features: new Set(["academics", "students", "exams"]) };
    expect((await new ReportCardService(off).termCard(fa.t1, fa.s1)).blocks[0]!.attendance).toBeNull();
  });

  it("class teacher remarks print on the card; another section's teacher is refused", async () => {
    const r = new RemarkService(a.as.teacher);
    expect((await r.sections()).map((s) => s.id)).toEqual([fa.secA]);
    await expect(r.save({ sectionId: fa.secA, termId: fa.t1, entries: [{ studentId: fa.s1, text: "Works hard." }, { studentId: fa.s2, text: "" }] })).resolves.toMatchObject({ saved: 1 });
    expect((await r.sheet(fa.secA, fa.t1)).rows.find((x) => x.studentId === fa.s1)!.text).toBe("Works hard.");
    expect((await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1)).teacherRemark).toBe("Works hard.");
    // section B has a different (no) class teacher
    await expect(r.save({ sectionId: fa.secB, termId: fa.t1, entries: [{ studentId: fa.s4, text: "x" }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(r.sheet(fa.secB, fa.t1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RemarkService(a.as.admin).save({ sectionId: fa.secB, termId: fa.t1, entries: [{ studentId: fa.s4, text: "Fine." }] })).resolves.toMatchObject({ saved: 1 });
    await expect(new RemarkService(a.as.student).sheet(fa.secA, fa.t1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(r.save({ sectionId: fa.secA, termId: fa.t1, entries: [{ studentId: fa.s4, text: "wrong section" }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("co-scholastic grades are entered per term by the class teacher, from the scale, and print with their meaning", async () => {
    const svc = new MarksService(a.as.teacher);
    const grade = (studentId: string, g: string) => JSON.stringify([{ studentId, subjectId: fa.art, grade: g }]);
    // published exams lock the term's grades
    await expect(svc.saveCoScholastic({ termId: fa.t1, entries: grade(fa.s1, "A") })).rejects.toBeInstanceOf(ConflictError);
    await withSchool(a.id, (tx) => tx.execute(sql`update exams set status = 'marks_open' where term_id = ${fa.t1}`));
    await expect(svc.saveCoScholastic({ termId: fa.t1, entries: grade(fa.s1, "A") })).resolves.toMatchObject({ saved: 1 });
    await svc.saveCoScholastic({ termId: fa.t1, entries: grade(fa.s1, "B") }); // overwrite, not a duplicate
    await expect(svc.saveCoScholastic({ termId: fa.t1, entries: grade(fa.s1, "Z") })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.saveCoScholastic({ termId: fa.t1, entries: grade(fa.s4, "A") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new MarksService(a.as.student).saveCoScholastic({ termId: fa.t1, entries: grade(fa.s1, "A") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new MarksService(a.as.admin).saveCoScholastic({ termId: fa.t1, entries: JSON.stringify([{ studentId: fa.s1, subjectId: fa.maths, grade: "A" }]) })).rejects.toBeInstanceOf(ValidationError);
    await withSchool(a.id, (tx) => tx.execute(sql`update exams set status = 'published' where term_id = ${fa.t1}`));
    const sheet = await svc.coSheet(fa.secA, fa.t1);
    expect(sheet.students.find((s) => s.id === fa.s1)!.grades[fa.art]).toBe("B");
    await expect(svc.coSheet(fa.secB, fa.t1)).rejects.toBeInstanceOf(ForbiddenError);
    const card = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1);
    expect(card.co).toEqual([{ subject: "Art", grade: "B", description: "Very good" }]);
  });

  it("an ICSE marks-only template hides grades and the legend from the card", async () => {
    await new ReportSetupService(a.as.admin).applyPreset({ preset: "icse_marks_only", classBand: "6-8" });
    const card = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1);
    expect(card.opts.showGrade).toBe(false);
    const pdf = await new ReportCardService(a.as.admin).termPdf(fa.t1, fa.s1);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await new ReportCardService(a.as.admin).pdf({ examId: hy }, fa.s1)).bytes.length).toBeGreaterThan(1000);
    // class 9-10 stays on the default setup
    expect((await new ReportSetupService(a.as.admin).templates()).find((t) => t.classBand === "6-8")).toMatchObject({ showGrade: false, board: "icse" });
    await new ReportSetupService(a.as.admin).saveTemplate({ classBand: "6-8", board: "cbse", showGrade: true, showRank: true, termSplit: "40,60" });
    const split = await new ReportCardService(a.as.admin).termCard(fa.t1, fa.s1);
    expect(split.opts.showGrade).toBe(true);
    expect(split.final!.subjects.find((s) => s.subject === "Maths")!.percent).toBe(62); // 80 x 40% + 50 x 60%
    await expect(new ReportSetupService(a.as.admin).saveTemplate({ classBand: "6-8", showGrade: true, termSplit: "40,50" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("date sheet and admit cards", () => {
  it("finds clashes: same class, same day, no times or overlapping times", () => {
    const p = (id: string, date: string, startTime: string | null, endTime: string | null) => ({ id, label: id, date, startTime, endTime });
    expect(findClashes([p("a", "2026-10-01", null, null), p("b", "2026-10-01", null, null)])).toHaveLength(1);
    expect(findClashes([p("a", "2026-10-01", "09:00", "11:00"), p("b", "2026-10-01", "10:00", "12:00")])).toHaveLength(1);
    expect(findClashes([p("a", "2026-10-01", "09:00", "11:00"), p("b", "2026-10-01", "11:00", "13:00")])).toHaveLength(0);
    expect(findClashes([p("a", "2026-10-01", null, null), p("b", "2026-10-02", null, null)])).toHaveLength(0);
  });

  it("saves dates and times, refuses a clash, shows students only after the exam leaves draft", async () => {
    const svc = new ExamService(a.as.admin);
    const { exam: e } = await svc.createWithPapers({ yearId: fa.yearId, termId: fa.t2, name: "Date sheet exam", kind: "other", startsOn: "2099-01-05", endsOn: "2099-01-10", classIds: [fa.classId], subjectIds: [], maxMarks: 50, passMarks: 17 });
    const sheet = new DateSheetService(a.as.admin);
    const papers = (await sheet.forExam(e.id)).groups[0]!.papers;
    const [maths, hindi] = [papers.find((p) => p.subject === "Maths")!, papers.find((p) => p.subject === "Hindi")!];
    const save = (rows: object[]) => sheet.save({ examId: e.id, papers: JSON.stringify(rows) });
    await expect(save([{ paperId: maths.id, date: "2099-01-06", startTime: "09:00", endTime: "11:00" }, { paperId: hindi.id, date: "2099-01-06", startTime: "10:30", endTime: "12:00" }])).rejects.toBeInstanceOf(ValidationError);
    await expect(save([{ paperId: maths.id, date: "2099-01-06", startTime: "09:00", endTime: "08:00" }])).rejects.toBeInstanceOf(ValidationError); // end before start
    await expect(save([{ paperId: maths.id, date: "2099-01-06", startTime: "09:00", endTime: "11:00" }, { paperId: hindi.id, date: "2099-01-06", startTime: "11:00", endTime: "12:30" }])).resolves.toMatchObject({ saved: 2 });
    expect((await sheet.forExam(e.id)).clashes).toEqual({});
    await expect(new DateSheetService(a.as.teacher).save({ examId: e.id, papers: [] })).rejects.toBeInstanceOf(ForbiddenError);
    const coordinator: Ctx = { ...a.as.teacher, grants: new Set(["exams:read", "exams:manage"]) };
    await expect(new DateSheetService(coordinator).save({ examId: e.id, papers: JSON.stringify([{ paperId: maths.id, date: "2099-01-06", startTime: "09:00", endTime: "11:00" }]) })).resolves.toMatchObject({ saved: 1 });
    // draft: hidden from the student; scheduled: published to them, only the subjects they take
    expect((await new DateSheetService(a.as.student).mine()).some((m) => m.exam.id === e.id)).toBe(false);
    await svc.transition({ id: e.id, to: "scheduled" });
    const mine = (await new DateSheetService(a.as.student).mine()).find((m) => m.exam.id === e.id)!;
    expect(mine.papers.map((p) => p.subject).sort()).toEqual(["Hindi", "Maths"]);
    await expect(new DateSheetService(b.as.student).mine()).resolves.toEqual([]);
    await expect(new DateSheetService(a.as.student).forExam(e.id)).rejects.toBeInstanceOf(ForbiddenError);

    // admit cards
    const cards = new AdmitCardService(a.as.admin);
    const one = await cards.pdf(e.id, fa.s1);
    expect(Buffer.from(one.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await cards.classBatch(e.id, fa.secA)).bytes.length).toBeGreaterThan(one.bytes.length);
    await expect(new AdmitCardService(a.as.student).pdf(e.id, fa.s1)).resolves.toBeTruthy();
    await expect(new AdmitCardService(a.as.student).pdf(e.id, fa.s2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AdmitCardService(a.as.student).classBatch(e.id, fa.secA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AdmitCardService(b.as.admin).pdf(e.id, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("term locks and student visibility", () => {
  let t3: string, otherYearTerm: string;
  beforeAll(async () => {
    await withSchool(a.id, async (tx) => {
      const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31" }).returning();
      const rows = await tx.insert(terms).values([
        { schoolId: a.id, yearId: fa.yearId, name: "Term 3", startsOn: "2027-04-01", endsOn: "2027-05-31" },
        { schoolId: a.id, yearId: y!.id, name: "Other year", startsOn: "2027-04-01", endsOn: "2027-09-30" },
      ]).returning();
      [t3, otherYearTerm] = [rows[0]!.id, rows[1]!.id];
    });
  });

  it("co-scholastic grades need a term of the section's year, and lock once an exam of the term is published", async () => {
    const entry = JSON.stringify([{ studentId: fa.s1, subjectId: fa.art, grade: "A" }]);
    const svc = new MarksService(a.as.admin);
    await expect(svc.saveCoScholastic({ termId: otherYearTerm, entries: entry })).rejects.toBeInstanceOf(ValidationError);
    const done = await exam("T3 done", t3, 20, 7, () => 15, ["2027-04-05", "2027-04-06"]);
    await expect(svc.saveCoScholastic({ termId: t3, entries: entry })).resolves.toMatchObject({ saved: 1 });
    await new ExamService(a.as.admin).transition({ id: done.id, to: "published" });
    await expect(svc.saveCoScholastic({ termId: t3, entries: entry })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a student gets a term card only when every exam of the term is published, weighted or not", async () => {
    const open = await exam("T3 open", t3, 20, 7, () => 10, ["2027-05-10", "2027-05-12"]); // no weight row
    const [done] = await withSchool(a.id, (tx) => tx.execute(sql`select id from exams where name = 'T3 done'`));
    await new TermWeightService(a.as.admin).save({ termId: t3, weights: [{ examId: String((done as { id: string }).id), weightPercent: 100 }] });
    await new RemarkService(a.as.admin).save({ sectionId: fa.secA, termId: t3, entries: [{ studentId: fa.s1, text: "Term three remark." }] });
    const student = new ReportCardService(a.as.student);
    await expect(student.termCard(t3, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(student.termPdf(t3, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(student.pdf({ termId: t3 }, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    // the unpublished term's remark never rides on another term's card
    expect((await student.termCard(fa.t1, fa.s1)).teacherRemark).not.toBe("Term three remark.");
    await expect(new ReportCardService(a.as.admin).termCard(t3, fa.s1)).resolves.toBeTruthy();
    await new ExamService(a.as.admin).transition({ id: open.id, to: "published" });
    await expect(student.pdf({ termId: t3 }, fa.s1)).resolves.toBeTruthy();
  });
});
