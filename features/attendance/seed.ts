import { ConflictError, ValidationError, type Ctx, type FeatureSeed } from "@smw/feature-kit";
import type { AttendanceStatus } from "./constants";
import { withSchool } from "@smw/db";
import { HolidayService } from "./holiday-service";
import { closedSet } from "./holidays";
import { ensureCredit } from "./leave-ledger";
import { StaffAttendanceService, StudentAttendanceService } from "./service";
import { addDays, isSunday, todayIST } from "./stats";

const SCHOOL_DAYS = 25;

/** Small deterministic generator so every demo school gets the same believable pattern. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Diwali moves every year; the demo school closes for five days around it. */
const DIWALI: Record<number, string> = { 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17" };

/**
 * A realistic year of closures, added through the service like the office would. They go in before any mark, so no closed day is ever marked
 * (the marks below skip them); a day the service refuses (a clash) is left out.
 */
async function seedHolidays(ctx: Ctx, today: string) {
  const svc = new HolidayService(ctx);
  const { year } = await svc.workingDays();
  if (!year) return;
  const y = Number(year.startsOn.slice(0, 4)), diwali = DIWALI[y] ?? `${y}-11-01`;
  const weekday = (d: string) => (isSunday(d) ? addDays(d, 1) : d);
  const sunday = (d: string) => { while (!isSunday(d)) d = addDays(d, 1); return d; };
  const top = (await svc.classOptions()).at(-1);
  const items = [
    { from: `${y}-08-15`, name: "Independence Day", kind: "national" },
    { from: `${y}-10-02`, name: "Gandhi Jayanti", kind: "national" },
    { from: addDays(diwali, -2), to: addDays(diwali, 2), name: "Diwali break", kind: "vacation" },
    { from: `${y}-12-25`, name: "Christmas", kind: "restricted" },
    { from: `${y + 1}-01-26`, name: "Republic Day", kind: "national" },
    ...(top ? [{ from: weekday(addDays(today, 10)), name: `${top.name} preparation leave`, kind: "other", appliesTo: "classes", classIds: [top.id], note: "Only this class stays home" }] : []),
    { from: sunday(addDays(today, 21)), name: "Working Sunday", kind: "working", note: "Makes up for the Diwali break" },
  ];
  for (const i of items) {
    if (i.from < year.startsOn || (("to" in i ? i.to : i.from) as string) > year.endsOn) continue;
    await svc.create({ notify: false, ...i }).catch((e) => { if (!(e instanceof ConflictError || e instanceof ValidationError)) throw e; });
  }
}

/** The last `n` days the school was open (Sundays and closures skipped), newest first, starting today. */
function lastSchoolDays(n: number, closed: Set<string>): string[] {
  const days: string[] = [];
  for (let d = todayIST(); days.length < n; d = addDays(d, -1)) if (!closed.has(d)) days.push(d);
  return days;
}

/**
 * Roughly 92% present with some late, leave and absent days. One student in twenty is often away,
 * so the defaulters list has real names. Marked through the services, like a teacher would.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const students = new StudentAttendanceService(ctx);
  const staff = new StaffAttendanceService(ctx);
  await seedHolidays(ctx, todayIST());
  const closed = await withSchool(ctx.schoolId, (tx) => closedSet(tx, addDays(todayIST(), -150), todayIST(), { staff: true }));
  const days = lastSchoolDays(SCHOOL_DAYS, closed);
  const roll = rng(7);

  const pick = (frequentlyAway: boolean): AttendanceStatus => {
    const r = roll();
    if (frequentlyAway && r < 0.35) return "absent";
    return r < 0.9 ? "present" : r < 0.935 ? "late" : r < 0.965 ? "leave" : "absent";
  };

  for (const section of await students.sectionOptions()) {
    const roster = (await students.sectionSheet(section.id, days[0]!)).rows;
    if (roster.length === 0) continue;
    const away = new Set(roster.filter((_, i) => i % 20 === 7).map((r) => r.studentId));
    for (const date of days) {
      await students.mark({ sectionId: section.id, date, entries: roster.map((r) => ({ studentId: r.studentId, status: pick(away.has(r.studentId)) })) }, { alerts: false });
    }
  }

  const team = (await staff.staffSheet(days[0]!)).rows;
  for (const date of days) {
    await staff.mark({ date, entries: team.map((p) => {
      const r = roll();
      return { userId: p.userId, status: r < 0.93 ? "present" : r < 0.96 ? "late" : r < 0.98 ? "half_day" : "leave" };
    }) });
  }

  // Leave types and this year's balances for everyone on the team.
  await withSchool(ctx.schoolId, (tx) => ensureCredit(tx, ctx.schoolId, todayIST()));

  state.attendance = { from: days.at(-1), to: days[0], days: days.length };
};
export default seed;
