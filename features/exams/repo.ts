// Shared read queries for the exams services (one place, so exams, marks and results never repeat a join).
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { schools, type Tx } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { CBSE_BANDS, GradeScale, type Band, type StudentInfo } from "./grading";
import { examPapers, exams, gradeBands, gradeScales, marks } from "./schema";

export type Exam = typeof exams.$inferSelect;
export type Paper = typeof examPapers.$inferSelect;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface PaperProgress {
  id: string; classId: string; className: string; grade: number; subjectId: string; subjectName: string;
  date: string; maxMarks: number; passMarks: number;
  /** Active students who sit this paper, and how many have a mark or an absent flag. */
  students: number; entered: number;
}

export class ExamRepo {
  static async exam(tx: Tx, id: string): Promise<Exam> {
    if (!isUuid(id)) throw new NotFoundError("Exam");
    const [row] = await tx.select().from(exams).where(eq(exams.id, id)).limit(1);
    if (!row) throw new NotFoundError("Exam");
    return row;
  }

  static async paper(tx: Tx, id: string): Promise<{ paper: Paper; exam: Exam }> {
    if (!isUuid(id)) throw new NotFoundError("Paper");
    const [row] = await tx.select({ paper: examPapers, exam: exams }).from(examPapers).innerJoin(exams, eq(exams.id, examPapers.examId)).where(eq(examPapers.id, id)).limit(1);
    if (!row) throw new NotFoundError("Paper");
    return row;
  }

  /** Active students of a class in the sections of the exam's year, in section then roll order. */
  static async students(tx: Tx, classId: string, yearId: string, sectionIds?: string[]): Promise<StudentInfo[]> {
    if (sectionIds && sectionIds.length === 0) return [];
    const rows = await tx.select({
      id: students.id, name: students.name, admissionNo: students.admissionNo, rollNo: students.rollNo, dob: students.dob,
      sectionId: sections.id, sectionName: sections.name, classId: classes.id, className: classes.name,
    }).from(students)
      .innerJoin(sections, eq(sections.id, students.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .where(and(eq(sections.classId, classId), eq(sections.yearId, yearId), eq(students.status, "active"), sectionIds ? inArray(sections.id, sectionIds) : undefined))
      .orderBy(asc(sections.name), sql`${students.rollNo} asc nulls last`, asc(students.name));
    return rows;
  }

  /** Sections of one class and subject that this teacher teaches in the exam's year. */
  static async teachingSections(tx: Tx, teacherId: string, yearId: string, classId: string, subjectId: string): Promise<string[]> {
    const rows = await tx.select({ id: sectionTeachers.sectionId }).from(sectionTeachers)
      .innerJoin(sections, eq(sections.id, sectionTeachers.sectionId))
      .where(and(eq(sectionTeachers.teacherId, teacherId), eq(sectionTeachers.subjectId, subjectId), eq(sections.classId, classId), eq(sections.yearId, yearId)));
    return rows.map((r) => r.id);
  }

  /** Every (class, subject) this teacher teaches in a year, as "classId:subjectId". */
  static async teacherSlots(tx: Tx, teacherId: string, yearId: string): Promise<Set<string>> {
    const rows = await tx.select({ classId: sections.classId, subjectId: sectionTeachers.subjectId }).from(sectionTeachers)
      .innerJoin(sections, eq(sections.id, sectionTeachers.sectionId))
      .where(and(eq(sectionTeachers.teacherId, teacherId), eq(sections.yearId, yearId)));
    return new Set(rows.map((r) => `${r.classId}:${r.subjectId}`));
  }

  /** The default scale's bands, or the built-in CBSE scale when the school has not set one up. */
  static async scale(tx: Tx): Promise<GradeScale> {
    const rows = await tx.select({ band: gradeBands }).from(gradeScales).innerJoin(gradeBands, eq(gradeBands.scaleId, gradeScales.id)).where(eq(gradeScales.isDefault, true));
    const bands: Band[] = rows.map((r) => r.band);
    return bands.length ? new GradeScale(bands) : new GradeScale(CBSE_BANDS);
  }

  /** Every paper of an exam with how many marks are in. */
  static async progress(tx: Tx, exam: Exam): Promise<PaperProgress[]> {
    const papers = await tx.select({
      id: examPapers.id, classId: examPapers.classId, className: classes.name, grade: classes.grade, subjectId: examPapers.subjectId,
      subjectName: subjects.name, date: examPapers.date, maxMarks: examPapers.maxMarks, passMarks: examPapers.passMarks,
    }).from(examPapers)
      .innerJoin(classes, eq(classes.id, examPapers.classId))
      .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
      .where(eq(examPapers.examId, exam.id))
      .orderBy(asc(classes.grade), asc(classes.name), asc(examPapers.date), asc(subjects.name));
    if (papers.length === 0) return [];
    const [roster, entered] = await Promise.all([
      tx.select({ classId: sections.classId, n: count() }).from(students).innerJoin(sections, eq(sections.id, students.sectionId))
        .where(and(inArray(sections.classId, [...new Set(papers.map((p) => p.classId))]), eq(sections.yearId, exam.yearId), eq(students.status, "active"))).groupBy(sections.classId),
      tx.select({ paperId: marks.paperId, n: count() }).from(marks).where(inArray(marks.paperId, papers.map((p) => p.id))).groupBy(marks.paperId),
    ]);
    const size = new Map(roster.map((r) => [r.classId, Number(r.n)]));
    const done = new Map(entered.map((r) => [r.paperId, Number(r.n)]));
    return papers.map((p) => ({ ...p, students: size.get(p.classId) ?? 0, entered: done.get(p.id) ?? 0 }));
  }

  /** School name and address lines for report cards. */
  static async school(tx: Tx) {
    const [s] = await tx.select({ name: schools.name, address: schools.address, city: schools.city, state: schools.state, board: schools.board, phone: schools.phone, udiseCode: schools.udiseCode }).from(schools).limit(1);
    return s ?? { name: "School", address: null, city: null, state: null, board: null, phone: null, udiseCode: null };
  }
}
