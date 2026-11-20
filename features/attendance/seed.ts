import type { FeatureSeed } from "@smw/feature-kit";
import type { AttendanceStatus } from "./constants";
import { StaffAttendanceService, StudentAttendanceService } from "./service";
import { addDays, isSunday, todayIST } from "./stats";

const SCHOOL_DAYS = 25;

/** Small deterministic generator so every demo school gets the same believable pattern. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** The last `n` school days (Sundays skipped), newest first, starting today. */
function lastSchoolDays(n: number): string[] {
  const days: string[] = [];
  for (let d = todayIST(); days.length < n; d = addDays(d, -1)) if (!isSunday(d)) days.push(d);
  return days;
}

/**
 * Roughly 92% present with some late, leave and absent days. One student in twenty is often away,
 * so the defaulters list has real names. Marked through the services, like a teacher would.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const students = new StudentAttendanceService(ctx);
  const staff = new StaffAttendanceService(ctx);
  const days = lastSchoolDays(SCHOOL_DAYS);
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

  state.attendance = { from: days.at(-1), to: days[0], days: days.length };
};
export default seed;
