// Shared read queries for the exams services (one place, so exams, marks and results never repeat a join).
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { schools, type Tx } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { classSubjects, classes, sections, sectionTeachers, studentSubjects, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { CBSE_BANDS, CBSE_CO_GRADES, GradeScale, classBandOf, type Band, type StudentInfo } from "./grading";
import { coScholasticScales, examPapers, exams, gradeBands, gradeScales, marks, reportTemplates, type Board, type ClassBand, type CoGrade } from "./schema";

export type Exam = typeof exams.$inferSelect;
export type Paper = typeof examPapers.$inferSelect;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** A class band's report setup with its scales loaded; built-in CBSE defaults when the school has not set one. */
export interface Template {
  classBand: ClassBand; board: Board; scale: GradeScale; scaleId: string | null; coScaleId: string | null; coGrades: readonly CoGrade[];
  showGrade: boolean; showRank: boolean; termSplit: number[] | undefined;
}

export interface PaperProgress {
  id: string; classId: string; className: string; grade: number; subjectId: string; subjectName: string;
  date: string; maxMarks: number; passMarks: number; startTime: string | null; endTime: string | null;
  /** Active students who sit this paper, and how many have a mark or an absent flag. */
  students: number; entered: number;
}

export class ExamRepo {
  /** Reject anything that is not a uuid as "not found" before it reaches the database. */
  static uuid(id: string, what: string): string {
    if (!isUuid(id)) throw new NotFoundError(what);
    return id;
  }

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

  /** The given scale's bands, else the default scale's, else the built-in CBSE scale. */
  static async scale(tx: Tx, scaleId?: string | null): Promise<GradeScale> {
    const load = (where: SQL) => tx.select({ band: gradeBands }).from(gradeScales).innerJoin(gradeBands, eq(gradeBands.scaleId, gradeScales.id)).where(where);
    let rows = scaleId && isUuid(scaleId) ? await load(eq(gradeScales.id, scaleId)) : [];
    if (!rows.length) rows = await load(eq(gradeScales.isDefault, true));
    const bands: Band[] = rows.map((r) => r.band);
    return bands.length ? new GradeScale(bands) : new GradeScale(CBSE_BANDS);
  }

  /** The grades a co-scholastic scale offers: the given one, else the default one, else CBSE A-C. */
  static async coGrades(tx: Tx, coScaleId?: string | null): Promise<readonly CoGrade[]> {
    const [own] = coScaleId && isUuid(coScaleId) ? await tx.select().from(coScholasticScales).where(eq(coScholasticScales.id, coScaleId)).limit(1) : [];
    const [row] = own ? [own] : await tx.select().from(coScholasticScales).where(eq(coScholasticScales.isDefault, true)).limit(1);
    return row?.grades.length ? row.grades : CBSE_CO_GRADES;
  }

  /** The report setup for a class grade level. */
  static async template(tx: Tx, grade: number): Promise<Template> {
    const classBand = classBandOf(grade);
    const [t] = await tx.select().from(reportTemplates).where(eq(reportTemplates.classBand, classBand)).limit(1);
    const [scale, coGrades] = await Promise.all([ExamRepo.scale(tx, t?.scaleId), ExamRepo.coGrades(tx, t?.coScaleId)]);
    const split = t?.options?.termSplit;
    return { classBand, board: t?.board ?? "cbse", scale, scaleId: t?.scaleId ?? null, coScaleId: t?.coScaleId ?? null, coGrades, showGrade: t?.showGrade ?? true, showRank: t?.showRank ?? true, termSplit: split?.length ? split : undefined };
  }

  /** Who takes each elective: "classId:subjectId" to the student ids chosen for that year. Subjects that are not electives are absent from the map. */
  static async electiveTakers(tx: Tx, yearId: string, classIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!classIds.length) return out;
    const rows = await tx.select({ classId: classSubjects.classId, subjectId: classSubjects.subjectId, studentId: students.id }).from(classSubjects)
      .leftJoin(studentSubjects, and(eq(studentSubjects.subjectId, classSubjects.subjectId), eq(studentSubjects.yearId, yearId)))
      .leftJoin(students, and(eq(students.id, studentSubjects.studentId), eq(students.classId, classSubjects.classId), eq(students.status, "active")))
      .where(and(inArray(classSubjects.classId, classIds), eq(classSubjects.isElective, true)));
    for (const r of rows) {
      const set = out.get(`${r.classId}:${r.subjectId}`) ?? new Set<string>();
      if (r.studentId) set.add(r.studentId);
      out.set(`${r.classId}:${r.subjectId}`, set);
    }
    return out;
  }

  /** Working days and days present between two dates, read by raw SQL so the exams feature works without the attendance module. Null when there is no data. */
  static async attendance(tx: Tx, ctx: { schoolId: string; features: ReadonlySet<string> }, studentId: string, sectionId: string, from: string, to: string): Promise<{ working: number; present: number } | null> {
    if (!ctx.features.has("attendance") || !isUuid(studentId) || !isUuid(sectionId)) return null;
    const [have] = [...(await tx.execute(sql`select to_regclass('student_attendance') as a, to_regclass('attendance_holidays') as h, to_regproc('school_day_closed') as f`))] as { a: string | null; h: string | null; f: string | null }[];
    if (!have?.a) return null;
    // The rule lives in attendance/sql/20-closed.sql (this feature reads attendance by name only); the function reads holidays under row-level security.
    const open = have.h && have.f ? sql`and not school_day_closed(a.date, (select s.class_id from sections s where s.id = ${sectionId}::uuid))` : sql``;
    const [r] = [...(await tx.execute(sql`
      select
        (select count(distinct a.date) from student_attendance a where a.school_id = ${ctx.schoolId} and a.section_id = ${sectionId} and a.date between ${from} and ${to} ${open}) as working,
        (select count(*) from student_attendance a where a.school_id = ${ctx.schoolId} and a.student_id = ${studentId} and a.date between ${from} and ${to} and a.status in ('present', 'late') ${open}) as present`))] as { working: string | number; present: string | number }[];
    const working = Number(r?.working ?? 0);
    return working > 0 ? { working, present: Math.min(working, Number(r?.present ?? 0)) } : null;
  }

  /** Every paper of an exam with how many marks are in. */
  static async progress(tx: Tx, exam: Exam): Promise<PaperProgress[]> {
    const papers = await tx.select({
      id: examPapers.id, classId: examPapers.classId, className: classes.name, grade: classes.grade, subjectId: examPapers.subjectId,
      subjectName: subjects.name, date: examPapers.date, maxMarks: examPapers.maxMarks, passMarks: examPapers.passMarks, startTime: examPapers.startTime, endTime: examPapers.endTime,
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
    const takers = await ExamRepo.electiveTakers(tx, exam.yearId, [...size.keys()]);
    return papers.map((p) => ({ ...p, students: takers.get(`${p.classId}:${p.subjectId}`)?.size ?? size.get(p.classId) ?? 0, entered: done.get(p.id) ?? 0 }));
  }

  /** School name and address lines for report cards. */
  static async school(tx: Tx) {
    const [s] = await tx.select({ name: schools.name, address: schools.address, city: schools.city, state: schools.state, board: schools.board, phone: schools.phone, udiseCode: schools.udiseCode }).from(schools).limit(1);
    return s ?? { name: "School", address: null, city: null, state: null, board: null, phone: null, udiseCode: null };
  }
}
