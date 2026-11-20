import { z } from "zod";
import { StudentAttendanceService } from "@smw/feature-attendance/service";
import { ValidationError } from "@smw/feature-kit";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { isoDate, istDate, queryOf } from "../../_lib";

const range = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/**
 * GET /api/v1/attendance/summary?from&to (default: last 30 days).
 * Students get their own summary; staff get today's school-wide summary.
 */
export const GET = apiHandler(async (req) => {
  const ctx = await bearerCtx(req);
  const svc = new StudentAttendanceService(ctx);
  const { from = istDate(-29), to = istDate() } = queryOf(req, range);
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new ValidationError({ from: "Pick a range of up to one year, starting before the end date." });
  if (ctx.role === "student") {
    const kids = await svc.myStudents();
    return { from, to, students: await Promise.all(kids.map(async (k) => ({ ...k, summary: await svc.studentSummary(k.id, from, to), recentAbsences: await svc.recentAbsences(k.id, 5) }))) };
  }
  return { today: await svc.todaySchoolSummary() };
});
