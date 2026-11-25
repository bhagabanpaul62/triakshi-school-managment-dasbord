// Who is a family, who teaches a child, who counts as a sibling. Raw SQL on other features' tables, so no feature imports.
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { teachersOfStudent } from "@smw/feature-notifications/audience";
import type { meetingDays } from "./schema";

export type Meeting = typeof meetingDays.$inferSelect;
/** Raw rows. The driver hands back timestamps as text, so every column whose name ends in "At" becomes a Date. */
export const rows = async <T>(tx: Tx, q: SQL) => [...(await tx.execute(q))].map((r) => {
  for (const k of Object.keys(r)) if (k.endsWith("At") && typeof r[k] === "string") r[k] = new Date(r[k] as string);
  return r;
}) as T[];
/** A Date as a SQL value: the driver wants text in raw queries. */
export const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
export const idList = (list: string[]) => list.length ? sql.join(list.map((i) => sql`${i}::uuid`), sql`, `) : sql`null::uuid`;

export interface Kid { id: string; name: string; label: string; sectionId: string | null; userId: string | null }
export interface Teacher { teacherId: string; name: string; why: string }

const KID = sql`select s.id, s.name, s.section_id as "sectionId", s.user_id as "userId", coalesce(c.name || coalesce('-' || sec.name, ''), 'Student') as label
  from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id where s.status = 'active'`;

/** The active student this login belongs to (the family login is the student login). */
export async function kidOfLogin(tx: Tx, userId: string): Promise<Kid | null> {
  return (await rows<Kid>(tx, sql`${KID} and s.user_id = ${userId}::uuid limit 1`))[0] ?? null;
}
export async function kidById(tx: Tx, id: string): Promise<Kid | null> {
  return (await rows<Kid>(tx, sql`${KID} and s.id = ${id}::uuid limit 1`))[0] ?? null;
}

/** Who teaches this child, with why ("Class teacher, Maths"). */
export async function teachersOf(tx: Tx, studentId: string): Promise<Teacher[]> {
  return (await teachersOfStudent(tx, studentId)).map((t) => ({ teacherId: t.id, name: t.name, why: [t.classTeacher ? "Class teacher" : null, t.subjects].filter(Boolean).join(", ") }));
}

/** Active brothers and sisters: children who share a guardian with this one. */
export async function siblingIds(tx: Tx, studentId: string): Promise<string[]> {
  return (await rows<{ id: string }>(tx, sql`select distinct sg2.student_id as id from student_guardians sg join student_guardians sg2 on sg2.guardian_id = sg.guardian_id
    join students s on s.id = sg2.student_id and s.status = 'active' where sg.student_id = ${studentId}::uuid and sg2.student_id <> ${studentId}::uuid`)).map((r) => r.id);
}

/**
 * One family books one change at a time. The lock is held on the child and on each guardian, in a fixed order, so
 * two brothers (who share a guardian) can never both pass the clash check before either has written.
 */
export async function lockFamily(tx: Tx, studentId: string): Promise<void> {
  const guardians = await rows<{ id: string }>(tx, sql`select guardian_id::text as id from student_guardians where student_id = ${studentId}::uuid`);
  for (const key of [studentId, ...guardians.map((g) => g.id)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`meeting-family:${key}`}, 0))`);
}

/** A booking of this child or a sibling that overlaps the given time (in any meeting that still stands). */
export async function clashFor(tx: Tx, studentIds: string[], span: { startsAt: Date; endsAt: Date }, ignoreSlot?: string) {
  return rows<{ studentId: string; studentName: string; teacherName: string }>(tx, sql`
    select s.student_id as "studentId", st.name as "studentName", u.name as "teacherName"
    from meeting_slots s join meeting_days md on md.id = s.meeting_id and md.state <> 'cancelled'
    join students st on st.id = s.student_id join users u on u.id = s.teacher_id
    where s.state = 'booked' and s.student_id in (${idList(studentIds)}) and s.starts_at < ${ts(span.endsAt)} and s.ends_at > ${ts(span.startsAt)}
      ${ignoreSlot ? sql`and s.id <> ${ignoreSlot}::uuid` : sql``} limit 1`);
}
