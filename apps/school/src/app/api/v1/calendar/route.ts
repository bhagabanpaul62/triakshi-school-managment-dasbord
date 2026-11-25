import { LAYERS, type LayerKey } from "@smw/feature-events/constants";
import { addDays, daysBetween, parseIst } from "@smw/feature-events/dates";
import { ValidationError } from "@smw/feature-kit";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { calendarItems } from "@/lib/calendar-layers";
import { istDate, queryOf } from "../_lib";
import { CALENDAR_MAX_DAYS, calendarQuery } from "../_schemas";

/** GET /api/v1/calendar?from&to&layers: events, holidays, exams, homework, meetings and fee dates between two India dates (default: the next 31 days). Drafts are never shown. */
export const GET = apiHandler(async (req) => {
  const ctx = await bearerCtx(req);
  const q = queryOf(req, calendarQuery);
  const from = q.from ?? istDate(), to = q.to ?? addDays(from, 30);
  const start = parseIst(from), end = parseIst(addDays(to, 1));
  if (!start || !end) throw new ValidationError({ from: "Use real dates like 2026-12-01" });
  const span = daysBetween(from, to);
  if (span < 0) throw new ValidationError({ to: "The end date is before the start date." });
  if (span + 1 > CALENDAR_MAX_DAYS) throw new ValidationError({ to: `Ask for at most ${CALENDAR_MAX_DAYS} days at a time.` });
  const names = q.layers?.split(",").map((l) => l.trim()).filter(Boolean);
  const bad = names?.find((l) => !(l in LAYERS));
  if (bad) throw new ValidationError({ layers: `Unknown layer "${bad}".` });
  return { from, to, items: await calendarItems(ctx, start, end, names as LayerKey[] | undefined, { drafts: false }) };
});
