// Who may touch which assignment, shared by all three services (composition keeps each service on its own base class).
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { assignments } from "./schema";

export type Assignment = typeof assignments.$inferSelect;
export interface Kid { id: string; name: string; sectionId: string | null; rollNo: number | null; admissionNo: string }
export interface Option { value: string; label: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
/** "Class 5-A". */
export const sectionLabel = (className: string, sectionName: string) => `${className}-${sectionName}`;

const KID = { id: students.id, name: students.name, sectionId: students.sectionId, rollNo: students.rollNo, admissionNo: students.admissionNo };

export class AssignmentAccess {
  constructor(private readonly ctx: Ctx) {}

  /** Everyone but the admin is scoped by the sections and subjects they teach (custom staff-base roles included); a student login never reaches these paths. */
  private get isTeacher() { return this.ctx.role !== "admin" && this.ctx.role !== "student"; }

  /** Teachers see only assignments for a section and subject they teach; everyone else is unrestricted here. */
  teacherScope(): SQL | undefined {
    if (!this.isTeacher) return undefined;
    return sql`exists (select 1 from ${sectionTeachers} where ${sectionTeachers.sectionId} = ${assignments.sectionId} and ${sectionTeachers.subjectId} = ${assignments.subjectId} and ${sectionTeachers.teacherId} = ${this.ctx.userId})`;
  }

  /** The assignment, or NotFound when it does not exist or is outside the caller's scope. */
  async assignment(tx: Tx, id: string): Promise<Assignment> {
    if (!isUuid(id)) throw new NotFoundError("Assignment");
    const [row] = await tx.select().from(assignments).where(and(eq(assignments.id, id), this.teacherScope())).limit(1);
    if (!row) throw new NotFoundError("Assignment");
    return row;
  }

  /** Section + subject must exist; a teacher must also teach that subject to that section. */
  async assertCanAssign(tx: Tx, sectionId: string, subjectId: string): Promise<void> {
    const [[sec], [sub]] = await Promise.all([
      tx.select({ id: sections.id }).from(sections).where(eq(sections.id, sectionId)).limit(1),
      tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).limit(1),
    ]);
    if (!sec) throw new ValidationError({ sectionId: "Pick a section" });
    if (!sub) throw new ValidationError({ subjectId: "Pick a subject" });
    if (!this.isTeacher) return;
    const [mine] = await tx.select({ id: sectionTeachers.id }).from(sectionTeachers)
      .where(and(eq(sectionTeachers.sectionId, sectionId), eq(sectionTeachers.subjectId, subjectId), eq(sectionTeachers.teacherId, this.ctx.userId))).limit(1);
    if (!mine) throw new ForbiddenError("You do not teach this subject to this section.");
  }

  /** (section, subject, teacher) triples the caller may assign for: a teacher's own, or all for an admin. */
  async assignable(tx: Tx) {
    return tx.select({ sectionId: sectionTeachers.sectionId, subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId })
      .from(sectionTeachers).where(this.isTeacher ? eq(sectionTeachers.teacherId, this.ctx.userId) : undefined);
  }

  /** Choices for the create form: sections of the current year and subjects, limited to what a teacher teaches. */
  async options(tx: Tx): Promise<{ sections: Option[]; subjects: Option[] }> {
    const pairs = this.isTeacher ? await this.assignable(tx) : null;
    if (pairs && pairs.length === 0) return { sections: [], subjects: [] };
    const secIds = pairs ? [...new Set(pairs.map((p) => p.sectionId))] : null;
    const subIds = pairs ? [...new Set(pairs.map((p) => p.subjectId))] : null;
    const [secs, subs] = await Promise.all([
      tx.select({ id: sections.id, name: sections.name, className: classes.name, current: academicYears.isCurrent }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId))
        .where(secIds ? inArray(sections.id, secIds) : undefined).orderBy(asc(classes.grade), asc(sections.name)),
      tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(subIds ? inArray(subjects.id, subIds) : undefined).orderBy(asc(subjects.name)),
    ]);
    const live = secs.filter((s) => s.current);
    return {
      sections: (live.length ? live : secs).map((s) => ({ value: s.id, label: sectionLabel(s.className, s.name) })),
      subjects: subs.map((s) => ({ value: s.id, label: s.name })),
    };
  }

  /** Display names for a page of assignments. */
  async labels(tx: Tx, sectionIds: string[], subjectIds: string[]) {
    const secIds = [...new Set(sectionIds)], subIds = [...new Set(subjectIds)];
    const [secs, subs] = await Promise.all([
      secIds.length ? tx.select({ id: sections.id, name: sections.name, className: classes.name }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(inArray(sections.id, secIds)) : [],
      subIds.length ? tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, subIds)) : [],
    ]);
    return {
      section: (id: string) => { const s = secs.find((x) => x.id === id); return s ? sectionLabel(s.className, s.name) : "-"; },
      subject: (id: string) => subs.find((x) => x.id === id)?.name ?? "-",
    };
  }

  async userName(tx: Tx, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? null;
  }

  /** Active students of a section, in roll order. */
  async roster(tx: Tx, sectionId: string): Promise<Kid[]> {
    return tx.select(KID).from(students).where(and(eq(students.sectionId, sectionId), eq(students.status, "active"))).orderBy(asc(students.rollNo), asc(students.name));
  }

  /** A student login → itself; anyone else → nobody. */
  async myStudents(tx: Tx): Promise<Kid[]> {
    if (this.ctx.role !== "student") return [];
    return tx.select(KID).from(students).where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active")));
  }

  async myStudent(tx: Tx): Promise<Kid> {
    const [me] = await this.myStudents(tx);
    if (!me || this.ctx.role !== "student") throw new ForbiddenError("This login is not linked to a student.");
    return me;
  }
}
