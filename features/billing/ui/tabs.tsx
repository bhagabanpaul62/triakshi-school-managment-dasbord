import Link from "next/link";

export const BILLING_TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "credits", label: "Credits and notes" },
  { id: "statement", label: "Statement" },
] as const;
export type BillingTab = (typeof BILLING_TABS)[number]["id"];

/** Link tabs: the address says which one is open, so a refresh, a back button and a shared link all land in the same place. */
export function BillingTabs({ active, counts = {} }: { active: BillingTab; counts?: Partial<Record<BillingTab, number>> }) {
  return (
    <nav aria-label="Billing sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3">
      {BILLING_TABS.map((t) => {
        const on = t.id === active;
        const n = counts[t.id];
        return (
          <Link key={t.id} href={`/app/billing?tab=${t.id}`} scroll={false} aria-current={on ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] ${on ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.05]"}`}>
            {t.label}
            {n ? <span className="rounded-full bg-[var(--ds-color-warning-500)]/20 px-2 text-xs tabular-nums">{n}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
