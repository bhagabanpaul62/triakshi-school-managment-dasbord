import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { paise } from "@smw/ui/format";
import { InlineForm } from "@smw/feature-finance/ui/inline-form";
import { DeclarationService } from "../services/declarations";
import { LoanService } from "../services/loans";
import { PayslipService } from "../services/payslips";
import { requestLoan, saveDeclaration } from "./actions";
import { FormModal } from "@smw/ui/shell/FormModal";
import { NoAccess, PILL_BTN, PayNav } from "./common";

export const metadata = { title: "My payslips" };

/** Everything about the signed-in person's own pay: payslips, loans and the tax declaration. */
export default async function MePage() {
  const ctx = await requireCtx();
  const slips = new PayslipService(ctx);
  if (!slips.can("self")) return <NoAccess what="My payslips" />;
  const manage = slips.can("manage"), fy = fyOf(todayIST());
  const [list, loans, decl, est] = await Promise.all([slips.list(), new LoanService(ctx).list({}), new DeclarationService(ctx).get(), new DeclarationService(ctx).estimate()]);
  return (
    <>
      <PageHeader eyebrow="Payroll" title="My payslips" description="Your pay, your loans and your tax declaration. Only you and the people who run payroll can see these." actions={<a href={`/app/payroll/files/report?name=statement&fy=${fy}`} download className={PILL_BTN}>Salary statement {fy}</a>} />
      <PayNav active="me" manager={manage} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel title="Payslips" className="h-full">
            {list.length === 0 ? <EmptyLine title="No payslips yet." hint="Your payslip appears here once the month's pay run is approved. If you expected one, ask whoever runs payroll to check you are in the run." /> : (
              <ul className="flex flex-col">{list.map((s) => (
                <li key={s.itemId} className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 text-sm hover:bg-white/[0.04]">
                  <span className="min-w-0"><a href={`/app/payroll/files/payslip?item=${s.itemId}`} className="block truncate underline">{s.label}</a><span className="block text-xs text-[var(--ds-on-surface-muted)]">{s.payslipNo}</span></span>
                  <span className="flex items-center gap-3"><Money paise={s.netPaise} />{s.payout === "paid" ? <StateBadge state="paid" /> : <StateBadge state="pending" />}</span>
                </li>))}</ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="My loans" className="h-full" action={<FormModal title="Ask for a loan" description="An admin approves it. The instalment is taken from your salary." icon="money" action={requestLoan} trigger={{ label: "Ask for a loan", variant: "secondary", size: "sm" }} submitLabel="Send for approval" values={{ startsOn: todayIST() }}
            fields={[{ name: "amountPaise", label: "Loan amount", type: "money", required: true }, { name: "emiPaise", label: "Taken from each month's pay", type: "money", required: true }, { name: "startsOn", label: "First deduction from", type: "date", required: true }, { name: "reason", label: "What it is for", type: "text", required: true }]} />}>
            {loans.rows.length === 0 ? <EmptyLine title="No loans." /> : <ul className="flex flex-col gap-2 text-sm">{loans.rows.map((l) => <li key={l.id} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate">{paise(Number(l.amountPaise))}, {l.reason}</span><span className="flex items-center gap-2"><Money paise={l.balancePaise} /><StateBadge state={l.status === "active" ? (l.givenOn ? "open" : "approved") : l.status} /></span></li>)}</ul>}
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel title={`Tax declaration ${fy}`} className="h-full">
            <p className="mb-2 text-sm text-[var(--ds-on-surface-muted)]">What you tell payroll so tax is deducted correctly. Deductions count only under the old regime.</p>
            <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              {!decl ? <ToneBadge label="Not sent" tone="default" /> : decl.acceptedAt ? <><ToneBadge label="Accepted" tone="success" /><span className="text-[var(--ds-on-surface-muted)]">It counts for your tax. Changing it asks the office to accept it again.</span></>
                : decl.returnedNote ? <><ToneBadge label="Sent back" tone="warning" /><span>{decl.returnedNote}. Fix it and save again.</span></> : <><ToneBadge label="Waiting for the office" tone="info" /><span className="text-[var(--ds-on-surface-muted)]">It does not change your tax until the office accepts it.</span></>}
            </p>
            <InlineForm action={saveDeclaration} submitLabel="Save declaration" hidden={{ fy }} values={decl ?? {}}
              fields={[{ name: "otherIncomePaise", label: "Other income this year", type: "money" }, { name: "deductionsPaise", label: "Deductions you will claim (80C and others)", type: "money" }, { name: "previousSalaryPaise", label: "Salary from a previous employer this year", type: "money" }, { name: "previousTdsPaise", label: "Tax already deducted there", type: "money" }, { name: "note", label: "Note", type: "text", wide: true }]} />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Tax estimate" className="h-full">
            {est ? <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--ds-on-surface-variant)]">Income this year</dt><dd><Money paise={est.yearlyIncomePaise} /></dd></div>
              <div className="flex justify-between"><dt className="text-[var(--ds-on-surface-variant)]">Taxable after deductions</dt><dd><Money paise={est.taxablePaise} /></dd></div>
              <div className="flex justify-between"><dt className="text-[var(--ds-on-surface-variant)]">Tax for the year</dt><dd><Money paise={est.yearlyTaxPaise} /></dd></div>
              <div className="flex justify-between border-t border-white/[0.08] pt-2 font-medium"><dt>Deducted each month now</dt><dd><Money paise={est.monthlyPaise} /></dd></div>
              <p className="text-xs text-[var(--ds-on-surface-muted)]">An estimate on the {est.regime} regime from today's pay, {est.monthsLeft} months left. The run decides the real amount.</p></dl>
              : <EmptyLine title="No estimate yet." hint="It needs your pay set up and tax slabs for this year. Ask whoever runs payroll." />}
          </Panel>
        </div>
      </div>
      {manage ? <p className="mt-6 text-sm"><Link href="/app/payroll" className="underline">Back to payroll</Link></p> : null}
    </>
  );
}
