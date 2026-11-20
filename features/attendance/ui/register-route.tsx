import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { PeriodAttendanceService } from "../period-service";
import { subjectCsv } from "../register-export";
import { monthDays } from "../stats";
import { StaffAttendanceService, StudentAttendanceService } from "../service";

const headers = (type: string, fileName: string) => ({ "content-type": type, "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" });

/** GET /app/attendance/register/export?sectionId=&month=&format=pdf|csv; with no sectionId it is the staff register. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const month = q.get("month") ?? "", sectionId = q.get("sectionId"), ctx = await actionCtx();
    const csv = q.get("format") === "csv";
    if (csv && sectionId && q.get("view") === "subject") {
      const days = monthDays(month), svc = new PeriodAttendanceService(ctx);
      return new Response(subjectCsv(await svc.subjectReport(sectionId, days[0]!, days.at(-1)!)), { headers: headers("text/csv; charset=utf-8", `subject-attendance-${sectionId.slice(0, 8)}-${month}.csv`) });
    }
    if (csv) {
      const { text, fileName } = sectionId ? await new StudentAttendanceService(ctx).registerCsv(sectionId, month) : await new StaffAttendanceService(ctx).registerCsv(month);
      return new Response(text, { headers: headers("text/csv; charset=utf-8", fileName) });
    }
    const { bytes, fileName } = sectionId ? await new StudentAttendanceService(ctx).registerPdf(sectionId, month) : await new StaffAttendanceService(ctx).registerPdf(month);
    return new Response(Buffer.from(bytes), { headers: headers("application/pdf", fileName) });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
