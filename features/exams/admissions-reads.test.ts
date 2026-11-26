import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classSubjects, classes, sections, studentSubjects, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { AdmitCardService, ExamService, MarksService, ResultService } from "./service";

let a: TestSchool;
let secId: string, classId: string, yearId: string, termId: string;
let active: string, left: string, leftNoMarks: string, joining: string;
const FEATURES = ["academics", "students", "exams"];

beforeAll(async () => {
  ({ a } = await createSchoolPair(FEATURES, "-xj"));
  await withSchool(a.id, async (tx) => {
    const sid = a.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [term] = await tx.insert(terms).values({ schoolId: sid, yearId: year!.id, name: "Term 1", startsOn: "2026-04-01", endsOn: "2026-09-30" }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 6", grade: 6 }).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A" }).returning();
    const [maths, music] = await tx.insert(subjects).values([{ schoolId: sid, name: "Maths" }, { schoolId: sid, name: "Music" }]).returning();
    await tx.insert(classSubjects).values([{ schoolId: sid, classId: cls!.id, subjectId: maths!.id }, { schoolId: sid, classId: cls!.id, subjectId: music!.id, isElective: true }]);
    const base = { schoolId: sid, classId: cls!.id };
    const st = await tx.insert(students).values([
      { ...base, admissionNo: "A1", name: "Aarav Active", sectionId: sec!.id, rollNo: 1, userId: a.users.student },
      { ...base, admissionNo: "A2", name: "Laksh Left", sectionId: sec!.id, rollNo: 2 },
      { ...base, admissionNo: "A3", name: "Leela Left", sectionId: sec!.id, rollNo: 3 },
      { ...base, admissionNo: "A4", name: "Jiya Joining", status: "joining", joinsSectionId: sec!.id, joinsYearId: year!.id },
    ]).returning();
    // Aarav and Laksh both chose Music
    await tx.insert(studentSubjects).values([st[0]!, st[1]!].map((k) => ({ schoolId: sid, studentId: k.id, yearId: year!.id, subjectId: music!.id })));
    [secId, classId, yearId, termId] = [sec!.id, cls!.id, year!.id, term!.id];
    [active, left, leftNoMarks, joining] = st.map((s) => s.id) as [string, string, string, string];
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("are on no mark sheet or hall list, and the left child's old result and card still open", async () => {
    const svc = new ExamService(a.as.admin);
    const { exam } = await svc.createWithPapers({ yearId, termId, name: "Unit 1", kind: "half_yearly", startsOn: "2026-09-22", endsOn: "2026-09-30", classIds: [classId], subjectIds: [], maxMarks: "80", passMarks: "27" });
    await svc.transition({ id: exam.id, to: "scheduled" });
    await svc.transition({ id: exam.id, to: "marks_open" });
    const papers = (await svc.detail(exam.id)).papers;
    const paper = papers.find((p) => p.subjectName === "Maths")!, musicPaper = papers.find((p) => p.subjectName === "Music")!;
    const marks = new MarksService(a.as.admin);
    // Laksh sits the exam, then leaves; Leela leaves before any marks go in.
    await marks.save({ paperId: paper.id, entries: JSON.stringify([{ studentId: active, marks: 60, absent: false }, { studentId: left, marks: 50, absent: false }]) });
    await marks.save({ paperId: musicPaper.id, entries: JSON.stringify([{ studentId: active, marks: 70, absent: false }, { studentId: left, marks: 65, absent: false }]) });
    await withSchool(a.id, async (tx) => {
      await tx.update(students).set({ status: "left", leftOn: "2026-09-25" }).where(eq(students.id, left));
      await tx.update(students).set({ status: "left", leftOn: "2026-09-01" }).where(eq(students.id, leftNoMarks));
    });

    expect((await marks.sheet(paper.id)).rows.map((r) => r.studentId)).toEqual([active]);
    expect((await svc.detail(exam.id)).papers.map((p) => p.students)).toEqual([1, 1]);
    await svc.transition({ id: exam.id, to: "published" });

    const results = new ResultService(a.as.admin);
    expect((await results.classResult(exam.id, secId)).results.map((r) => r.student.id).sort()).toEqual([active, left].sort());
    // the left child's result still counts the elective they sat
    const old = (await results.studentResult(exam.id, left)).result;
    expect(old).toMatchObject({ result: "pass" });
    expect(old.subjects.map((x) => x.subject).sort()).toEqual(["Maths", "Music"]);
    await expect(results.studentResult(exam.id, leftNoMarks)).rejects.toBeInstanceOf(NotFoundError);
    await expect(results.studentResult(exam.id, joining)).rejects.toBeInstanceOf(NotFoundError);

    const cards = new AdmitCardService(a.as.admin);
    await expect(cards.pdf(exam.id, left)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cards.pdf(exam.id, joining)).rejects.toBeInstanceOf(NotFoundError);
    expect((await cards.pdf(exam.id, active)).filename).toContain("admit-card");
  });
});
