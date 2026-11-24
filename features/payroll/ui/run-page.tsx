import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { canApprove } from "@smw/feature-finance/approvals";
import { UrlTabs } from "@smw/feature-finance/ui/url-tabs";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack } from "@smw/ui/finance/StatusTrack";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { PayoutService } from "../services/payouts";
import { ADJUSTMENT_CODES, RunService, type ItemDetail, type RunView } from "../services/runs";
import { addAdjustment, addPerson, cancelRun, includePerson, recomputeRun, removeAdjustment, withdrawRequest, reopenRun, requestRecall, retryPayout, reviewRun, setDays, skipPerson, submitRun, switchPayBy, typeAmount, markFailed, markPaid } from "./actions";
import { NoAccess, PILL_BTN, PRIMARY_BTN, PayNav, RUN_KIND_LABEL, monthName, one, type Search } from "./common";
import { PeekByUrl } from "./peek-by-url";

const ADJUST_LABEL: Record<keyof typeof ADJUSTMENT_CODES, string> = { arrears: "Arrears", bonus: "Bonus", extra_classes: "Extra classes", lop_reversal: "Loss of pay reversed", other_earning: "Other pay", deduction: "Deduction" };
const columns: Column[] = [
  { key: "name", label: "Person", type: "person", metaKey: "employeeId" },
  { key: "days", label: "Days", type: "text", hideOnMobile: true },
  { key: "grossPaise", label: "Gross", type: "money", hideOnMobile: true },
  { key: "deductionsPaise", label: "Deductions", type: "money", hideOnMobile: true },
  { key: "netPaise", label: "Net", type: "money" },
  { key: "change", label: "Vs last month", type: "text", hideOnMobile: true },
  { key: "flags", label: "Flags", type: "text", hideOnMobile: true },
];

export const metadata = { title: "Pay run" };

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const runs = new RunService(ctx);
  if (!runs.can("read")) return <NoAccess what="Pay runs" />;
  let v: RunView;
  try { v = await runs.get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const manage = runs.can("manage"), tab = one(sp.tab) ?? "people", itemId = one(sp.item);
  const detail = itemId && v.items.some((i) => i.id === itemId) ? await runs.item(itemId) : null;
  const payouts = new PayoutService(ctx);
  const run = v.run, t = v.totals;
  const waiting = run.status === "reviewed" && v.approval;
  const steps = [
    { label: "Draft", state: run.status === "draft" ? "now" : "done" }, { label: "Reviewed", state: run.status === "draft" ? "todo" : run.status === "reviewed" ? "now" : "done" },
    { label: "Approved", state: ["approved", "paid"].includes(run.status) ? "done" : run.status === "reviewed" ? "now" : "todo", at: run.approvedAt?.toISOString() }, { label: "Paid", state: run.status === "paid" ? "done" : run.status === "approved" ? "now" : "todo" },
  ] as const;

  const live = v.items.filter((i) => !i.skippedReason);
  const rows = v.items.map((i) => ({
    id: i.id, name: i.skippedReason ? `${i.name} (left out)` : i.name, employeeId: i.employeeId, days: `${(i.calendarDays * 2 - i.unpaidHalfDays) / 2} of ${i.calendarDays}`, grossPaise: i.grossPaise, deductionsPaise: i.deductionsPaise, netPaise: i.netPaise,
    change: i.changeBp === null ? "" : `${i.changeBp > 0 ? "+" : ""}${Math.round(i.changeBp / 100)}%`,
    flags: i.skippedReason ? `Left out: ${i.skippedReason}` : [i.unmarkedDays ? `${i.unmarkedDays} unmarked` : "", i.netPaise < 0 ? "Negative" : "", ...i.flags.map((f) => (f.code === "no_pan" ? "No PAN" : f.code === "needs_input" ? "Needs amount" : ""))].filter(Boolean).join(", "),
  }));

  return (
    <>
      <Link href="/app/payroll/runs" className="mb-2 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Pay runs</Link>
      <PageHeader eyebrow={`${RUN_KIND_LABEL[run.kind]} run`} title={<span className="flex flex-wrap items-center gap-3">{run.label}<StateBadge state={run.status} /></span>} description={`${monthName(run.month)}${v.previous ? `. Last month: ${v.previous.label}` : ""}`}
        actions={<>
          {manage && run.status === "draft" ? <>
            <ActionButton action={recomputeRun} values={{ id }} label="Work out again" variant="ghost" />
            {run.kind !== "exit" ? <FormModal title="Add a person" description="Someone not in this run yet." icon="users" action={addPerson} hidden={{ id }} trigger={{ label: "Add person", variant: "ghost" }}
              fields={[{ name: "userId", label: "Person", type: "select", required: true, options: v.notIncluded.filter((n) => n.why === "Not added to this run").map((n) => ({ value: n.userId, label: n.name })) }]} /> : null}
            <ActionButton action={reviewRun} values={{ id }} label={v.blockers.length ? `Review (${v.blockers.length} to fix)` : "Review the run"} variant="default" />
          </> : null}
          {manage && run.status === "reviewed" && !waiting ? <>
            <ActionButton action={reopenRun} values={{ id }} label="Reopen to edit" variant="ghost" />
            <FormModal title="Send for approval" description="A second person approves before any money is posted." icon="check" action={submitRun} hidden={{ id }} trigger={{ label: "Send for approval" }} submitLabel="Send"
              summary={`${t.people ?? 0} people, net pay ${((t.net ?? 0) / 100).toLocaleString("en-IN")} rupees`} fields={[{ name: "note", label: "Note for the approver", type: "textarea" }]} />
          </> : null}
          {run.status === "approved" && manage ? <>
            <a href={`/app/payroll/files/bank-file?run=${id}`} download className={PILL_BTN}>Bank file</a>
            <Link href={`/app/payroll/runs/${id}?tab=payouts`} className={PRIMARY_BTN}>Pay salaries</Link>
          </> : null}
        </>} />
      <PayNav active="runs" manager />

      <Panel className="mb-4"><StatusTrack label="Pay run progress" steps={[...steps]} /></Panel>

      {waiting ? (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm">
          <p>{v.approval!.kind === "payroll.recall" ? "A recall is waiting" : "Waiting for approval"}{v.approval!.requestedByName ? `, asked by ${v.approval!.requestedByName}` : ""}. A second person must decide.</p>
          <span className="flex flex-wrap gap-2">
            {canApprove(ctx) && !v.approval!.mine ? <Link href="/app/finance/approvals" className={PRIMARY_BTN}>Open approvals</Link> : null}
            {v.approval!.mine ? <ActionButton action={withdrawRequest} values={{ id: v.approval!.id }} label="Withdraw" variant="ghost" confirm={{ title: "Withdraw this request?", body: "The run goes back to being reviewed and can be sent again." }} /> : null}
          </span>
        </section>
      ) : null}
      {run.status === "approved" && v.approval ? (
        <section className="mb-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm">A recall is waiting for a second person. <Link href="/app/finance/approvals" className="underline">Open approvals</Link></section>
      ) : null}

      {v.blockers.length && run.status === "draft" ? (
        <section role="alert" aria-labelledby="block-h" className="mb-4 rounded-3xl bg-[var(--ds-color-danger-500)]/10 p-5">
          <h2 id="block-h" className="text-[15px] font-medium text-[var(--ds-color-danger-300)]">Fix these before review ({v.blockers.length})</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {v.blockers.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2"><span>{b.message}</span>
                <span className="flex gap-2">
                  {b.fix === "switch_pay_by" && manage ? <ActionButton action={switchPayBy} values={{ userId: b.userId!, payBy: "cash" }} label="Pay by cash" variant="secondary" /> : null}
                  <Link href={b.href} className="underline">Fix it</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {v.warnings.length || v.lowConfidence.length ? (
        <details className="mb-4 rounded-3xl bg-white/[0.04] p-5 text-sm">
          <summary className="cursor-pointer font-medium">Worth a look ({v.warnings.length + v.lowConfidence.length})</summary>
          <ul className="mt-3 flex flex-col gap-1.5 text-[var(--ds-on-surface-variant)]">
            {v.warnings.map((w, i) => <li key={i}>{w.itemId ? <Link href={`/app/payroll/runs/${id}?item=${w.itemId}`} className="underline">{w.message}</Link> : w.message}</li>)}
            {v.lowConfidence.map((r, i) => <li key={`r${i}`}>We are not sure of the {r.key.replace(/_/g, " ")}{r.state ? ` rule for ${r.state}` : ""}. Check it against <a href={r.source.startsWith("http") ? r.source : "/app/payroll/statutory"} className="underline" rel="noreferrer">the source</a> or <Link href="/app/payroll/statutory" className="underline">set your own</Link>.</li>)}
          </ul>
        </details>
      ) : null}
      {v.notIncluded.length ? (
        <p className="mb-4 text-sm text-[var(--ds-on-surface-muted)]">{v.notIncluded.length} people are not in this run: {v.notIncluded.slice(0, 4).map((n, i) => <span key={n.userId}>{i ? ", " : ""}<Link href={n.href} className="underline">{n.name}</Link> ({n.why.toLowerCase()})</span>)}{v.notIncluded.length > 4 ? " and more" : ""}.</p>
      ) : null}

      <div className="mb-4"><UrlTabs label="Pay run sections" value={tab} tabs={[{ id: "people", label: "People" }, { id: "payouts", label: "Payouts" }, { id: "files", label: "Files" }]} /></div>

      {tab === "people" ? (
        <>
          <DataTable columns={columns} rows={rows} total={rows.length} page={1} pageCount={1} rowHref={`/app/payroll/runs/${id}?item={id}`} searchable={false}
            empty={{ title: "Nobody is in this run.", description: "Add the people to be paid, or set up pay for them first.", action: <Link href="/app/payroll/people?missing=1" className={PILL_BTN}>Set up pay</Link> }} />
          <div className="sticky bottom-0 z-10 mt-3 rounded-2xl bg-[var(--ds-surface-container-high)] p-4">
            <KeyTotals items={[{ label: `Gross, ${live.length} people`, paise: t.gross ?? 0 }, { label: "Deductions", paise: t.deductions ?? 0 }, { label: "Employer cost", paise: t.employer ?? 0 }, ...(t.claims ? [{ label: "Claims paid", paise: t.claims }] : []), { label: "Net pay", paise: t.net ?? 0, strong: true }]} />
          </div>
        </>
      ) : null}

      {tab === "payouts" ? <Payouts v={v} payouts={await payouts.summary(id)} manage={manage} id={id} /> : null}

      {tab === "files" ? (
        <Panel title="Files">
          <ul className="flex flex-col gap-1 text-sm">
            <li><a className="underline" href={`/app/payroll/files/register-csv?run=${id}`} download>Salary register (CSV)</a></li>
            {["approved", "paid"].includes(run.status) ? <li><a className="underline" href={`/app/payroll/files/bank-file?run=${id}`} download>Bank file (CSV)</a></li> : null}
            <li><Link className="underline" href={`/app/payroll/reports?report=bank&runId=${id}`}>Bank advice</Link></li>
            <li><a className="underline" href={`/app/payroll/files/ecr?month=${run.month.slice(0, 7)}`} download>PF return file</a></li>
            <li><Link className="underline" href={`/app/payroll/reports?report=esi&period=${run.month.slice(0, 7)}`}>ESI sheet</Link></li>
            <li><Link className="underline" href={`/app/payroll/reports?report=pt&period=${run.month.slice(0, 7)}`}>Professional tax register</Link></li>
            <li><Link className="underline" href={`/app/payroll/reports?report=tds&period=${run.month.slice(0, 7)}`}>Income tax register</Link></li>
            {run.status === "approved" || run.status === "paid" ? live.filter((i) => i.payslipNo).map((i) => <li key={i.id}><a className="underline" href={`/app/payroll/files/payslip?item=${i.id}`}>{i.payslipNo}: {i.name}</a></li>) : null}
          </ul>
        </Panel>
      ) : null}

      {run.status === "approved" && manage ? (
        <p className="mt-6 text-sm text-[var(--ds-on-surface-muted)]">Wrong numbers? <FormModal title="Ask to recall this run" description="Only before anyone is paid. A second person must approve; the postings are reversed and the run reopens." icon="clock" action={requestRecall} hidden={{ id }} trigger={{ label: "Ask to recall", variant: "ghost", size: "sm" }} submitLabel="Ask" fields={[{ name: "reason", label: "Why", type: "textarea", required: true }]} /></p>
      ) : null}
      {manage && (run.status === "draft" || run.status === "reviewed") && !waiting ? (
        <p className="mt-6"><ActionButton action={cancelRun} values={{ id }} label="Cancel this run" variant="ghost" confirm={{ title: "Cancel this run?", body: "Nothing was posted. The month can have a new run afterwards.", danger: true }} /></p>
      ) : null}

      {detail ? <PeekByUrl title={detail.item.name} description={`${detail.item.employeeId} · ${monthName(run.month)}`}><ItemPanel d={detail} edit={v.canEdit} attendanceOn={v.attendanceOn} runId={id} /></PeekByUrl> : null}
    </>
  );
}

function Payouts({ v, payouts, manage, id }: { v: RunView; payouts: Awaited<ReturnType<PayoutService["summary"]>>; manage: boolean; id: string }) {
  const run = v.run;
  if (!["approved", "paid"].includes(run.status)) return <EmptyLine title="Nothing to pay yet." hint="Salaries are paid after a second person approves the run." />;
  const live = v.items.filter((i) => !i.skippedReason);
  return (
    <div className="flex flex-col gap-4">
      <KeyTotals items={[{ label: `Paid, ${payouts.paid} people`, paise: payouts.paidPaise, tone: "success" }, { label: `Still to pay, ${payouts.pending + payouts.failed} people`, paise: payouts.pendingPaise, strong: true }, ...(payouts.failed ? [{ label: `${payouts.failed} transfers failed`, paise: 0, tone: "danger" as const }] : [])]} />
      {manage && run.status === "approved" ? (
        <div className="flex flex-wrap gap-2">
          <a href={`/app/payroll/files/bank-file?run=${id}`} download className={PILL_BTN}>Bank file</a>
          <FormModal title="Mark everyone paid" description="Everyone still waiting is marked paid and the money leaves your bank or cash book." icon="money" action={markPaid} hidden={{ id }} trigger={{ label: "Mark all paid" }} submitLabel="Mark paid"
            fields={[{ name: "date", label: "Paid on", type: "date" }, { name: "reference", label: "Bank reference", type: "text" }]} />
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {live.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
            <span className="min-w-0"><Link href={`/app/payroll/runs/${id}?item=${i.id}`} className="underline">{i.name}</Link><span className="block text-xs text-[var(--ds-on-surface-muted)]">{i.payBy === "bank" ? `Bank ${i.bankLast4 ? `XXXX${i.bankLast4}` : "(no account)"}` : i.payBy === "cash" ? "Cash" : "Cheque"}{i.paidOn ? `, paid ${shortDate(i.paidOn)}` : ""}{i.failReason ? `. ${i.failReason}` : ""}</span></span>
            <span className="flex flex-wrap items-center gap-2"><Money paise={i.netPaise} /><StateBadge state={i.payout === "paid" ? "paid" : i.payout} />
              {manage && run.status === "approved" && i.payout === "pending" ? <>
                <ActionButton action={markPaid} values={{ id, itemIds: i.id }} label="Paid" variant="secondary" />
                <FormModal title={`Transfer failed: ${i.name}`} icon="money" action={markFailed} hidden={{ id, itemIds: i.id }} trigger={{ label: "Failed", variant: "ghost", size: "sm" }} submitLabel="Mark failed" fields={[{ name: "reason", label: "What the bank said", type: "text", required: true }]} />
              </> : null}
              {manage && run.status === "approved" && i.payout === "failed" ? <ActionButton action={retryPayout} values={{ id, itemIds: i.id }} label="Try again" variant="secondary" /> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemPanel({ d, edit, attendanceOn, runId }: { d: ItemDetail; edit: boolean; attendanceOn: boolean; runId: string }) {
  const it = d.item;
  const group = (kind: string, title: string) => {
    const ls = d.lines.filter((l) => l.kind === kind);
    return ls.length ? (
      <section aria-label={title} className="mb-5">
        <h3 className="mb-2 text-[13px] text-[var(--ds-on-surface-muted)]">{title}</h3>
        <ul className="flex flex-col gap-2">
          {ls.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0"><span className="block">{l.label}{l.manual ? <ToneBadge label="Typed" tone="info" className="ml-2" /> : null}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{l.needsInput ? "Needs an amount" : l.source}</span>
                {l.needsInput && edit ? <FormModal title={l.label} description="Type the amount to deduct for this person this month." icon="money" action={typeAmount} hidden={{ itemId: it.id, code: l.code ?? "" }} trigger={{ label: "Type the amount", variant: "secondary", size: "sm" }} fields={[{ name: "amountPaise", label: "Amount", type: "money", required: true }]} /> : null}</span>
              <span className="flex items-center gap-1"><Money paise={l.amountPaise} />{edit && l.manual && !l.code?.match(/^(pt|tds|lwf_employee)$/) ? <ActionButton action={removeAdjustment} values={{ id: l.id }} label={`Remove ${l.label}`} variant="icon-delete" /> : null}</span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  };
  return (
    <div>
      <dl className="mb-5 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Gross</dt><dd><Money paise={it.grossPaise} size="lg" /></dd></div>
        <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Deductions</dt><dd><Money paise={it.deductionsPaise} size="lg" /></dd></div>
        <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Net pay</dt><dd><Money paise={it.netPaise} size="lg" tone={it.netPaise < 0 ? "danger" : "default"} /></dd></div>
      </dl>
      <p className="mb-5 text-xs text-[var(--ds-on-surface-muted)]">Paid for {(it.calendarDays * 2 - it.unpaidHalfDays) / 2} of {it.calendarDays} days{it.hours != null ? `, ${it.hours} hours` : ""}.{it.prevNetPaise !== null ? ` Last month's net pay: ${(it.prevNetPaise / 100).toLocaleString("en-IN")} rupees.` : ""}{it.skippedReason ? ` Left out of this run: ${it.skippedReason}.` : ""}</p>
      {group("earning", "Earnings")}{group("deduction", "Deductions")}{group("employer", "Employer cost, not deducted from pay")}
      {edit ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <FormModal title="Add pay or a deduction" icon="money" action={addAdjustment} hidden={{ itemId: it.id }} trigger={{ label: "Add a line", variant: "secondary", size: "sm", plus: true }} submitLabel="Add"
            fields={[{ name: "code", label: "What for", type: "select", required: true, options: Object.keys(ADJUSTMENT_CODES).map((k) => ({ value: k, label: ADJUST_LABEL[k as keyof typeof ADJUST_LABEL] })) }, { name: "label", label: "Shown on the payslip as", type: "text" }, { name: "amountPaise", label: "Amount", type: "money", required: true }, { name: "note", label: "Note", type: "text" }]} />
          {!attendanceOn || it.hours != null ? <FormModal title="Days and hours" icon="calendar" action={setDays} hidden={{ itemId: it.id }} trigger={{ label: "Days or hours", variant: "secondary", size: "sm" }}
            values={{ unpaidDays: it.unpaidHalfDays / 2, hours: it.hours ?? "" }} fields={[...(attendanceOn ? [] : [{ name: "unpaidDays", label: "Unpaid days", type: "number" as const, step: 0.5, min: 0, hint: "Use .5 for a half day." }]), { name: "hours", label: "Hours worked", type: "number" as const, step: 0.5, min: 0, hint: "Only for people paid by the hour." }]} /> : null}
          {it.skippedReason ? <ActionButton action={includePerson} values={{ itemId: it.id }} label="Put back in the run" variant="secondary" />
            : <FormModal title="Leave out of this run" description="They are not paid in this run. What they were owed comes in as arrears on the next monthly run." icon="users" action={skipPerson} hidden={{ itemId: it.id }} trigger={{ label: "Leave out", variant: "ghost", size: "sm" }} submitLabel="Leave out" fields={[{ name: "reason", label: "Why", type: "text", required: true }]} />}
        </div>
      ) : null}
      {d.rates.length ? (
        <section aria-label="Rules used"><h3 className="mb-2 text-[13px] text-[var(--ds-on-surface-muted)]">Rules this number rests on</h3>
          <ul className="flex flex-col gap-1.5 text-xs text-[var(--ds-on-surface-variant)]">{d.rates.map((r, i) => <li key={i} className="flex flex-wrap items-center gap-2">{r.key.replace(/_/g, " ")}{r.state ? ` (${r.state})` : ""}<ToneBadge label={r.overridden ? "Your own" : r.confidence} tone={r.confidence === "low" ? "warning" : "default"} /><span className="truncate text-[var(--ds-on-surface-muted)]">{r.source.replace(/^https?:\/\//, "")}</span></li>)}</ul></section>
      ) : null}
      <p className="mt-5 flex flex-wrap gap-3 text-sm"><Link href={`/app/payroll/people/${it.userId}?next=${encodeURIComponent(`/app/payroll/runs/${runId}`)}`} className="underline">Pay details</Link>{it.payslipNo ? <a href={`/app/payroll/files/payslip?item=${it.id}`} className="underline">Payslip {it.payslipNo}</a> : null}</p>
    </div>
  );
}
