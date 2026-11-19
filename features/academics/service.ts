import { and, asc, count, eq, inArray, sql, sum, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { users, type Tx } from "@smw/db";
import { ConflictError, CrudService, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import academicsFeature from "./feature";
import {
  assignSubjectsInput, assignTeacherInput, boardInput, classInput, classTeacherInput, classSubjectInput, rolloverInput, sectionInput,
  sectionTeacherInput, sectionTeacherUpdate, sectionUpdate, subjectInput, termInput, termUpdate, yearInput,
} from "./inputs";
import { CLASS_PRESETS, SUBJECT_PRESETS, aprilToMarch, defaultTerms, nextYearName } from "./presets";
import { academicYears, classSubjects, classes, sectionTeachers, sections, subjects, terms } from "./schema";

type Perm = keyof typeof academicsFeature.permissions;
type Tenant = PgTable & { id: PgColumn; schoolId: PgColumn; createdAt: PgColumn };
export type Option = { value: string; label: string };
export type AcademicYear = typeof academicYears.$inferSelect;
export type Term = typeof terms.$inferSelect;
export type ClassRow = typeof classes.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Subject = typeof subjects.$inferSelect;

const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

/** The school's current academic year, or null when none is set. */
async function currentYear(tx: Tx): Promise<AcademicYear | null> {
  const [y] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y ?? null;
}

/** Active students per section; empty when the students module is off. */
async function enrolment(tx: Tx, ctx: Ctx, sectionIds: string[]): Promise<Record<string, number>> {
  if (!sectionIds.length || !ctx.features.has("students")) return {};
  const ids = sql.join(sectionIds.map((i) => sql`${i}`), sql`, `);
  const rows = await tx.execute(sql`select section_id, count(*)::int as n from students where status = 'active' and section_id in (${ids}) group by section_id`);
  return Object.fromEntries([...rows].map((r) => [String((r as { section_id: string }).section_id), Number((r as { n: number }).n)]));
}

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

/**
 * Shared base of every academics service: the feature, read/manage permissions, friendly errors for duplicate or
 * dangling references, and the "teacher" rule used by class teachers and subject teachers.
 */
abstract class AcademicsCrud<T extends Tenant> extends CrudService<T, Perm> {
  protected feature = academicsFeature;
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected abstract readonly duplicateMessage: string;

  constructor(ctx: Ctx) { super(ctx); }

  override async create(input: unknown): Promise<T["$inferSelect"]> { return this.guard(() => super.create(input)); }
  override async update(id: string, input: unknown): Promise<T["$inferSelect"]> { return this.guard(() => super.update(id, input)); }

  override async remove(id: string): Promise<{ id: string }> {
    try { return await super.remove(id); } catch (e) {
      // other features (students, fees, exams) hang rows off these tables
      if (pgCode(e) === "23503") throw new ConflictError(`This ${this.entityName.toLowerCase()} is still in use elsewhere, so it can't be deleted.`);
      throw e;
    }
  }

  /** A foreign key bypasses row-level security, so every id from a form must be checked as visible to this school. */
  protected async assertVisible(tx: Tx, table: Tenant, id: unknown, field: string, what: string) {
    const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, String(id))).limit(1);
    if (!row) throw new ValidationError({ [field]: `Pick a valid ${what}` });
  }

  private async guard<R>(fn: () => Promise<R>): Promise<R> {
    try { return await fn(); } catch (e) {
      if (pgCode(e) === "23503") throw new ConflictError("Something this depends on no longer exists. Refresh and try again.");
      return rethrowUnique(e, this.duplicateMessage);
    }
  }

  protected all(tx: Tx, ...order: SQL[]): Promise<T["$inferSelect"][]> {
    return tx.select().from(this.table as Tenant).orderBy(...(order.length ? order : [asc(this.table.createdAt)])) as Promise<T["$inferSelect"][]>;
  }

  /** Only users with role teacher may be class or subject teachers. */
  protected async assertTeacher(tx: Tx, userId: string | null | undefined, field = "classTeacherId") {
    if (!userId) return;
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.role, "teacher"))).limit(1);
    if (!u) throw new ValidationError({ [field]: "Pick a teacher from your staff" });
  }

  /** Active teachers for selects. */
  async teacherOptions(): Promise<Option[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), eq(users.status, "active"))).orderBy(asc(users.name));
      return rows.map((r) => ({ value: r.id, label: r.name }));
    });
  }
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
    // A year stops being current only when another one is made current.
    if (data.isCurrent && !existing.isCurrent) await this.clearCurrent(tx);
    return { ...data, isCurrent: Boolean(data.isCurrent) || existing.isCurrent };
  }

  protected async beforeRemove(_tx: Tx, existing: AcademicYear) {
    if (existing.isCurrent) throw new ConflictError("Make another year current before deleting this one.");
  }

  /** Make one year current; every other year stops being current. */
  async setCurrent(id: string): Promise<AcademicYear> {
    return this.write("manage", async (tx) => {
      const year = await this.findOrThrow(tx, id);
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

  protected sortColumns() { return { startsOn: terms.startsOn }; }
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
    return data;
  }
  protected async beforeUpdate(tx: Tx, existing: Term, data: Record<string, unknown>) {
    await this.within(tx, existing.yearId, data);
    return data;
  }

  /** Add Term 1 (April-September) and Term 2 (October-March) to a year, skipping names that already exist. */
  async addDefaults(yearId: string): Promise<Term[]> {
    return this.write("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
      if (!year) throw new NotFoundError("Academic year");
      const have = new Set((await tx.select({ name: terms.name }).from(terms).where(eq(terms.yearId, yearId))).map((t) => t.name));
      const missing = defaultTerms(year.name).filter((t) => !have.has(t.name));
      if (!missing.length) return [];
      return tx.insert(terms).values(missing.map((t) => ({ ...t, yearId, schoolId: this.ctx.schoolId }))).returning();
    }, (rows) => ({ action: "create", entity: this.entityName, summary: `Added ${rows.length} default terms` }));
  }
}

export class ClassService extends AcademicsCrud<typeof classes> {
  protected table = classes;
  protected entityName = "Class";
  protected createSchema = classInput;
  protected updateSchema = classInput;
  protected duplicateMessage = "A class with that name already exists";
  protected defaultSort = "grade";

  protected sortColumns() { return { grade: classes.grade, name: classes.name }; }
  protected searchColumns() { return [classes.name]; }

  /** Add Nursery, LKG, UKG and Class 1 to 12, skipping the ones that exist. */
  async addPresets(): Promise<{ added: number }> {
    return this.write("manage", async (tx) => {
      const rows = await tx.insert(classes).values(CLASS_PRESETS.map((c) => ({ ...c, schoolId: this.ctx.schoolId }))).onConflictDoNothing().returning({ id: classes.id });
      return { added: rows.length };
    }, (r) => ({ action: "create", entity: this.entityName, summary: `Added ${r.added} preset classes` }));
  }

  async options(): Promise<Option[]> {
    return this.read("read", async (tx) => (await this.all(tx, asc(classes.grade))).map((c) => ({ value: c.id, label: c.name })));
  }

  /** Per class, this year: sections, seats, students, subjects, and the gaps (sections with no class teacher, subject-by-section pairs with no teacher). */
  async stats(classIds: string[]): Promise<Record<string, ClassStats>> {
    return this.read("read", async (tx) => {
      const out: Record<string, ClassStats> = {};
      if (!classIds.length) return out;
      for (const id of classIds) out[id] = { sections: 0, capacity: 0, students: 0, subjects: 0, noClassTeacher: 0, unstaffed: 0 };
      const year = await currentYear(tx);
      if (year) {
        const rows = await tx.select({ classId: sections.classId, n: count(), cap: sum(sections.capacity) }).from(sections)
          .where(and(inArray(sections.classId, classIds), eq(sections.yearId, year.id))).groupBy(sections.classId);
        for (const r of rows) out[r.classId] = { ...out[r.classId]!, sections: Number(r.n), capacity: Number(r.cap ?? 0) };
        const { secs, subjectsOf, taught } = await staffing(tx, classIds);
        const enrolled = await enrolment(tx, this.ctx, secs.map((s) => s.id));
        for (const s of secs) {
          const o = out[s.classId]!;
          o.students += enrolled[s.id] ?? 0;
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

export interface ClassStats { sections: number; capacity: number; students: number; subjects: number; noClassTeacher: number; unstaffed: number }

export class SectionService extends AcademicsCrud<typeof sections> {
  protected table = sections;
  protected entityName = "Section";
  protected createSchema = sectionInput;
  protected updateSchema = sectionUpdate;
  protected duplicateMessage = "That section already exists for this class and year";
  protected defaultSort = "name";

  protected sortColumns() { return { name: sections.name }; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.classId ? eq(sections.classId, f.classId) : undefined, f.yearId ? eq(sections.yearId, f.yearId) : undefined];
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    const year = data.yearId ? { id: String(data.yearId) } : await currentYear(tx);
    if (!year) throw new ConflictError("Set a current academic year first.");
    await this.assertVisible(tx, classes, data.classId, "classId", "class");
    await this.assertVisible(tx, academicYears, year.id, "yearId", "academic year");
    await this.assertTeacher(tx, data.classTeacherId as string | undefined);
    return { ...data, yearId: year.id, classTeacherId: data.classTeacherId ?? null, room: data.room ?? null };
  }

  // The edit form always sends every field, so a blank teacher or room means "clear it".
  protected async beforeUpdate(tx: Tx, _existing: Section, data: Record<string, unknown>) {
    await this.assertTeacher(tx, data.classTeacherId as string | undefined);
    return { ...data, classTeacherId: data.classTeacherId ?? null, room: data.room ?? null };
  }

  /** Sections of a class in a year (default: the current one) with the class teacher's name. */
  async forClass(classId: string, yearId?: string) {
    return this.read("read", async (tx) => {
      const year = yearId ?? (await currentYear(tx))?.id;
      if (!year) return [];
      const rows = await tx.select({ ...sectionCols, teacherName: users.name }).from(sections).leftJoin(users, eq(users.id, sections.classTeacherId))
        .where(and(eq(sections.classId, classId), eq(sections.yearId, year))).orderBy(asc(sections.name));
      const enrolled = await enrolment(tx, this.ctx, rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, students: enrolled[r.id] ?? 0 }));
    });
  }

  /** Set or clear a section's class teacher without touching its other fields. */
  async assignClassTeacher(input: unknown): Promise<Section> {
    this.authorize("manage", "write");
    const { sectionId, teacherId } = this.parse(classTeacherInput, input);
    const s = await this.get(sectionId);
    return this.update(sectionId, { name: s.name, capacity: String(s.capacity), room: s.room ?? "", classTeacherId: teacherId ?? "" });
  }

  /** "Class 5 - A" style labels for selects, for one year (default: the current one). */
  async options(yearId?: string): Promise<Option[]> {
    return this.read("read", async (tx) => {
      const year = yearId ?? (await currentYear(tx))?.id;
      if (!year) return [];
      const rows = await tx.select({ id: sections.id, section: sections.name, cls: classes.name }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.yearId, year)).orderBy(asc(classes.grade), asc(sections.name));
      return rows.map((r) => ({ value: r.id, label: `${r.cls} - ${r.section}` }));
    });
  }
}
const sectionCols = {
  id: sections.id, classId: sections.classId, yearId: sections.yearId, name: sections.name, capacity: sections.capacity,
  classTeacherId: sections.classTeacherId, room: sections.room,
};

export class SubjectService extends AcademicsCrud<typeof subjects> {
  protected table = subjects;
  protected entityName = "Subject";
  protected createSchema = subjectInput;
  protected updateSchema = subjectInput;
  protected duplicateMessage = "A subject with that name already exists";
  protected defaultSort = "name";

  protected sortColumns() { return { name: subjects.name, kind: subjects.kind }; }
  protected searchColumns() { return [subjects.name, subjects.code]; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.kind ? eq(subjects.kind, f.kind as Subject["kind"]) : undefined]; }

  protected async beforeUpdate(_tx: Tx, _existing: Subject, data: Record<string, unknown>) { return { ...data, code: data.code ?? null }; }

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

  // Dropping a subject from a class also drops its teachers in that class's sections.
  protected async beforeRemove(tx: Tx, existing: typeof classSubjects.$inferSelect) {
    const ids = tx.select({ id: sections.id }).from(sections).where(eq(sections.classId, existing.classId));
    await tx.delete(sectionTeachers).where(and(eq(sectionTeachers.subjectId, existing.subjectId), inArray(sectionTeachers.sectionId, ids)));
  }

  /** Subjects a class studies, with the link id to remove it. */
  async forClass(classId: string) {
    return this.read("read", (tx) => tx.select({ id: classSubjects.id, subjectId: subjects.id, name: subjects.name, code: subjects.code, kind: subjects.kind })
      .from(classSubjects).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId)).where(eq(classSubjects.classId, classId)).orderBy(asc(subjects.name)));
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

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    const [section] = await tx.select({ classId: sections.classId }).from(sections).where(eq(sections.id, String(data.sectionId))).limit(1);
    if (!section) throw new NotFoundError("Section");
    const [taught] = await tx.select({ id: classSubjects.id }).from(classSubjects)
      .where(and(eq(classSubjects.classId, section.classId), eq(classSubjects.subjectId, String(data.subjectId)))).limit(1);
    if (!taught) throw new ConflictError("That subject is not taught in this class. Assign it to the class first.");
    await this.assertTeacher(tx, String(data.teacherId), "teacherId");
    return data;
  }
  protected async beforeUpdate(tx: Tx, _existing: typeof sectionTeachers.$inferSelect, data: Record<string, unknown>) {
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

  /** Create `nextName` (default: the year after the current one) with default terms; copy every section (same class, name, capacity). The new year is not made current. */
  async rollForward(nextName?: string): Promise<{ year: AcademicYear; sections: number }> {
    this.authorize("manage", "write");
    const input = this.parse(rolloverInput, { name: nextName });
    return this.write("manage", async (tx) => {
      const from = await currentYear(tx);
      if (!from) throw new ConflictError("Set a current academic year first.");
      const name = input.name ?? nextYearName(from.name);
      const [dup] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.name, name)).limit(1);
      if (dup) throw new ConflictError(`${name} already exists.`);
      const schoolId = this.ctx.schoolId;
      const [year] = await tx.insert(academicYears).values({ name, ...aprilToMarch(name), isCurrent: false, schoolId }).returning();
      await tx.insert(terms).values(defaultTerms(name).map((t) => ({ ...t, yearId: year!.id, schoolId })));
      const old = await tx.select().from(sections).where(eq(sections.yearId, from.id));
      if (old.length) await tx.insert(sections).values(old.map((s) => ({ classId: s.classId, name: s.name, capacity: s.capacity, yearId: year!.id, schoolId })));
      return { year: year!, sections: old.length };
    }, (r) => ({ action: "rollover", entity: "Academic year", entityId: r.year.id, summary: `Rolled forward to ${r.year.name} with ${r.sections} sections` }));
  }
}
