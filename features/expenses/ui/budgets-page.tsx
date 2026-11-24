import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { VarianceBar } from "@smw/ui/finance/VarianceBar";
import { paise, tilePaise } from "@smw/ui/format";
import { BudgetService, LookupService } from "../service";
import { copyBudget, deleteBudget, importBudget, saveBudget } from "./actions";
import { NoAccess, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Budgets" };
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export default async function BudgetsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Budgets" who="accountants and admins" />;
  const sp = await searchParams, manage = can(ctx, "manage"), now = fyOf(todayIST());
  const fy = one(sp.fy) || now, y = +fy.slice(0, 4);
  const years = [y - 1, y, y + 1].map((n) => `${n}-${String((n + 1) % 100).padStart(2, "0")}`);
  const [grid, accounts, centres] = await Promise.all([new BudgetService(ctx).grid(fy), new LookupService(ctx).accounts(), new LookupService(ctx).centres()]);
  const used = grid.reduce((s, b) => s + b.actualPaise + b.committedPaise, 0), cap = grid.reduce((s, b) => s + b.totalPaise, 0);
  const fields = (b?: (typeof grid)[number]): Field[] => [
    { name: "accountId", label: "Account", type: "select", required: true, options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), section: "What" },
    ...(centres.length ? [{ name: "costCentreId", label: "Cost centre", type: "select" as const, options: centres.map((c) => ({ value: c.id, label: c.name })) }] : []),
    { name: "onOver", label: "When a bill goes over", type: "select", required: true, options: [{ value: "warn", label: "Warn, and let it through" }, { value: "block", label: "Stop it until an approver agrees" }] },
    ...(b ? [] : [{ name: "yearlyPaise", label: "Whole year (spread evenly)", type: "money" as const, hint: "Or fill the months below instead.", section: "How much" }]),
    ...MONTHS.map((m, i) => ({ name: `m${i}`, label: m, type: "money" as const, section: b ? "Each month" : undefined })),
  ];
  const values = (b: (typeof grid)[number]) => ({ accountId: b.accountId, costCentreId: b.costCentreId, onOver: b.onOver, ...Object.fromEntries(b.months.map((m, i) => [`m${i}`, m])) });

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Budgets" description={`What each account may spend in ${fy}, month by month, against what is spent or promised.`}
        actions={manage ? <>
          <FormModal title="Import budgets" icon="upload" fields={[{ name: "file", label: "Sheet (.xlsx or .csv)", type: "file", accept: ".xlsx,.csv", required: true, hint: "Columns: account_code, cost_centre (optional), then apr to mar in rupees, or one year column." }]} hidden={{ fy }} action={importBudget} submitLabel="Import" trigger={{ label: "Import sheet", variant: "ghost", plus: false }} />
          <ActionButton label="Copy last year's spending" variant="secondary" action={copyBudget} values={{ fy }} confirm={{ title: "Start from last year?", body: "Makes a budget for every account that had spending last year, month by month. Budgets you already set are left as they are.", confirmLabel: "Copy" }} />
          <FormModal title="Set a budget" icon="chart" size="xl" fields={fields()} hidden={{ fy }} values={{ onOver: "warn" }} action={saveBudget} submitLabel="Save budget" trigger={{ label: "Set a budget", plus: true }} />
        </> : null} />
      <SectionNav ctx={ctx} current="/app/expenses/budgets" />
      <div role="tablist" aria-label="Financial year" className="mb-4 flex gap-1">
        {years.map((v) => <Link key={v} role="tab" aria-selected={v === fy} href={`/app/expenses/budgets?fy=${v}`} className={`rounded-full px-4 py-2 text-sm hover:bg-white/[0.06] ${v === fy ? "bg-white/[0.1]" : "text-[var(--ds-on-surface-muted)]"}`}>{v}</Link>)}
      </div>
      {grid.length ? (
        <>
          <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">{tilePaise(used)} spent or promised of {tilePaise(cap)} budgeted.</p>
          <div className="overflow-x-auto rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
            <table className="w-full min-w-[56rem] text-sm">
              <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 pr-3 font-normal">Account</th>{MONTHS.map((m) => <th key={m} className="px-1 py-2 text-right font-normal">{m}</th>)}<th className="w-48 py-2 pl-3 font-normal">Used</th><th /></tr></thead>
              <tbody>
                {grid.map((b) => (
                  <tr key={b.id} className="border-t border-white/[0.06] align-top">
                    <td className="py-2 pr-3"><span className="block">{b.accountName}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{[b.centreName, b.onOver === "block" ? "Stops when over" : "Warns when over"].filter(Boolean).join(" · ")}</span></td>
                    {b.months.map((m, i) => <td key={i} className="px-1 py-2 text-right tabular-nums"><span className="block">{m ? tilePaise(m) : "-"}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{b.actualMonths[i] ? tilePaise(b.actualMonths[i]!) : ""}</span></td>)}
                    <td className="py-2 pl-3"><VarianceBar actual={b.actualPaise + b.committedPaise} budget={b.totalPaise} label={`${paise(b.leftPaise)} left`} /></td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      {manage ? <>
                        <FormModal title={`Edit budget: ${b.accountName}`} icon="chart" size="xl" fields={fields(b)} values={values(b)} hidden={{ fy }} action={saveBudget} trigger={{ label: "Edit", variant: "ghost", plus: false }} />
                        <ActionButton label="Remove" variant="ghost" action={deleteBudget} values={{ id: b.id }} confirm={{ title: "Remove this budget?", body: "Spending is not affected. Bills for this account are no longer checked against a budget.", confirmLabel: "Remove", danger: true }} />
                      </> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Each month shows the budget, with what was actually posted underneath. "Used" counts posted spending plus bills waiting or unpaid.</p>
        </>
      ) : (
        <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8"><WidgetEmptyState title={`No budgets for ${fy}`} description={manage ? "Set one for rent, electricity or repairs. A bill that goes over gets a warning, or waits for an approver if you choose to stop it. You can also start from last year's spending." : "An accountant or admin sets budgets."} /></div>
      )}
    </>
  );
}
