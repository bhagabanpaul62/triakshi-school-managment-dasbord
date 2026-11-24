import Link from "next/link";
import { NotFoundError, listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { paise, shortDate } from "@smw/ui/format";
import { LoanService } from "../services/loans";
import { ProfileService } from "../services/profiles";
import { giveLoan, pauseLoan, payBackLoan, requestLoan, resumeLoan } from "./actions";
import { NoAccess, PILL_BTN, PayNav, one, type Search } from "./common";
import { PeekByUrl } from "./peek-by-url";

export const metadata = { title: "Staff loans" };
const columns: Column[] = [
  { key: "name", label: "Person", type: "person", metaKey: "employeeId" },
  { key: "amountPaise", label: "Loan", type: "money" },
  { key: "emiPaise", label: "Each month", type: "money", hideOnMobile: true },
  { key: "balancePaise", label: "Still owed", type: "money" },
  { key: "state", label: "State", type: "state" },
];
const STATE = (l: { status: string; givenOn: string | null }) => (l.status === "active" && !l.givenOn ? "approved" : l.status === "active" ? "open" : l.status);

/** All loans for payroll staff; a person's own for everyone else, with a way to ask for one. */
export default async function LoansPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const svc = new LoanService(ctx);
  if (!svc.can("self")) return <NoAccess what="Loans" />;
  const manage = svc.can("manage"), sp = await searchParams;
  const page = await svc.list(listQueryFrom(sp));
  const people = manage ? await new ProfileService(ctx).all() : [];
  const itemId = one(sp.item);
  const detail = itemId ? await svc.get(itemId).catch((e) => { if (e instanceof NotFoundError) return null; throw e; }) : null;
  const ask = (
    <FormModal title={manage ? "New loan" : "Ask for a loan"} description="An admin approves it before any money is given. The instalment is taken from salary." icon="money" action={requestLoan} trigger={{ label: manage ? "New loan" : "Ask for a loan" }} submitLabel="Send for approval"
      values={{ startsOn: todayIST() }}
      fields={[...(manage ? [{ name: "userId", label: "Person", type: "select" as const, required: true, options: people.map((p) => ({ value: p.id, label: `${p.name} (${p.employeeId})` })) }] : []),
        { name: "amountPaise", label: "Loan amount", type: "money", required: true }, { name: "emiPaise", label: "Taken from each month's pay", type: "money", required: true }, { name: "startsOn", label: "First deduction from", type: "date", required: true }, { name: "reason", label: "What it is for", type: "text", required: true }]} />
  );
  const rowActions = Object.fromEntries(page.rows.map((l) => [l.id, manage ? (
    <span key={l.id} className="flex items-center gap-1">
      {l.status === "active" && !l.givenOn ? <FormModal title="Give the loan" description="Posts the money to staff loans and takes it from the bank." icon="money" action={giveLoan} hidden={{ id: l.id }} trigger={{ label: "Give", variant: "secondary", size: "sm" }} submitLabel="Give" fields={[{ name: "date", label: "Given on", type: "date" }]} /> : null}
      {l.status === "active" && l.givenOn ? <FormModal title="Pause the loan" description="No instalment is taken until the date you pick." icon="clock" action={pauseLoan} hidden={{ id: l.id }} trigger={{ label: "Pause", variant: "ghost", size: "sm" }} submitLabel="Pause" fields={[{ name: "until", label: "Pause until", type: "date", required: true }]} /> : null}
      {l.status === "paused" ? <ActionButton action={resumeLoan} values={{ id: l.id }} label="Resume" variant="ghost" /> : null}
      {l.givenOn && l.status !== "closed" ? <FormModal title="Paid back" description="Leave the amount empty if the whole balance is paid." icon="money" action={payBackLoan} hidden={{ id: l.id }} trigger={{ label: "Paid back", variant: "ghost", size: "sm" }} submitLabel="Record" fields={[{ name: "amountPaise", label: "Amount", type: "money", hint: `${paise(l.balancePaise)} is owed` }, { name: "date", label: "Paid on", type: "date" }]} /> : null}
    </span>) : null]));
  return (
    <>
      <PageHeader eyebrow="Payroll" title={manage ? "Staff loans" : "My loans"} description="Money lent to staff and taken back from salary. Never more than what is still owed." actions={<>{manage ? <a href="/app/payroll/files/loans-csv" download className={PILL_BTN}>CSV</a> : null}{ask}</>} />
      <PayNav active="loans" manager={manage} />
      <DataTable columns={columns} rows={page.rows.map((l) => ({ ...l, state: STATE(l) }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/payroll/loans?item={id}" rowActions={rowActions} searchPlaceholder="Search by person"
        filters={manage ? [{ key: "status", label: "State", options: ["pending", "active", "paused", "closed", "rejected"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) }] : undefined}
        empty={{ title: "No loans.", description: manage ? "A loan is asked for, approved by an admin and then given." : "If you need an advance, ask for it here. An admin decides.", action: ask }} />
      {detail ? (
        <PeekByUrl title={`Loan for ${detail.person.name}`} description={detail.loan.reason}>
          <dl className="mb-5 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Loan</dt><dd><Money paise={Number(detail.loan.amountPaise)} size="lg" /></dd></div><div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Recovered</dt><dd><Money paise={detail.recoveredPaise} size="lg" /></dd></div><div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Owed</dt><dd><Money paise={detail.balancePaise} size="lg" /></dd></div></dl>
          <p className="mb-4 flex items-center gap-2 text-sm"><StateBadge state={STATE(detail.loan)} />{detail.loan.status === "pending" ? <span>Waiting for an admin. <Link href="/app/finance/approvals" className="underline">Approvals</Link></span> : detail.loan.status === "rejected" ? <span>Not approved. Ask again with a new request.</span> : null}</p>
          <h3 className="mb-2 text-[13px] text-[var(--ds-on-surface-muted)]">Recovered so far</h3>
          {detail.repayments.length ? <ul className="mb-5 flex flex-col gap-1 text-sm">{detail.repayments.map((r) => <li key={r.id} className="flex justify-between"><span>{shortDate(r.date)}{r.itemId ? " from salary" : " paid back"}</span><Money paise={Number(r.amountPaise)} /></li>)}</ul> : <EmptyLine title="Nothing recovered yet." />}
          {detail.schedule.length ? <><h3 className="mb-2 text-[13px] text-[var(--ds-on-surface-muted)]">Still to come</h3><ul className="flex flex-col gap-1 text-sm">{detail.schedule.slice(0, 24).map((s) => <li key={s.month} className="flex justify-between"><span>{new Date(`${s.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</span><span className="tabular-nums">{paise(s.paise)}, then {paise(s.left)} left</span></li>)}</ul></> : null}
        </PeekByUrl>
      ) : null}
    </>
  );
}
