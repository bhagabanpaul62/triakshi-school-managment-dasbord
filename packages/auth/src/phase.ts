/**
 * What a student's login may do, from the student row. Pure; the one place for the 90 days and the sentences.
 * Dates are IST calendar days as `YYYY-MM-DD`.
 * @module @smw/auth/phase
 */
import { sql, type Tx } from "@smw/db";

/** Days after the last day attended that a left student's family can still sign in. */
export const LEFT_ACCESS_DAYS = 90;
export const LOGIN_CLOSED_MESSAGE = "This login was closed because the student left the school. Ask the school office.";

/** `accessUntil` is students.access_until: the last day (inclusive, IST) a left or alumni login works; null = closed. */
export interface StudentPhase { status: "joining" | "active" | "alumni" | "left"; leftOn: string | null; joinsOn: string | null; accessUntil?: string | null }

export type Access =
  | { kind: "full" }
  | { kind: "left"; until: string }
  | { kind: "closed" }
  | { kind: "joining"; joinsOn: string | null };

const IST_MS = 330 * 60_000;
export const istDay = (now: Date) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The value features/students writes to students.access_until: LEFT_ACCESS_DAYS after the later of today and the last day attended. */
export const accessUntilFor = (lastDay: string, now = new Date()) => { const t = istDay(now); return addDays(lastDay > t ? lastDay : t, LEFT_ACCESS_DAYS); };

/** No phase (staff, parent, a student with no student row) = full. Left or alumni = limited until access_until (inclusive), then closed; no date = closed. */
export function accessOf(phase: StudentPhase | null | undefined, now = new Date()): Access {
  if (!phase) return { kind: "full" };
  if (phase.status === "joining") return { kind: "joining", joinsOn: phase.joinsOn };
  if (phase.status === "active") return { kind: "full" };
  const until = phase.accessUntil ?? null;
  return until && istDay(now) <= until ? { kind: "left", until } : { kind: "closed" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2027-01-12 -> "12 Jan 2027". */
export function longDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}
export const startsMessage = (joinsOn: string | null) => (joinsOn ? `This login starts on ${longDate(joinsOn)}.` : "This login has not started yet. Ask the school office.");

let hasStudents = false;
/**
 * The student row behind a login (index students_user), when the students feature is installed. Guarded by to_regclass like dobOf (packages never import features).
 */
export async function studentPhaseOf(tx: Tx, schoolId: string, userId: string): Promise<StudentPhase | null> {
  if (!hasStudents) {
    const has = await tx.execute(sql`select to_regclass('students') is not null as ok`);
    if (!has[0]?.ok) return null;
    hasStudents = true;
  }
  const cols = sql`s.status, to_char(s.left_on, 'YYYY-MM-DD') as left_on, to_char(s.joins_on, 'YYYY-MM-DD') as joins_on, to_char(s.access_until, 'YYYY-MM-DD') as access_until`;
  const rows = await tx.execute(sql`select ${cols} from students s where s.school_id = ${schoolId} and s.user_id = ${userId} limit 1`);
  const r = rows[0];
  return r ? { status: r.status as StudentPhase["status"], leftOn: (r.left_on as string | null) ?? null, joinsOn: (r.joins_on as string | null) ?? null, accessUntil: (r.access_until as string | null) ?? null } : null;
}

/** Topics a left student's family may still be told about: fees, results and account security. Nothing else, and nothing once closed. */
export const LEFT_TOPIC = /^(fees|exam)\.|^(account\.security|privacy\.request)$/;
export function mayHear(phase: StudentPhase | null | undefined, topic: string, now = new Date()): boolean {
  const a = accessOf(phase, now);
  return a.kind === "full" || (a.kind === "left" && LEFT_TOPIC.test(topic));
}

/** The phase of every left or alumni student among these logins (others are absent). One indexed read by school and status. */
export async function leftPhases(tx: Tx, schoolIds: string[], userIds: string[]): Promise<Map<string, StudentPhase>> {
  const out = new Map<string, StudentPhase>();
  if (!schoolIds.length || !userIds.length) return out;
  if (!hasStudents) {
    const has = await tx.execute(sql`select to_regclass('students') is not null as ok`);
    if (!has[0]?.ok) return out;
    hasStudents = true;
  }
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);
  const rows = await tx.execute(sql`select user_id::text as user_id, status, to_char(left_on, 'YYYY-MM-DD') as left_on, to_char(access_until, 'YYYY-MM-DD') as access_until from students
    where school_id in (${list(schoolIds)}) and status in ('left', 'alumni') and user_id in (${list(userIds)})`);
  for (const r of rows) out.set(r.user_id as string, { status: r.status as StudentPhase["status"], leftOn: (r.left_on as string | null) ?? null, joinsOn: null, accessUntil: (r.access_until as string | null) ?? null });
  return out;
}
