import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { Timeline } from "@smw/ui/finance/Timeline";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { paise, shortDate } from "@smw/ui/format";
import { todayIST } from "@smw/feature-kit/money";
import { AssignmentService } from "../services/assignments";
import { LoanService } from "../services/loans";
import { PayslipService } from "../services/payslips";
import { ProfileService } from "../services/profiles";
import { StructureService } from "../services/structures";
import { ExitService } from "../services/exits";
import { assignPay, revealDetail, saveProfile } from "./actions";
import { NoAccess, PILL_BTN, PRIMARY_BTN, PayNav, one, type Search } from "./common";
import { RevealButton } from "./reveal-button";

export const metadata = { title: "Pay details" };
const STATES = ["Andhra Pradesh", "Gujarat", "Karnataka", "Madhya Pradesh", "Maharashtra", "Odisha", "Telangana", "West Bengal", "Other"];
const tri = (v: boolean | null) => (v === null ? "auto" : v ? "yes" : "no");

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const next = one((await searchParams).next);
  const profiles = new ProfileService(ctx);
  if (!profiles.can("read")) return <NoAccess what="Pay details" />;
  let info: Awaited<ReturnType<ProfileService["get"]>>;
  try { info = await profiles.get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const manage = profiles.can("manage"), { person, profile, missing } = info;
  const [history, structures, loans, slips, leave, exits] = await Promise.all([
    new AssignmentService(ctx).history(id), new StructureService(ctx).list(), new LoanService(ctx).list({ filters: { userId: id } }), new PayslipService(ctx).list(id), profiles.leaveBalance(id), new ExitService(ctx).list({ filters: { userId: id } }),
  ]);
  const today = todayIST();
  const current = history.find((h) => h.fromDate <= today) ?? history[0];
  const openExit = exits.rows.find((e) => e.status !== "rejected" && e.status !== "paid");
  const back = next && /^\/app\//.test(next) ? next : "/app/payroll/people";
  const has = profile?.has ?? { pan: false, uan: false, esi: false, bankAccount: false };
  const sealed = (field: "pan" | "uan" | "esi" | "bankAccount", last: string | null | undefined, label: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">{label}</span>
      {has[field] ? (manage ? <RevealButton action={revealDetail} userId={id} field={field} masked={`XXXXXX${last ?? ""}`} /> : <span className="font-mono tabular-nums">XXXXXX{last}</span>) : <span className="text-[var(--ds-on-surface-muted)]">Not added</span>}</div>
  );
  return (
    <>
      <Link href={back} className="mb-2 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">{back.startsWith("/app/payroll/runs") ? "Back to the run" : "Pay and people"}</Link>
      <PageHeader eyebrow={`${person.employeeId}${person.department ? ` · ${person.department}` : ""}`} title={<span className="flex flex-wrap items-center gap-3">{person.name}{person.left ? <ToneBadge label="Left" tone="default" /> : null}</span>} description={person.designation ?? undefined}
        actions={<><Link href={`/app/staff/${id}`} className={PILL_BTN}>Staff record</Link>{manage && !openExit && !person.left ? <Link href={`/app/payroll/exits/new?user=${id}`} className={PILL_BTN}>Start an exit</Link> : null}{openExit ? <Link href={`/app/payroll/exits/${openExit.id}`} className={PRIMARY_BTN}>Open the exit</Link> : null}</>} />
      <PayNav active="people" manager />

      {missing.length ? (
        <section className="mb-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm">
          <p className="mb-2 font-medium">Still missing</p>
          <div className="flex flex-wrap gap-2">{missing.map((m) => <ToneBadge key={m.code} label={m.text} tone="warning" />)}</div>
          {!manage ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">An admin or accountant can fill these in.</p> : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel title="Pay details" className="h-full" action={manage ? <FormModal title="Pay details" description="Leave a private number empty to keep what is stored." icon="teacher" action={saveProfile} hidden={{ userId: id }} trigger={{ label: "Edit", variant: "secondary", size: "sm" }} size="lg"
            values={{ bankName: profile?.bankName, ifsc: profile?.ifsc, payBy: profile?.payBy ?? "bank", regime: profile?.regime ?? "new", state: profile?.state, pfApplies: tri(profile?.pfApplies ?? null), esiApplies: tri(profile?.esiApplies ?? null), ptApplies: tri(profile?.ptApplies ?? null), pfOnFullWages: profile?.pfOnFullWages, skipMonthly: profile ? !profile.paysMonthly : false }}
            fields={[
              { name: "pan", label: "PAN", type: "text", placeholder: has.pan ? `Stored, ends ${profile?.panLast4}` : "ABCDE1234F", section: "Identity" }, { name: "uan", label: "UAN (provident fund)", type: "text", placeholder: has.uan ? `Stored, ends ${profile?.uanLast4}` : undefined },
              { name: "esi", label: "ESI number", type: "text", placeholder: has.esi ? `Stored, ends ${profile?.esiLast4}` : undefined },
              { name: "payBy", label: "Paid by", type: "select", required: true, options: [{ value: "bank", label: "Bank transfer" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }], section: "Bank" },
              { name: "bankAccount", label: "Account number", type: "text", placeholder: has.bankAccount ? `Stored, ends ${profile?.bankLast4}` : undefined }, { name: "ifsc", label: "IFSC", type: "text" }, { name: "bankName", label: "Bank name", type: "text" },
              { name: "regime", label: "Tax regime", type: "select", required: true, options: [{ value: "new", label: "New regime" }, { value: "old", label: "Old regime" }], section: "Deductions" },
              { name: "state", label: "State (professional tax)", type: "select", options: STATES.map((s) => ({ value: s, label: s })), hint: "Empty uses the school's state." },
              ...(["pfApplies", "esiApplies", "ptApplies"] as const).map((n) => ({ name: n, label: { pfApplies: "Provident fund", esiApplies: "ESI", ptApplies: "Professional tax" }[n], type: "select" as const, required: true, options: [{ value: "auto", label: "As the school decided" }, { value: "yes", label: "Applies" }, { value: "no", label: "Does not apply" }] })),
              { name: "pfOnFullWages", label: "PF on full wages", type: "checkbox", placeholder: "Pay PF on full wages, not up to the ceiling" }, { name: "skipMonthly", label: "Monthly run", type: "checkbox", placeholder: "Leave out of the monthly run (extra pay only)" },
            ]} /> : null}>
            {profile ? (
              <div className="divide-y divide-white/[0.06]">
                {sealed("pan", profile.panLast4, "PAN")}{sealed("uan", profile.uanLast4, "UAN")}{sealed("esi", profile.esiLast4, "ESI number")}{sealed("bankAccount", profile.bankLast4, "Bank account")}
                <div className="flex justify-between py-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">Paid by</span><span>{{ bank: `Bank${profile.ifsc ? `, ${profile.ifsc}` : ""}`, cash: "Cash", cheque: "Cheque" }[profile.payBy]}</span></div>
                <div className="flex justify-between py-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">Tax regime, state</span><span>{profile.regime === "new" ? "New" : "Old"} · {profile.state ?? "School's state"}</span></div>
              </div>
            ) : <EmptyLine title="No pay details yet." hint="PAN, bank account and which deductions apply." action={manage ? <FormModal title="Pay details" icon="teacher" action={saveProfile} hidden={{ userId: id }} trigger={{ label: "Add pay details" }} fields={[{ name: "pan", label: "PAN", type: "text" }, { name: "bankAccount", label: "Account number", type: "text" }, { name: "ifsc", label: "IFSC", type: "text" }, { name: "payBy", label: "Paid by", type: "select", required: true, options: [{ value: "bank", label: "Bank transfer" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }] }]} /> : undefined} />}
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Structure and pay" className="h-full" action={manage ? <FormModal title="Change pay" description="A new line in the pay history. A future date waits for its month." icon="money" action={assignPay} hidden={{ userId: id }} trigger={{ label: current ? "Change pay" : "Set up pay", variant: "secondary", size: "sm" }}
            values={{ structureId: current?.structureId, grossPaise: current ? Number(current.grossPaise) : undefined, fromDate: today }}
            fields={[{ name: "structureId", label: "Structure", type: "select", required: true, options: structures.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })) }, { name: "grossPaise", label: "Gross a month", type: "money", required: true }, { name: "fromDate", label: "From", type: "date", required: true }, { name: "hourlyPaise", label: "Hourly rate (if paid by the hour)", type: "money" }, { name: "reason", label: "Reason", type: "text" }]} /> : null}>
            {history.length === 0 ? <EmptyLine title="No pay set up." hint="Pick a structure and a gross pay." /> : (
              <Timeline items={history.map((h) => ({ at: h.fromDate, title: `${paise(Number(h.grossPaise))} a month${h.hourlyPaise ? `, ${paise(Number(h.hourlyPaise))} an hour` : ""}`, meta: `${h.structure ?? "Structure"}${h.reason ? ` · ${h.reason}` : ""}${h.fromDate > today ? " · starts later" : ""}`, tone: h.fromDate > today ? "info" : undefined }))} />
            )}
            {leave.length ? <p className="mt-4 text-sm text-[var(--ds-on-surface-muted)]">Leave that could be paid out: {leave.map((l) => `${l.name} ${l.days} days`).join(", ")}.</p> : null}
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Loans" action={<Link href="/app/payroll/loans" className="text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">All loans</Link>}>
            {loans.rows.length === 0 ? <EmptyLine title="No loans." /> : <ul className="flex flex-col gap-2">{loans.rows.map((l) => <li key={l.id}><Link href={`/app/payroll/loans?item=${l.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-sm hover:bg-white/[0.04]"><span>{paise(Number(l.amountPaise))}, {l.reason}</span><span className="flex items-center gap-3"><Money paise={l.balancePaise} /><StateBadge state={l.status === "active" ? "open" : l.status === "closed" ? "closed" : l.status} /></span></Link></li>)}</ul>}
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Payslips">
            {slips.length === 0 ? <EmptyLine title="No payslips yet." hint="They appear once a pay run with this person is approved." /> : <ul className="flex flex-col">{slips.slice(0, 12).map((s) => <li key={s.itemId} className="flex min-h-11 items-center justify-between gap-3 px-2 text-sm"><span><a href={`/app/payroll/files/payslip?item=${s.itemId}`} className="underline">{s.label}</a><span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{s.payslipNo}</span></span><Money paise={s.netPaise} /></li>)}</ul>}
          </Panel>
        </div>
      </div>
      <p className="mt-6 text-xs text-[var(--ds-on-surface-muted)]">Joined {person.joiningDate ? shortDate(person.joiningDate) : "on a date not recorded"}.</p>
    </>
  );
}
