// Report setup and exam logistics: co-scholastic scales, report templates, paper components, term weights, remarks, date sheet and admit cards.
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError } from "@smw/feature-kit";
import { academicYears, classes, sections, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import examsFeature from "./feature";
import { componentsInput, coScaleInput, dateSheetInput, presetInput, remarksInput, templateInput, weightsInput } from "./inputs";
import { CBSE_BANDS, CBSE_CO_GRADES, findClashes, type Slot } from "./grading";
import { AdmitCardLayout, type AdmitCard } from "./admit-card";
import { ExamRepo, type Exam } from "./repo";
import {
  CLASS_BANDS, coScholasticScales, examPapers, exams, gradeBands, gradeScales, marks, paperComponents, reportRemarks, reportTemplates, termWeights,
  type ClassBand,
} from "./schema";

type Perm = keyof typeof examsFeature.permissions;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PRESET_SCALE = "CBSE 9-point";
const PRESET_CO = "CBSE co-scholastic A-C";

/** Co-scholastic scales, per-class-band report templates and the one-click presets. Needs `manage` (the Exam coordinator role has it). */
export class ReportSetupService extends SchoolService<Perm> {
  protected feature = examsFeature;

  async coScales() { return this.read("read", (tx) => tx.select().from(coScholasticScales).orderBy(asc(coScholasticScales.name))); }

  async saveCoScale(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(coScaleInput, input);
    const dup = data.grades.find((g, i) => data.grades.findIndex((x) => x.grade.toLowerCase() === g.grade.toLowerCase()) !== i);
    if (dup) throw new ValidationError({ grades: `${dup.grade} is listed twice` });
    return this.write("manage", async (tx) => {
      if (data.isDefault) await tx.update(coScholasticScales).set({ isDefault: false }).where(eq(coScholasticScales.isDefault, true));
      if (data.id) {
        const [row] = await tx.update(coScholasticScales).set({ name: data.name, isDefault: data.isDefault, grades: data.grades }).where(eq(coScholasticScales.id, data.id)).returning();
        if (!row) throw new NotFoundError("Co-scholastic scale");
        return row;
      }
      const [have] = await tx.select({ id: coScholasticScales.id }).from(coScholasticScales).where(eq(coScholasticScales.isDefault, true)).limit(1);
      const [row] = await tx.insert(coScholasticScales).values({ schoolId: this.ctx.schoolId, name: data.name, isDefault: data.isDefault || !have, grades: data.grades }).returning();
      return row!;
    }, (r) => ({ action: "save", entity: "Co-scholastic scale", entityId: r.id, summary: `Saved co-scholastic scale ${r.name}` }));
  }

  async removeCoScale(id: string) {
    return this.write("manage", async (tx) => {
      const [row] = await tx.select().from(coScholasticScales).where(eq(coScholasticScales.id, ExamRepo.uuid(id, "Co-scholastic scale"))).limit(1);
      if (!row) throw new NotFoundError("Co-scholastic scale");
      if (row.isDefault) throw new ConflictError("Make another scale the default before deleting this one.");
      await tx.delete(coScholasticScales).where(eq(coScholasticScales.id, id));
      return row;
    }, (r) => ({ action: "delete", entity: "Co-scholastic scale", entityId: r.id, summary: `Deleted co-scholastic scale ${r.name}` }));
  }

  /** One row per class band; a band without a saved template shows the defaults it would use. */
  async templates() {
    return this.read("read", async (tx) => {
      const rows = await tx.select().from(reportTemplates);
      return CLASS_BANDS.map((classBand) => {
        const t = rows.find((r) => r.classBand === classBand);
        return { classBand, saved: !!t, board: t?.board ?? "cbse", scaleId: t?.scaleId ?? null, coScaleId: t?.coScaleId ?? null, showGrade: t?.showGrade ?? true, showRank: t?.showRank ?? true, termSplit: t?.options?.termSplit ?? [] };
      });
    });
  }

  async saveTemplate(input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(templateInput, input);
    return this.write("manage", async (tx) => {
      const [sc] = d.scaleId ? await tx.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.id, d.scaleId)).limit(1) : [null];
      if (d.scaleId && !sc) throw new ValidationError({ scaleId: "Pick a grade scale" });
      const [co] = d.coScaleId ? await tx.select({ id: coScholasticScales.id }).from(coScholasticScales).where(eq(coScholasticScales.id, d.coScaleId)).limit(1) : [null];
      if (d.coScaleId && !co) throw new ValidationError({ coScaleId: "Pick a co-scholastic scale" });
      const values = { board: d.board, scaleId: d.scaleId ?? null, coScaleId: d.coScaleId ?? null, showGrade: d.showGrade, showRank: d.showRank, options: { termSplit: d.termSplit } };
      await tx.insert(reportTemplates).values({ schoolId: this.ctx.schoolId, classBand: d.classBand, ...values })
        .onConflictDoUpdate({ target: [reportTemplates.schoolId, reportTemplates.classBand], set: { ...values, updatedAt: sql`now()` } });
      return d;
    }, (r) => ({ action: "save", entity: "Report template", summary: `Saved the report setup for classes ${r.classBand}` }));
  }

  /** CBSE 9-band scale, CBSE co-scholastic A-C, or an ICSE marks-only template (no grade column) for one class band or all. Safe to repeat. */
  async applyPreset(input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(presetInput, input);
    return this.write("manage", async (tx) => {
      if (d.preset === "cbse_9") {
        const [have] = await tx.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.name, PRESET_SCALE)).limit(1);
        if (have) return { preset: d.preset, id: have.id, created: false };
        const [anyDefault] = await tx.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.isDefault, true)).limit(1);
        const [scale] = await tx.insert(gradeScales).values({ schoolId: this.ctx.schoolId, name: PRESET_SCALE, isDefault: !anyDefault }).returning();
        await tx.insert(gradeBands).values(CBSE_BANDS.map((b) => ({ ...b, schoolId: this.ctx.schoolId, scaleId: scale!.id })));
        return { preset: d.preset, id: scale!.id, created: true };
      }
      if (d.preset === "cbse_co") {
        const [have] = await tx.select({ id: coScholasticScales.id }).from(coScholasticScales).where(eq(coScholasticScales.name, PRESET_CO)).limit(1);
        if (have) return { preset: d.preset, id: have.id, created: false };
        const [anyDefault] = await tx.select({ id: coScholasticScales.id }).from(coScholasticScales).where(eq(coScholasticScales.isDefault, true)).limit(1);
        const [row] = await tx.insert(coScholasticScales).values({ schoolId: this.ctx.schoolId, name: PRESET_CO, isDefault: !anyDefault, grades: [...CBSE_CO_GRADES] }).returning();
        return { preset: d.preset, id: row!.id, created: true };
      }
      const bands: readonly ClassBand[] = d.classBand ? [d.classBand] : CLASS_BANDS;
      for (const classBand of bands) {
        const values = { board: "icse" as const, scaleId: null, coScaleId: null, showGrade: false, showRank: true, options: {} };
        await tx.insert(reportTemplates).values({ schoolId: this.ctx.schoolId, classBand, ...values })
          .onConflictDoUpdate({ target: [reportTemplates.schoolId, reportTemplates.classBand], set: { ...values, updatedAt: sql`now()` } });
      }
      return { preset: d.preset, id: null, created: true };
    }, (r) => ({ action: "save", entity: "Report preset", summary: `Applied preset ${r.preset}` }));
  }
}

/** Parts of a paper (Theory 80 + Internal 20). Their sum becomes the paper's maximum. */
export class ComponentService extends SchoolService<Perm> {
  protected feature = examsFeature;

  async forPaper(paperId: string) {
    return this.read("read", (tx) => tx.select().from(paperComponents).where(eq(paperComponents.paperId, ExamRepo.uuid(paperId, "Paper"))).orderBy(asc(paperComponents.sortOrder), asc(paperComponents.name)));
  }

  /** Replace the parts of a paper. An empty list goes back to one mark per student. Refused once marks are entered or the exam is published. */
  async save(input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(componentsInput, input);
    const names = d.components.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new ValidationError({ components: "Each part needs its own name" });
    return this.write("manage", async (tx) => {
      const { paper, exam } = await ExamRepo.paper(tx, d.paperId);
      if (exam.status === "published") throw new ConflictError("Results are published, so this paper is locked.");
      const [entered] = await tx.select({ n: count() }).from(marks).where(eq(marks.paperId, paper.id));
      if (Number(entered?.n ?? 0) > 0) throw new ConflictError("Marks are already entered for this paper. Clear them before changing its parts.");
      await tx.delete(paperComponents).where(eq(paperComponents.paperId, paper.id));
      if (d.components.length) {
        const total = d.components.reduce((a, c) => a + c.maxMarks, 0);
        if (paper.passMarks > total) throw new ValidationError({ components: `Pass marks are ${paper.passMarks}, more than the parts add up to (${total})` });
        await tx.insert(paperComponents).values(d.components.map((c, i) => ({ schoolId: this.ctx.schoolId, paperId: paper.id, name: c.name, maxMarks: c.maxMarks, sortOrder: i })));
        await tx.update(examPapers).set({ maxMarks: total }).where(eq(examPapers.id, paper.id));
      }
      return { paperId: paper.id, parts: d.components.length };
    }, (r) => ({ action: "update", entity: "Exam paper", entityId: r.paperId, summary: r.parts ? `Split a paper into ${r.parts} parts` : "Removed the parts of a paper" }));
  }
}

/** How much each exam of a term counts. A term's weights must add up to 100. */
export class TermWeightService extends SchoolService<Perm> {
  protected feature = examsFeature;

  /** Every term with its exams and saved weights. */
  async overview() {
    return this.read("read", async (tx) => {
      const [termRows, examRows, w] = await Promise.all([
        tx.select().from(terms).orderBy(asc(terms.startsOn)),
        tx.select({ id: exams.id, name: exams.name, termId: exams.termId, startsOn: exams.startsOn, status: exams.status }).from(exams).orderBy(asc(exams.startsOn)),
        tx.select().from(termWeights),
      ]);
      return termRows.map((t) => ({
        term: t,
        exams: examRows.filter((e) => e.termId === t.id).map((e) => ({ ...e, weight: w.find((x) => x.termId === t.id && x.examId === e.id)?.weightPercent ?? 0 })),
      }));
    });
  }

  async save(input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(weightsInput, input);
    const total = d.weights.reduce((n, w) => n + w.weightPercent, 0);
    if (total !== 100) throw new ValidationError({ weights: `The weights add up to ${total}. They must add up to 100.` });
    return this.write("manage", async (tx) => {
      const [t] = await tx.select({ id: terms.id }).from(terms).where(eq(terms.id, d.termId)).limit(1);
      if (!t) throw new NotFoundError("Term");
      const ids = d.weights.map((w) => w.examId);
      if (new Set(ids).size !== ids.length) throw new ValidationError({ weights: "An exam is listed twice" });
      const own = await tx.select({ id: exams.id }).from(exams).where(and(eq(exams.termId, d.termId), inArray(exams.id, ids)));
      if (own.length !== ids.length) throw new ValidationError({ weights: "Only exams of this term can have a weight" });
      await tx.delete(termWeights).where(eq(termWeights.termId, d.termId));
      const kept = d.weights.filter((w) => w.weightPercent > 0);
      await tx.insert(termWeights).values(kept.map((w) => ({ schoolId: this.ctx.schoolId, termId: d.termId, examId: w.examId, weightPercent: w.weightPercent })));
      return { termId: d.termId, exams: kept.length };
    }, (r) => ({ action: "save", entity: "Term weights", entityId: r.termId, summary: `Saved weights for ${r.exams} exams` }));
  }
}

/** Class teacher remarks for the report card, one per student per term. */
export class RemarkService extends SchoolService<Perm> {
  protected feature = examsFeature;

  /** The section's students with their remark; only its class teacher, or an admin, may open or save it. */
  private async section(tx: Tx, sectionId: string) {
    const [sec] = await tx.select({ id: sections.id, name: sections.name, classId: sections.classId, yearId: sections.yearId, className: classes.name, classTeacherId: sections.classTeacherId })
      .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, ExamRepo.uuid(sectionId, "Section"))).limit(1);
    if (!sec) throw new NotFoundError("Section");
    if (this.ctx.role !== "admin" && !this.can("manage") && sec.classTeacherId !== this.ctx.userId) throw new ForbiddenError("Only the class teacher can write remarks for this section.");
    return sec;
  }

  /** Sections this person may write remarks for: all for an admin, their own for a class teacher. */
  async sections() {
    return this.read("remarks", async (tx) => {
      const all = this.ctx.role === "admin" || this.can("manage");
      const rows = await tx.select({ id: sections.id, name: sections.name, className: classes.name, grade: classes.grade }).from(sections).innerJoin(classes, eq(classes.id, sections.classId))
        .where(all ? undefined : eq(sections.classTeacherId, this.ctx.userId)).orderBy(asc(classes.grade), asc(sections.name));
      return rows.map((r) => ({ id: r.id, label: `${r.className}-${r.name}` }));
    });
  }

  async sheet(sectionId: string, termId: string) {
    return this.read("remarks", async (tx) => {
      const sec = await this.section(tx, sectionId);
      const [term] = await tx.select({ id: terms.id, name: terms.name }).from(terms).where(eq(terms.id, ExamRepo.uuid(termId, "Term"))).limit(1);
      if (!term) throw new NotFoundError("Term");
      const roster = await ExamRepo.students(tx, sec.classId, sec.yearId, [sec.id]);
      const rows = roster.length ? await tx.select().from(reportRemarks).where(and(eq(reportRemarks.termId, term.id), inArray(reportRemarks.studentId, roster.map((s) => s.id)))) : [];
      return { section: { id: sec.id, label: `${sec.className}-${sec.name}` }, term, rows: roster.map((s) => ({ studentId: s.id, name: s.name, rollNo: s.rollNo, text: rows.find((r) => r.studentId === s.id)?.text ?? "" })) };
    });
  }

  /** Save the sheet. An empty text removes that student's remark. */
  async save(input: unknown) {
    this.authorize("remarks", "write");
    const d = this.parse(remarksInput, input);
    return this.write("remarks", async (tx) => {
      const sec = await this.section(tx, d.sectionId);
      const [term] = await tx.select({ id: terms.id }).from(terms).where(eq(terms.id, d.termId)).limit(1);
      if (!term) throw new NotFoundError("Term");
      const roster = new Set((await ExamRepo.students(tx, sec.classId, sec.yearId, [sec.id])).map((s) => s.id));
      if (d.entries.some((e) => !roster.has(e.studentId))) throw new ValidationError({ entries: "A student is not in this section" });
      const keep = d.entries.filter((e) => e.text);
      const drop = d.entries.filter((e) => !e.text).map((e) => e.studentId);
      if (keep.length) {
        await tx.insert(reportRemarks).values(keep.map((e) => ({ schoolId: this.ctx.schoolId, studentId: e.studentId, termId: d.termId, text: e.text, byUserId: this.ctx.userId })))
          .onConflictDoUpdate({ target: [reportRemarks.studentId, reportRemarks.termId], set: { text: sql`excluded.text`, byUserId: sql`excluded.by_user_id`, updatedAt: sql`now()` } });
      }
      if (drop.length) await tx.delete(reportRemarks).where(and(eq(reportRemarks.termId, d.termId), inArray(reportRemarks.studentId, drop)));
      return { sectionId: d.sectionId, saved: keep.length, cleared: drop.length };
    }, (r) => ({ action: "save", entity: "Report remarks", entityId: r.sectionId, summary: `Saved ${r.saved} remarks${r.cleared ? `, cleared ${r.cleared}` : ""}` }));
  }
}

// ---------- date sheet and admit cards ----------

export interface DatePaper { id: string; classId: string; subjectId: string; subject: string; date: string; startTime: string | null; endTime: string | null }

const slotOf = (p: DatePaper): Slot => ({ id: p.id, label: p.subject, date: p.date, startTime: p.startTime, endTime: p.endTime });
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The exam timetable per class, with a clash check, shown to students once the exam leaves draft. */
export class DateSheetService extends SchoolService<Perm> {
  protected feature = examsFeature;

  static async papers(tx: Tx, examId: string, classIds?: string[]): Promise<DatePaper[]> {
    return tx.select({ id: examPapers.id, classId: examPapers.classId, subjectId: examPapers.subjectId, subject: subjects.name, date: examPapers.date, startTime: examPapers.startTime, endTime: examPapers.endTime })
      .from(examPapers).innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
      .where(and(eq(examPapers.examId, examId), classIds ? inArray(examPapers.classId, classIds) : undefined)).orderBy(asc(examPapers.date), asc(examPapers.startTime), asc(subjects.name));
  }

  /** Clashes inside each class: a message per class that has one. */
  private static clashes(list: DatePaper[], names: Map<string, string>) {
    const out: Record<string, string> = {};
    for (const classId of new Set(list.map((p) => p.classId))) {
      for (const [a, b] of findClashes(list.filter((p) => p.classId === classId).map(slotOf))) out[b.id] = `${names.get(classId) ?? "This class"}: ${b.label} clashes with ${a.label} on ${nice(b.date)}`;
    }
    return out;
  }

  async forExam(examId: string) {
    return this.read("read", async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      const [list, cls] = await Promise.all([DateSheetService.papers(tx, exam.id), tx.select({ id: classes.id, name: classes.name, grade: classes.grade }).from(classes).orderBy(asc(classes.grade))]);
      const names = new Map(cls.map((c) => [c.id, c.name]));
      const clashes = DateSheetService.clashes(list, names);
      const groups = cls.filter((c) => list.some((p) => p.classId === c.id)).map((c) => ({ classId: c.id, className: c.name, papers: list.filter((p) => p.classId === c.id) }));
      const secs = await tx.select({ id: sections.id, name: sections.name, classId: sections.classId }).from(sections).where(eq(sections.yearId, exam.yearId)).orderBy(asc(sections.name));
      return { exam, groups, clashes, sections: secs.filter((s) => names.has(s.classId) && list.some((p) => p.classId === s.classId)).map((s) => ({ id: s.id, label: `${names.get(s.classId)}-${s.name}` })) };
    });
  }

  /** Save dates and times. The whole class is checked afterwards: two papers in one slot are refused and nothing is saved. */
  async save(input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(dateSheetInput, input);
    return this.write("manage", async (tx) => {
      const exam = await ExamRepo.exam(tx, d.examId);
      if (exam.status === "published") throw new ConflictError("Results are published, so the date sheet is locked.");
      const own = await tx.select({ id: examPapers.id, classId: examPapers.classId }).from(examPapers).where(and(eq(examPapers.examId, exam.id), inArray(examPapers.id, d.papers.map((p) => p.paperId))));
      if (own.length !== new Set(d.papers.map((p) => p.paperId)).size) throw new NotFoundError("Paper");
      for (const p of d.papers) await tx.update(examPapers).set({ date: p.date, startTime: p.startTime, endTime: p.endTime }).where(eq(examPapers.id, p.paperId));
      const classIds = [...new Set(own.map((o) => o.classId))];
      const [list, cls] = await Promise.all([DateSheetService.papers(tx, exam.id, classIds), tx.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds))]);
      const clashes = DateSheetService.clashes(list, new Map(cls.map((c) => [c.id, c.name])));
      if (Object.keys(clashes).length) throw new ValidationError(clashes, "Two papers of one class are in the same slot.");
      return { examId: exam.id, saved: d.papers.length };
    }, (r) => ({ action: "update", entity: "Date sheet", entityId: r.examId, summary: `Saved the dates of ${r.saved} papers` }));
  }

  /** A student's own date sheet: exams that are no longer draft and not yet over, only the papers they study. */
  async mine() {
    return this.read("self", async (tx) => {
      const today = new Date().toISOString().slice(0, 10);
      const kids = await tx.select({ id: students.id, name: students.name, classId: students.classId }).from(students).where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active")));
      const out: { student: string; studentId: string; exam: { id: string; name: string; startsOn: string; endsOn: string }; papers: DatePaper[] }[] = [];
      for (const kid of kids) {
        if (!kid.classId) continue;
        const list = await tx.selectDistinct({ exam: exams }).from(exams).innerJoin(examPapers, and(eq(examPapers.examId, exams.id), eq(examPapers.classId, kid.classId))).where(and(ne(exams.status, "draft"), sql`${exams.endsOn} >= ${today}`)).orderBy(asc(exams.startsOn));
        for (const { exam } of list) {
          const takers = await ExamRepo.electiveTakers(tx, exam.yearId, [kid.classId]);
          const papers = (await DateSheetService.papers(tx, exam.id, [kid.classId])).filter((p) => takers.get(`${p.classId}:${p.subjectId}`)?.has(kid.id) ?? true);
          out.push({ student: kid.name, studentId: kid.id, exam: { id: exam.id, name: exam.name, startsOn: exam.startsOn, endsOn: exam.endsOn }, papers });
        }
      }
      return out;
    });
  }
}

/** Admit cards (hall tickets): one student or a whole section, with the date sheet. */
export class AdmitCardService extends SchoolService<Perm> {
  protected feature = examsFeature;

  private async cards(tx: Tx, exam: Exam, studentIds: string[]): Promise<AdmitCard[]> {
    const rows = await tx.select({
      id: students.id, name: students.name, admissionNo: students.admissionNo, rollNo: students.rollNo, dob: students.dob, photoKey: students.photoKey,
      classId: classes.id, className: classes.name, sectionName: sections.name,
    }).from(students).innerJoin(sections, eq(sections.id, students.sectionId)).innerJoin(classes, eq(classes.id, sections.classId))
      .where(and(inArray(students.id, studentIds), eq(students.status, "active"))).orderBy(asc(sections.name), sql`${students.rollNo} asc nulls last`, asc(students.name));
    const classIds = [...new Set(rows.map((r) => r.classId))];
    const [papers, takers, school, [year]] = await Promise.all([
      DateSheetService.papers(tx, exam.id, classIds), ExamRepo.electiveTakers(tx, exam.yearId, classIds), ExamRepo.school(tx),
      tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, exam.yearId)).limit(1),
    ]);
    const out = rows.map((s): AdmitCard => ({
      school, examName: exam.name, yearName: year?.name ?? "",
      student: { name: s.name, admissionNo: s.admissionNo, rollNo: s.rollNo, className: s.className, sectionName: s.sectionName, dob: s.dob, photoKey: s.photoKey },
      papers: papers.filter((p) => p.classId === s.classId && (takers.get(`${p.classId}:${p.subjectId}`)?.has(s.id) ?? true)),
    }));
    if (out.length === 0 || out.every((c) => c.papers.length === 0)) throw new NotFoundError("Date sheet");
    return out;
  }

  /** One student's admit card. A student may take their own once the exam is no longer a draft. */
  async pdf(examId: string, studentId: string) {
    const perm: Perm = this.can("read") ? "read" : "self";
    const { cards } = await this.read(perm, async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      if (perm === "self") {
        const [own] = await tx.select({ id: students.id }).from(students).where(and(eq(students.id, ExamRepo.uuid(studentId, "Student")), eq(students.userId, this.ctx.userId))).limit(1);
        if (!own || exam.status === "draft") throw new NotFoundError("Admit card");
      }
      return { cards: await this.cards(tx, exam, [ExamRepo.uuid(studentId, "Student")]) };
    });
    return { filename: `admit-card-${slug(cards[0]!.student.admissionNo)}-${slug(cards[0]!.examName)}.pdf`, bytes: await AdmitCardLayout.render(cards) };
  }

  /** Every student of a section in one PDF. Staff only. */
  async classBatch(examId: string, sectionId: string) {
    const { cards, name } = await this.read("read", async (tx) => {
      const exam = await ExamRepo.exam(tx, examId);
      const [sec] = await tx.select({ id: sections.id, name: sections.name, classId: sections.classId, className: classes.name }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, ExamRepo.uuid(sectionId, "Section"))).limit(1);
      if (!sec) throw new NotFoundError("Section");
      const roster = await ExamRepo.students(tx, sec.classId, exam.yearId, [sec.id]);
      return { cards: await this.cards(tx, exam, roster.map((s) => s.id)), name: `${sec.className}-${sec.name}-${exam.name}` };
    });
    return { filename: `admit-cards-${slug(name)}.pdf`, bytes: await AdmitCardLayout.render(cards) };
  }
}
