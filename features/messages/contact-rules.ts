// Who may START a conversation with whom. Replying inside one you are in is always allowed.
// One place answers both "who can I pick?" and "may I message this person?", so the picker and the check cannot disagree.
import { and, asc, eq, ilike, inArray, ne, notInArray, or } from "drizzle-orm";
import { users, type SchoolRole, type Tx } from "@smw/db";
import { allows, ForbiddenError, type Ctx } from "@smw/feature-kit";
import { classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { teacherSections } from "@smw/feature-notifications/audience";
import type { CommSettings } from "@smw/feature-notifications/settings";
import { students } from "@smw/feature-students/schema";
import messagesFeature from "./feature";
import { isFamily } from "./core";

/** A person a family or a staff member may pick. `label` says why they are in the list: "Maths", "Class teacher", "School office". */
export interface Contact { id: string; name: string; role: SchoolRole; label: string }
/** A student a staff member may write about. The family login is the other side. */
export interface StudentContact { id: string; name: string; userId: string; label: string }

const like = (q?: string) => (q?.trim() ? `%${q.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")}%` : null);

export class Starters {
  constructor(private readonly ctx: Ctx, private readonly settings: CommSettings) {}

  private get family() { return isFamily(this.ctx.role); }
  private get all() { return allows(this.ctx, messagesFeature, "all"); }

  /** Staff to staff: any active staff member. Nobody picks a family by login name. */
  async staff(tx: Tx, q?: string, limit = 20): Promise<Contact[]> {
    const t = like(q);
    const rows = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
      .where(and(eq(users.status, "active"), ne(users.id, this.ctx.userId), notInArray(users.role, ["student", "parent"]), t ? ilike(users.name, t) : undefined))
      .orderBy(asc(users.name), asc(users.id)).limit(limit);
    return rows.map((r) => ({ ...r, label: r.role === "admin" ? this.settings.officeName : r.role }));
  }

  /** Sections whose families this staff member may write to. Null means every section. */
  private async sectionScope(tx: Tx): Promise<string[] | null> {
    if (this.all) return null;
    if (this.ctx.role !== "teacher") return [];
    if (this.settings.teacherMessages === "class_teacher") {
      const rows = await tx.select({ id: sections.id }).from(sections).where(eq(sections.classTeacherId, this.ctx.userId));
      return rows.map((r) => r.id);
    }
    return teacherSections(tx, this.ctx.userId);
  }

  /** Staff to family: students (not logins) the person may message, who have an active login. */
  async students(tx: Tx, q?: string, limit = 20): Promise<StudentContact[]> {
    const scope = await this.sectionScope(tx);
    if (scope && !scope.length) return [];
    const t = like(q);
    const rows = await tx.select({ id: students.id, name: students.name, userId: students.userId, cls: classes.name, sec: sections.name }).from(students)
      .innerJoin(users, and(eq(users.id, students.userId), eq(users.status, "active")))
      .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
      .where(and(eq(students.status, "active"), scope ? inArray(students.sectionId, scope) : undefined, t ? or(ilike(students.name, t), ilike(students.admissionNo, t)) : undefined))
      .orderBy(asc(students.name), asc(students.id)).limit(limit);
    return rows.map((r) => ({ id: r.id, name: r.name, userId: r.userId!, label: [r.cls, r.sec].filter(Boolean).join(" ") }));
  }

  /** The student, if this staff member may message that family. Anything else is refused in plain words. */
  async studentFor(tx: Tx, studentId: string): Promise<StudentContact> {
    const hit = await this.byId(tx, studentId, await this.sectionScope(tx));
    if (!hit) throw new ForbiddenError(this.settings.teacherMessages === "class_teacher" && this.ctx.role === "teacher"
      ? "You can message the families of the class you are class teacher of. Ask the school office for others."
      : "You can message the families of students you teach. Ask the school office for others.");
    return hit;
  }

  /** The students among `ids` this person may not write to, by the same section rule as `students` and `studentFor`. A family login is not needed here: "Message families" reports who cannot be reached on its own. */
  async outside(tx: Tx, ids: string[]): Promise<string[]> {
    const scope = await this.sectionScope(tx);
    if (!scope || !ids.length) return scope ? ids : [];
    const ok = scope.length ? await tx.select({ id: students.id }).from(students).where(and(inArray(students.id, ids), eq(students.status, "active"), inArray(students.sectionId, scope))) : [];
    const inside = new Set(ok.map((r) => r.id));
    return ids.filter((id) => !inside.has(id));
  }

  private async byId(tx: Tx, studentId: string, scope: string[] | null): Promise<StudentContact | null> {
    if (scope && !scope.length) return null;
    const [r] = await tx.select({ id: students.id, name: students.name, userId: students.userId, cls: classes.name, sec: sections.name }).from(students)
      .innerJoin(users, and(eq(users.id, students.userId), eq(users.status, "active")))
      .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
      .where(and(eq(students.id, studentId), eq(students.status, "active"), scope ? inArray(students.sectionId, scope) : undefined));
    return r ? { id: r.id, name: r.name, userId: r.userId!, label: [r.cls, r.sec].filter(Boolean).join(" ") } : null;
  }

  /** A family's own children (active students on this login). */
  async children(tx: Tx): Promise<{ id: string; name: string }[]> {
    return tx.select({ id: students.id, name: students.name }).from(students).where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active"))).orderBy(asc(students.name));
  }

  /** Family to school: the child's class teacher and subject teachers (named by subject), and the office. */
  async teachers(tx: Tx, studentId?: string): Promise<Contact[]> {
    const kids = await tx.select({ sectionId: students.sectionId }).from(students)
      .where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active"), studentId ? eq(students.id, studentId) : undefined));
    const secIds = [...new Set(kids.map((k) => k.sectionId).filter((s): s is string => !!s))];
    const out = new Map<string, Contact>();
    if (secIds.length) {
      const [subj, form] = await Promise.all([
        tx.select({ id: users.id, name: users.name, role: users.role, subject: subjects.name }).from(sectionTeachers)
          .innerJoin(users, and(eq(users.id, sectionTeachers.teacherId), eq(users.status, "active"))).innerJoin(subjects, eq(subjects.id, sectionTeachers.subjectId)).where(inArray(sectionTeachers.sectionId, secIds)),
        tx.select({ id: users.id, name: users.name, role: users.role }).from(sections).innerJoin(users, and(eq(users.id, sections.classTeacherId), eq(users.status, "active"))).where(inArray(sections.id, secIds)),
      ]);
      for (const f of form) out.set(f.id, { ...f, label: "Class teacher" });
      for (const s of subj) {
        const had = out.get(s.id);
        out.set(s.id, { id: s.id, name: s.name, role: s.role, label: had ? `${had.label}, ${s.subject}` : s.subject });
      }
    }
    const office = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"))).orderBy(asc(users.name));
    for (const o of office) if (!out.has(o.id)) out.set(o.id, { ...o, label: this.settings.officeName });
    return [...out.values()];
  }

  /** Staff ids among `ids` that this person may start a conversation with. */
  async allowedStaff(tx: Tx, ids: string[], studentId?: string): Promise<Set<string>> {
    if (this.family) return new Set((await this.teachers(tx, studentId)).filter((c) => ids.includes(c.id)).map((c) => c.id));
    const rows = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.status, "active"), ne(users.id, this.ctx.userId), notInArray(users.role, ["student", "parent"])));
    return new Set(rows.map((r) => r.id));
  }
}
