import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { canApprove } from "@smw/feature-finance/approvals";
import { Panel } from "@smw/ui/kit/Panel";
import { EmptyLine } from "@smw/ui/finance/States";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { todayIST } from "@smw/feature-kit/money";
import { ExitService, type ExitView } from "../services/exits";
import { addExitLine, deleteExit, removeExitLine, submitExit, undoExit, updateExit, withdrawRequest } from "./actions";
import { NoAccess, PILL_BTN, PRIMARY_BTN, PayNav } from "./common";
import { pendingFor } from "./exit-approval";

export const metadata = { title: "Final settlement" };

export default async function ExitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const svc = new ExitService(ctx);
  if (!svc.can("read")) return <NoAccess what="Exits" />;
  const { id } = await params;
  let v: ExitView;
  try { v = await svc.get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const manage = svc.can("manage"), x = v.exit, editable = manage && (x.status === "draft" || x.status === "rejected");
  const approval = x.status === "pending" ? await pendingFor(ctx, id) : null;
  const today = todayIST();
  const days = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const countdown = (d: string) => (days(d) < 0 ? `${-days(d)} days late` : days(d) === 0 ? "today" : `in ${days(d)} days`);
  const group = (kind: "earning" | "deduction" | "employer", title: string) => {
    const ls = x.lines.map((l, index) => ({ l, index })).filter(({ l }) => l.kind === kind && !(l.amountPaise === 0 && l.code === "info"));
    return ls.length ? (
      <section aria-label={title} className="mb-5"><h3 className="mb-2 text-[13px] text-[var(--ds-on-surface-muted)]">{title}</h3>
        <ul className="flex flex-col gap-2">{ls.map(({ l, index }) => (
          <li key={index} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0"><span className="block">{l.label}</span>{l.note && !l.note.startsWith("needs:") && !/^[0-9a-f-]{36}$/.test(l.note) && !l.note.includes(":") ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{l.note}</span> : null}{l.note?.startsWith("needs:") ? <span className="block text-xs text-[var(--ds-color-warning-400)]">{l.note.slice(6)}</span> : null}</span>
            <span className="flex items-center gap-1"><Money paise={l.amountPaise} />{editable && l.code === "other" ? <ActionButton action={removeExitLine} values={{ id, index: String(index) }} label={`Remove ${l.label}`} variant="icon-delete" /> : null}</span></li>))}</ul></section>
    ) : null;
  };
  return (
    <>
      <Link href="/app/payroll/exits" className="mb-2 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Exits</Link>
      <PageHeader eyebrow={`Last day ${shortDate(x.lastDay)}`} title={<span className="flex flex-wrap items-center gap-3">{v.name}<StateBadge state={x.status} /></span>} description={x.reason}
        actions={<><Link href={`/app/payroll/people/${x.userId}`} className={PILL_BTN}>Pay details</Link>
          {editable ? <><FormModal title="Change the exit" icon="calendar" action={updateExit} hidden={{ id }} trigger={{ label: "Change", variant: "secondary" }} values={{ lastDay: x.lastDay, reason: x.reason, noticeDays: v.noticeDays }}
            fields={[{ name: "lastDay", label: "Last working day", type: "date", required: true }, { name: "reason", label: "Reason", type: "text", required: true }, { name: "noticeDays", label: "Notice days", type: "number", step: 1, hint: "More than zero: the school pays. Less than zero: not served." }]} />
            <ActionButton action={submitExit} values={{ id }} label={v.blockers.length ? "Fix points first" : "Send for approval"} variant="default" /></> : null}</>} />
      <PayNav active="exits" manager />
      {x.status === "rejected" ? <section className="mb-4 rounded-3xl bg-[var(--ds-color-danger-500)]/10 p-5 text-sm">A second person did not approve this. Change what is needed and send it again. <Link href="/app/finance/approvals?status=rejected" className="underline">See the reason</Link></section> : null}
      {x.status === "pending" ? (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm"><p>Waiting for a second person to approve.</p>
          <span className="flex gap-2">{canApprove(ctx) && approval && !approval.mine ? <Link href="/app/finance/approvals" className={PRIMARY_BTN}>Open approvals</Link> : null}{approval?.mine ? <ActionButton action={withdrawRequest} values={{ id: approval.id }} label="Withdraw" variant="ghost" confirm={{ title: "Withdraw this request?", body: "The settlement goes back to a draft you can change." }} /> : null}</span></section>
      ) : null}
      {v.blockers.length && editable ? <section role="alert" className="mb-4 rounded-3xl bg-[var(--ds-color-danger-500)]/10 p-5 text-sm"><p className="mb-2 font-medium text-[var(--ds-color-danger-300)]">Fix before sending</p><ul className="flex flex-col gap-1">{v.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></section> : null}
      {x.status === "approved" && x.runId ? (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm"><p>Approved. The money is owed; pay it from the settlement's run.</p>
          <span className="flex gap-2"><Link href={`/app/payroll/runs/${x.runId}?tab=payouts`} className={PRIMARY_BTN}>Pay the settlement</Link>{manage ? <FormModal title="Undo this settlement" description="Only while nothing is paid. The postings, loan recovery and leave paid out are reversed and the exit goes back to a draft." icon="clock" action={undoExit} hidden={{ id }} trigger={{ label: "Undo", variant: "ghost" }} submitLabel="Undo" fields={[{ name: "reason", label: "Why", type: "text", required: true }]} /> : null}</span></section>
      ) : null}
      {x.status === "paid" && v.stillActive ? <section className="mb-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm">Paid. {v.name} is still active in your staff list. <Link href={`/app/staff/${x.userId}`} className="underline">Deactivate them</Link> (only an admin can).</section> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Settlement" action={editable ? <FormModal title="Add a line" description="Something else owed to them or by them." icon="money" action={addExitLine} hidden={{ id }} trigger={{ label: "Add a line", variant: "secondary", size: "sm", plus: true }} submitLabel="Add"
            fields={[{ name: "kind", label: "It is", type: "select", required: true, options: [{ value: "earning", label: "Paid to them" }, { value: "deduction", label: "Taken from them" }] }, { name: "label", label: "What for", type: "text", required: true }, { name: "amountPaise", label: "Amount", type: "money", required: true }]} /> : null}>
            {x.lines.length === 0 ? <EmptyLine title="Nothing to settle." /> : <>{group("earning", "Paid to them")}{group("deduction", "Taken from their pay")}{group("employer", "Employer cost, not deducted")}</>}
            <div className="mt-4 border-t border-white/[0.08] pt-4"><KeyTotals items={[{ label: "Paid to them", paise: v.totals.gross + v.totals.claims }, { label: "Taken", paise: v.totals.deductions }, { label: "They receive", paise: v.totals.net, strong: true, tone: v.totals.net < 0 ? "danger" : undefined }]} /></div>
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="When it must be paid" className="h-full">
            <ul className="flex flex-col gap-3 text-sm">
              <li className="flex justify-between gap-3"><span>Wages and dues</span><span className="text-right"><span className="block">{shortDate(v.due.wages)}</span>{x.status !== "paid" ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{countdown(v.due.wages)}</span> : null}</span></li>
              {v.due.gratuity ? <li className="flex justify-between gap-3"><span>Gratuity</span><span className="text-right"><span className="block">{shortDate(v.due.gratuity)}</span>{x.status !== "paid" ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{countdown(v.due.gratuity)}</span> : null}</span></li> : null}
            </ul>
            {v.sources.length ? <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">From the rule list: {v.sources.map((s) => <a key={s.key} href={s.source} rel="noreferrer" className="underline">{s.key.replace(/_/g, " ")} ({s.confidence})</a>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, ", ", n] : [n]), [])}.</p> : null}
          </Panel>
        </div>
      </div>
      {editable ? <p className="mt-6"><ActionButton action={deleteExit} values={{ id }} label="Delete this draft" variant="ghost" redirectTo="/app/payroll/exits" confirm={{ title: "Delete this exit draft?", body: "Nothing was posted. You can start again later.", danger: true }} /></p> : null}
    </>
  );
}
