import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { paise, shortDate } from "@smw/ui/format";
import { UrlTabs } from "@smw/feature-finance/ui/url-tabs";
import { BANK_COLUMNS, BANK_COLUMN_LABEL } from "../config";
import { PayConfigService } from "../services/profiles";
import { RateService, type RateRow } from "../services/rates";
import { REMIT_LABEL, RemittanceService } from "../services/remittances";
import { overrideRate, recordRemittance, removeRateOverride, savePayConfig } from "./actions";
import { InlineForm } from "@smw/feature-finance/ui/inline-form";
import { NoAccess, PayNav, monthName, one, type Search } from "./common";

export const metadata = { title: "Statutory" };
const CONFIDENCE_TONE = { high: "success", medium: "default", low: "warning" } as const;
const STATES = ["Andhra Pradesh", "Gujarat", "Karnataka", "Madhya Pradesh", "Maharashtra", "Odisha", "Telangana", "West Bengal"];

function show(r: RateRow): string {
  const v = r.shown;
  if (typeof v === "number") return r.key.endsWith("_bp") ? `${v / 100}%` : /ceiling|max|min|std|paise/.test(r.key) ? paise(v) : String(v);
  if (Array.isArray(v)) return `${v.length} slab${v.length === 1 ? "" : "s"}`;
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === "number" ? (x > 1000 ? paise(x) : x) : String(x)}`).join(", ");
  return String(v);
}

export default async function StatutoryPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const rates = new RateService(ctx);
  if (!rates.can("read")) return <NoAccess what="Statutory rules" />;
  const tab = one((await searchParams).tab) ?? "rates", manage = rates.can("manage");
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Statutory" description="The rules behind provident fund, ESI, professional tax and income tax: each with where it came from and how sure we are. Not legal advice." />
      <PayNav active="statutory" manager />
      <div className="mb-4"><UrlTabs label="Statutory sections" value={tab} tabs={[{ id: "rates", label: "Rates" }, { id: "remittances", label: "Payments due" }, { id: "settings", label: "Settings" }]} /></div>
      {tab === "rates" ? <Rates rows={await rates.list()} manage={manage} /> : null}
      {tab === "remittances" ? <Remittances svc={new RemittanceService(ctx)} manage={manage} /> : null}
      {tab === "settings" ? <Settings svc={new PayConfigService(ctx)} manage={manage} /> : null}
    </>
  );
}

function Rates({ rows, manage }: { rows: RateRow[]; manage: boolean }) {
  return (
    <>
      <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">A rule your school sets beats the built-in one. A month with no rule asks you to type the amount; nothing is guessed. Amounts are in paise and shares in basis points (12% is 1200) when you set your own.</p>
      <div className="overflow-x-auto rounded-2xl bg-white/[0.03]">
        <table className="w-full min-w-[720px] text-sm"><caption className="sr-only">Statutory rates in force today</caption>
          <thead className="bg-[var(--ds-surface-container-high)]"><tr>{["Rule", "Value", "From", "Source", "How sure", ""].map((h) => <th key={h} scope="col" className="px-4 py-3 text-left font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={`${r.key}${r.state}${i}`} className="border-t border-white/[0.05]">
              <th scope="row" className="px-4 py-2.5 text-left font-normal">{r.label}{r.state ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{r.state}</span> : null}</th>
              <td className="px-4 py-2.5 tabular-nums">{show(r)}</td><td className="px-4 py-2.5 whitespace-nowrap">{shortDate(r.from)}</td>
              <td className="max-w-[240px] truncate px-4 py-2.5">{r.source.startsWith("http") ? <a href={r.source} rel="noreferrer" className="underline" title={r.note}>{r.source.replace(/^https?:\/\/(www\.)?/, "")}</a> : r.source}</td>
              <td className="px-4 py-2.5">{r.overridden ? <ToneBadge label="Your own" tone="info" /> : <ToneBadge label={r.confidence} tone={CONFIDENCE_TONE[r.confidence]} />}</td>
              <td className="px-4 py-2.5 text-right">{manage ? (r.overridden && r.id ? <ActionButton action={removeRateOverride} values={{ id: r.id }} label="Use built-in" variant="ghost" confirm={{ title: "Go back to the built-in rate?", body: "Runs not yet approved use it from now on. Approved runs keep what they used." }} />
                : <FormModal title={`Set your own: ${r.label}`} description="From the date you pick, your value is used instead of the built-in one." icon="settings" action={overrideRate} hidden={{ key: r.key, ...(r.state ? { state: r.state } : {}) }} trigger={{ label: "Set own", variant: "ghost", size: "sm" }} submitLabel="Save"
                  fields={[{ name: "value", label: "Value (as JSON)", type: "text", required: true, hint: `Now: ${JSON.stringify(r.value).slice(0, 80)}` }, { name: "fromDate", label: "From", type: "date", required: true }, { name: "reason", label: "Where this comes from", type: "text", required: true }]} />) : null}</td>
            </tr>))}</tbody></table>
      </div>
    </>
  );
}

async function Remittances({ svc, manage }: { svc: RemittanceService; manage: boolean }) {
  const [rows, paid] = await Promise.all([svc.list(), svc.payments()]);
  if (!rows.length) return <EmptyLine title="Nothing is owed to the offices yet." hint="Once a pay run is approved, what is due for PF, ESI, professional tax and TDS shows here with its date." action={<Link href="/app/payroll/runs" className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm">Open the pay runs</Link>} />;
  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={`${r.key}${r.month}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
            <span className="min-w-0"><span className="block">{REMIT_LABEL[r.key]}, {monthName(r.month)}</span><span className={`block text-xs ${r.late ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"}`}>{r.outstandingPaise > 0 ? `${r.late ? "Was due" : "Due"} ${shortDate(r.dueDate)}` : "Paid"}</span></span>
            <span className="flex flex-wrap items-center gap-3"><span className="text-right text-xs text-[var(--ds-on-surface-muted)]">Owed <Money paise={r.duePaise} size="sm" /> · paid <Money paise={r.paidPaise} size="sm" /></span><Money paise={r.outstandingPaise} tone={r.late ? "danger" : "default"} />
              {manage && r.outstandingPaise > 0 ? <FormModal title={`Record payment: ${REMIT_LABEL[r.key]}`} description={`For ${monthName(r.month)}. At most ${paise(r.outstandingPaise)}.`} icon="money" action={recordRemittance} hidden={{ key: r.key, month: r.month }} trigger={{ label: "Record payment", variant: "secondary", size: "sm" }} submitLabel="Record" values={{ amountPaise: r.outstandingPaise }}
                fields={[{ name: "amountPaise", label: "Amount paid", type: "money", required: true }, { name: "paidOn", label: "Paid on", type: "date" }, { name: "reference", label: "Challan or reference", type: "text" }]} /> : null}</span>
          </li>
        ))}
      </ul>
      {paid.length ? <Panel title="Payments made"><ul className="flex flex-col gap-1 text-sm">{paid.slice(0, 20).map((p) => <li key={p.id} className="flex justify-between gap-3"><span>{REMIT_LABEL[p.key as keyof typeof REMIT_LABEL]}, {monthName(p.month)} <span className="text-xs text-[var(--ds-on-surface-muted)]">paid {shortDate(p.paidOn)}{p.reference ? `, ${p.reference}` : ""}</span></span><Money paise={Number(p.amountPaise)} /></li>)}</ul></Panel> : null}
    </div>
  );
}

async function Settings({ svc, manage }: { svc: PayConfigService; manage: boolean }) {
  const c = await svc.get();
  if (!manage) return <EmptyLine title="Only people who run payroll can change these." />;
  return (
    <InlineForm action={savePayConfig} submitLabel="Save settings" values={{ ...c, bankColumns: c.bankColumns }}
      fields={[
        { name: "pf", label: "Provident fund", type: "checkbox", placeholder: "The school pays PF" }, { name: "esi", label: "ESI", type: "checkbox", placeholder: "The school is covered by ESI" },
        { name: "pt", label: "Professional tax", type: "checkbox", placeholder: "The school deducts professional tax" }, { name: "lwf", label: "Labour welfare fund", type: "checkbox", placeholder: "The school pays the labour welfare fund" }, { name: "tds", label: "Income tax", type: "checkbox", placeholder: "The school deducts income tax from salaries" },
        { name: "state", label: "School's state", type: "select", options: STATES.map((s) => ({ value: s, label: s })), hint: "Used for professional tax when a person has no state of their own." },
        { name: "lopBasis", label: "An unpaid day is worth", type: "select", required: true, options: [{ value: "calendar", label: "Gross divided by the days of that month" }, { value: "fixed30", label: "Gross divided by 30" }] },
        { name: "dayDivisor", label: "Leave and notice are paid at gross divided by", type: "number", min: 20, max: 31 },
        { name: "bankColumns", label: "Columns of the bank file", type: "multiselect", options: BANK_COLUMNS.map((k) => ({ value: k, label: BANK_COLUMN_LABEL[k] })) },
      ]} />
  );
}
