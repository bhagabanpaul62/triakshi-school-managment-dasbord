import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { cn } from "@smw/ui/utils";
import { ApprovalService, type ApprovalHandlers } from "../approvals";
import { ApprovalDeskService } from "../services/approval-desk";
import { JournalService } from "../services/journals";
import { ApprovalCard, type ApprovalCardData } from "./approval-card";
import { kindLabel } from "./labels";

export const metadata = { title: "Approvals" };

const STATUSES = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]] as const;
const PAGE = 20;
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Every request waiting for a second person, grouped by what it is. The route passes the merged handlers of all
 * modules and the two server actions, so finance imports none of the modules that ask.
 */
export default async function ApprovalsPage({ searchParams, handlers, approve, reject, withdraw }: { searchParams: Search; handlers: ApprovalHandlers; approve: (fd: FormData) => Promise<FormResult>; reject: (fd: FormData) => Promise<FormResult>; withdraw: (fd: FormData) => Promise<FormResult> }) {
  const ctx = await requireCtx();
  const svc = new ApprovalService(ctx, handlers);
  if (!svc.can("approve")) notFound();
  const sp = await searchParams;
  const status = one(sp.status) ?? "pending", page = Math.max(1, Number(one(sp.page)) || 1);
  const { rows, total, pageCount } = await svc.list({ page, pageSize: PAGE, filters: { status, kind: one(sp.kind) } });
  const waitingFor = await new ApprovalDeskService(ctx).approvers(ctx.userId);
  const drafts = await new JournalService(ctx).drafts(rows.filter((r) => r.kind === "finance.journal").map((r) => r.refId));

  const cards = new Map<string, ApprovalCardData[]>();
  for (const r of rows) {
    const draft = r.kind === "finance.journal" ? drafts[r.refId] : undefined;
    const list = cards.get(r.kind) ?? [];
    list.push({
      id: r.id, title: r.title, amountPaise: r.amountPaise, reason: r.reason, href: r.href, status: r.status, requestedByName: r.requestedByName, decidedByName: r.decidedByName,
      createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, note: r.note, selfApproved: r.selfApproved, mine: r.requestedBy === ctx.userId, waitingFor, lines: draft?.lines,
    });
    cards.set(r.kind, list);
  }
  const link = (s: string, p = 1) => `/app/finance/approvals?status=${s}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Approvals" description="Money requests that need a second person. Read what will happen, then decide."
        actions={<a href={`/app/finance/export/approvals?status=${status}`} download className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12]">CSV</a>} />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 pb-6">
        {STATUSES.map(([key, label]) => (
          <Link key={key} href={link(key)} aria-current={status === key ? "page" : undefined}
            className={cn("rounded-full px-4 py-2 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", status === key ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>{label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyLine title={status === "pending" ? "Nothing is waiting for you." : "No requests here."} hint={status === "pending" ? "New requests from fees, expenses, payroll and journals show up here, and you get a notification." : undefined} />
      ) : (
        <div className="flex flex-col gap-8">
          {[...cards].map(([kind, items]) => (
            <section key={kind} aria-labelledby={`k-${kind}`}>
              <h2 id={`k-${kind}`} className="mb-3 text-[15px] font-medium">{kindLabel(kind)} <span className="ml-1 text-sm font-normal text-[var(--ds-on-surface-muted)]">{items.length}</span></h2>
              <div className="flex flex-col gap-3">{items.map((a) => <ApprovalCard key={a.id} a={a} approve={approve} reject={reject} withdraw={withdraw} canDecide />)}</div>
            </section>
          ))}
          {pageCount > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm text-[var(--ds-on-surface-muted)]">
              <span>{total} requests</span>
              <span className="flex gap-2">
                {page > 1 ? <Link href={link(status, page - 1)} className="rounded-full bg-white/[0.07] px-4 py-2 text-[var(--ds-on-surface)]">Previous</Link> : null}
                {page < pageCount ? <Link href={link(status, page + 1)} className="rounded-full bg-white/[0.07] px-4 py-2 text-[var(--ds-on-surface)]">Next</Link> : null}
              </span>
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
