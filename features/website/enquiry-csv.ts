// The enquiry list and the report as spreadsheets. Only the people who may export (the pipeline right).
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { csvResponse, csvText } from "@smw/integrations";
import { STAGE_WORDS } from "./enquiry-core";
import { EnquiryImportService } from "./enquiry-import-service";
import { EnquiryReportService, reportRows } from "./enquiry-report-service";
import { listQueryOf } from "./enquiry-reads";
import { EnquiryService } from "./enquiry-service";

const fail = (err: unknown) => {
  if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
};
const ist = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "");

/** The same list, filters and search as the screen, every row. */
export async function enquiriesCsv(req: Request): Promise<Response> {
  try {
    const svc = new EnquiryService(await actionCtx());
    const rows = await svc.exportRows(listQueryOf(Object.fromEntries(new URL(req.url).searchParams), await svc.myViews()));
    return csvResponse(csvText([
      ["Reference", "Child", "Parent", "Phone", "Email", "Class", "Session", "Stage", "Reached", "Close reason", "Source", "Campaign", "Owner", "Next step", "Received", "First call"],
      ...rows.map((r) => [r.ref, r.studentName, r.parentName, r.phone, r.email, r.classApplying, r.session, STAGE_WORDS[r.status], STAGE_WORDS[r.reached], r.closeReason, r.source, r.campaign, r.ownerName, ist(r.nextAt), ist(r.createdAt), ist(r.firstContactAt)]),
    ]), "enquiries.csv");
  } catch (err) { return fail(err); }
}

export async function enquiryReportCsv(req: Request): Promise<Response> {
  try {
    const ctx = await actionCtx();
    if (!new EnquiryService(ctx).can("pipeline")) return Response.json({ error: "Only the office admin can download this." }, { status: 403 });
    const p = new URL(req.url).searchParams;
    const r = await new EnquiryReportService(ctx).summary({ from: p.get("from") || undefined, to: p.get("to") || undefined, session: p.get("session") || undefined });
    return csvResponse(csvText(reportRows(r)), "enquiry-report.csv");
  } catch (err) { return fail(err); }
}

export async function enquiryTemplate(): Promise<Response> {
  return csvResponse(EnquiryImportService.templateCsv(), "enquiries-template.csv");
}
