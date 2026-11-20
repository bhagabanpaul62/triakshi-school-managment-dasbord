// Electives and streams: subject groups per class, a student's group, and "what does this student study".
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { AcademicsCrud } from "./base";
import { assignGroupInput, choicesInput, groupUpdate, subjectGroupInput } from "./inputs";
import { academicYears, classSubjects, classes, sections, studentSubjects, subjectGroupSubjects, subjectGroups, subjects } from "./schema";

export type StudentSubject = { subjectId: string; name: string; code: string | null; kind: "scholastic" | "co_scholastic"; elective: boolean };

/** Students are read by raw SQL: the students feature depends on this one, so it cannot be imported here. */
export async function studentRow(tx: Tx, ctx: Ctx, studentId: string) {
  if (!ctx.features.has("students")) throw new ConflictError("Turn on the Students module first.");
  const rows = await tx.execute(sql`select id, name, class_id, section_id, user_id, status from students where id = ${studentId}`);
  const r = [...rows][0] as { id: string; name: string; class_id: string | null; section_id: string | null; user_id: string | null; status: string } | undefined;
  if (!r) throw new NotFoundError("Student");
  return r;
}

/** Active students of a section, in roll order. */
export async function sectionStudents(tx: Tx, ctx: Ctx, sectionId: string) {
  if (!ctx.features.has("students")) return [];
  const rows = await tx.execute(sql`select id, name, roll_no from students where section_id = ${sectionId} and status = 'active' order by roll_no nulls last, name`);
  return [...rows].map((r) => ({ id: String(r.id), name: String(r.name), rollNo: r.roll_no as number | null }));
}

export class SubjectGroupService extends AcademicsCrud<typeof subjectGroups> {
  protected table = subjectGroups;
  protected entityName = "Subject group";
  protected createSchema = subjectGroupInput;
  protected updateSchema = groupUpdate;
  protected duplicateMessage = "That class already has a group with this name";
  protected defaultSort = "name";
  /** Subject ids of the group being created, from beforeCreate to afterCreate (the same call). */
  private pending: string[] = [];

  protected sortColumns() { return { name: subjectGroups.name }; }
  protected searchColumns() { return [subjectGroups.name]; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.classId ? eq(subjectGroups.classId, f.classId) : undefined]; }

  /** A group holds only elective subjects the class studies. */
  private async electives(tx: Tx, classId: string, subjectIds: string[]) {
    const ids = [...new Set(subjectIds)];
    const elective = await tx.select({ id: classSubjects.subjectId }).from(classSubjects)
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.isElective, true), inArray(classSubjects.subjectId, ids)));
    if (elective.length !== ids.length) throw new ValidationError({ subjectIds: "Groups can only hold elective subjects of this class" });
    return ids;
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    await this.assertVisible(tx, classes, data.classId, "classId", "class");
    this.pending = await this.electives(tx, String(data.classId), data.subjectIds as string[]);
    return { classId: data.classId, name: data.name };
  }
  protected async afterCreate(tx: Tx, g: typeof subjectGroups.$inferSelect) {
    await tx.insert(subjectGroupSubjects).values(this.pending.map((subjectId) => ({ groupId: g.id, subjectId, schoolId: this.ctx.schoolId })));
  }

  /** Rename a group or change its subjects; students lose the subjects taken out of it. */
  protected async beforeUpdate(tx: Tx, g: typeof subjectGroups.$inferSelect, data: Record<string, unknown>) {
    const ids = await this.electives(tx, g.classId, data.subjectIds as string[]);
    await tx.delete(subjectGroupSubjects).where(and(eq(subjectGroupSubjects.groupId, g.id), notInArray(subjectGroupSubjects.subjectId, ids)));
    await tx.delete(studentSubjects).where(and(eq(studentSubjects.groupId, g.id), notInArray(studentSubjects.subjectId, ids)));
    await tx.insert(subjectGroupSubjects).values(ids.map((subjectId) => ({ groupId: g.id, subjectId, schoolId: this.ctx.schoolId }))).onConflictDoNothing();
    // students already in the group gain the new subjects
    const members = await tx.select({ studentId: studentSubjects.studentId, yearId: studentSubjects.yearId }).from(studentSubjects).where(eq(studentSubjects.groupId, g.id));
    const seen = new Set<string>();
    const gain = members.filter((m) => !seen.has(m.studentId + m.yearId) && seen.add(m.studentId + m.yearId))
      .flatMap((m) => ids.map((subjectId) => ({ studentId: m.studentId, yearId: m.yearId, subjectId, groupId: g.id, schoolId: this.ctx.schoolId })));
    if (gain.length) await tx.insert(studentSubjects).values(gain).onConflictDoNothing();
    return { name: data.name };
  }

  // Students in a deleted group lose the subjects it gave them (the form says so before the click).
  protected async beforeRemove(tx: Tx, g: typeof subjectGroups.$inferSelect) {
    await tx.delete(studentSubjects).where(eq(studentSubjects.groupId, g.id));
  }

  /** Groups of a class with their subjects. */
  async forClass(classId: string) {
    return this.read("read", async (tx) => {
      const groups = await tx.select().from(subjectGroups).where(eq(subjectGroups.classId, classId)).orderBy(asc(subjectGroups.name));
      if (!groups.length) return [];
      const links = await tx.select({ groupId: subjectGroupSubjects.groupId, subjectId: subjects.id, name: subjects.name }).from(subjectGroupSubjects)
        .innerJoin(subjects, eq(subjects.id, subjectGroupSubjects.subjectId)).where(inArray(subjectGroupSubjects.groupId, groups.map((g) => g.id))).orderBy(asc(subjects.name));
      return groups.map((g) => ({ ...g, subjects: links.filter((l) => l.groupId === g.id) }));
    });
  }

  /**
   * Set a student's own elective picks for the current year: subjects chosen one by one, outside any group.
   * An empty list clears them. Picks must be elective subjects of the student's class.
   */
  async setChoices(input: unknown): Promise<{ count: number }> {
    const { studentId, subjectIds } = this.parse(choicesInput, input);
    return this.write("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) throw new ConflictError("Set a current academic year first.");
      const st = await studentRow(tx, this.ctx, studentId);
      const ids = [...new Set(subjectIds)];
      if (ids.length) {
        const ok = st.class_id ? await tx.select({ id: classSubjects.subjectId }).from(classSubjects)
          .where(and(eq(classSubjects.classId, st.class_id), eq(classSubjects.isElective, true), inArray(classSubjects.subjectId, ids))) : [];
        if (ok.length !== ids.length) throw new ValidationError({ subjectIds: "Pick elective subjects of the student's class" });
      }
      await tx.delete(studentSubjects).where(and(eq(studentSubjects.studentId, studentId), eq(studentSubjects.yearId, year.id), isNull(studentSubjects.groupId)));
      if (ids.length) await tx.insert(studentSubjects).values(ids.map((subjectId) => ({ studentId, yearId: year.id, subjectId, schoolId: this.ctx.schoolId }))).onConflictDoNothing();
      return { count: ids.length, name: st.name };
    }, (r) => ({ action: "update", entity: "Student subjects", summary: `Set ${r.count} elective choices for ${r.name}` }));
  }

  /** Put one student in a group for the current year (or, with no group, take them out). Replaces their earlier group. */
  async assign(input: unknown): Promise<{ groupId: string | null }> {
    const { studentId, groupId } = this.parse(assignGroupInput, input);
    return this.write("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) throw new ConflictError("Set a current academic year first.");
      const st = await studentRow(tx, this.ctx, studentId);
      await tx.delete(studentSubjects).where(and(eq(studentSubjects.studentId, studentId), eq(studentSubjects.yearId, year.id), sql`${studentSubjects.groupId} is not null`));
      if (groupId) {
        const [g] = await tx.select().from(subjectGroups).where(eq(subjectGroups.id, groupId)).limit(1);
        if (!g) throw new ValidationError({ groupId: "Pick a valid group" });
        if (g.classId !== st.class_id) throw new ValidationError({ groupId: `${g.name} is not a group of this student's class` });
        const subs = await tx.select({ subjectId: subjectGroupSubjects.subjectId }).from(subjectGroupSubjects).where(eq(subjectGroupSubjects.groupId, groupId));
        if (subs.length) await tx.insert(studentSubjects).values(subs.map((s) => ({ studentId, yearId: year.id, subjectId: s.subjectId, groupId, schoolId: this.ctx.schoolId }))).onConflictDoNothing();
      }
      return { groupId: groupId ?? null, name: st.name };
    }, (r) => ({ action: "update", entity: "Student subjects", summary: r.groupId ? `Put ${r.name} in a subject group` : `Cleared the subject group of ${r.name}` }));
  }

  /** Students of a section with the group each is in this year. */
  async roster(sectionId: string) {
    return this.read("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      const [sec] = await tx.select({ id: sections.id }).from(sections).where(eq(sections.id, sectionId)).limit(1);
      if (!sec) throw new NotFoundError("Section");
      const list = await sectionStudents(tx, this.ctx, sectionId);
      if (!list.length || !year) return list.map((s) => ({ ...s, groupId: "", picks: [] as string[] }));
      const rows = await tx.select({ studentId: studentSubjects.studentId, groupId: studentSubjects.groupId, subjectId: studentSubjects.subjectId }).from(studentSubjects)
        .where(and(eq(studentSubjects.yearId, year.id), inArray(studentSubjects.studentId, list.map((s) => s.id))));
      const groupOf = new Map(rows.filter((p) => p.groupId).map((p) => [p.studentId, p.groupId!]));
      // own picks: electives chosen one by one, outside any group
      const picksOf = new Map<string, string[]>();
      for (const r of rows) if (!r.groupId) picksOf.set(r.studentId, [...(picksOf.get(r.studentId) ?? []), r.subjectId]);
      return list.map((s) => ({ ...s, groupId: groupOf.get(s.id) ?? "", picks: picksOf.get(s.id) ?? [] }));
    });
  }

  /** What a student studies: every compulsory subject of their class plus the electives chosen for them in the year (default: the current one). Exams use this. */
  async subjectsForStudent(studentId: string, yearId?: string): Promise<StudentSubject[]> {
    return this.read("read", async (tx) => {
      const st = await studentRow(tx, this.ctx, studentId);
      if (this.ctx.role === "student" && st.user_id !== this.ctx.userId) throw new ForbiddenError();
      if (!st.class_id) return [];
      const year = yearId ?? (await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1))[0]?.id;
      const cols = { subjectId: subjects.id, name: subjects.name, code: subjects.code, kind: subjects.kind };
      const compulsory = await tx.select(cols).from(classSubjects).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
        .where(and(eq(classSubjects.classId, st.class_id), eq(classSubjects.isElective, false)));
      const chosen = year ? await tx.select(cols).from(studentSubjects).innerJoin(subjects, eq(subjects.id, studentSubjects.subjectId))
        .where(and(eq(studentSubjects.studentId, studentId), eq(studentSubjects.yearId, year))) : [];
      return [...compulsory.map((s) => ({ ...s, elective: false })), ...chosen.map((s) => ({ ...s, elective: true }))]
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }
}
