import { withSchool } from "@smw/db";
import { AppError, NotFoundError, listQueryFrom, type Ctx } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { actionCtx } from "@smw/runtime";
import { allPages } from "@smw/feature-finance/services/exports";
import { schoolName } from "@smw/feature-finance/services/common";
import { reportToCsv, reportToPdf, type Report } from "@smw/feature-finance/services/report";
import { parsePeriod, periodLabel } from "@smw/ui/finance/logic";
import { ConcessionService, ConcessionTypeService, DuesService, InvoiceService } from "../service";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Every filter on the screen (and nothing else) rides along, so the file is the list the person was looking at. */
const note = (q: ReturnType<typeof listQueryFrom>) => [q.q && `Search: ${q.q}`, ...Object.entries(q.filters).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(". ") || "Everything.";

export const REPORT_BY = ["head", "class", "method", "cashier", "day"] as const;
export type ReportBy = (typeof REPORT_BY)[number];
export const BY_LABEL: Record<ReportBy, string> = { head: "Fee head", class: "Class", method: "Payment method", cashier: "Cashier", day: "Day" };

/** The collection report for a period: the screen and the file read the same rows. */
export async function collectionReport(ctx: Ctx, by: ReportBy, sp: Record<string, string | null | undefined>): Promise<Report & { totalPaise: number }> {
  const period = parsePeriod({ period: sp.period, from: sp.from, to: sp.to }, todayIST());
  const out = await new DuesService(ctx).collection({ from: period.from, to: period.to, by });
  return {
    title: `Fees collected by ${BY_LABEL[by].toLowerCase()}`, subtitle: periodLabel(period), totalPaise: out.totalPaise,
    columns: [{ key: "label", label: BY_LABEL[by] }, { key: "receipts", label: "Receipts" }, { key: "paise", label: "Collected", kind: "money" }],
    rows: [...out.rows.map((r) => ({ cells: { label: r.label, receipts: r.receipts, paise: r.paise } })), { style: "total" as const, cells: { label: "Total", receipts: out.rows.reduce((s, r) => s + r.receipts, 0), paise: out.totalPaise } }],
  };
}

async function build(kind: string, sp: URLSearchParams, ctx: Ctx): Promise<Report> {
  const q = listQueryFrom(Object.fromEntries(sp));
  if (kind === "invoices") {
    const svc = new InvoiceService(ctx);
    const rows = await allPages((page) => svc.list({ ...q, page, pageSize: 100 }));
    return {
      title: "Bills", subtitle: note(q),
      columns: [{ key: "number", label: "Number", kind: "mono" }, { key: "student", label: "Student" }, { key: "adm", label: "Admission no" }, { key: "class", label: "Class" }, { key: "label", label: "For" }, { key: "due", label: "Due date", kind: "date" }, { key: "state", label: "State" },
        { key: "gross", label: "Billed", kind: "money" }, { key: "conc", label: "Concession", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "open", label: "Open", kind: "money" }],
      rows: rows.map((r) => ({ cells: { number: r.number ?? "Draft", student: r.studentName, adm: r.admissionNo, class: r.snapshot.classLabel, label: r.label, due: r.dueDate, state: r.state, gross: r.grossPaise, conc: r.concessionPaise + r.creditedPaise, paid: r.paidPaise, open: r.openPaise } })),
    };
  }
  if (kind === "dues") {
    const svc = new DuesService(ctx);
    const rows = await allPages((page) => svc.report({ ...q, page, pageSize: 100 }));
    return {
      title: "Students' dues", subtitle: `${note(q)} As on ${todayIST()}.`,
      columns: [{ key: "student", label: "Student" }, { key: "adm", label: "Admission no" }, { key: "class", label: "Class" }, { key: "state", label: "Student" }, { key: "billed", label: "Billed", kind: "money" }, { key: "paid", label: "Paid", kind: "money" },
        { key: "due", label: "Open", kind: "money" }, { key: "overdue", label: "Overdue", kind: "money" }, { key: "late", label: "Late fee building up", kind: "money" }, { key: "next", label: "Next due", kind: "date" }],
      rows: rows.map((r) => ({ cells: { student: r.name, adm: r.admissionNo, class: r.classLabel, state: r.studentStatus === "active" ? "At school" : `Left${r.leftOn ? ` ${r.leftOn}` : ""}`, billed: r.gross - r.concession, paid: r.paid, due: r.due, overdue: r.overdue, late: r.accrued, next: r.nextDueDate } })),
    };
  }
  if (kind === "rte") {
    const types = await allPages((page) => new ConcessionTypeService(ctx).list({ page, pageSize: 100 }));
    const rte = new Set(types.filter((t) => t.auto === "rte").map((t) => t.id));
    const svc = new ConcessionService(ctx);
    const rows = (await allPages((page) => svc.list({ ...q, filters: { ...q.filters, status: "approved" }, page, pageSize: 100 }))).filter((c) => c.typeId && rte.has(c.typeId));
    return {
      title: "RTE seats for the government claim", subtitle: "Students on an approved RTE concession. The school claims their tuition from the government.",
      columns: [{ key: "student", label: "Student" }, { key: "concession", label: "Concession" }, { key: "head", label: "Fee" }, { key: "reason", label: "Reason" }],
      rows: rows.map((c) => ({ cells: { student: c.studentName, concession: c.mode === "percent" ? `${c.value / 100}%` : rupees(c.value), head: c.headName ?? "All fees", reason: c.reason } })),
    };
  }
  if ((REPORT_BY as readonly string[]).includes(kind)) return collectionReport(ctx, kind as ReportBy, Object.fromEntries(sp));
  throw new NotFoundError("Export");
}

/** GET /app/fees/export/[kind]: the CSV or PDF behind every "Download" link of the fee lists. The services check the permission. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await params, sp = new URL(req.url).searchParams, ctx = await actionCtx();
    const report = await build(kind, sp, ctx), name = slug(`${report.title}-${todayIST()}`);
    if (sp.get("format") === "pdf") {
      const bytes = await reportToPdf(report, await withSchool(ctx.schoolId, schoolName));
      return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
    }
    return new Response(reportToCsv(report), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
