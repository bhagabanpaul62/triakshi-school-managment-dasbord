// Who may see a request. This is the ONLY place that decides: list, counts, search, get, report, csv, files and notifications all use `scope`.
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { allows, ForbiddenError, type Ctx } from "@smw/feature-kit";
import { may, noSupport, isFamily } from "@smw/feature-messages/core";
import { sections, sectionTeachers } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import requestsFeature from "./feature";
import { requestCategories, requests } from "./schema";

export interface Viewer {
  userId: string;
  family: boolean;
  office: boolean;
  /** A teacher may write a request down only for a student they teach. */
  teacher: boolean;
  safeguard: boolean;
  /** Role keys a request may be owned by that this person answers for: their role and their custom role id. */
  roles: string[];
}

/** Who is looking. A support session sees nothing, ever. */
export async function viewerOf(tx: Tx, ctx: Ctx): Promise<Viewer> {
  noSupport(ctx);
  if (!allows(ctx, requestsFeature, "use") && !allows(ctx, requestsFeature, "office")) throw new ForbiddenError();
  const [u] = await tx.select({ roleId: users.roleId }).from(users).where(eq(users.id, ctx.userId));
  return {
    userId: ctx.userId, family: isFamily(ctx.role), office: allows(ctx, requestsFeature, "office"), teacher: ctx.role === "teacher", safeguard: may(ctx, "safeguard"),
    roles: [ctx.role, ...(u?.roleId ? [u.roleId] : [])],
  };
}

/** The sections this teacher teaches: as class teacher or as a subject teacher. */
export const taughtSections = (tx: Tx, userId: string) => tx.select({ id: sections.id }).from(sections)
  .where(or(eq(sections.classTeacherId, userId), inArray(sections.id, tx.select({ id: sectionTeachers.sectionId }).from(sectionTeachers).where(eq(sectionTeachers.teacherId, userId)))));

const safetyCategories = (tx: Tx) => tx.select({ id: requestCategories.id }).from(requestCategories).where(eq(requestCategories.nature, "safety"));

/** The rows this viewer may see. Everything that reads requests puts this in its `where`. */
export function scope(tx: Tx, v: Viewer): SQL {
  const me = v.userId;
  if (v.family) {
    const own = tx.select({ id: students.id }).from(students).where(eq(students.userId, me));
    return or(eq(requests.raisedBy, me), inArray(requests.studentId, own))!;
  }
  // A complaint about this person is invisible to them, whoever they are.
  const notAbout = sql`not (${me}::uuid = any(${requests.aboutUserIds}))`;
  const raisedByMe = eq(requests.raisedBy, me);
  // Safety concerns stay with safeguarding holders, not the general queue.
  const safetyOk = v.safeguard ? undefined : or(raisedByMe, sql`${requests.categoryId} not in (${safetyCategories(tx)})`);
  // A category owned by "any teacher" is not every teacher's business: a teacher sees such a request only for a student they teach, whatever the category says.
  const taught = inArray(requests.studentId, tx.select({ id: students.id }).from(students).where(inArray(students.sectionId, taughtSections(tx, me))));
  const mine = v.office ? undefined : or(
    eq(requests.ownerId, me), raisedByMe, v.teacher ? and(inArray(requests.ownerRole, v.roles), taught) : inArray(requests.ownerRole, v.roles),
    sql`${requests.ownerRole} = 'class_teacher' and exists (select 1 from ${students} inner join ${sections} on ${sections.id} = ${students.sectionId} where ${students.id} = ${requests.studentId} and ${sections.classTeacherId} = ${me})`,
  );
  return and(notAbout, safetyOk, mine)!;
}
