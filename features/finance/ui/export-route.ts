import { withSchool } from "@smw/db";
import { AppError, NotFoundError, listQueryFrom, type Ctx } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { ApprovalService } from "../approvals";
import { AccountService } from "../services/accounts";
import { BankService, reconciliationReport } from "../services/bank";
import { schoolName } from "../services/common";
import { accountsReport, allPages, approvalsReport, journalsReport } from "../services/exports";
import { JournalService } from "../services/journals";
import { reportToCsv, reportToPdf, type Report } from "../services/report";
import { STATEMENT_KINDS, StatementService, defaultRange, type CompareMode, type StatementKind } from "../services/statements";
import { TallyExportService } from "../services/tally";

type Built = { body: BodyInit; type: string; fileName: string };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function fromReport(ctx: Ctx, report: Report, format: string | null, name: string): Promise<Built> {
  if (format === "pdf") return { body: Buffer.from(await reportToPdf(report, await withSchool(ctx.schoolId, schoolName))), type: "application/pdf", fileName: `${name}.pdf` };
  return { body: reportToCsv(report), type: "text/csv; charset=utf-8", fileName: `${name}.csv` };
}

async function build(kind: string, sp: URLSearchParams, ctx: Ctx): Promise<Built> {
  const format = sp.get("format"), q = Object.fromEntries(sp);
  if ((STATEMENT_KINDS as string[]).includes(kind)) {
    const range = defaultRange(), from = sp.get("from") ?? range.from, to = sp.get("to") ?? range.to;
    const query = { kind: kind as StatementKind, from, to, compare: (sp.get("compare") || undefined) as CompareMode | undefined, accountId: sp.get("accountId") || undefined, cashAccountId: sp.get("cashAccountId") || undefined };
    const svc = new StatementService(ctx), name = `${kind}-${from}-to-${to}`;
    return format === "pdf" ? { body: Buffer.from(await svc.pdf(query)), type: "application/pdf", fileName: `${name}.pdf` } : { body: await svc.csv(query), type: "text/csv; charset=utf-8", fileName: `${name}.csv` };
  }
  switch (kind) {
    case "accounts": return fromReport(ctx, accountsReport(await new AccountService(ctx).withBalances()), format, "chart-of-accounts");
    case "journals": {
      const svc = new JournalService(ctx), query = listQueryFrom(q);
      return fromReport(ctx, journalsReport(await allPages((page) => svc.list({ ...query, page, pageSize: 100 })), [query.q && `Search: ${query.q}`, ...Object.entries(query.filters).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(". ") || "Every entry, newest first."), format, "journal-entries");
    }
    case "approvals": {
      const svc = new ApprovalService(ctx, {}), query = listQueryFrom(q);
      return fromReport(ctx, approvalsReport(await allPages((page) => svc.list({ ...query, page, pageSize: 100 })), `Status: ${query.filters.status ?? "pending"}`), format, "approvals");
    }
    case "tally": {
      const range = defaultRange(), out = await new TallyExportService(ctx).vouchers({ from: sp.get("from") ?? range.from, to: sp.get("to") ?? range.to });
      return { body: out.xml, type: "application/xml; charset=utf-8", fileName: out.fileName };
    }
    case "bank-reconciliation": {
      const id = sp.get("cashAccountId") ?? "", bank = sp.get("bank");
      const r = await new BankService(ctx).reconciliation(id, { asOn: sp.get("asOn") ?? undefined, bankBalancePaise: bank ? Math.round(Number(bank) * 100) : undefined });
      return fromReport(ctx, reconciliationReport(r), format, `bank-reconciliation-${slug(r.account.name)}-${r.asOn}`);
    }
  }
  throw new NotFoundError("Export");
}

/** GET /app/finance/export/[kind]: the CSV, PDF or Tally file behind every "Download" link. The services check the caller's permission, so a person without it gets a plain refusal. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await params;
    const out = await build(kind, new URL(req.url).searchParams, await actionCtx());
    return new Response(out.body, { headers: { "content-type": out.type, "content-disposition": `attachment; filename="${out.fileName}"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
