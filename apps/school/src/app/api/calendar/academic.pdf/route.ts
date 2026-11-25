import { sql, withSchool } from "@smw/db";
import { actionCtx } from "@smw/runtime";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { academicCalendarPdf } from "@smw/feature-events/academic-pdf";
import { schoolFromRequest } from "@smw/runtime/bearer";
import { parseIst } from "@smw/feature-events/dates";
import { calendarItems, layersFor } from "@/lib/calendar-layers";
import { failure } from "../_lib";

export const dynamic = "force-dynamic";

/** The academic year as a printable page: events, holidays, exams and special days this person may see. `?year=<id>` picks another year. */
export async function GET(req: Request) {
  try {
    const ctx = await actionCtx();
    if (ctx.leftUntil) throw new ForbiddenError("This is not available to a student who has left the school.");
    const asked = new URL(req.url).searchParams.get("year");
    const year = await withSchool(ctx.schoolId, async (tx) => {
      const rows = [...(await tx.execute(asked && /^[0-9a-f-]{36}$/i.test(asked)
        ? sql`select name, starts_on::text as "from", ends_on::text as "to" from academic_years where id = ${asked}::uuid`
        : sql`select name, starts_on::text as "from", ends_on::text as "to" from academic_years where is_current limit 1`))] as { name: string; from: string; to: string }[];
      return rows[0];
    });
    if (!year) throw new NotFoundError("Academic year");
    const items = await calendarItems(ctx, parseIst(year.from)!, new Date(parseIst(year.to)!.getTime() + 864e5), layersFor(ctx).filter((l) => ["events", "holidays", "exams", "timetable"].includes(l)));
    const school = await schoolFromRequest(req);
    const bytes = await academicCalendarPdf({ school: school.name, year: year.name, from: year.from, to: year.to, items });
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="academic-calendar-${year.name}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (err) { return failure(err); }
}
