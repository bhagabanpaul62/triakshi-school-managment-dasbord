import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, eq, sql, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classSubjects, classes, sectionTeachers, sections, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { ExamService, GradeScaleService, MarksService, ReportCardService, ResultService } from "./service";

let a: TestSchool, b: TestSchool;
const FEATURES = ["academics", "students", "exams"];

interface Fixture { yearId: string; termId: string; classId: string; secA: string; secB: string; maths: string; science: string; art: string; s1: string; s2: string; s3: string; s4: string }

/** One class with two sections: A (teacher teaches Maths) has three students, B has one. Maths, Science and Art (co-scholastic). */
async function build(school: TestSchool, withTeacher: boolean): Promise<Fixture> {
  return withSchool(school.id, async (tx) => {
    const sid = school.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [term] = await tx.insert(terms).values({ schoolId: sid, yearId: year!.id, name: "Term 1", startsOn: "2026-04-01", endsOn: "2026-09-30" }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 6", grade: 6 }).returning();
    const secs = await tx.insert(sections).values([
      { schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: withTeacher ? school.users.teacher : null }, { schoolId: sid, classId: cls!.id, yearId: year!.id, name: "B" },
    ]).returning();
    const subs = await tx.insert(subjects).values([
      { schoolId: sid, name: "Maths" }, { schoolId: sid, name: "Science" }, { schoolId: sid, name: "Art", kind: "co_scholastic" },
    ]).returning();
    await tx.insert(classSubjects).values(subs.map((s) => ({ schoolId: sid, classId: cls!.id, subjectId: s.id })));
    if (withTeacher) await tx.insert(sectionTeachers).values({ schoolId: sid, sectionId: secs[0]!.id, subjectId: subs[0]!.id, teacherId: school.users.teacher });
    const st = await tx.insert(students).values([
      { schoolId: sid, admissionNo: "A1", name: "Aarav Sharma", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 1, userId: school.users.student },
      { schoolId: sid, admissionNo: "A2", name: "Diya Patel", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 2 },
      { schoolId: sid, admissionNo: "A3", name: "Kabir Singh", classId: cls!.id, sectionId: secs[0]!.id, rollNo: 3 },
      { schoolId: sid, admissionNo: "B1", name: "Meera Nair", classId: cls!.id, sectionId: secs[1]!.id, rollNo: 1 },
    ]).returning();
    return { yearId: year!.id, termId: term!.id, classId: cls!.id, secA: secs[0]!.id, secB: secs[1]!.id, maths: subs[0]!.id, science: subs[1]!.id, art: subs[2]!.id, s1: st[0]!.id, s2: st[1]!.id, s3: st[2]!.id, s4: st[3]!.id };
  });
}

let fa: Fixture, fb: Fixture;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES, "-exams"));
  [fa, fb] = [await build(a, true), await build(b, false)];
});
afterAll(closeDb);

const exam = (name: string, extra: Record<string, unknown> = {}) => ({
  yearId: fa.yearId, termId: fa.termId, name, kind: "half_yearly", startsOn: "2026-09-22", endsOn: "2026-09-30",
  classIds: [fa.classId], subjectIds: [], maxMarks: "80", passMarks: "27", ...extra,
});

async function openExam(name: string) {
  const svc = new ExamService(a.as.admin);
  const { exam: e } = await svc.createWithPapers(exam(name));
  await svc.transition({ id: e.id, to: "scheduled" });
  await svc.transition({ id: e.id, to: "marks_open" });
  const papers = (await svc.detail(e.id)).papers;
  return { id: e.id, svc, maths: papers.find((p) => p.subjectName === "Maths")!, science: papers.find((p) => p.subjectName === "Science")! };
}

const entries = (rows: [string, number | null, boolean?][]) => JSON.stringify(rows.map(([studentId, marks, absent]) => ({ studentId, marks, absent: !!absent })));

describe("ExamService", () => {
  it("creates an exam with papers for the chosen classes, scholastic subjects only", async () => {
    const svc = new ExamService(a.as.admin);
    const { exam: e, papers } = await svc.createWithPapers(exam("Half Yearly"));
    expect(papers).toBe(2); // Maths and Science; Art is co-scholastic
    expect(e.status).toBe("draft");
    const d = await svc.detail(e.id);
    expect(d.papers.map((p) => p.subjectName)).toEqual(["Maths", "Science"]);
    expect(d.papers[0]).toMatchObject({ maxMarks: 80, passMarks: 27, students: 4, entered: 0 });
    expect(d.papers.every((p) => p.date >= "2026-09-22" && p.date <= "2026-09-30")).toBe(true);
  });

  it("can limit the papers to chosen subjects", async () => {
    const { papers } = await new ExamService(a.as.admin).createWithPapers(exam("Maths only", { subjectIds: [fa.maths] }));
    expect(papers).toBe(1);
  });

  it("validates pass marks, dates and the class list", async () => {
    const svc = new ExamService(a.as.admin);
    await expect(svc.createWithPapers(exam("Bad", { passMarks: "90" }))).rejects.toMatchObject({ fieldErrors: { passMarks: expect.any(String) } });
    await expect(svc.createWithPapers(exam("Bad", { endsOn: "2026-09-01" }))).rejects.toMatchObject({ fieldErrors: { endsOn: expect.any(String) } });
    await expect(svc.createWithPapers(exam("Bad", { classIds: [] }))).rejects.toMatchObject({ fieldErrors: { classIds: expect.any(String) } });
  });

  it("does not schedule without papers, and cannot jump to published", async () => {
    const svc = new ExamService(a.as.admin);
    const e = await svc.create({ yearId: fa.yearId, name: "Empty exam", kind: "other", startsOn: "2026-10-01", endsOn: "2026-10-02" });
    await expect(svc.transition({ id: e.id, to: "scheduled" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.transition({ id: e.id, to: "published" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("will not open or publish an exam with no papers, and will not change the year once papers exist", async () => {
    const svc = new ExamService(a.as.admin);
    const { exam: e } = await svc.createWithPapers(exam("Year guard"));
    await expect(svc.update(e.id, { yearId: fb.yearId, name: "Year guard", kind: "other", startsOn: "2026-09-22", endsOn: "2026-09-30" })).rejects.toBeInstanceOf(ConflictError);
    await svc.transition({ id: e.id, to: "scheduled" });
    for (const p of (await svc.detail(e.id)).papers) await svc.removePaper({ id: p.id });
    await expect(svc.transition({ id: e.id, to: "marks_open" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("will not publish until every mark is in, unless forced; then everything is locked", async () => {
    const { id, svc, maths, science } = await openExam("Publish rules");
    await expect(svc.transition({ id, to: "published" })).rejects.toThrow(/still missing/);
    const marks = new MarksService(a.as.admin);
    await marks.save({ paperId: maths.id, entries: entries([[fa.s1, 70], [fa.s2, 50], [fa.s3, 40], [fa.s4, 30]]) });
    await expect(svc.transition({ id, to: "published" })).rejects.toThrow(/4 marks are still missing/);
    await marks.save({ paperId: science.id, entries: entries([[fa.s1, 60], [fa.s2, 50], [fa.s3, null, true], [fa.s4, 33]]) });
    const published = await svc.transition({ id, to: "published" });
    expect(published.status).toBe("published");
    // locked
    await expect(marks.save({ paperId: maths.id, entries: entries([[fa.s1, 71]]) })).rejects.toThrow(/locked/);
    await expect(svc.transition({ id, to: "marks_open" })).rejects.toThrow(/cannot be changed/);
    await expect(svc.update(id, { yearId: fa.yearId, name: "Renamed", kind: "other", startsOn: "2026-09-22", endsOn: "2026-09-30" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.remove(id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("force publishes with missing marks, which then show as pending", async () => {
    const { id, svc, maths } = await openExam("Forced");
    await new MarksService(a.as.admin).save({ paperId: maths.id, entries: entries([[fa.s1, 70]]) });
    await svc.transition({ id, to: "published", force: "true" });
    const { result } = await new ResultService(a.as.admin).studentResult(id, fa.s1);
    expect(result.result).toBe("pending");
    expect(result.rank).toBeNull();
  });

  it("will not remove a paper that has marks", async () => {
    const { svc, maths, science } = await openExam("Paper removal");
    await new MarksService(a.as.admin).save({ paperId: maths.id, entries: entries([[fa.s1, 70]]) });
    await expect(svc.removePaper({ id: maths.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.removePaper({ id: science.id })).resolves.toEqual({ id: science.id });
  });

  it("permissions: only admins manage exams; teachers read; students and accountants cannot", async () => {
    await expect(new ExamService(a.as.teacher).createWithPapers(exam("Nope"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExamService(a.as.teacher).list()).resolves.toBeTruthy();
    await expect(new ExamService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExamService(a.as.accountant).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExamService(a.as.parent).create({})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B cannot list, get, update, transition or delete school A's exams", async () => {
    const { exam: e } = await new ExamService(a.as.admin).createWithPapers(exam("A only"));
    const bSvc = new ExamService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === e.id)).toBe(false);
    await expect(bSvc.get(e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.detail(e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(e.id, { yearId: fb.yearId, name: "Hacked", kind: "other", startsOn: "2026-09-22", endsOn: "2026-09-30" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.transition({ id: e.id, to: "scheduled" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(e.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("MarksService", () => {
  it("shows the roster and saves, updates and clears marks", async () => {
    const { maths } = await openExam("Marks grid");
    const svc = new MarksService(a.as.admin);
    expect((await svc.sheet(maths.id)).rows.map((r) => r.name)).toEqual(["Aarav Sharma", "Diya Patel", "Kabir Singh", "Meera Nair"]);
    expect(await svc.save({ paperId: maths.id, entries: entries([[fa.s1, 71.256], [fa.s2, null, true], [fa.s3, 0]]) })).toMatchObject({ saved: 3, cleared: 0 });
    let rows = (await svc.sheet(maths.id)).rows;
    expect(rows[0]).toMatchObject({ marks: 71.26, absent: false });
    expect(rows[1]).toMatchObject({ marks: null, absent: true });
    expect(rows[2]).toMatchObject({ marks: 0, absent: false });
    await svc.save({ paperId: maths.id, entries: entries([[fa.s1, 65], [fa.s2, null], [fa.s3, null]]) }); // update, clear absent, clear mark
    rows = (await svc.sheet(maths.id)).rows;
    expect(rows.map((r) => [r.marks, r.absent])).toEqual([[65, false], [null, false], [null, false], [null, false]]);
  });

  it("rejects marks above the maximum, naming the student", async () => {
    const { maths } = await openExam("Marks max");
    await expect(new MarksService(a.as.admin).save({ paperId: maths.id, entries: entries([[fa.s1, 81], [fa.s2, 20]]) }))
      .rejects.toMatchObject({ fieldErrors: { [fa.s1]: "Enter 0 to 80" } });
    await expect(new MarksService(a.as.admin).save({ paperId: maths.id, entries: entries([[fa.s1, -1]]) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is closed until marks are opened", async () => {
    const svc = new ExamService(a.as.admin);
    const { exam: e } = await svc.createWithPapers(exam("Not open"));
    const paper = (await svc.detail(e.id)).papers[0]!;
    await expect(new MarksService(a.as.admin).save({ paperId: paper.id, entries: entries([[fa.s1, 10]]) })).rejects.toThrow(/not open/);
  });

  it("a teacher enters marks only for the sections they teach that subject", async () => {
    const { maths, science } = await openExam("Teacher marks");
    const teacher = new MarksService(a.as.teacher);
    expect((await teacher.sheet(maths.id)).rows.map((r) => r.name)).toEqual(["Aarav Sharma", "Diya Patel", "Kabir Singh"]); // section A only
    await expect(teacher.save({ paperId: maths.id, entries: entries([[fa.s1, 50]]) })).resolves.toMatchObject({ saved: 1 });
    await expect(teacher.save({ paperId: maths.id, entries: entries([[fa.s4, 50]]) })).rejects.toBeInstanceOf(ForbiddenError); // section B
    await expect(teacher.sheet(science.id)).rejects.toBeInstanceOf(ForbiddenError); // does not teach Science
    const detail = await new ExamService(a.as.teacher).detail((await teacher.sheet(maths.id)).paper.examId);
    expect(detail.papers.map((p) => [p.subjectName, p.canEnter])).toEqual([["Maths", true], ["Science", false]]);
  });

  it("students, legacy parent logins and accountants cannot enter marks", async () => {
    const { maths } = await openExam("Marks perms");
    for (const who of [a.as.student, a.as.parent, a.as.accountant]) {
      await expect(new MarksService(who).save({ paperId: maths.id, entries: entries([[fa.s1, 50]]) })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new MarksService(who).sheet(maths.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("isolation: school B cannot read or write school A's marks", async () => {
    const { maths } = await openExam("Marks isolation");
    await expect(new MarksService(b.as.admin).sheet(maths.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new MarksService(b.as.admin).save({ paperId: maths.id, entries: entries([[fb.s1, 50]]) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("saves co-scholastic grades for co-scholastic subjects only", async () => {
    const { id } = await openExam("Co-scholastic");
    const svc = new MarksService(a.as.teacher);
    await expect(svc.saveCoScholastic({ examId: id, entries: JSON.stringify([{ studentId: fa.s1, subjectId: fa.art, grade: "A" }]) })).resolves.toMatchObject({ saved: 1 });
    await expect(svc.saveCoScholastic({ examId: id, entries: JSON.stringify([{ studentId: fa.s1, subjectId: fa.maths, grade: "A" }]) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ResultService", () => {
  let examId: string;
  beforeAll(async () => {
    const { id, svc, maths, science } = await openExam("Results");
    examId = id;
    const marks = new MarksService(a.as.admin);
    await marks.save({ paperId: maths.id, entries: entries([[fa.s1, 72], [fa.s2, 20], [fa.s3, null, true], [fa.s4, 40]]) });
    await marks.save({ paperId: science.id, entries: entries([[fa.s1, 60], [fa.s2, 50], [fa.s3, 40], [fa.s4, 40]]) });
    await marks.saveCoScholastic({ examId: id, entries: JSON.stringify([{ studentId: fa.s1, subjectId: fa.art, grade: "A" }]) });
    // publishing happens inside the tests that need it
    void svc;
  });

  it("computes a student's result and rank in the section (admin sees it before publish)", async () => {
    const { result } = await new ResultService(a.as.admin).studentResult(examId, fa.s1);
    expect(result).toMatchObject({ total: 132, maxTotal: 160, percent: 82.5, grade: "A2", result: "pass", rank: 1, sectionSize: 3 });
    expect(result.subjects.map((s) => [s.subject, s.marks, s.percent, s.grade, s.status])).toEqual([["Maths", 72, 90, "A2", "pass"], ["Science", 60, 75, "B1", "pass"]]);
    const kabir = (await new ResultService(a.as.admin).studentResult(examId, fa.s3)).result;
    expect(kabir).toMatchObject({ result: "fail", rank: 3, grade: "E1" });
    expect(kabir.subjects[0]).toMatchObject({ status: "absent", marks: null });
  });

  it("builds the class table: ranked, subject averages, pass percent", async () => {
    const r = await new ResultService(a.as.teacher).classResult(examId, fa.secA);
    expect(r.results.map((x) => [x.student.name, x.rank])).toEqual([["Aarav Sharma", 1], ["Diya Patel", 2], ["Kabir Singh", 3]]);
    expect(r.summary.passPercent).toBe(33.3);
    expect(r.summary.subjects.map((s) => s.subject)).toEqual(["Maths", "Science"]);
    expect(r.summary.subjects[1]).toMatchObject({ averagePercent: 62.5, passPercent: 100 });
    const other = await new ResultService(a.as.admin).classResult(examId, fa.secB);
    expect(other.results).toHaveLength(1);
  });

  it("students see results only after publish and only their own; a legacy parent sees nothing", async () => {
    const student = new ResultService(a.as.student);
    await expect(student.studentResult(examId, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ResultService(a.as.parent).studentResult(examId, fa.s1)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await student.mine())[0]!.items.some((i) => i.examId === examId)).toBe(false); // not published yet

    await new ExamService(a.as.admin).transition({ id: examId, to: "published" });

    expect((await student.studentResult(examId, fa.s1)).result.percent).toBe(82.5);
    expect((await student.studentResult(examId, fa.s1)).result.rank).toBe(1);
    await expect(student.studentResult(examId, fa.s2)).rejects.toBeInstanceOf(NotFoundError); // a classmate
    const mine = await student.mine();
    expect(mine[0]!.items.map((i) => [i.examName, i.grade, i.rank])).toContainEqual(["Results", "A2", 1]);
    await expect(student.classResult(examId, fa.secA)).rejects.toBeInstanceOf(ForbiddenError); // staff only
    await expect(new ResultService(a.as.accountant).studentResult(examId, fa.s1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists exams and the sections that sit one", async () => {
    const o = await new ResultService(a.as.admin).options(examId);
    expect(o.exams.some((e) => e.id === examId)).toBe(true);
    expect(o.sections.map((s) => s.label)).toEqual(["Class 6-A", "Class 6-B"]);
    expect((await new ResultService(a.as.admin).options()).sections).toEqual([]);
  });

  it("isolation: school B cannot read school A's results", async () => {
    await expect(new ResultService(b.as.admin).studentResult(examId, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ResultService(b.as.admin).classResult(examId, fa.secA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReportCardService(b.as.admin).pdf({ examId }, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("makes a report card PDF, and one combined PDF for a section", async () => {
    const svc = new ReportCardService(a.as.admin);
    const one = await svc.pdf({ examId }, fa.s1);
    expect(Buffer.from(one.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(one.filename).toBe("report-card-a1-results.pdf");
    const batch = await svc.classBatch(examId, fa.secA);
    expect(Buffer.from(batch.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(batch.bytes.length).toBeGreaterThan(one.bytes.length);
    // a student may download their own card, but not a classmate's, and not the batch
    await expect(new ReportCardService(a.as.student).pdf({ examId }, fa.s1)).resolves.toBeTruthy();
    await expect(new ReportCardService(a.as.student).pdf({ examId }, fa.s2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReportCardService(a.as.student).classBatch(examId, fa.secA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("makes a term report card across the term's exams", async () => {
    const pdf = await new ReportCardService(a.as.admin).pdf({ termId: fa.termId }, fa.s1);
    expect(pdf.bytes.length).toBeGreaterThan(1000);
    await expect(new ReportCardService(a.as.admin).pdf({ termId: fb.termId }, fa.s1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GradeScaleService", () => {
  it("creates the CBSE default once and grades with it", async () => {
    const svc = new GradeScaleService(a.as.admin);
    const id = await svc.ensureDefault();
    expect(await svc.ensureDefault()).toBe(id);
    expect(await svc.bands(id)).toHaveLength(9);
    expect((await svc.scale()).gradeFor(91).grade).toBe("A1");
  });

  it("a custom band set changes the grades; gaps are refused", async () => {
    const svc = new GradeScaleService(a.as.admin);
    const id = await svc.ensureDefault();
    await expect(svc.saveBands(id, [{ grade: "P", minPercent: 40, maxPercent: 100 }])).rejects.toMatchObject({ fieldErrors: { bands: expect.stringMatching(/start at 0/) } });
    await svc.saveBands(id, [{ grade: "Pass", minPercent: 35, maxPercent: 100 }, { grade: "Fail", minPercent: 0, maxPercent: 34 }]);
    expect((await svc.scale()).gradeFor(50).grade).toBe("Pass");
    await svc.saveBands(id, JSON.parse(JSON.stringify([
      { grade: "A1", minPercent: 91, maxPercent: 100, gradePoint: 10 }, { grade: "E", minPercent: 0, maxPercent: 90, gradePoint: 0 },
    ])));
    expect((await svc.scale()).gradeFor(50).grade).toBe("E");
  });

  it("only admins manage scales, the default cannot be deleted, schools are isolated", async () => {
    const id = await new GradeScaleService(a.as.admin).ensureDefault();
    await expect(new GradeScaleService(a.as.teacher).ensureDefault()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GradeScaleService(a.as.admin).remove(id)).rejects.toBeInstanceOf(ConflictError);
    await expect(new GradeScaleService(b.as.admin).get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new GradeScaleService(b.as.admin).saveBands(id, [{ grade: "A", minPercent: 0, maxPercent: 100 }])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("result notifications", () => {
  it("publishing tells each student login of the exam once, never the publisher", async () => {
    const { id, svc } = await openExam("Unit Test Notify");
    // Other tests in this file publish exams too, so count only this exam's notices.
    const notes = (school: TestSchool, userId: string) => withSchool(school.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.title, "Unit Test Notify results are out"))));
    expect(await notes(a, a.users.student)).toHaveLength(0);
    await svc.transition({ id, to: "published", force: true });
    const [kid] = await notes(a, a.users.student);
    expect(kid).toMatchObject({ kind: "result", title: "Unit Test Notify results are out", href: `/app/results/${id}/${fa.s1}` });
    expect(await notes(a, a.users.parent)).toHaveLength(0);
    expect(await notes(a, a.users.admin)).toHaveLength(0);
    expect(await notes(a, a.users.teacher)).toHaveLength(0);
    await svc.transition({ id, to: "published", force: true }); // a repeat is a no-op, not a second notice
    expect(await notes(a, a.users.student)).toHaveLength(1);
    for (const u of Object.values(b.users)) expect(await notes(b, u)).toHaveLength(0);
  });
});

describe("homework marks for internal assessment", () => {
  it("sums graded homework in the paper's subject within the exam's term, per student", async () => {
    const { maths } = await openExam("Homework IA");
    await withSchool(a.id, async (tx) => {
      const hw = async (subjectId: string, due: string, max: number | null) => {
        const [r] = [...await tx.execute<{ id: string }>(sql`insert into assignments (id, school_id, section_id, subject_id, title, due_at, max_marks, status)
          values (gen_random_uuid(), ${a.id}, ${fa.secA}, ${subjectId}, 'HW', ${due}::timestamptz, ${max}, 'published') returning id`)];
        return r!.id;
      };
      const sub = (assignmentId: string, studentId: string, marks: number | null, status: string) =>
        tx.execute(sql`insert into submissions (id, school_id, assignment_id, student_id, status, marks) values (gen_random_uuid(), ${a.id}, ${assignmentId}, ${studentId}, ${status}, ${marks})`);
      const h1 = await hw(fa.maths, "2026-05-10T10:00:00+05:30", 10), h2 = await hw(fa.maths, "2026-06-10T10:00:00+05:30", 20);
      const later = await hw(fa.maths, "2026-11-01T10:00:00+05:30", 10); // after the term ends
      const unmarked = await hw(fa.maths, "2026-07-01T10:00:00+05:30", null);
      const sci = await hw(fa.science, "2026-05-10T10:00:00+05:30", 10);
      await sub(h1, fa.s1, 8, "graded"); await sub(h2, fa.s1, 12, "returned"); await sub(later, fa.s1, 10, "graded"); await sub(unmarked, fa.s1, null, "submitted");
      await sub(h1, fa.s2, null, "submitted"); // handed in, not graded yet
      await sub(sci, fa.s3, 10, "graded"); // other subject
    });
    const withHw = (ctx: typeof a.as.admin) => ({ ...ctx, features: new Set([...ctx.features, "assignments"]) });
    const got = await new MarksService(withHw(a.as.admin)).homeworkMarks(maths.id);
    expect(Object.keys(got)).toEqual([fa.s1]);
    expect(got[fa.s1]!.graded).toBe(2);
    expect(got[fa.s1]!.pct).toBeCloseTo(20 / 30);
    expect(await new MarksService(withHw(a.as.teacher)).homeworkMarks(maths.id)).toHaveProperty(fa.s1); // teacher of Maths in A
    expect(await new MarksService(a.as.admin).homeworkMarks(maths.id)).toEqual({}); // Assignments module off
  });
});
