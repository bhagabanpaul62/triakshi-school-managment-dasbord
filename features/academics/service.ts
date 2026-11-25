import { z } from "zod";
import { and, asc, count, eq, inArray, sql, sum } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { AppError, ConflictError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { AcademicsCrud, by, countIn, currentYear, type AcademicYear, type Option, type Perm } from "./base";
import academicsFeature from "./feature";
import {
  assignSubjectsInput, assignTeacherInput, setElectiveInput, boardInput, classInput, classTeacherInput, classSubjectInput, rolloverInput, sectionInput,
  sectionTeacherInput, sectionTeacherUpdate, sectionUpdate, subjectInput, termInput, termUpdate, yearInput,
} from "./inputs";
import { CLASS_PRESETS, SUBJECT_PRESETS, aprilToMarch, defaultTerms, nextYearName } from "./presets";
import { academicYears, classSubjects, classes, sectionTeachers, sections, studentSubjects, subjectGroupSubjects, subjectGroups, subjects, terms } from "./schema";

export type { AcademicYear, Option } from "./base";
export type Term = typeof terms.$inferSelect;
export type ClassRow = typeof classes.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Subject = typeof subjects.$inferSelect;

/** Active students per section; empty when the students module is off. */
async function enrolment(tx: Tx, ctx: Ctx, sectionIds: string[]): Promise<Record<string, number>> {
  if (!sectionIds.length || !ctx.features.has("students")) return {};
  const ids = sql.join(sectionIds.map((i) => sql`${i}`), sql`, `);
  const rows = await tx.execute(sql`select section_id, count(*)::int as n from students where status = 'active' and section_id in (${ids}) group by section_id`);
  return Object.fromEntries([...rows].map((r) => [String((r as { section_id: string }).section_id), Number((r as { n: number }).n)]));
}

/** Children planned into each section who have not started: shown next to the strength for planning, never counted in it. */
async function joiningPlan(tx: Tx, ctx: Ctx, sectionIds: string[]): Promise<Record<string, number>> {
  if (!sectionIds.length || !ctx.features.has("students")) return {};
  const ids = sql.join(sectionIds.map((i) => sql`${i}`), sql`, `);
  const rows = await tx.execute(sql`select joins_section_id as section_id, count(*)::int as n from students where status = 'joining' and joins_section_id in (${ids}) group by joins_section_id`);
  return Object.fromEntries([...rows].map((r) => [String((r as { section_id: string }).section_id), Number((r as { n: number }).n)]));
}

/** "32" or "32 + 3 joining". */
export const withJoining = (students: number, joining: number) => (joining ? `${students} + ${joining} joining` : String(students));

/** Who is missing where, this year: sections of the given classes (all when empty), the subjects each class studies, and the subject teachers set. */
async function staffing(tx: Tx, classIds?: string[]) {
  const year = await currentYear(tx);
  const none = { secs: [] as { id: string; classId: string; classTeacherId: string | null }[], subjectsOf: new Map<string, Set<string>>(), taught: new Set<string>() };
  if (!year) return none;
  const inClasses = classIds ? inArray(sections.classId, classIds) : undefined;
  const secs = await tx.select({ id: sections.id, classId: sections.classId, classTeacherId: sections.classTeacherId }).from(sections).where(and(eq(sections.yearId, year.id), inClasses));
  if (!secs.length) return none;
  const [subs, teach] = await Promise.all([
    tx.select({ classId: classSubjects.classId, subjectId: classSubjects.subjectId }).from(classSubjects).where(inArray(classSubjects.classId, [...new Set(secs.map((s) => s.classId))])),
    tx.select({ sectionId: sectionTeachers.sectionId, subjectId: sectionTeachers.subjectId }).from(sectionTeachers).where(inArray(sectionTeachers.sectionId, secs.map((s) => s.id))),
  ]);
  const subjectsOf = new Map<string, Set<string>>();
  for (const r of subs) subjectsOf.set(r.classId, (subjectsOf.get(r.classId) ?? new Set()).add(r.subjectId));
  return { secs, subjectsOf, taught: new Set(teach.map((t) => `${t.sectionId}:${t.subjectId}`)) };
}

export class AcademicYearService extends AcademicsCrud<typeof academicYears> {
  protected table = academicYears;
  protected entityName = "Academic year";
  protected createSchema = yearInput;
  protected updateSchema = yearInput;
  protected duplicateMessage = "That academic year already exists";
  protected defaultSort = "startsOn";

  protected sortColumns() { return { startsOn: academicYears.startsOn, name: academicYears.name }; }
  protected searchColumns() { return [academicYears.name]; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.status ? eq(academicYears.status, f.status as AcademicYear["status"]) : undefined]; }
  protected describe(r: AcademicYear) { return r.name; }

  private clearCurrent(tx: Tx) { return tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.isCurrent, true)); }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    const dates = aprilToMarch(String(data.name));
    const [existing] = await tx.select({ id: academicYears.id }).from(academicYears).limit(1);
    const isCurrent = Boolean(data.isCurrent) || !existing; // the first year is current
    if (isCurrent) await this.clearCurrent(tx);
    return { ...data, startsOn: data.startsOn ?? dates.startsOn, endsOn: data.endsOn ?? dates.endsOn, isCurrent };
  }

  protected async beforeUpdate(tx: Tx, existing: AcademicYear, data: Record<string, unknown>) {
    const status = (data.status ?? existing.status) as AcademicYear["status"];
    // A closed year is read-only; the only edit it accepts is reopening it.
    if (existing.status === "closed" && status === "closed") throw new ConflictError(`${existing.name} is closed. Reopen it to change it.`);
    if (status === "closed" && (data.isCurrent || existing.isCurrent)) throw new ConflictError("Make another year current before closing this one.");
    // A year stops being current only when another one is made current.
    if (data.isCurrent && !existing.isCurrent) await this.clearCurrent(tx);
    return { ...data, status, isCurrent: Boolean(data.isCurrent) || existing.isCurrent };
  }

  /** Attendance, exams, fees and enrolments of a year are history: a year that has any is closed, not deleted. */
  protected async usage(tx: Tx, y: AcademicYear): Promise<[string, number][]> {
    if (y.isCurrent) throw new ConflictError("Make another year current before deleting this one.");
    const ofYear = sql`section_id in (select id from sections where year_id = ${y.id})`;
    const n = (table: string, where = by("year_id", y.id)) => countIn(tx, table, where);
    const counts = await Promise.all([n("exams"), n("fee_invoices"), n("fee_receipts", sql`date between ${y.startsOn}::date and ${y.endsOn}::date`), n("student_enrollments"), n("student_attendance", ofYear), n("assignments", ofYear), n("timetable_slots", ofYear), n("fee_payments")]);
    const total = (...i: number[]) => i.reduce((t, k) => t + counts[k]!, 0);
    const planned = await countIn(tx, "students", sql`status = 'joining' and joins_year_id = ${y.id}`);
    return [["exams", total(0)], ["fee records", total(1, 2, 7)], ["student enrolments", total(3)], ["attendance, assignment or timetable records", total(4, 5, 6)], ["children are planned to join this year", planned]];
  }

  /** Make one year current; every other year stops being current. */
  async setCurrent(id: string): Promise<AcademicYear> {
    return this.write("manage", async (tx) => {
      const year = await this.findOrThrow(tx, id);
      if (year.status === "closed") throw new ConflictError(`${year.name} is closed. Reopen it before making it current.`);
      await this.clearCurrent(tx);
      const [row] = await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, year.id)).returning();
      return row!;
    }, (y) => ({ action: "set_current", entity: this.entityName, entityId: y.id, summary: `Made ${y.name} the current year` }));
  }

  current(): Promise<AcademicYear | null> { return this.read("read", currentYear); }

  async options(): Promise<Option[]> {
    return this.read("read", async (tx) => (await this.all(tx, asc(academicYears.startsOn))).map((y) => ({ value: y.id, label: y.name })));
  }
}

export class TermService extends AcademicsCrud<typeof terms> {
  protected table = terms;
  protected entityName = "Term";
  protected createSchema = termInput;
  protected updateSchema = termUpdate;
  protected duplicateMessage = "That term already exists";
  protected defaultSort = "startsOn";

  protected sortColumns() { return { startsOn: terms.startsOn, sortOrder: terms.sortOrder }; }
  protected searchColumns() { return [terms.name]; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.yearId ? eq(terms.yearId, f.yearId) : undefined]; }

  /** A term must sit inside its academic year. */
  private async within(tx: Tx, yearId: string, d: Record<string, unknown>) {
    const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
    if (!year) throw new NotFoundError("Academic year");
    if (String(d.startsOn) < year.startsOn) throw new ValidationError({ startsOn: `Starts before the academic year ${year.name}` });
    if (String(d.endsOn) > year.endsOn) throw new ValidationError({ endsOn: `Ends after the academic year ${year.name}` });
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    await this.within(tx, String(data.yearId), data);
    await this.assertOpen(tx, String(data.yearId));
    const [last] = await tx.select({ n: sql<number>`coalesce(max(${terms.sortOrder}), 0)::int` }).from(terms).where(eq(terms.yearId, String(data.yearId)));
    return { ...data, sortOrder: data.sortOrder ?? (last?.n ?? 0) + 1 };
  }
  protected async beforeUpdate(tx: Tx, existing: Term, data: Record<string, unknown>) {
    await this.assertOpen(tx, existing.yearId);
    await this.within(tx, existing.yearId, data);
    return { ...data, sortOrder: data.sortOrder ?? existing.sortOrder };
  }
  protected async beforeRemove(tx: Tx, existing: Term) {
    await this.assertOpen(tx, existing.yearId);
    await super.beforeRemove(tx, existing);
  }
  /** Exam results, weights and report remarks hang off a term. */
  protected async usage(tx: Tx, t: Term): Promise<[string, number][]> {
    const n = (table: string) => countIn(tx, table, by("term_id", t.id));
    return [["exams", await n("exams")], ["term weights", await n("term_weights")], ["report remarks", await n("report_remarks")], ["co-scholastic grades", await n("co_scholastic_grades")]];
  }

  /** Add Term 1 (April-September) and Term 2 (October-March) to a year, skipping names that already exist. */
  async addDefaults(yearId: string): Promise<Term[]> {
    return this.write("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
      if (!year) throw new NotFoundError("Academic year");
      const have = new Set((await tx.select({ name: terms.name }).from(terms).where(eq(terms.yearId, yearId))).map((t) => t.name));
      const missing = defaultTerms(year.name).filter((t) => !have.has(t.name));
      if (!missing.length) return [];
      await this.assertOpen(tx, yearId);
      return tx.insert(terms).values(missing.map((t, i) => ({ ...t, sortOrder: have.size + i + 1, yearId, schoolId: this.ctx.schoolId }))).returning();
    }, (rows) => ({ action: "create", entity: this.entityName, summary: `Added ${rows.length} default terms` }));
  }
}

export class ClassService extends AcademicsCrud<typeof classes> {
  protected table = classes;
  protected entityName = "Class";
  protected createSchema = classInput;
  protected updateSchema = classInput;
  protected duplicateMessage = "A class with that name already exists";
  protected defaultSort = "displayOrder";
  protected readonly nullable = ["stage", "boardOverride"] as const;

  protected sortColumns() { return { displayOrder: classes.displayOrder, grade: classes.grade, name: classes.name }; }
  protected searchColumns() { return [classes.name]; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.stage ? eq(classes.stage, f.stage as NonNullable<ClassRow["stage"]>) : undefined]; }

  protected beforeCreate(_tx: Tx, data: Record<string, unknown>) { return Promise.resolve(this.withNulls({ ...data, displayOrder: data.displayOrder ?? data.grade })); }
  protected beforeUpdate(_tx: Tx, existing: ClassRow, data: Record<string, unknown>) { return Promise.resolve(this.withNulls({ ...data, displayOrder: data.displayOrder ?? existing.displayOrder })); }

  /** A class with sections, students or exam papers is history; clear those first. */
  protected async usage(tx: Tx, c: ClassRow): Promise<[string, number][]> {
    const [sec] = await tx.select({ n: count() }).from(sections).where(eq(sections.classId, c.id));
    return [["sections", Number(sec?.n ?? 0)], ["students", await countIn(tx, "students", by("class_id", c.id))], ["exam papers", await countIn(tx, "exam_papers", by("class_id", c.id))]];
  }

  /** Add Nursery, LKG, UKG and Class 1 to 12, skipping the ones that exist. */
  async addPresets(): Promise<{ added: number }> {
    return this.write("manage", async (tx) => {
      const rows = await tx.insert(classes).values(CLASS_PRESETS.map((c) => ({ ...c, displayOrder: c.grade, schoolId: this.ctx.schoolId }))).onConflictDoNothing().returning({ id: classes.id });
      return { added: rows.length };
    }, (r) => ({ action: "create", entity: this.entityName, summary: `Added ${r.added} preset classes` }));
  }

  async options(): Promise<Option[]> {
    return this.read("read", async (tx) => (await this.all(tx, asc(classes.displayOrder), asc(classes.grade))).map((c) => ({ value: c.id, label: c.name })));
  }

  /** Per class, this year: sections, seats, students, subjects, and the gaps (sections with no class teacher, subject-by-section pairs with no teacher). */
  async stats(classIds: string[]): Promise<Record<string, ClassStats>> {
    return this.read("read", async (tx) => {
      const out: Record<string, ClassStats> = {};
      if (!classIds.length) return out;
      for (const id of classIds) out[id] = { sections: 0, capacity: 0, students: 0, joining: 0, subjects: 0, noClassTeacher: 0, unstaffed: 0 };
      const year = await currentYear(tx);
      if (year) {
        const rows = await tx.select({ classId: sections.classId, n: count(), cap: sum(sections.capacity) }).from(sections)
          .where(and(inArray(sections.classId, classIds), eq(sections.yearId, year.id))).groupBy(sections.classId);
        for (const r of rows) out[r.classId] = { ...out[r.classId]!, sections: Number(r.n), capacity: Number(r.cap ?? 0) };
        const { secs, subjectsOf, taught } = await staffing(tx, classIds);
        const enrolled = await enrolment(tx, this.ctx, secs.map((s) => s.id));
        const joining = await joiningPlan(tx, this.ctx, secs.map((s) => s.id));
        for (const s of secs) {
          const o = out[s.classId]!;
          o.students += enrolled[s.id] ?? 0;
          o.joining += joining[s.id] ?? 0;
          if (!s.classTeacherId) o.noClassTeacher += 1;
          o.unstaffed += [...(subjectsOf.get(s.classId) ?? [])].filter((sub) => !taught.has(`${s.id}:${sub}`)).length;
        }
      }
      const subs = await tx.select({ classId: classSubjects.classId, n: count() }).from(classSubjects).where(inArray(classSubjects.classId, classIds)).groupBy(classSubjects.classId);
      for (const r of subs) out[r.classId] = { ...out[r.classId]!, subjects: Number(r.n) };
      return out;
    });
  }
}

export interface ClassStats { sections: number; capacity: number; students: number; joining: number; subjects: number; noClassTeacher: number; unstaffed: number }

export class SectionService extends AcademicsCrud<typeof sections> {
  protected table = sections;
  protected entityName = "Section";
  protected createSchema = sectionInput;
  protected updateSchema = sectionUpdate;
  protected duplicateMessage = "That section already exists for this class and year";
  protected defaultSort = "name";
  protected readonly nullable = ["classTeacherId", "room", "medium", "shift", "streamLabel"] as const;

  protected sortColumns() { return { name: sections.name }; }
  protected searchColumns() { return [sections.name, sections.room, sections.medium, sections.streamLabel]; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.classId ? eq(sections.classId, f.classId) : undefined, f.yearId ? eq(sections.yearId, f.yearId) : undefined, f.shift ? eq(sections.shift, f.shift as NonNullable<Section["shift"]>) : undefined];
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    const year = data.yearId ? { id: String(data.yearId) } : await currentYear(tx);
    if (!year) throw new ConflictError("Set a current academic year first.");
    await this.assertVisible(tx, classes, data.classId, "classId", "class");
    await this.assertVisible(tx, academicYears, year.id, "yearId", "academic year");
    await this.assertOpen(tx, year.id);
    await this.assertTeacher(tx, data.classTeacherId as string | undefined);
    return this.withNulls({ ...data, yearId: year.id });
  }

  // The edit form always sends every field, so a blank teacher or room means "clear it".
  protected async beforeUpdate(tx: Tx, existing: Section, data: Record<string, unknown>) {
    await this.assertOpen(tx, existing.yearId);
    await this.assertTeacher(tx, data.classTeacherId as string | undefined);
    return this.withNulls(data);
  }

  protected async beforeRemove(tx: Tx, existing: Section) {
    await this.assertOpen(tx, existing.yearId);
    await super.beforeRemove(tx, existing);
  }

  /** Students and their attendance, assignments and timetable slots hang off a section. */
  protected async usage(tx: Tx, s: Section): Promise<[string, number][]> {
    const n = (table: string) => countIn(tx, table, by("section_id", s.id));
    // A child who has not started has no section yet; the plan (joins_section_id) is what a delete would strip.
    const planned = await countIn(tx, "students", sql`status = 'joining' and joins_section_id = ${s.id}`);
    return [["students", await n("students")], ["children are planned to join this section", planned], ["attendance records", await n("student_attendance")], ["assignments", await n("assignments")], ["timetable slots", await n("timetable_slots")]];
  }

  /** Sections of a class in a year (default: the current one) with the class teacher's name. */
  async forClass(classId: string, yearId?: string) {
    return this.read("read", async (tx) => {
      const year = yearId ?? (await currentYear(tx))?.id;
      if (!year) return [];
      const rows = await tx.select({ ...sectionCols, teacherName: users.name }).from(sections).leftJoin(users, eq(users.id, sections.classTeacherId))
        .where(and(eq(sections.classId, classId), eq(sections.yearId, year))).orderBy(asc(sections.name));
      const [enrolled, joining] = await Promise.all([enrolment(tx, this.ctx, rows.map((r) => r.id)), joiningPlan(tx, this.ctx, rows.map((r) => r.id))]);
      return rows.map((r) => ({ ...r, students: enrolled[r.id] ?? 0, joining: joining[r.id] ?? 0 }));
    });
  }

  /** Set or clear a section's class teacher without touching its other fields. */
  async assignClassTeacher(input: unknown): Promise<Section> {
    this.authorize("manage", "write");
    const { sectionId, teacherId } = this.parse(classTeacherInput, input);
    return this.write("manage", async (tx) => {
      const s = await this.findOrThrow(tx, sectionId);
      await this.assertOpen(tx, s.yearId);
      await this.assertTeacher(tx, teacherId);
      const [row] = await tx.update(sections).set({ classTeacherId: teacherId ?? null }).where(eq(sections.id, sectionId)).returning();
      return row!;
    }, (r) => ({ action: "update", entity: this.entityName, entityId: r.id, summary: `Updated section ${r.name}` }));
  }

  /** Many class teachers at once: one transaction, one audit entry, and each row on its own savepoint so a bad row reports its reason and the rest are still saved. */
  async assignClassTeachers(input: unknown): Promise<{ changed: number; failed: { sectionId: string; error: string }[] }> {
    this.authorize("manage", "write");
    const picks = this.parse(z.object({ picks: z.array(classTeacherInput).min(1).max(400) }), input).picks;
    return this.write("manage", async (tx) => {
      let changed = 0;
      const failed: { sectionId: string; error: string }[] = [];
      for (const p of picks) {
        try {
          await tx.transaction(async (sp) => {
            const s = await this.findOrThrow(sp, p.sectionId);
            if (s.classTeacherId === (p.teacherId ?? null)) return;
            await this.assertOpen(sp, s.yearId);
            await this.assertTeacher(sp, p.teacherId);
            await sp.update(sections).set({ classTeacherId: p.teacherId ?? null }).where(eq(sections.id, p.sectionId));
            changed++;
          });
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          failed.push({ sectionId: p.sectionId, error: Object.values(e.fieldErrors ?? {})[0] ?? e.message });
        }
      }
      return { changed, failed };
    }, (r) => ({ action: "update", entity: this.entityName, summary: `Set class teachers for ${r.changed} sections`, meta: { changed: r.changed, failed: r.failed.length } }));
  }

  /** "Class 5 - A" style labels for selects, for one year (default: the current one). */
  async options(yearId?: string): Promise<Option[]> {
    return this.read("read", async (tx) => {
      const year = yearId ?? (await currentYear(tx))?.id;
      if (!year) return [];
      const rows = await tx.select({ id: sections.id, section: sections.name, cls: classes.name }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.yearId, year)).orderBy(asc(classes.displayOrder), asc(classes.grade), asc(sections.name));
      return rows.map((r) => ({ value: r.id, label: `${r.cls} - ${r.section}` }));
    });
  }
}
const sectionCols = {
  id: sections.id, classId: sections.classId, yearId: sections.yearId, name: sections.name, capacity: sections.capacity,
  classTeacherId: sections.classTeacherId, room: sections.room, medium: sections.medium, shift: sections.shift, streamLabel: sections.streamLabel,
};

export class SubjectService extends AcademicsCrud<typeof subjects> {
  protected table = subjects;
  protected entityName = "Subject";
  protected createSchema = subjectInput;
  protected updateSchema = subjectInput;
  protected duplicateMessage = "A subject with that name already exists";
  protected defaultSort = "name";

  protected readonly nullable = ["code", "shortName", "maxMarksTheory", "maxMarksPractical", "boardCode", "tone"] as const;

  protected sortColumns() { return { name: subjects.name, kind: subjects.kind }; }
  protected searchColumns() { return [subjects.name, subjects.code, subjects.shortName, subjects.boardCode]; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.kind ? eq(subjects.kind, f.kind as Subject["kind"]) : undefined, f.type ? eq(subjects.type, f.type as Subject["type"]) : undefined];
  }

  protected beforeUpdate(_tx: Tx, _existing: Subject, data: Record<string, unknown>) { return Promise.resolve(this.withNulls(data)); }

  /** A subject that a class studies, or that has assignments or exam papers, is in use. */
  protected async usage(tx: Tx, s: Subject): Promise<[string, number][]> {
    const [cl] = await tx.select({ n: count() }).from(classSubjects).where(eq(classSubjects.subjectId, s.id));
    return [["classes", Number(cl?.n ?? 0)], ["assignments", await countIn(tx, "assignments", by("subject_id", s.id))], ["exam papers", await countIn(tx, "exam_papers", by("subject_id", s.id))]];
  }

  /** Add the common subjects of a board (CBSE, ICSE or State), skipping the ones that exist. */
  async addPreset(input: unknown): Promise<{ added: number }> {
    const { board } = this.parse(boardInput, input);
    return this.write("manage", async (tx) => {
      const rows = await tx.insert(subjects).values(SUBJECT_PRESETS[board].map((s) => ({ ...s, schoolId: this.ctx.schoolId }))).onConflictDoNothing().returning({ id: subjects.id });
      return { added: rows.length };
    }, (r) => ({ action: "create", entity: this.entityName, summary: `Added ${r.added} ${board} subjects` }));
  }

  async options(): Promise<Option[]> {
    return this.read("read", async (tx) => (await this.all(tx, asc(subjects.name))).map((s) => ({ value: s.id, label: s.name })));
  }

  /** Per subject, this year: classes that study it, sections that have a teacher for it, and sections still without one. */
  async stats(subjectIds: string[]): Promise<Record<string, { classes: number; teachers: number; unstaffed: number }>> {
    return this.read("read", async (tx) => {
      const out: Record<string, { classes: number; teachers: number; unstaffed: number }> = Object.fromEntries(subjectIds.map((id) => [id, { classes: 0, teachers: 0, unstaffed: 0 }]));
      if (!subjectIds.length) return out;
      const links = await tx.select({ subjectId: classSubjects.subjectId }).from(classSubjects).where(inArray(classSubjects.subjectId, subjectIds));
      for (const l of links) out[l.subjectId]!.classes += 1;
      const { secs, subjectsOf, taught } = await staffing(tx);
      for (const s of secs) for (const sub of subjectsOf.get(s.classId) ?? []) {
        const o = out[sub];
        if (!o) continue;
        if (taught.has(`${s.id}:${sub}`)) o.teachers += 1; else o.unstaffed += 1;
      }
      return out;
    });
  }
}

export class ClassSubjectService extends AcademicsCrud<typeof classSubjects> {
  protected table = classSubjects;
  protected entityName = "Class subject";
  protected createSchema = classSubjectInput;
  protected updateSchema = classSubjectInput;
  protected duplicateMessage = "That subject is already assigned to the class";

  protected filterClauses(f: Record<string, string | undefined>) { return [f.classId ? eq(classSubjects.classId, f.classId) : undefined]; }

  private async check(tx: Tx, data: Record<string, unknown>) {
    await this.assertVisible(tx, classes, data.classId, "classId", "class");
    await this.assertVisible(tx, subjects, data.subjectId, "subjectId", "subject");
    return data;
  }
  protected beforeCreate(tx: Tx, data: Record<string, unknown>) { return this.check(tx, data); }
  protected beforeUpdate(tx: Tx, _existing: typeof classSubjects.$inferSelect, data: Record<string, unknown>) { return this.check(tx, data); }

  /** Exam papers set for this subject in this class are history. */
  protected async usage(tx: Tx, e: typeof classSubjects.$inferSelect): Promise<[string, number][]> {
    return [["exam papers", await countIn(tx, "exam_papers", sql`class_id = ${e.classId} and subject_id = ${e.subjectId}`)]];
  }

  // Dropping a subject from a class also drops its teachers in that class's sections.
  protected async beforeRemove(tx: Tx, existing: typeof classSubjects.$inferSelect) {
    await super.beforeRemove(tx, existing);
    const ids = tx.select({ id: sections.id }).from(sections).where(eq(sections.classId, existing.classId));
    await tx.delete(sectionTeachers).where(and(eq(sectionTeachers.subjectId, existing.subjectId), inArray(sectionTeachers.sectionId, ids)));
    // ... and drops it from the class's groups and from the students who chose it through them
    const groupIds = tx.select({ id: subjectGroups.id }).from(subjectGroups).where(eq(subjectGroups.classId, existing.classId));
    await tx.delete(studentSubjects).where(and(eq(studentSubjects.subjectId, existing.subjectId), inArray(studentSubjects.groupId, groupIds)));
    await tx.delete(subjectGroupSubjects).where(and(eq(subjectGroupSubjects.subjectId, existing.subjectId), inArray(subjectGroupSubjects.groupId, groupIds)));
  }

  /** Subjects a class studies, with the link id to remove it. */
  async forClass(classId: string) {
    return this.read("read", (tx) => tx.select({ id: classSubjects.id, subjectId: subjects.id, name: subjects.name, code: subjects.code, kind: subjects.kind, isElective: classSubjects.isElective })
      .from(classSubjects).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId)).where(eq(classSubjects.classId, classId)).orderBy(asc(subjects.name)));
  }

  /** Mark a class subject as elective or compulsory. A subject that sits in a group stays elective. */
  async setElective(input: unknown): Promise<typeof classSubjects.$inferSelect> {
    const { id, isElective } = this.parse(setElectiveInput, input);
    return this.write("manage", async (tx) => {
      const [row] = await tx.select().from(classSubjects).where(eq(classSubjects.id, id)).limit(1);
      if (!row) throw new NotFoundError("Class subject");
      if (!isElective) {
        const groupIds = tx.select({ id: subjectGroups.id }).from(subjectGroups).where(eq(subjectGroups.classId, row.classId));
        const [inGroup] = await tx.select({ id: subjectGroupSubjects.id }).from(subjectGroupSubjects)
          .where(and(eq(subjectGroupSubjects.subjectId, row.subjectId), inArray(subjectGroupSubjects.groupId, groupIds))).limit(1);
        if (inGroup) throw new ConflictError("Take this subject out of its group first.");
      }
      const [r] = await tx.update(classSubjects).set({ isElective }).where(eq(classSubjects.id, id)).returning();
      return r!;
    }, (r) => ({ action: "update", entity: this.entityName, entityId: r.id, summary: r.isElective ? "Marked a class subject elective" : "Marked a class subject compulsory" }));
  }

  /** Assign several subjects to a class at once; ones already assigned are skipped. */
  async assign(input: unknown): Promise<{ added: number }> {
    this.authorize("manage", "write");
    const { classId, subjectIds } = this.parse(assignSubjectsInput, input);
    return this.write("manage", async (tx) => {
      const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).limit(1);
      if (!cls) throw new NotFoundError("Class");
      const found = await tx.select({ id: subjects.id }).from(subjects).where(inArray(subjects.id, subjectIds));
      if (found.length !== new Set(subjectIds).size) throw new ValidationError({ subjectIds: "One of those subjects no longer exists" });
      const rows = await tx.insert(classSubjects).values(found.map((s) => ({ classId, subjectId: s.id, schoolId: this.ctx.schoolId }))).onConflictDoNothing().returning({ id: classSubjects.id });
      return { added: rows.length };
    }, (r) => ({ action: "create", entity: this.entityName, summary: `Assigned ${r.added} subjects to a class` }));
  }
}

export class SectionTeacherService extends AcademicsCrud<typeof sectionTeachers> {
  protected table = sectionTeachers;
  protected entityName = "Subject teacher";
  protected createSchema = sectionTeacherInput;
  protected updateSchema = sectionTeacherUpdate;
  protected duplicateMessage = "That subject already has a teacher in this section";

  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.sectionId ? eq(sectionTeachers.sectionId, f.sectionId) : undefined, f.teacherId ? eq(sectionTeachers.teacherId, f.teacherId) : undefined];
  }

  /** Refuse changes while the section's year is closed. */
  private async open(tx: Tx, sectionId: string) {
    const [s] = await tx.select({ yearId: sections.yearId }).from(sections).where(eq(sections.id, sectionId)).limit(1);
    if (s) await this.assertOpen(tx, s.yearId);
  }
  protected async beforeRemove(tx: Tx, existing: typeof sectionTeachers.$inferSelect) { await this.open(tx, existing.sectionId); }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    const [section] = await tx.select({ classId: sections.classId, yearId: sections.yearId }).from(sections).where(eq(sections.id, String(data.sectionId))).limit(1);
    if (!section) throw new NotFoundError("Section");
    await this.assertOpen(tx, section.yearId);
    const [taught] = await tx.select({ id: classSubjects.id }).from(classSubjects)
      .where(and(eq(classSubjects.classId, section.classId), eq(classSubjects.subjectId, String(data.subjectId)))).limit(1);
    if (!taught) throw new ConflictError("That subject is not taught in this class. Assign it to the class first.");
    await this.assertTeacher(tx, String(data.teacherId), "teacherId");
    return data;
  }
  protected async beforeUpdate(tx: Tx, existing: typeof sectionTeachers.$inferSelect, data: Record<string, unknown>) {
    await this.open(tx, existing.sectionId);
    await this.assertTeacher(tx, String(data.teacherId), "teacherId");
    return data;
  }

  /** Set, change or (with no teacher) clear who teaches a subject to a section. */
  async assign(input: unknown): Promise<{ teacherId: string | null }> {
    this.authorize("manage", "write");
    const { sectionId, subjectId, teacherId } = this.parse(assignTeacherInput, input);
    const current = await this.read("read", async (tx) => (await tx.select({ id: sectionTeachers.id }).from(sectionTeachers)
      .where(and(eq(sectionTeachers.sectionId, sectionId), eq(sectionTeachers.subjectId, subjectId))).limit(1))[0]);
    if (!teacherId) { if (current) await this.remove(current.id); }
    else if (current) await this.update(current.id, { teacherId });
    else await this.create({ sectionId, subjectId, teacherId });
    return { teacherId: teacherId ?? null };
  }

  /** The subject-teacher grid of a class: its sections, its subjects and who teaches each pair. */
  async matrix(classId: string) {
    const [secs, subs] = await Promise.all([new SectionService(this.ctx).forClass(classId), new ClassSubjectService(this.ctx).forClass(classId)]);
    const cells: Record<string, string> = {};
    if (secs.length) {
      const rows = await this.read("read", (tx) => tx.select().from(sectionTeachers).where(inArray(sectionTeachers.sectionId, secs.map((s) => s.id))));
      for (const r of rows) cells[`${r.sectionId}:${r.subjectId}`] = r.teacherId;
    }
    return { sections: secs, subjects: subs, cells };
  }
}

/** Year-end: create the next academic year and carry the sections forward. */
export class YearRolloverService extends SchoolService<Perm> {
  protected feature = academicsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Create `nextName` (default: the year after the current one) with default terms; copy every section (same class, name, capacity) and, unless `copyTeachers` is false, its class teacher and subject teachers. The new year is not made current. */
  async rollForward(nextName?: string, copyTeachers = true): Promise<{ year: AcademicYear; sections: number; teachers: number }> {
    this.authorize("manage", "write");
    const input = this.parse(rolloverInput, { name: nextName, copyTeachers });
    return this.write("manage", async (tx) => {
      const from = await currentYear(tx);
      if (!from) throw new ConflictError("Set a current academic year first.");
      const name = input.name ?? nextYearName(from.name);
      const [dup] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.name, name)).limit(1);
      if (dup) throw new ConflictError(`${name} already exists.`);
      const schoolId = this.ctx.schoolId;
      const [year] = await tx.insert(academicYears).values({ name, ...aprilToMarch(name), isCurrent: false, status: "planning", schoolId }).returning();
      await tx.insert(terms).values(defaultTerms(name).map((t, i) => ({ ...t, sortOrder: i + 1, yearId: year!.id, schoolId })));
      const old = await tx.select().from(sections).where(eq(sections.yearId, from.id));
      let teachers = 0;
      if (old.length) {
        const made = await tx.insert(sections).values(old.map((s) => ({
          classId: s.classId, name: s.name, capacity: s.capacity, room: s.room, medium: s.medium, shift: s.shift, streamLabel: s.streamLabel, yearId: year!.id, schoolId, classTeacherId: input.copyTeachers ? s.classTeacherId : null,
        }))).returning({ id: sections.id, classId: sections.classId, name: sections.name });
        if (input.copyTeachers) {
          const newId = new Map(made.map((m) => [`${m.classId}:${m.name}`, m.id]));
          const idOf = new Map(old.map((s) => [s.id, newId.get(`${s.classId}:${s.name}`)!]));
          const links = await tx.select().from(sectionTeachers).where(inArray(sectionTeachers.sectionId, old.map((s) => s.id)));
          if (links.length) await tx.insert(sectionTeachers).values(links.map((l) => ({ sectionId: idOf.get(l.sectionId)!, subjectId: l.subjectId, teacherId: l.teacherId, schoolId })));
          teachers = links.length;
        }
      }
      return { year: year!, sections: old.length, teachers };
    }, (r) => ({ action: "rollover", entity: "Academic year", entityId: r.year.id, summary: `Rolled forward to ${r.year.name} with ${r.sections} sections${r.teachers ? ` and ${r.teachers} subject teachers` : ""}` }));
  }
}

export * from "./electives";
export * from "./houses";
export * from "./exports";
