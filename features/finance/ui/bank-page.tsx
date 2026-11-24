import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";
import { shortDate } from "@smw/ui/format";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { cn } from "@smw/ui/utils";
import { canApprove } from "../approvals";
import { AccountService } from "../services/accounts";
import { BankService, type BankLineRow } from "../services/bank";
import { CashAccountService } from "../services/cash";
import { OWNED_BY_MODULES } from "../services/journals";
import { autoMatchBank, createBankEntry, matchBankLine, unmatchBankLine } from "./actions";
import { FIELD, LINK, MUTED, PILL, PRIMARY, href, one, safeNext, type SearchParams } from "./styles";

export const metadata = { title: "Bank statement" };
const STATUS = [["open", "Not matched"], ["matched", "Matched"], ["all", "All"]] as const;
const GHOST = { variant: "ghost", size: "sm" } as const;

/** One bank account's statement: what is left to match, with the one-click suggestion, and the ways to settle the rest. */
export default async function BankPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, requireCtx()]);
  const svc = new BankService(ctx);
  if (!svc.can("reconcile")) notFound();
  const status = STATUS.find(([k]) => k === one(sp.status))?.[0] ?? "open", q = one(sp.q), page = Number(one(sp.page)) || 1, next = safeNext(sp.next);
  const [summaries, lines] = await Promise.all([svc.summary(), svc.lines(id, { status, q, page }).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; })]);
  const sum = summaries.find((s) => s.account.id === id);
  if (!sum) notFound();
  const [accounts, cash] = await Promise.all([new AccountService(ctx).withBalances(), new CashAccountService(ctx).list()]);
  const owned = new Set(OWNED_BY_MODULES);
  const ledgerOptions = accounts.filter((a) => a.isActive && a.id !== sum.account.accountId && !(a.systemKey && owned.has(a.systemKey))).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const otherCash = cash.filter((c) => c.isActive && c.id !== id).map((c) => ({ value: c.id, label: c.name }));
  const mayApprove = canApprove(ctx), base = `/app/finance/banking/${id}`;
  const link = (over: Record<string, string | number | undefined>) => href(base, { status, q, next, ...over });

  const entryFields = (action: "charge" | "interest" | "transfer" | "other"): Field[] => [
    ...(action === "transfer" ? [{ name: "toCashAccountId", label: "The other account", type: "select" as const, required: true, options: otherCash }] : []),
    ...(action === "other" ? [{ name: "accountId", label: "Belongs to account", type: "select" as const, required: true, options: ledgerOptions, hint: "The account on the other side of this bank line." }, { name: "reason", label: "What is this?", type: "textarea" as const, required: true, wide: true, hint: "The approver reads this." }] : []),
    { name: "memo", label: "Narration", wide: true, hint: "Optional. Leave it to use the bank's own words." },
  ];
  const record = (l: BankLineRow, action: "charge" | "interest" | "transfer" | "other", label: string, note: string) => (
    <FormModal key={action} title={label} icon="money" action={createBankEntry} hidden={{ bankLineId: l.id, action }} fields={entryFields(action)} submitLabel={action === "other" ? "Ask for approval" : "Record and match"} trigger={{ label, ...GHOST }} summary={note} />
  );

  return (
    <>
      <PageHeader eyebrow="Banking" title={sum.account.name}
        description={`${sum.account.bankName ? `${sum.account.bankName}. ` : ""}${sum.unmatched} line${sum.unmatched === 1 ? "" : "s"} still to match, ${sum.matched} matched. Books show ${sum.bookPaise < 0 ? "-" : ""}₹${(Math.abs(sum.bookPaise) / 100).toLocaleString("en-IN")}.`}
        actions={<>
          <Link href={next ?? "/app/finance/banking"} className={PILL}>{next ? "Back to where you were" : "All accounts"}</Link>
          <Link href={`${base}/statement`} className={PILL}>Reconciliation statement</Link>
          {sum.unmatched > 0 ? <ActionButton action={autoMatchBank} values={{ cashAccountId: id }} label="Match automatically" successMessage="Matching done" /> : null}
          <Link href={`${base}/import`} className={PRIMARY}>Import statement</Link>
        </>} />
      <nav aria-label="Show" className="flex flex-wrap items-center gap-2 pb-4">
        {STATUS.map(([k, label]) => <Link key={k} href={link({ status: k, page: undefined })} aria-current={status === k ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", status === k ? "bg-white/[0.12]" : "bg-white/[0.05] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>{label}</Link>)}
        <form method="get" role="search" className="ml-auto flex gap-2">
          {status !== "open" ? <input type="hidden" name="status" value={status} /> : null}
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <label className="sr-only" htmlFor="bank-q">Search the statement</label>
          <input id="bank-q" name="q" defaultValue={q} placeholder="Search words or reference" className={`${FIELD} w-56 rounded-full`} />
        </form>
      </nav>

      {lines.total === 0 ? (
        sum.matched + sum.unmatched === 0
          ? <EmptyLine title="No statement imported yet." hint="Download the statement from your bank as .csv or .xlsx, then import it. Matching starts at once." action={<Link href={`${base}/import`} className={PRIMARY}>Import statement</Link>} />
          : status === "open" && !q ? <EmptyLine title="Every line is matched." hint="Print the reconciliation statement to show the books agree with the bank." action={<Link href={`${base}/statement`} className={PRIMARY}>Reconciliation statement</Link>} />
          : <EmptyLine title="No line fits." hint="Try another word or filter." action={<Link href={link({ status: "all", q: undefined })} className={PILL}>Show all lines</Link>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.rows.map((l) => (
            <li key={l.id} className="flex flex-col gap-3 rounded-2xl bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{l.description || "No description"}</p>
                  <p className={cn("truncate", MUTED)}>{shortDate(l.date)}{l.reference ? ` · ${l.reference}` : ""}</p>
                  {l.hint ? <p className={cn("mt-1", MUTED)}>{l.hint}</p> : null}
                </div>
                <Money paise={l.amountPaise} sign="always" size="lg" />
              </div>
              {l.matched ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className={MUTED}>Matched to</span>
                  {l.matchedTo.map((m) => <Link key={m.lineId} href={`/app/finance/journals/${m.journalId}`} className={cn(LINK, "font-mono text-xs")}>{m.number}</Link>)}
                  <ActionButton variant="ghost" label="Unmatch" action={unmatchBankLine} values={{ bankLineId: l.id }} confirm={{ title: "Unmatch this line?", body: "The entry in the books stays; both become open again.", confirmLabel: "Unmatch" }} />
                </div>
              ) : l.pendingApprovalId ? (
                <p className="text-sm">Waiting for approval to record this line. {mayApprove ? <Link href="/app/finance/approvals" className={LINK}>Open approvals</Link> : <span className={MUTED}>An admin decides it.</span>}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {l.suggestion ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3">
                      <p className="min-w-0 text-sm"><span className={MUTED}>Likely: </span><Link href={`/app/finance/journals/${l.suggestion.journalId}`} className={cn(LINK, "font-mono text-xs")}>{l.suggestion.number}</Link> {l.suggestion.memo}<span className={cn("block", MUTED)}>{l.suggestion.why.join(", ")}</span></p>
                      <ActionButton action={matchBankLine} values={{ bankLineId: l.id, entry: l.suggestion.lineId }} label="Match" variant="default" successMessage="Matched" />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/match/${l.id}${next ? `?next=${encodeURIComponent(next)}` : ""}`} className={PILL}>{l.suggestion ? "Choose other entries" : "Choose the entry"}</Link>
                    {l.amountPaise < 0 ? record(l, "charge", "Bank charge", "Posts the charge to Bank charges and matches this line.") : record(l, "interest", "Interest", "Posts to Other income and matches this line.")}
                    {otherCash.length ? record(l, "transfer", "Move between accounts", "Posts a transfer with the other account and matches this line.") : null}
                    {record(l, "other", "Record as other entry", "A manual entry. Another person approves it; the line is matched then.")}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {lines.pageCount > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm text-[var(--ds-on-surface-muted)]">
          <span>{lines.total} lines</span>
          <span className="flex gap-2">
            {lines.page > 1 ? <Link href={link({ page: lines.page - 1 })} className={PILL}>Previous</Link> : null}
            {lines.page < lines.pageCount ? <Link href={link({ page: lines.page + 1 })} className={PILL}>Next</Link> : null}
          </span>
        </nav>
      ) : null}
      <Panel title="Need the statement in the books?" className="mt-6">
        <p className="text-sm text-[var(--ds-on-surface-variant)]">Entries that the bank has not caught up with (cheques not presented, deposits not credited) stay open on the books side and show on the <Link href={`${base}/statement`} className={LINK}>reconciliation statement</Link>.</p>
      </Panel>
    </>
  );
}
