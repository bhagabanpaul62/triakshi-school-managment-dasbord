import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { CrudService, ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { academicYears, classSubjects, classes, sections, subjects, terms } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import examsFeature from "./feature";
import {
  coScholasticInput, examInput, examWithPapersInput, gradeBandsInput, gradeScaleInput, marksSaveInput, papersInput, removePaperInput, transitionInput,
  type PapersInput,
} from "./inputs";
import { CBSE_BANDS, GradeScale, ResultCalculator, spreadDates, type ClassSummary, type PaperInfo, type StudentResult } from "./grading";
import { ExamRepo, type Exam, type PaperProgress } from "./repo";
import { ReportCardLayout, type ReportCard } from "./report-card";
import { coScholasticGrades, examPapers, exams, gradeBands, gradeScales, marks, type ExamStatus } from "./schema";

type Perm = keyof typeof examsFeature.permissions;
export type { Exam, PaperProgress } from "./repo";
export type GradeScaleRow = typeof gradeScales.$inferSelect;

// ---------- grade scales ----------

/** Grade scales. One is the default; the CBSE 9-point scale is created on first use and can be edited. */
export class GradeScaleService extends CrudService<typeof gradeScales, Perm> {
  protected feature = examsFeature;
  protected table = gradeScales;
  protected entityName = "Grade scale";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = gradeScaleInput;
  protected updateSchema = gradeScaleInput;
  protected searchColumns() { return [gradeScales.name]; }
  protected describe(r: GradeScaleRow) { return r.name; }

  private async clearDefault(tx: Tx) { await tx.update(gradeScales).set({ isDefault: false }).where(eq(gradeScales.isDefault, true)); }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { if (data.isDefault) await this.clearDefault(tx); return data; }
  protected async beforeUpdate(tx: Tx, _e: GradeScaleRow, data: Record<string, unknown>) { if (data.isDefault) await this.clearDefault(tx); return data; }
  protected async beforeRemove(_tx: Tx, e: GradeScaleRow) { if (e.isDefault) throw new ConflictError("Make another scale the default before deleting this one."); }

  /** The scale used for grades: the default one, or CBSE when none is set. */
  async scale(): Promise<GradeScale> { return this.read("read", (tx) => ExamRepo.scale(tx)); }

  async bands(scaleId: string) {
    return this.read("read", (tx) => tx.select().from(gradeBands).where(eq(gradeBands.scaleId, scaleId)).orderBy(desc(gradeBands.minPercent)));
  }

  /** Create the CBSE 9-point scale as the default when the school has no default scale yet. Safe to call again. */
  async ensureDefault(): Promise<string> {
    return this.write("manage", async (tx) => {
      const [have] = await tx.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.isDefault, true)).limit(1);
      if (have) return have.id;
      const [scale] = await tx.insert(gradeScales).values({ schoolId: this.ctx.schoolId, name: "CBSE 9-point", isDefault: true }).returning();
      await tx.insert(gradeBands).values(CBSE_BANDS.map((b) => ({ ...b, schoolId: this.ctx.schoolId, scaleId: scale!.id })));
      return scale!.id;
    });
  }

  /** Replace all bands of a scale. They must cover 0-100 once, with no gaps or overlaps. */
  async saveBands(scaleId: string, input: unknown) {
    this.authorize("manage", "write");
    const bands = this.parse(gradeBandsInput, input);
    const problem = GradeScale.problem(bands);
    if (problem) throw new ValidationError({ bands: problem });
    return this.write("manage", async (tx) => {
      await this.findOrThrow(tx, scaleId);
      await tx.delete(gradeBands).where(eq(gradeBands.scaleId, scaleId));
      await tx.insert(gradeBands).values(bands.map((b) => ({ ...b, remark: b.remark ?? null, schoolId: this.ctx.schoolId, scaleId })));
      return { scaleId, bands: bands.length };
    }, (r) => ({ action: "update", entity: this.entityName, entityId: r.scaleId, summary: `Saved ${r.bands} grade bands` }));
  }
}

// ---------- exams ----------

const NEXT: Record<ExamStatus, ExamStatus[]> = { draft: ["scheduled"], scheduled: ["marks_open", "draft"], marks_open: ["published", "scheduled"], published: [] };
const STATUS_NAME: Record<ExamStatus, string> = { draft: "draft", scheduled: "scheduled", marks_open: "open for marks", published: "published" };

export interface ExamDetail {
  exam: Exam;
  yearName: string;
  termName: string | null;
  papers: (PaperProgress & { canEnter: boolean })[];
  totals: { papers: number; slots: number; entered: number; missing: number; percent: number };
}

export class ExamService extends CrudService<typeof exams, Perm> {
  protected feature = examsFeature;
  protected table = exams;
  protected entityName = "Exam";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = examInput;
  protected updateSchema = examInput;
  protected defaultSort = "startsOn";

  protected searchColumns() { return [exams.name]; }
  protected sortColumns() { return { startsOn: exams.startsOn, name: exams.name, createdAt: exams.createdAt }; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.status ? eq(exams.status, f.status as ExamStatus) : undefined, f.kind ? eq(exams.kind, f.kind as Exam["kind"]) : undefined];
  }
  protected describe(r: Exam) { return r.name; }

  private static assertEditable(e: Exam) { if (e.status === "published") throw new ConflictError("Results are published, so this exam is locked."); }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    await this.checkYearAndTerm(tx, String(data.yearId), data.termId ? String(data.termId) : undefined);
    return { ...data, status: "draft" };
  }
  protected async beforeUpdate(tx: Tx, existing: Exam, data: Record<string, unknown>) {
    ExamService.assertEditable(existing);
    if (data.yearId !== existing.yearId) {
      const [has] = await tx.select({ n: count() }).from(examPapers).where(eq(examPapers.examId, existing.id));
      if (Number(has?.n ?? 0) > 0) throw new ConflictError("Papers are already set up for this year. Remove them before changing the academic year.");
    }
    await this.checkYearAndTerm(tx, String(data.yearId), data.termId ? String(data.termId) : undefined);
    return { ...data, termId: data.termId ?? null };
  }
  protected async beforeRemove(_tx: Tx, existing: Exam) { ExamService.assertEditable(existing); }

  private async checkYearAndTerm(tx: Tx, yearId: string, termId?: string) {
    const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
    if (!year) throw new ValidationError({ yearId: "Pick the academic year" });
    if (!termId) return;
    const [term] = await tx.select({ id: terms.id }).from(terms).where(and(eq(terms.id, termId), eq(terms.yearId, yearId))).limit(1);
    if (!term) throw new ValidationError({ termId: "That term is not in this academic year" });
  }

  /** The exam list with the number of papers on each. */
  async listWithPapers(query: Parameters<ExamService["list"]>[0] = {}) {
    const page = await this.list(query);
    const ids = page.rows.map((r) => r.id);
    const counts = ids.length ? await this.read("read", (tx) => tx.select({ examId: examPapers.examId, n: count() }).from(examPapers).where(inArray(examPapers.examId, ids)).groupBy(examPapers.examId)) : [];
    const byExam = new Map(counts.map((c) => [c.examId, Number(c.n)]));
    return { ...page, rows: page.rows.map((r) => ({ ...r, papers: byExam.get(r.id) ?? 0 })) };
  }

  /** Papers to insert: each class's scholastic subjects (optionally only the chosen ones), dates spread across the exam window. */
  private async insertPapers(tx: Tx, exam: Exam, spec: PapersInput): Promise<number> {
    const rows = await tx.select({ classId: classSubjects.classId, subjectId: subjects.id, name: subjects.name }).from(classSubjects)
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .where(and(inArray(classSubjects.classId, spec.classIds), eq(subjects.kind, "scholastic"), spec.subjectIds.length ? inArray(subjects.id, spec.subjectIds) : undefined))
      .orderBy(asc(subjects.name));
    if (rows.length === 0) throw new ValidationError({ classIds: "These classes have no subjects set up yet" });
    const values = spec.classIds.flatMap((classId) => {
      const own = rows.filter((r) => r.classId === classId);
      const dates = spreadDates(exam.startsOn, exam.endsOn, own.length);
      return own.map((r, i) => ({ schoolId: this.ctx.schoolId, examId: exam.id, classId, subjectId: r.subjectId, date: dates[i]!, maxMarks: spec.maxMarks, passMarks: spec.passMarks }));
    });
    const added = await tx.insert(examPapers).values(values).onConflictDoNothing().returning({ id: examPapers.id });
    return added.length;
  }

  /** Create an exam and its papers for the chosen classes and subjects in one go. */
  async createWithPapers(input: unknown) {
    this.authorize("manage", "write");
    const { classIds, subjectIds, maxMarks, passMarks, ...examData } = this.parse(examWithPapersInput, input);
    return this.write("manage", async (tx) => {
      const values = await this.beforeCreate(tx, examData);
      const [exam] = await tx.insert(exams).values({ ...values, schoolId: this.ctx.schoolId } as never).returning();
      const papers = await this.insertPapers(tx, exam!, { classIds, subjectIds, maxMarks, passMarks });
      return { exam: exam!, papers };
    }, (r) => ({ action: "create", entity: this.entityName, entityId: r.exam.id, summary: `Added exam ${r.exam.name} with ${r.papers} papers` }));
  }

  /** Add more papers to an exam that is not published (existing class and subject pairs are kept as they are). */
  async addPapers(examId: string, input: unknown) {
    this.authorize("manage", "write");
    const spec = this.parse(papersInput, input);
    return this.write("manage", async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      ExamService.assertEditable(exam);
      return { examId, added: await this.insertPapers(tx, exam, spec) };
    }, (r) => ({ action: "update", entity: this.entityName, entityId: examId, summary: `Added ${r.added} papers` }));
  }

  async removePaper(input: unknown) {
    this.authorize("manage", "write");
    const { id } = this.parse(removePaperInput, input);
    return this.write("manage", async (tx) => {
      const { paper, exam } = await ExamRepo.paper(tx, id);
      ExamService.assertEditable(exam);
      const [entered] = await tx.select({ n: count() }).from(marks).where(eq(marks.paperId, id));
      if (Number(entered?.n ?? 0) > 0) throw new ConflictError("Marks are already entered for this paper, so it cannot be removed.");
      await tx.delete(examPapers).where(eq(examPapers.id, paper.id));
      return { id };
    }, (r) => ({ action: "delete", entity: "Exam paper", entityId: r.id, summary: "Removed an exam paper" }));
  }

  /** Move an exam along draft, scheduled, marks open, published. Publishing needs every mark in unless `force` is set; published exams never reopen. */
  async transition(input: unknown) {
    this.authorize("manage", "write");
    const { id, to, force } = this.parse(transitionInput, input);
    return this.write("manage", async (tx) => {
      const exam = await ExamRepo.exam(tx, id);
      if (exam.status === to) return exam;
      if (!NEXT[exam.status].includes(to)) {
        throw new ConflictError(exam.status === "published" ? "Results are published and cannot be changed." : `An exam that is ${STATUS_NAME[exam.status]} cannot go straight to ${STATUS_NAME[to]}.`);
      }
      const papers = await ExamRepo.progress(tx, exam);
      if (to !== "draft" && papers.length === 0) throw new ConflictError("Add at least one paper before moving this exam on.");
      if (to === "published") {
        const missing = papers.reduce((n, p) => n + Math.max(0, p.students - p.entered), 0);
        if (missing > 0 && !force) throw new ConflictError(`${missing} marks are still missing. Finish marks entry, or publish anyway to show them as pending.`);
      }
      const [row] = await tx.update(exams).set({ status: to }).where(eq(exams.id, id)).returning();
      if (to === "published") await this.notifyPublished(tx, row!);
      return row!;
    }, (r) => ({ action: "status", entity: this.entityName, entityId: r.id, summary: `${r.name} is now ${STATUS_NAME[r.status]}`, meta: { force } }));
  }

  /** Tell every student sitting the exam, and their guardians, that results are out (each gets a link to that student's result). */
  private async notifyPublished(tx: Tx, exam: Exam) {
    const kids = await tx.selectDistinct({ id: students.id, name: students.name, userId: students.userId }).from(students)
      .innerJoin(examPapers, and(eq(examPapers.classId, students.classId), eq(examPapers.examId, exam.id))).where(eq(students.status, "active"));
    if (!kids.length) return;
    const links = await tx.select({ studentId: studentGuardians.studentId, userId: guardians.userId }).from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(inArray(studentGuardians.studentId, kids.map((k) => k.id)));
    const rows = kids.flatMap((k) => [k.userId, ...links.filter((l) => l.studentId === k.id).map((l) => l.userId)]
      .filter((u): u is string => !!u && u !== this.ctx.userId)
      .map((userId) => ({ userId, kind: "result" as const, title: `${exam.name} results are out`, body: k.name, href: `/app/results/${exam.id}/${k.id}` })));
    await NotificationWriter.insert(tx, this.ctx.schoolId, rows);
  }

  /** One exam with its papers and how far marks entry has got. */
  async detail(id: string): Promise<ExamDetail> {
    return this.read("read", async (tx) => {
      const exam = await ExamRepo.exam(tx, id);
      const [papers, slots, year, term] = await Promise.all([
        ExamRepo.progress(tx, exam),
        this.ctx.role === "admin" ? Promise.resolve(null) : ExamRepo.teacherSlots(tx, this.ctx.userId, exam.yearId),
        tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, exam.yearId)).limit(1),
        exam.termId ? tx.select({ name: terms.name }).from(terms).where(eq(terms.id, exam.termId)).limit(1) : Promise.resolve([]),
      ]);
      const slotsTotal = papers.reduce((n, p) => n + p.students, 0);
      const entered = papers.reduce((n, p) => n + Math.min(p.entered, p.students), 0);
      return {
        exam, yearName: year[0]?.name ?? "", termName: term[0]?.name ?? null,
        papers: papers.map((p) => ({ ...p, canEnter: slots === null || slots.has(`${p.classId}:${p.subjectId}`) })),
        totals: { papers: papers.length, slots: slotsTotal, entered, missing: slotsTotal - entered, percent: slotsTotal ? Math.round((entered / slotsTotal) * 100) : 0 },
      };
    });
  }

  /** Choices for the create-exam form. */
  async formOptions() {
    return this.read("read", async (tx) => {
      const [years, termRows, classRows, subjectRows] = await Promise.all([
        tx.select().from(academicYears).orderBy(desc(academicYears.startsOn)),
        tx.select().from(terms).orderBy(asc(terms.startsOn)),
        tx.select().from(classes).orderBy(asc(classes.grade), asc(classes.name)),
        tx.select().from(subjects).where(eq(subjects.kind, "scholastic")).orderBy(asc(subjects.name)),
      ]);
      const yearName = new Map(years.map((y) => [y.id, y.name]));
      return {
        years: years.map((y) => ({ value: y.id, label: y.name + (y.isCurrent ? " (current)" : ""), isCurrent: y.isCurrent })),
        terms: termRows.map((t) => ({ value: t.id, label: `${t.name} (${yearName.get(t.yearId) ?? ""})` })),
        classes: classRows.map((c) => ({ value: c.id, label: c.name })),
        subjects: subjectRows.map((s) => ({ value: s.id, label: s.name })),
      };
    });
  }
}

// ---------- marks ----------

export interface MarkSheet {
  paper: { id: string; examId: string; examName: string; status: ExamStatus; className: string; subjectName: string; date: string; maxMarks: number; passMarks: number };
  /** Marks can be changed right now. */
  editable: boolean;
  rows: { studentId: string; name: string; rollNo: number | null; sectionName: string; marks: number | null; absent: boolean }[];
}

/** Marks entry. Admins enter any paper; a teacher only for the sections they teach that subject. */
export class MarksService extends SchoolService<Perm> {
  protected feature = examsFeature;

  /** Students this caller may enter marks for on a paper. */
  private async roster(tx: Tx, paper: { classId: string; subjectId: string }, exam: Exam) {
    if (this.ctx.role === "admin") return ExamRepo.students(tx, paper.classId, exam.yearId);
    const mine = await ExamRepo.teachingSections(tx, this.ctx.userId, exam.yearId, paper.classId, paper.subjectId);
    if (mine.length === 0) throw new ForbiddenError("You do not teach this subject to this class.");
    return ExamRepo.students(tx, paper.classId, exam.yearId, mine);
  }

  async sheet(paperId: string): Promise<MarkSheet> {
    return this.read("marks", async (tx) => {
      const { paper, exam } = await ExamRepo.paper(tx, paperId);
      const [roster, rows, names] = await Promise.all([
        this.roster(tx, paper, exam),
        tx.select().from(marks).where(eq(marks.paperId, paperId)),
        tx.select({ className: classes.name, subjectName: subjects.name }).from(classes).innerJoin(subjects, eq(subjects.id, paper.subjectId)).where(eq(classes.id, paper.classId)).limit(1),
      ]);
      const byStudent = new Map(rows.map((m) => [m.studentId, m]));
      return {
        paper: { id: paper.id, examId: exam.id, examName: exam.name, status: exam.status, className: names[0]?.className ?? "", subjectName: names[0]?.subjectName ?? "", date: paper.date, maxMarks: paper.maxMarks, passMarks: paper.passMarks },
        editable: exam.status === "marks_open",
        rows: roster.map((s) => ({ studentId: s.id, name: s.name, rollNo: s.rollNo, sectionName: s.sectionName, marks: byStudent.get(s.id)?.marksObtained ?? null, absent: byStudent.get(s.id)?.isAbsent ?? false })),
      };
    });
  }

  /** Save a grid of marks. A blank entry clears the mark; absent stores no number. Locked once the exam is published. */
  async save(input: unknown) {
    this.authorize("marks", "write");
    const data = this.parse(marksSaveInput, input);
    return this.write("marks", async (tx) => {
      const { paper, exam } = await ExamRepo.paper(tx, data.paperId);
      if (exam.status === "published") throw new ConflictError("Results are published, so marks are locked.");
      if (exam.status !== "marks_open") throw new ConflictError("Marks entry is not open for this exam yet.");
      const allowed = new Set((await this.roster(tx, paper, exam)).map((s) => s.id));
      const errors: Record<string, string> = {};
      const upserts: (typeof marks.$inferInsert)[] = [];
      const clears: string[] = [];
      for (const e of data.entries) {
        if (!allowed.has(e.studentId)) {
          if (this.ctx.role !== "admin") throw new ForbiddenError("You can only enter marks for the sections you teach.");
          errors[e.studentId] = "Not in this class";
        } else if (e.absent) {
          upserts.push({ schoolId: this.ctx.schoolId, paperId: paper.id, studentId: e.studentId, marksObtained: null, isAbsent: true, enteredBy: this.ctx.userId });
        } else if (e.marks === null) {
          clears.push(e.studentId);
        } else if (e.marks > paper.maxMarks) {
          errors[e.studentId] = `Enter 0 to ${paper.maxMarks}`;
        } else {
          upserts.push({ schoolId: this.ctx.schoolId, paperId: paper.id, studentId: e.studentId, marksObtained: Math.round(e.marks * 100) / 100, isAbsent: false, enteredBy: this.ctx.userId });
        }
      }
      if (Object.keys(errors).length) throw new ValidationError(errors, "Some marks are not valid.");
      if (upserts.length) {
        await tx.insert(marks).values(upserts).onConflictDoUpdate({
          target: [marks.paperId, marks.studentId],
          set: { marksObtained: sql`excluded.marks_obtained`, isAbsent: sql`excluded.is_absent`, enteredBy: sql`excluded.entered_by`, updatedAt: sql`now()` },
        });
      }
      if (clears.length) await tx.delete(marks).where(and(eq(marks.paperId, paper.id), inArray(marks.studentId, clears)));
      return { paperId: paper.id, saved: upserts.length, cleared: clears.length };
    }, (r) => ({ action: "save", entity: "Marks", entityId: r.paperId, summary: `Saved ${r.saved} marks${r.cleared ? `, cleared ${r.cleared}` : ""}` }));
  }

  /** Co-scholastic grades (art, sports, discipline...) for report cards. Same lock as marks. */
  async saveCoScholastic(input: unknown) {
    this.authorize("marks", "write");
    const data = this.parse(coScholasticInput, input);
    return this.write("marks", async (tx) => {
      const exam = await ExamRepo.exam(tx, data.examId);
      if (exam.status === "published") throw new ConflictError("Results are published, so grades are locked.");
      const wanted = [...new Set(data.entries.map((e) => e.subjectId))];
      const valid = await tx.select({ id: subjects.id }).from(subjects).where(and(inArray(subjects.id, wanted), eq(subjects.kind, "co_scholastic")));
      if (valid.length !== wanted.length) throw new ValidationError({ subjectId: "Choose co-scholastic subjects only" });
      await tx.insert(coScholasticGrades).values(data.entries.map((e) => ({ ...e, schoolId: this.ctx.schoolId, examId: exam.id })))
        .onConflictDoUpdate({ target: [coScholasticGrades.examId, coScholasticGrades.studentId, coScholasticGrades.subjectId], set: { grade: sql`excluded.grade`, updatedAt: sql`now()` } });
      return { examId: exam.id, saved: data.entries.length };
    }, (r) => ({ action: "save", entity: "Co-scholastic grades", entityId: r.examId, summary: `Saved ${r.saved} grades` }));
  }
}

// ---------- results ----------

export interface SectionResults {
  exam: Exam;
  section: { id: string; name: string; classId: string; className: string };
  papers: PaperInfo[];
  results: StudentResult[];
  summary: ClassSummary;
}

/** Shared reading rules for results and report cards: who may see what, and the per-section computation. */
abstract class ResultReader extends SchoolService<Perm> {
  protected feature = examsFeature;

  /** Staff read everything; students and parents use the "self" door. */
  protected viewPerm(): Perm { return this.can("read") ? "read" : "self"; }

  /** Students this caller is: their own record, or their children. */
  protected async ownStudentIds(tx: Tx): Promise<string[]> {
    if (this.ctx.role === "student") return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
    const rows = await tx.select({ id: studentGuardians.studentId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(eq(guardians.userId, this.ctx.userId));
    return rows.map((r) => r.id);
  }

  /** Students and parents see published exams only, and only their own children; anything else looks like it does not exist. */
  protected async visible(tx: Tx, examId: string, studentId: string | null, perm: Perm): Promise<Exam> {
    const exam = await ExamRepo.exam(tx, examId);
    if (perm !== "self") return exam;
    if (exam.status !== "published") throw new NotFoundError("Result");
    if (studentId && !(await this.ownStudentIds(tx)).includes(studentId)) throw new NotFoundError("Result");
    return exam;
  }

  protected async sectionResults(tx: Tx, exam: Exam, sectionId: string): Promise<SectionResults> {
    if (!/^[0-9a-f-]{36}$/i.test(sectionId)) throw new NotFoundError("Section");
    const [section] = await tx.select({ id: sections.id, name: sections.name, classId: sections.classId, className: classes.name }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, sectionId)).limit(1);
    if (!section) throw new NotFoundError("Section");
    const [roster, paperRows, scale] = await Promise.all([
      ExamRepo.students(tx, section.classId, exam.yearId, [section.id]),
      tx.select({ id: examPapers.id, subjectId: examPapers.subjectId, subject: subjects.name, date: examPapers.date, maxMarks: examPapers.maxMarks, passMarks: examPapers.passMarks })
        .from(examPapers).innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
        .where(and(eq(examPapers.examId, exam.id), eq(examPapers.classId, section.classId))).orderBy(asc(subjects.name)),
      ExamRepo.scale(tx),
    ]);
    const entered = roster.length && paperRows.length
      ? await tx.select().from(marks).where(and(inArray(marks.paperId, paperRows.map((p) => p.id)), inArray(marks.studentId, roster.map((s) => s.id))))
      : [];
    const byKey = new Map(entered.map((m) => [`${m.studentId}:${m.paperId}`, { marks: m.marksObtained, absent: m.isAbsent }]));
    const calc = new ResultCalculator(scale);
    const results = calc.section(roster, paperRows, (s, p) => byKey.get(`${s}:${p}`));
    return { exam, section, papers: paperRows, results, summary: calc.summary(results, paperRows) };
  }

  /** The student's result for one exam, ranked within their section. */
  protected async resultFor(tx: Tx, exam: Exam, studentId: string): Promise<StudentResult> {
    const [st] = await tx.select({ sectionId: students.sectionId }).from(students).where(eq(students.id, studentId)).limit(1);
    if (!st?.sectionId) throw new NotFoundError("Student");
    const { results } = await this.sectionResults(tx, exam, st.sectionId);
    const mine = results.find((r) => r.student.id === studentId);
    if (!mine || mine.subjects.length === 0) throw new NotFoundError("Result");
    return mine;
  }
}

export interface ResultOptions {
  exams: { id: string; name: string; status: ExamStatus; startsOn: string }[];
  sections: { id: string; label: string }[];
}

export interface MyResults {
  student: { id: string; name: string; className: string; sectionName: string };
  items: { examId: string; examName: string; startsOn: string; percent: number | null; grade: string | null; result: StudentResult["result"]; rank: number | null; sectionSize: number }[];
}

export class ResultService extends ResultReader {
  constructor(ctx: Ctx) { super(ctx); }

  /** A student's marks, percent, grade, pass or fail, total and rank. Students and parents see it only after publish. */
  async studentResult(examId: string, studentId: string): Promise<{ exam: Exam; result: StudentResult }> {
    const perm = this.viewPerm();
    return this.read(perm, async (tx) => {
      const exam = await this.visible(tx, examId, studentId, perm);
      return { exam, result: await this.resultFor(tx, exam, studentId) };
    });
  }

  /** A section's ranked table, subject averages and pass percent. Staff only. */
  async classResult(examId: string, sectionId: string): Promise<SectionResults> {
    return this.read("read", async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      const data = await this.sectionResults(tx, exam, sectionId);
      return { ...data, results: [...data.results].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.student.name.localeCompare(b.student.name)) };
    });
  }

  /** Exams to pick from, and the sections that sit the chosen one. */
  async options(examId?: string): Promise<ResultOptions> {
    return this.read("read", async (tx) => {
      const list = await tx.select({ id: exams.id, name: exams.name, status: exams.status, startsOn: exams.startsOn }).from(exams).orderBy(desc(exams.startsOn));
      const exam = list.find((e) => e.id === examId);
      if (!exam) return { exams: list, sections: [] };
      const full = await ExamRepo.exam(tx, exam.id);
      const rows = await tx.select({ id: sections.id, name: sections.name, className: classes.name, grade: classes.grade }).from(sections).innerJoin(classes, eq(classes.id, sections.classId))
        .where(and(eq(sections.yearId, full.yearId), inArray(sections.classId, tx.select({ c: examPapers.classId }).from(examPapers).where(eq(examPapers.examId, exam.id))))).orderBy(asc(classes.grade), asc(sections.name));
      return { exams: list, sections: rows.map((s) => ({ id: s.id, label: `${s.className}-${s.name}` })) };
    });
  }

  /** The caller's own (student) or children's (parent) published results. */
  async mine(): Promise<MyResults[]> {
    return this.read("self", async (tx) => {
      const ids = await this.ownStudentIds(tx);
      if (ids.length === 0) return [];
      const kids = await tx.select({ id: students.id, name: students.name, sectionId: sections.id, sectionName: sections.name, classId: classes.id, className: classes.name })
        .from(students).innerJoin(sections, eq(sections.id, students.sectionId)).innerJoin(classes, eq(classes.id, sections.classId)).where(inArray(students.id, ids)).orderBy(asc(students.name));
      const cache = new Map<string, SectionResults>();
      const out: MyResults[] = [];
      for (const kid of kids) {
        const published = await tx.selectDistinct({ exam: exams }).from(exams).innerJoin(examPapers, eq(examPapers.examId, exams.id))
          .where(and(eq(exams.status, "published"), eq(examPapers.classId, kid.classId))).orderBy(desc(exams.startsOn));
        const items: MyResults["items"] = [];
        for (const { exam } of published) {
          const key = `${exam.id}:${kid.sectionId}`;
          if (!cache.has(key)) cache.set(key, await this.sectionResults(tx, exam, kid.sectionId));
          const r = cache.get(key)!.results.find((x) => x.student.id === kid.id);
          if (r) items.push({ examId: exam.id, examName: exam.name, startsOn: exam.startsOn, percent: r.percent, grade: r.grade, result: r.result, rank: r.rank, sectionSize: r.sectionSize });
        }
        out.push({ student: { id: kid.id, name: kid.name, className: kid.className, sectionName: kid.sectionName }, items });
      }
      return out;
    });
  }
}

// ---------- report cards ----------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class ReportCardService extends ResultReader {
  private async coScholastic(tx: Tx, examIds: string[], studentIds: string[]) {
    const rows = await tx.select({ examId: coScholasticGrades.examId, studentId: coScholasticGrades.studentId, subject: subjects.name, grade: coScholasticGrades.grade })
      .from(coScholasticGrades).innerJoin(subjects, eq(subjects.id, coScholasticGrades.subjectId))
      .where(and(inArray(coScholasticGrades.examId, examIds), inArray(coScholasticGrades.studentId, studentIds))).orderBy(asc(subjects.name));
    const byStudent = new Map<string, { subject: string; grade: string }[]>();
    // Later exams override earlier ones for the same area (the exams arrive in date order).
    for (const examId of examIds) for (const r of rows.filter((x) => x.examId === examId)) {
      const list = (byStudent.get(r.studentId) ?? []).filter((x) => x.subject !== r.subject);
      byStudent.set(r.studentId, [...list, { subject: r.subject, grade: r.grade }]);
    }
    return byStudent;
  }

  private async yearName(tx: Tx, yearId: string) {
    const [y] = await tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
    return y?.name ?? "";
  }

  /** One student's report card for an exam, or for a whole term (every exam of the term, marks added up). Students and parents get it only after publish. */
  async pdf(target: { examId: string } | { termId: string }, studentId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const perm = this.viewPerm();
    const card = await this.read(perm, async (tx): Promise<{ card: ReportCard; admissionNo: string }> => {
      const list: Exam[] = "examId" in target
        ? [await this.visible(tx, target.examId, studentId, perm)]
        : await tx.select().from(exams).where(and(eq(exams.termId, target.termId), perm === "self" ? eq(exams.status, "published") : undefined)).orderBy(asc(exams.startsOn));
      if (list.length === 0) throw new NotFoundError("Exam");
      if (perm === "self" && !("examId" in target) && !(await this.ownStudentIds(tx)).includes(studentId)) throw new NotFoundError("Result");
      const results: StudentResult[] = [];
      const used: Exam[] = [];
      for (const exam of list) {
        try { results.push(await this.resultFor(tx, exam, studentId)); used.push(exam); } catch (e) { if (!(e instanceof NotFoundError) || "examId" in target) throw e; }
      }
      if (results.length === 0) throw new NotFoundError("Result");
      const combined = results.length === 1 ? results[0]! : new ResultCalculator(await ExamRepo.scale(tx)).combine(results);
      const [school, yearName, co] = await Promise.all([ExamRepo.school(tx), this.yearName(tx, used[0]!.yearId), this.coScholastic(tx, used.map((x) => x.id), [studentId])]);
      const title = used.length === 1 ? used[0]!.name : used.map((x) => x.name).join(" + ");
      return { card: { school, yearName, title, result: combined, co: co.get(studentId) ?? [] }, admissionNo: combined.student.admissionNo };
    });
    return { filename: `report-card-${slug(card.admissionNo)}-${slug(card.card.title)}.pdf`, bytes: await ReportCardLayout.render([card.card]) };
  }

  /** Every student of a section in one PDF, one card per page. Staff only. */
  async classBatch(examId: string, sectionId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const { cards, name } = await this.read("read", async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      const data = await this.sectionResults(tx, exam, sectionId);
      const ready = data.results.filter((r) => r.subjects.length > 0);
      if (ready.length === 0) throw new NotFoundError("Result");
      const [school, yearName, co] = await Promise.all([ExamRepo.school(tx), this.yearName(tx, exam.yearId), this.coScholastic(tx, [exam.id], ready.map((r) => r.student.id))]);
      return { name: `${data.section.className}-${data.section.name}-${exam.name}`, cards: ready.map((result): ReportCard => ({ school, yearName, title: exam.name, result, co: co.get(result.student.id) ?? [] })) };
    });
    return { filename: `report-cards-${slug(name)}.pdf`, bytes: await ReportCardLayout.render(cards) };
  }
}
