// The absence alert: one in-app notice and one email per student and date, however often the day is saved again,
// sent by the worker after a grace window so a mark corrected in time never reaches the family.
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { services, emailHtml, trySend } from "@smw/integrations";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import { DEFAULT_ROLLUP, DEFAULT_THRESHOLD, STATUS_LABEL, type AttendanceMode, type AttendanceStatus } from "./constants";
import { absenceAlerts, attendanceSettings, studentAttendance } from "./schema";
import { addDays, todayIST } from "./stats";

export interface AlertMail { to: string; subject: string; text: string; html: string }

export type Settings = { alertsEnabled: boolean; thresholdPercent: number; mode: AttendanceMode; rollupPercent: number };

export async function loadSettings(tx: Tx): Promise<Settings> {
  const [s] = await tx.select({ alertsEnabled: attendanceSettings.alertsEnabled, thresholdPercent: attendanceSettings.thresholdPercent, mode: attendanceSettings.mode, rollupPercent: attendanceSettings.rollupPercent }).from(attendanceSettings).limit(1);
  return s ?? { alertsEnabled: true, thresholdPercent: DEFAULT_THRESHOLD, mode: "daily", rollupPercent: DEFAULT_ROLLUP };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A plain notice-and-email pair for one person. */
export function notice(to: string | null, subject: string, body: string): AlertMail | null {
  return to ? { to, subject, text: body, html: emailHtml(esc(subject), `<p>${esc(body)}</p>`) } : null;
}

/** How long a mark can be corrected before the family hears about it. */
export const ALERT_GRACE_MS = 30 * 60_000;

/**
 * Inside the marking transaction: queue one alert per absent or late student and date (a second save changes nothing).
 * Nothing is sent here: `sendDueAlerts` sends it after the grace window, if the student is still absent or late then.
 * Days older than yesterday are skipped, so a back-dated correction never pings anyone.
 */
export async function queueAlerts(tx: Tx, schoolId: string, date: string, entries: { studentId: string; status: AttendanceStatus }[]): Promise<void> {
  const flagged = entries.filter((e) => e.status === "absent" || e.status === "late");
  if (flagged.length === 0 || date < addDays(todayIST(), -1)) return;
  if (!(await loadSettings(tx)).alertsEnabled) return;
  const kids = await tx.select({ id: students.id }).from(students).where(and(inArray(students.id, flagged.map((e) => e.studentId)), isNotNull(students.userId)));
  if (kids.length) await tx.insert(absenceAlerts).values(kids.map((k) => ({ schoolId, studentId: k.id, date }))).onConflictDoNothing();
}

/**
 * Worker, in one school's scope: alerts queued before `now - grace` go out. Each is checked against the day's current mark:
 * still absent or late, the student login gets the in-app notice now and the email after commit; anything else (corrected,
 * alerts turned off) is dropped. Rows are locked, so two runs never send one alert twice.
 */
export async function sendDueAlerts(tx: Tx, schoolId: string, now: Date): Promise<AlertMail[]> {
  const due = await tx.select({ id: absenceAlerts.id, studentId: absenceAlerts.studentId, date: absenceAlerts.date }).from(absenceAlerts)
    .where(and(isNull(absenceAlerts.sentAt), lte(absenceAlerts.queuedAt, new Date(now.getTime() - ALERT_GRACE_MS)))).for("update", { skipLocked: true });
  if (due.length === 0) return [];
  const drop = (ids: string[]) => ids.length ? tx.delete(absenceAlerts).where(inArray(absenceAlerts.id, ids)) : undefined;
  if (!(await loadSettings(tx)).alertsEnabled) { await drop(due.map((d) => d.id)); return []; }

  const marks = await tx.select({ studentId: studentAttendance.studentId, date: studentAttendance.date, status: studentAttendance.status }).from(studentAttendance)
    .where(inArray(studentAttendance.studentId, due.map((d) => d.studentId)));
  const statusOf = new Map(marks.map((m) => [`${m.studentId}:${m.date}`, m.status]));
  const kids = new Map((await tx.select({ id: students.id, name: students.name, userId: students.userId, email: users.email }).from(students)
    .innerJoin(users, eq(users.id, students.userId)).where(inArray(students.id, due.map((d) => d.studentId)))).map((k) => [k.id, k]));

  const send = due.flatMap((d) => {
    const status = statusOf.get(`${d.studentId}:${d.date}`), kid = kids.get(d.studentId);
    return (status === "absent" || status === "late") && kid ? [{ ...d, status, kid }] : [];
  });
  const sendIds = new Set(send.map((x) => x.id));
  await drop(due.filter((d) => !sendIds.has(d.id)).map((d) => d.id));
  if (send.length === 0) return [];
  await tx.update(absenceAlerts).set({ sentAt: now }).where(inArray(absenceAlerts.id, [...sendIds]));

  const line = (x: (typeof send)[number]) => `${x.kid.name} was marked ${STATUS_LABEL[x.status].toLowerCase()} on ${x.date}`;
  await NotificationWriter.insert(tx, schoolId, send.map((x) => ({
    userId: x.kid.userId!, kind: "system" as const, title: line(x),
    body: "Open attendance for the details. If this is a mistake, speak to the class teacher.", href: "/app/attendance",
  })));
  return send.flatMap((x) => notice(x.kid.email, line(x), `${line(x)}. If this is a mistake, please speak to the class teacher.`) ?? []);
}

/** After the commit. A failed email is logged and never fails the mark. */
export async function sendMails(mails: AlertMail[]): Promise<void> {
  await Promise.all(mails.map((m) => trySend(services().email, m)));
}
