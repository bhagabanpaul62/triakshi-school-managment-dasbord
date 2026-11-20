import { and, asc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { users, type SchoolRole, type Tx } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { sections, sectionTeachers } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export interface Contact { id: string; name: string; role: SchoolRole }

const none = sql`false`;
const idIn = (ids: string[]) => (ids.length ? inArray(users.id, ids) : none);

/**
 * Who one kind of user may START a conversation with. Replying inside a conversation you are in is always allowed.
 * A rule only says which `users` rows are reachable; listing contacts and checking recipients both go through
 * `reachable()`, so the two can never disagree.
 */
export abstract class ContactRule {
  /** WHERE on `users` for the people this user may message (undefined = everyone in the school). */
  protected abstract allowed(tx: Tx, me: Ctx): Promise<SQL | undefined>;

  async reachable(tx: Tx, me: Ctx, extra?: SQL, limit = 500): Promise<Contact[]> {
    return tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
      .where(and(eq(users.schoolId, me.schoolId), eq(users.status, "active"), ne(users.id, me.userId), await this.allowed(tx, me), extra))
      .orderBy(asc(users.name), asc(users.id)).limit(limit);
  }
}

/** Admins, accountants and teachers can start a conversation with anyone in the school. */
export class StaffContactRule extends ContactRule {
  protected async allowed() { return undefined; }
}

/** A student (the family login) reaches teachers of their own sections (subject teachers and the class teacher). */
abstract class TeacherContactRule extends ContactRule {
  protected abstract sectionIds(tx: Tx, me: Ctx): Promise<string[]>;

  private async teachersOf(tx: Tx, sectionIds: string[]): Promise<string[]> {
    if (!sectionIds.length) return [];
    const [subject, form] = await Promise.all([
      tx.select({ id: sectionTeachers.teacherId }).from(sectionTeachers).where(inArray(sectionTeachers.sectionId, sectionIds)),
      tx.select({ id: sections.classTeacherId }).from(sections).where(inArray(sections.id, sectionIds)),
    ]);
    return [...new Set([...subject, ...form].map((r) => r.id).filter((id): id is string => !!id))];
  }

  protected async allowed(tx: Tx, me: Ctx) {
    // The student login is also the family login, so the school office (admins) must stay reachable.
    return or(idIn(await this.teachersOf(tx, await this.sectionIds(tx, me))), eq(users.role, "admin"));
  }
}

/** A student (family login): their own teachers and the school office. */
export class StudentContactRule extends TeacherContactRule {
  protected async sectionIds(tx: Tx, me: Ctx) {
    const rows = await tx.select({ id: students.sectionId }).from(students).where(and(eq(students.userId, me.userId), eq(students.status, "active")));
    return rows.map((r) => r.id).filter((id): id is string => !!id);
  }
}

/** Legacy `parent` users are disabled; if one is ever signed in, they can start nothing. */
class NoContactRule extends ContactRule {
  protected async allowed() { return none; }
}

const staff = new StaffContactRule();
export const CONTACT_RULES: Record<SchoolRole, ContactRule> = {
  admin: staff, accountant: staff, teacher: staff, staff, parent: new NoContactRule(), student: new StudentContactRule(),
};
