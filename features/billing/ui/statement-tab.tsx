import type { BillingService } from "@smw/billing";
import { todayIST } from "@smw/feature-kit/money";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { periodParams, presetPeriod, parsePeriod } from "@smw/ui/finance/logic";

const columns: Column[] = [
  { key: "at", label: "Date", type: "date" },
  { key: "ref", label: "Document", type: "mono" },
  { key: "text", label: "Details", hideOnMobile: true },
  { key: "debitPaise", label: "Billed", type: "money" },
  { key: "creditPaise", label: "Paid or credited", type: "money" },
  { key: "balancePaise", label: "Balance", type: "money" },
];
const LINK = "inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function StatementTab({ svc, params }: { svc: BillingService; params: Record<string, string | string[] | undefined> }) {
  const today = todayIST();
  const fallback = presetPeriod("this_fy", today);
  const period = one(params.period) ? parsePeriod({ period: one(params.period), from: one(params.from), to: one(params.to) }, today) : fallback;
  const st = await svc.statement(period);
  const pdf = new URLSearchParams(Object.entries(periodParams(period)).filter(([, v]) => v) as [string, string][]).toString();
  const rows = st.rows.map((r, i) => ({ ...r, id: `${i}`, debitPaise: r.debitPaise || null, creditPaise: r.creditPaise || null }));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker today={today} presets={["this_fy", "last_fy", "this_quarter", "last_quarter"]} fallback={fallback} />
        <a href={`/app/billing/statement/pdf?${pdf}`} className={LINK}>Download statement (PDF)</a>
      </div>
      <KeyTotals items={[
        { label: "Opening balance", paise: st.openingPaise },
        { label: "Billed", paise: st.debitPaise },
        { label: "Paid or credited", paise: st.creditPaise },
        { label: st.closingPaise < 0 ? "Credit with us" : "You owe", paise: Math.abs(st.closingPaise), strong: true, tone: st.closingPaise > 0 ? "warning" : st.closingPaise < 0 ? "success" : "default" },
      ]} />
      <DataTable columns={columns} rows={rows} total={rows.length} page={1} pageCount={1} searchable={false}
        empty={{ title: "Nothing happened in this period.", description: "Pick another period above to see earlier invoices and payments." }} />
    </div>
  );
}
