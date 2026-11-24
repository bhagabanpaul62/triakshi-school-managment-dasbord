import { AppError, type Page } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { toCsv } from "../csv";
import { ExitService } from "../services/exits";
import { LoanService } from "../services/loans";
import { PayoutService } from "../services/payouts";
import { PayslipService } from "../services/payslips";
import { ProfileService } from "../services/profiles";
import { REPORT_NAMES, ReportService, reportCsv, type ReportName } from "../services/reports";
import { RunService } from "../services/runs";

const headers = (type: string, name: string) => ({ "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" });
const csv = (text: string, name: string) => new Response(text, { headers: headers("text/csv; charset=utf-8", name) });
const rupees = (p: number) => (p / 100).toFixed(2);
/** Every page of a list, for a CSV of the whole thing. */
async function every<T>(get: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) { const p = await get(page); out.push(...p.rows); if (page >= p.pageCount) return out; }
}

/** GET /app/payroll/files/<kind>: every download of payroll (CSV lists, the bank file, the PF file, a payslip PDF, a report). */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await params, q = new URL(req.url).searchParams, ctx = await actionCtx();
    const get = (k: string) => q.get(k) ?? "";
    switch (kind) {
      case "runs-csv": return csv(toCsv([["Run", "Kind", "Month", "State", "People", "Net pay"], ...(await every((page) => new RunService(ctx).list({ page, pageSize: 100 }))).map((r) => [r.label, r.kind, r.month.slice(0, 7), r.status, r.people, rupees(r.net)])]), "pay-runs.csv");
      case "people-csv": return csv(toCsv([["Employee ID", "Name", "Department", "Structure", "Gross a month", "Paid by", "Missing"], ...(await new ProfileService(ctx).all()).map((p) => [p.employeeId, p.name, p.department, p.structure, p.grossPaise === null ? "" : rupees(p.grossPaise), p.payBy, p.missing.map((m) => m.text).join("; ")])]), "pay-people.csv");
      case "loans-csv": return csv(toCsv([["Person", "Loan", "Each month", "Recovered", "Owed", "State", "Reason"], ...(await every((page) => new LoanService(ctx).list({ page, pageSize: 100 }))).map((l) => [l.name, rupees(Number(l.amountPaise)), rupees(Number(l.emiPaise)), rupees(l.recoveredPaise), rupees(l.balancePaise), l.status, l.reason])]), "staff-loans.csv");
      case "exits-csv": return csv(toCsv([["Person", "Last day", "Reason", "State", "Settlement"], ...(await every((page) => new ExitService(ctx).list({ page, pageSize: 100 }))).map((x) => [x.name, x.lastDay, x.reason, x.status, rupees(x.netPaise)])]), "exits.csv");
      case "register-csv": return csv(toCsv(await new RunService(ctx).registerRows(get("run"))), `salary-register-${get("run").slice(0, 8)}.csv`);
      case "bank-file": { const f = await new PayoutService(ctx).bankFile(get("run")); return csv(f.csv, f.filename); }
      case "ecr": { const f = await new ReportService(ctx).ecr(get("month")); return new Response(f.text, { headers: headers("text/plain; charset=utf-8", f.filename) }); }
      case "payslip": { const f = await new PayslipService(ctx).pdf(get("item")); return new Response(Buffer.from(f.bytes), { headers: headers("application/pdf", f.filename) }); }
      case "report": {
        const name = get("name") as ReportName;
        if (!(name in REPORT_NAMES)) return Response.json({ error: "Unknown report." }, { status: 404 });
        const r = await new ReportService(ctx).build(name, Object.fromEntries([...q.entries()].filter(([k, v]) => k !== "name" && v)));
        return csv(reportCsv(r), `${name}.csv`);
      }
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
