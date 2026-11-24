import Link from "next/link";
import { notFound } from "next/navigation";
import { canApprove } from "@smw/feature-finance/approvals";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { BigStat, StatGroup } from "@smw/ui/kit/BigStat";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { Timeline, type TimelineItem } from "@smw/ui/finance/Timeline";
import { EmptyLine } from "@smw/ui/finance/States";
import { paise, shortDate } from "@smw/ui/format";
import { ConcessionTypeService, DuesService, HeadService, PromiseService } from "../service";
import { addPromise, resumeReminders, settleUpLeaving, stopReminders, withdrawConcession, resendSettlement, withdrawNote, withdrawSettlement } from "./actions";
import { ConcessionForm } from "./concession-form";
import { FeesLookup } from "./lookups";
import type { ApprovalInfo } from "../base";
import { SettlementBuilder, type SettlementPlan } from "./settlement-builder";
import { StudentDocs } from "./student-docs";
import { Notice, PillLink, Tabs, can, one, type Search } from "./shared";
import { CARD, H3, LINK, MUTED } from "./styles";

export const metadata = { title: "Student fees" };

type Account = Awaited<ReturnType<DuesService["studentAccount"]>>;
const TABS = [["overview", "Overview"], ["bills", "Bills"], ["receipts", "Receipts"], ["deals", "Concessions and deals"], ["advance", "Advance and deposit"], ["documents", "Documents"], ["notes", "Notes"]] as const;
const TONE = { invoice: "default", receipt: "success", note: "default", refund: "info", slip: "warning", promise: "warning", reminder: "default" } as const;
const worth = (mode: "percent" | "amount", v: number) => (mode === "percent" ? `${v / 100}%` : rupees(v));

/** One student's money, every year: where they stand, the next step, and everything that ever touched their account. */
export default async function StudentFeesPage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  const [{ studentId }, sp] = await Promise.all([params, searchParams]);
  const staff = can(ctx, "read");
  if (!staff && !can(ctx, "self")) return <Notice tone="danger" action={{ href: "/app", label: "Go home" }}>Fees are for the accounts team. Ask an admin if you need access.</Notice>;
  let a: Account;
  try { a = await new DuesService(ctx).studentAccount(studentId); } catch { return notFound(); }
  const tab = TABS.some(([t]) => t === one(sp.tab)) ? one(sp.tab) : "overview";
  const { student, balance } = a, base = `/app/fees/students/${studentId}`, today = todayIST();
  const collect = can(ctx, "collect"), setup = can(ctx, "setup"), concede = can(ctx, "concede");
  const lookup = new FeesLookup(ctx);
  const [heads, types, stopped, broken] = await Promise.all([
    concede ? new HeadService(ctx).options().then((h) => h.filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name }))) : [],
    concede ? new ConcessionTypeService(ctx).list({ page: 1, pageSize: 100 }).then((p) => p.rows.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, mode: t.mode, value: t.value, headId: t.headId, per: t.per }))) : [],
        lookup.reminderStop(studentId),
    new PromiseService(ctx).broken().then((b) => b.find((x) => x.studentId === studentId) ?? null),
  ]);
  const openBills = a.invoices.filter((i) => i.status === "issued" && i.openPaise > 0).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const overdue = openBills.filter((i) => i.state === "overdue");
  const left = student.status !== "active";
  const waitingSettlement = a.settlements.find((s) => s.status === "pending");
  const billsForDeal = openBills.map((i) => ({ id: i.id, number: i.number, label: i.label, openPaise: i.openPaise, accruedLatePaise: i.accruedLatePaise, dueDate: i.dueDate }));
  const owed = balance.openPaise + balance.accruedPaise;

  const timeline: TimelineItem[] = a.timeline.map((t) => ({ at: t.at, title: t.title, amountPaise: t.amountPaise || undefined, href: t.href, tone: TONE[t.kind as keyof typeof TONE] }));
  const waiting = (x: ApprovalInfo | null) => { return x?.status === "pending" ? `Waiting for ${x.waitingFor.join(" or ") || "an admin"}` : x?.status === "rejected" ? `Not approved${x.decidedByName ? ` by ${x.decidedByName}` : ""}: ${x.note ?? "no reason was written"}` : ""; };

  return (
    <>
      <EntityHeader back={{ href: staff ? "/app/fees/dues" : "/app/fees", label: staff ? "Students' dues" : "My fees" }} title={student.name}
        chips={<><ToneBadge label={student.classLabel} />{left ? <ToneBadge label={student.status === "left" ? `Left${student.leftOn ? ` ${shortDate(student.leftOn)}` : ""}` : "Alumni"} tone="warning" /> : null}{stopped ? <ToneBadge label="Reminders stopped" tone="info" /> : null}</>}
        meta={[student.admissionNo, <Link key="p" href={`/app/students/${studentId}`} className={LINK}>Student record</Link>]}
        actions={staff ? <>
          {collect ? <PillLink href={`/app/fees/collect?student=${studentId}`} primary>Collect</PillLink> : null}
          {setup ? <PillLink href={`/app/fees/invoices/new?student=${studentId}`}>New bill</PillLink> : null}
          {concede ? <ConcessionForm types={types} heads={heads} student={{ id: studentId, label: student.name, meta: `${student.admissionNo} · ${student.classLabel}` }} label="Concession" variant="secondary" /> : null}
          {concede && openBills.length && !waitingSettlement ? <SettlementBuilder studentId={studentId} studentName={student.name} bills={billsForDeal} advancePaise={balance.advancePaise} depositPaise={balance.depositPaise} today={today} /> : null}
          {concede && (left || balance.advancePaise > 0 || balance.depositPaise > 0) ? (
            <FormModal title="Settle up and refund" icon="money" summary={`Advance ${paise(balance.advancePaise)} and deposit ${paise(balance.depositPaise)} first go against dues. What is left is asked back, and an approver says yes.`}
              trigger={{ label: "Settle up and refund", variant: "secondary", plus: false }} hidden={{ studentId }} action={settleUpLeaving} successMessage="Done" size="md"
              fields={[{ name: "reason", label: "Why", required: true, placeholder: "Left the school, moved to another city" }, { name: "method", label: "Refund by", type: "select", required: true, options: [{ value: "bank_transfer", label: "Bank transfer" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "upi", label: "UPI" }] }, { name: "reference", label: "Account or UPI to send to (optional)" }]} values={{ method: "bank_transfer" }} />
          ) : null}
          {collect ? <FormModal title="Promise to pay" icon="clock" trigger={{ label: "Promise", variant: "ghost", plus: false }} hidden={{ studentId }} action={addPromise} summary="Reminders pause until that day. A promise that passes with money still open is listed as broken."
            fields={[{ name: "promisedOn", label: "Will pay by", type: "date", required: true, min: today }, { name: "amountPaise", label: "Amount (optional)", type: "money" }, { name: "note", label: "Note", placeholder: "Father said after salary", wide: true }]} /> : null}
        </> : undefined} />

      <div className="mt-6"><StatGroup columns={4}>
        <BigStat label={owed > 0 ? "Owes" : "Owes nothing"} value={paise(owed)} size="lg" tone={overdue.length ? "danger" : "default"} hint={overdue.length ? `${overdue.length} bill${overdue.length === 1 ? " is" : "s are"} overdue` : openBills.length ? `${openBills.length} open bill${openBills.length === 1 ? "" : "s"}` : "All bills are paid"} />
        <BigStat label="Late fee building up" value={paise(balance.accruedPaise)} hint="Added when they pay" />
        <BigStat label="Advance" value={paise(balance.advancePaise)} hint={balance.waitingAdvancePaise ? `${paise(balance.waitingAdvancePaise)} more waits for a cheque to clear` : "Used on the next bill"} />
        <BigStat label="Deposit held" value={paise(balance.depositPaise)} hint="Refundable" />
      </StatGroup></div>

      {waitingSettlement ? <div className="mt-4"><Notice tone="info" action={canApprove(ctx) ? { href: "/app/finance/approvals", label: "Open approvals" } : undefined}>A settlement for this student is waiting. {waiting(waitingSettlement.approval)}. Reminders and late fees follow the new dates once it is approved.</Notice></div> : null}
      {broken ? <div className="mt-4"><Notice tone="danger" action={concede && openBills.length ? undefined : undefined}>Promised to pay by {shortDate(broken.promisedOn)} and still owes. {collect ? "Collect the fee, or note a new promise." : ""}</Notice></div> : null}
      {left && owed > 0 ? <div className="mt-4"><Notice>This student has left and still owes {paise(owed)}. A transfer certificate warns until it is paid or settled.</Notice></div> : null}

      <div className="mt-6"><Tabs label="Student fee sections" tabs={TABS.map(([t, l]) => [t, l] as const)} current={tab} href={(t) => `${base}${t === "overview" ? "" : `?tab=${t}`}`} /></div>

      {tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section className={CARD} aria-label="Everything on this account"><h2 className={H3}>Everything on this account</h2><Timeline items={timeline} emptyText="Nothing has happened on this account yet." /></section>
          <section className={CARD} aria-label="Open bills"><h2 className={H3}>Open bills</h2>
            {openBills.length ? <ul className="divide-y divide-white/[0.06] text-sm">{openBills.map((i) => <li key={i.id}><Link href={`/app/fees/invoices/${i.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:bg-white/[0.04]"><span className="min-w-0"><span className="block truncate">{i.number}</span><span className={`${MUTED} block truncate`}>{i.label}, due {shortDate(i.dueDate)}</span></span><span className="flex items-center gap-2"><StateBadge state={i.state} /><Money paise={i.openPaise} /></span></Link></li>)}</ul>
              : <EmptyLine title="Nothing is open" hint="Every bill is paid." action={setup ? <PillLink href={`/app/fees/invoices/new?student=${studentId}`}>New bill</PillLink> : undefined} />}
            {collect && openBills.length ? <div className="mt-4"><PillLink href={`/app/fees/collect?student=${studentId}`} primary>Collect {paise(owed)}</PillLink></div> : null}
          </section>
        </div>
      ) : null}

      {tab === "bills" ? (
        <section className={CARD} aria-label="Bills"><div className="custom-scrollbar overflow-x-auto"><table className="w-full min-w-[600px] text-sm">
          <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Bill</th><th className="py-2 font-normal">For</th><th className="py-2 font-normal">Due</th><th className="py-2 font-normal">State</th><th className="py-2 text-right font-normal">Billed</th><th className="py-2 text-right font-normal">Paid</th><th className="py-2 text-right font-normal">Open</th></tr></thead>
          <tbody>{a.invoices.map((i) => <tr key={i.id} className="border-t border-white/[0.06]"><td className="py-2"><Link href={`/app/fees/invoices/${i.id}`} className={LINK}>{i.number ?? "Draft"}</Link>{i.version > 1 ? <span className={`${MUTED} ml-1`}>v{i.version}</span> : null}</td><td className="py-2">{i.label}</td><td className="py-2 whitespace-nowrap">{shortDate(i.dueDate)}</td><td className="py-2"><StateBadge state={i.state} /></td><td className="py-2 text-right"><Money paise={i.grossPaise - i.concessionPaise - i.creditedPaise + i.latePaise} /></td><td className="py-2 text-right"><Money paise={i.paidPaise} /></td><td className="py-2 text-right"><Money paise={i.openPaise || null} /></td></tr>)}</tbody></table>
          {!a.invoices.length ? <EmptyLine title="No bills yet" hint="Bills come from the fee plan when it is issued, or you can make one." action={setup ? <PillLink href={`/app/fees/invoices/new?student=${studentId}`} primary>New bill</PillLink> : undefined} /> : null}</div></section>
      ) : null}

      {tab === "receipts" ? (
        <section className={CARD} aria-label="Receipts">{a.receipts.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.receipts.map((r) => <li key={r.id}><Link href={`/app/fees/receipts/${r.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:bg-white/[0.04]"><span><span className="block">{r.number}</span><span className={MUTED}>{shortDate(r.date)}{r.payerName ? `, from ${r.payerName}` : ""}</span></span><span className="flex items-center gap-2">{r.status !== "valid" ? <StateBadge state={r.status} /> : null}<Money paise={r.amountPaise} /></span></Link></li>)}</ul>
          : <EmptyLine title="No receipts yet" hint="Money received appears here with its receipt." action={collect ? <PillLink href={`/app/fees/collect?student=${studentId}`} primary>Collect a fee</PillLink> : undefined} />}</section>
      ) : null}

      {tab === "deals" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={CARD} aria-label="Concessions"><h2 className={H3}>Concessions</h2>
            {a.concessions.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.concessions.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block">{worth(c.mode, c.value)} off. {c.reason}</span><span className={`${MUTED} block`}>{waiting(c.approval)}</span></span><span className="flex items-center gap-2"><StateBadge state={c.status} />{c.status === "pending" && concede ? <ActionButton label="Withdraw" variant="ghost" action={withdrawConcession} values={{ id: c.id }} confirm={{ title: "Take this request back?", body: "Nothing changes on the bills.", confirmLabel: "Withdraw" }} /> : null}
              {c.status === "rejected" && concede ? <ConcessionForm types={types} heads={heads} student={{ id: studentId, label: student.name }} again={{ id: c.id, typeId: c.typeId, headId: c.headId, mode: c.mode, value: c.value, per: c.per, reason: c.reason }} label="Edit and resend" variant="ghost" /> : null}</span></li>)}</ul>
              : <EmptyLine title="No concessions" hint="A sibling, merit or need discount is given here." action={concede ? <ConcessionForm types={types} heads={heads} student={{ id: studentId, label: student.name }} label="Give a concession" /> : undefined} />}</section>
          <section className={CARD} aria-label="Settlements"><h2 className={H3}>Settlements</h2>
            {a.settlements.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.settlements.map((s) => { const plan = s.plan as unknown as SettlementPlan; return <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block">{s.reason}</span><span className={`${MUTED} block`}>{plan.parts?.length ? `${plan.parts.length} parts` : "One payment"}{plan.waiveLate ? ", late fee waived" : ""}{plan.writeOffPaise ? `, ${rupees(plan.writeOffPaise)} written off` : ""}{plan.finalPaise !== undefined ? `, agreed ${rupees(plan.finalPaise)}` : ""}. {waiting(s.approval)}</span></span>
              <span className="flex items-center gap-2"><StateBadge state={s.status} />{s.status === "pending" && concede ? <ActionButton label="Send again with today's dues" variant="ghost" action={resendSettlement} values={{ id: s.id }} /> : null}{s.status === "pending" && concede ? <ActionButton label="Withdraw" variant="ghost" action={withdrawSettlement} values={{ id: s.id }} confirm={{ title: "Take this settlement back?", body: "The dues stay as they are. You can build a new one.", confirmLabel: "Withdraw" }} /> : null}
                {s.status === "rejected" && concede && openBills.length ? <SettlementBuilder studentId={studentId} studentName={student.name} bills={billsForDeal} advancePaise={balance.advancePaise} depositPaise={balance.depositPaise} today={today} again={{ id: s.id, plan }} /> : null}</span></li>; })}</ul>
              : <EmptyLine title="No settlements" hint="A deal on dues: waive the late fee, write off part, or split what is left into dates." action={concede && openBills.length ? <SettlementBuilder studentId={studentId} studentName={student.name} bills={billsForDeal} advancePaise={balance.advancePaise} depositPaise={balance.depositPaise} today={today} /> : undefined} />}</section>
          <section className={`${CARD} lg:col-span-2`} aria-label="Credit and debit notes"><h2 className={H3}>Credit and debit notes</h2>
            {a.notes.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.notes.map((n) => <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`/app/fees/invoices/${n.invoiceId}`} className={`${LINK} min-w-0`}>{n.number ?? "Waiting"} · {n.kind === "credit" ? "Credit" : "Debit"} ({n.reasonType.replace("_", " ")}): {n.reason}</Link><span className="flex items-center gap-2"><span className={MUTED}>{waiting(n.approval)}</span><StateBadge state={n.status} />{n.status === "pending" && concede ? <ActionButton label="Withdraw" variant="ghost" action={withdrawNote} values={{ id: n.id }} /> : null}<Money paise={n.kind === "credit" ? -n.amountPaise : n.amountPaise} /></span></li>)}</ul>
              : <p className="text-sm text-[var(--ds-on-surface-muted)]">None. A note is added from a bill.</p>}</section>
        </div>
      ) : null}

      {tab === "advance" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={CARD} aria-label="Advance and deposit"><h2 className={H3}>Advance and deposit</h2>
            <p className="mb-3 text-sm">Advance <Money paise={balance.advancePaise} /> and deposit <Money paise={balance.depositPaise} />.{balance.waitingAdvancePaise + balance.waitingDepositPaise ? <> <Money paise={balance.waitingAdvancePaise + balance.waitingDepositPaise} /> more waits for a cheque to clear and cannot be refunded or used until it does.</> : null}</p>
            {a.advances.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.advances.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><span><span className="block">{x.note ?? x.kind}</span><span className={MUTED}>{shortDate(x.date)} · {x.kind === "used" ? "used on a bill" : x.kind === "deposit" ? "deposit" : x.kind}</span></span><Money paise={x.amountPaise} sign="always" /></li>)}</ul> : <EmptyLine title="No advance or deposit" hint="Money paid above the bills becomes an advance, and a refundable deposit is held here." />}</section>
          <section className={CARD} aria-label="Refunds"><h2 className={H3}>Refunds</h2>
            {a.refunds.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.refunds.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span><span className="block">{r.number ?? "Waiting"} · from the {r.source}</span><span className={MUTED}>{r.reason}</span></span><span className="flex items-center gap-2"><StateBadge state={r.status} /><Money paise={r.amountPaise} /></span></li>)}</ul>
              : <EmptyLine title="No refunds" hint="When a student leaves, settle up and the advance and deposit are refunded after approval." action={concede && (left || balance.advancePaise > 0 || balance.depositPaise > 0) ? <Link href={`${base}`} className={LINK}>Use Settle up and refund at the top</Link> : undefined} />}</section>
        </div>
      ) : null}

      {tab === "documents" ? <StudentDocs ctx={ctx} studentId={studentId} sp={sp} /> : null}

      {tab === "notes" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={CARD} aria-label="Promises to pay"><h2 className={H3}>Promises to pay</h2>
            {a.promises.length ? <ul className="divide-y divide-white/[0.06] text-sm">{a.promises.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 py-2"><span><span className="block">By {shortDate(p.promisedOn)}{p.note ? `: ${p.note}` : ""}</span>{p.promisedOn < today ? <span className="text-xs text-[var(--ds-color-danger-400)]">The day has passed</span> : null}</span><Money paise={p.amountPaise} /></li>)}</ul>
              : <EmptyLine title="No promises" hint="When a family says they will pay by a date, note it. Reminders pause until then." />}</section>
          <section className={CARD} aria-label="Reminders"><h2 className={H3}>Reminders</h2>
            {stopped ? <><p className="text-sm">Reminders are stopped for this student: {stopped}.</p>{collect ? <div className="mt-3"><ActionButton label="Start reminders again" action={resumeReminders} values={{ studentId }} /></div> : null}</>
              : <><p className="text-sm text-[var(--ds-on-surface-muted)]">The family gets a notice before and after each due date.</p>{collect ? <div className="mt-3"><FormModal title="Stop reminders" icon="clock" trigger={{ label: "Stop reminders", variant: "secondary", plus: false }} hidden={{ studentId }} action={stopReminders} fields={[{ name: "reason", label: "Why", required: true, placeholder: "In talks with the office", wide: true }]} summary="The nightly reminders skip this student until you start them again." /></div> : null}</>}
            <p className={`${MUTED} mt-4`}>Each reminder that was sent is on the Overview timeline.</p></section>
        </div>
      ) : null}
    </>
  );
}
