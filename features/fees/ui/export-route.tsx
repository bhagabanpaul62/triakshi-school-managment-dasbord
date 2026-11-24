import { withSchool } from "@smw/db";
import { AppError, NotFoundError, listQueryFrom, type Ctx } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { actionCtx } from "@smw/runtime";
import { allPages } from "@smw/feature-finance/services/exports";
import { schoolName } from "@smw/feature-finance/services/common";
import { reportToCsv, reportToPdf, type Report } from "@smw/feature-finance/services/report";
import { parsePeriod, periodLabel } from "@smw/ui/finance/logic";
import { AGE_BANDS } from "../constants";
import { ConcessionService, ConcessionTypeService, DuesService, InvoiceService, ReceiptService, RefundService } from "../service";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Every filter on the screen (and nothing else) rides along, so the file is the list the person was looking at. */
const note = (q: ReturnType<typeof listQueryFrom>) => [q.q && `Search: ${q.q}`, ...Object.entries(q.filters).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(". ") || "Everything.";

export const REPORT_BY = ["head", "class", "method", "cashier", "day"] as const;
export type ReportBy = (typeof REPORT_BY)[number];
export const BY_LABEL: Record<ReportBy, string> = { head: "Fee head", class: "Class", method: "Payment method", cashier: "Cashier", day: "Day" };
/** Every report on the reports screen: the five ways money is grouped, then the three registers. */
export const REPORT_KINDS = [...REPORT_BY, "concessions", "refunds", "reversals"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const KIND_LABEL: Record<ReportKind, string> = { ...BY_LABEL, concessions: "Concessions", refunds: "Refunds", reversals: "Reversals" };

/** The three registers of a period: concessions given, refunds paid, receipts reversed. */
async function register(ctx: Ctx, kind: "concessions" | "refunds" | "reversals", sp: Record<string, string | null | undefined>): Promise<Report> {
  const period = parsePeriod({ period: sp.period, from: sp.from, to: sp.to }, todayIST()), when = periodLabel(period);
  if (kind === "reversals") {
    const svc = new ReceiptService(ctx);
    const rows = await allPages((page) => svc.list({ page, pageSize: 100, filters: { status: "reversed", from: period.from, to: period.to } }));
    return { title: "Receipts reversed", subtitle: when, columns: [{ key: "number", label: "Receipt", kind: "mono" }, { key: "date", label: "Date", kind: "date" }, { key: "student", label: "Student" }, { key: "paise", label: "Amount", kind: "money" }],
      rows: [...rows.map((r) => ({ cells: { number: r.number, date: r.date, student: r.studentName, paise: r.amountPaise } })), { style: "total" as const, cells: { number: "Total", date: null, student: null, paise: rows.reduce((s, r) => s + r.amountPaise, 0) } }] };
  }
  if (kind === "refunds") {
    const svc = new RefundService(ctx);
    const rows = (await allPages((page) => svc.list({ page, pageSize: 100, filters: { status: "approved" } }))).filter((r) => r.paidOn && r.paidOn >= period.from && r.paidOn <= period.to);
    const cols = [{ key: "number", label: "Voucher", kind: "mono" as const }, { key: "date", label: "Paid on", kind: "date" as const }, { key: "student", label: "Student" }, { key: "adm", label: "Admission no" }, { key: "class", label: "Class" }, { key: "source", label: "From" }, { key: "method", label: "Method" }, { key: "state", label: "Approval" }, { key: "reason", label: "Why" }, { key: "paise", label: "Amount", kind: "money" as const }];
    const blank = { number: "Total", date: null, student: null, adm: null, class: null, source: null, method: null, state: null, reason: null };
    return { title: "Refunds paid", subtitle: when, columns: cols,
      rows: [...rows.map((r) => ({ cells: { number: r.number ?? "", date: r.paidOn, student: r.studentName, adm: r.admissionNo, class: r.classLabel, source: r.source === "advance" ? "Advance" : "Deposit", method: r.method.replace("_", " "), state: `Approved${r.approval?.decidedByName ? ` by ${r.approval.decidedByName}` : ""}${r.approval?.note ? `: ${r.approval.note}` : ""}`, reason: r.reason, paise: r.amountPaise } })), { style: "total" as const, cells: { ...blank, paise: rows.reduce((s, r) => s + r.amountPaise, 0) } }] };
  }
  const svc = new ConcessionService(ctx);
  const rows = await allPages((page) => svc.list({ page, pageSize: 100, filters: { status: "approved" } }));
  return { title: "Concessions given", subtitle: "Approved concessions of this academic year.", columns: [{ key: "student", label: "Student" }, { key: "type", label: "Kind" }, { key: "what", label: "Discount" }, { key: "head", label: "On" }, { key: "reason", label: "Why" }],
    rows: rows.map((c) => ({ cells: { student: c.studentName, type: c.typeName ?? "Other", what: c.mode === "percent" ? `${c.value / 100}%` : `${rupees(c.value)}${c.per === "year" ? " for the year" : " per bill"}`, head: c.headName ?? "Every fee", reason: c.reason } })) };
}

/** Any report of the reports screen, as one Report the screen, the CSV and the PDF all read. */
export async function periodReport(ctx: Ctx, kind: ReportKind, sp: Record<string, string | null | undefined>): Promise<Report> {
  return (REPORT_BY as readonly string[]).includes(kind) ? collectionReport(ctx, kind as ReportBy, sp) : register(ctx, kind as "concessions" | "refunds" | "reversals", sp);
}

/** The collection report for a period: the screen and the file read the same rows. */
export async function collectionReport(ctx: Ctx, by: ReportBy, sp: Record<string, string | null | undefined>): Promise<Report> {
  const period = parsePeriod({ period: sp.period, from: sp.from, to: sp.to }, todayIST());
  const out = await new DuesService(ctx).collection({ from: period.from, to: period.to, by });
  return {
    title: `Fees collected by ${BY_LABEL[by].toLowerCase()}`, subtitle: periodLabel(period),
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
        { key: "due", label: "Open", kind: "money" }, { key: "overdue", label: "Overdue", kind: "money" }, { key: "late", label: "Late fee building up", kind: "money" }, { key: "next", label: "Next due", kind: "date" }, ...(q.filters.age ? [{ key: "band", label: `Open, ${AGE_BANDS.find((b) => b.key === q.filters.age)?.label ?? "this age"}`, kind: "money" as const }] : [])],
      rows: rows.map((r) => ({ cells: { student: r.name, adm: r.admissionNo, class: r.classLabel, state: r.studentStatus === "active" ? "At school" : `Left${r.leftOn ? ` ${r.leftOn}` : ""}`, billed: r.gross - r.concession, paid: r.paid, due: r.due, overdue: r.overdue, late: r.accrued, next: r.nextDueDate, band: r.inBand } })),
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
  if ((REPORT_KINDS as readonly string[]).includes(kind)) return periodReport(ctx, kind as ReportKind, Object.fromEntries(sp));
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

/** GET /app/fees/opening/template: the empty sheet for opening balances, with one example row. */
export async function openingTemplate() {
  return new Response("admission_no,dues,advance,deposit,as_of\r\nA-1001,12500,0,2000,2026-04-01\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="opening-balances-template.csv"', "cache-control": "private, no-store" } });
}
