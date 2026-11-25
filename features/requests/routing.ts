// Who a request goes to: the category's owner, an escalation level, or the safeguarding leads. Never a person it is about.
import { and, asc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { schoolRoles, users, type Tx } from "@smw/db";
import { z } from "zod";
import { leadIds } from "@smw/feature-messages/leads";
import { sections, sectionTeachers } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import type { Nature } from "./constants";

export interface Route {
  /** Set when exactly one person answers for it; otherwise it is open to the team and somebody claims it. */
  ownerId: string | null;
  ownerRole: string;
  /** Everyone told about it. */
  notify: string[];
}

export const STAFF_ROLES = ["admin", "accountant", "teacher", "staff"];

const active = (extra: SQL | undefined) => and(eq(users.status, "active"), extra);
const ids = async (tx: Tx, where: SQL | undefined, skip: string[]) =>
  (await tx.select({ id: users.id }).from(users).where(and(active(where), skip.length ? notInArray(users.id, skip) : undefined)).orderBy(asc(users.createdAt))).map((u) => u.id);

/** People who work the whole queue: admins, accountants and any custom role with the office grant. */
export const officeIds = (tx: Tx, skip: string[]) =>
  ids(tx, or(inArray(users.role, ["admin", "accountant"]), inArray(users.roleId, tx.select({ id: schoolRoles.id }).from(schoolRoles).where(sql`'requests:office' = any(${schoolRoles.grants})`))), skip);

/** "Any teacher" means a teacher of this child: the class teacher or a subject teacher of the child's section. */
const teachesStudent = (tx: Tx, studentId: string) => {
  const section = tx.select({ id: students.sectionId }).from(students).where(eq(students.id, studentId));
  return or(
    inArray(users.id, tx.select({ id: sections.classTeacherId }).from(sections).where(inArray(sections.id, section))),
    inArray(users.id, tx.select({ id: sectionTeachers.teacherId }).from(sectionTeachers).where(inArray(sectionTeachers.sectionId, section))),
  );
};

/** A role is a built-in key ("admin"), a custom role id, or "class_teacher" (the teacher of the child's section). */
export async function resolveRoute(tx: Tx, spec: { userId?: string | null; role: string }, o: { studentId?: string | null; nature?: Nature; skip: string[] }): Promise<Route> {
  const { skip } = o;
  if (o.nature === "safety") return pick(await leadIds(tx, skip), "safeguard");
  if (spec.userId && !skip.includes(spec.userId)) {
    const [u] = await tx.select({ id: users.id }).from(users).where(active(eq(users.id, spec.userId)));
    if (u) return { ownerId: u.id, ownerRole: spec.role, notify: [u.id] };
  }
  let found: string[] = [];
  if (spec.role === "class_teacher") {
    if (o.studentId) {
      const [t] = await tx.select({ id: sections.classTeacherId }).from(students).innerJoin(sections, eq(sections.id, students.sectionId)).where(eq(students.id, o.studentId));
      if (t?.id && !skip.includes(t.id)) found = await ids(tx, eq(users.id, t.id), skip);
    }
  } else if (z.uuid().safeParse(spec.role).success) found = await ids(tx, eq(users.roleId, spec.role), skip);
  else found = await ids(tx, and(eq(users.role, spec.role as never), inArray(users.role, STAFF_ROLES as never[]), spec.role === "teacher" && o.studentId ? teachesStudent(tx, o.studentId) : undefined), skip);
  if (found.length) return pick(found, spec.role);
  const admins = await ids(tx, eq(users.role, "admin"), skip);
  return admins.length ? pick(admins, "admin") : pick(await officeIds(tx, skip), "admin");
}

function pick(found: string[], role: string): Route {
  return { ownerId: found.length === 1 ? found[0]! : null, ownerRole: role, notify: found };
}
