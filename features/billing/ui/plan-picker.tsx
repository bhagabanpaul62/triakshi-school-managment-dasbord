"use client";

import { useState } from "react";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { paise } from "@smw/ui/format";
import { CheckoutButton } from "./checkout-button";
import { startCheckout } from "./actions";

export interface PlanCard {
  key: string; name: string; studentCap: number; priceAnnualPaise: number; priceMonthlyPaise: number; modules: string[];
}

/** Same rounding as the invoice (GstCalculator): 18%, half up to the paisa. */
const gstOf = (p: number) => Math.floor((p * 18 + 50) / 100);

/** Annual / monthly switch and one card per public plan. Prices come from the database; the card shows the GST-inclusive total you will pay. */
export function PlanPicker({ plans, currentKey, currentInterval, recommendedKey, students, canManage, onTrial = false }: {
  onTrial?: boolean;
  plans: PlanCard[]; currentKey: string | null; currentInterval: "annual" | "monthly" | null; recommendedKey: string | null; students: number; canManage: boolean;
}) {
  const [interval, setInterval] = useState<"annual" | "monthly">(currentInterval ?? "annual");
  if (!plans.length) return <p className="py-6 text-sm text-[var(--ds-on-surface-muted)]">Plans are not available right now. Contact support to change your plan.</p>;
  const currentCap = plans.find((p) => p.key === currentKey)?.studentCap ?? null;
  // Honest saving: the smallest saving across plans, only when annual really is cheaper.
  const saving = Math.min(...plans.map((p) => (p.priceMonthlyPaise > 0 ? 1 - p.priceAnnualPaise / (p.priceMonthlyPaise * 12) : 0)));
  const savePct = Math.floor(saving * 100);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl label="Billing interval" value={interval} onChange={setInterval}
          options={[{ value: "annual", label: savePct > 0 ? `Annual · save ${savePct}%` : "Annual" }, { value: "monthly", label: "Monthly" }]} />
        <p className="text-xs text-[var(--ds-on-surface-muted)]">Totals include 18% GST. Invoices carry your GSTIN.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const price = interval === "annual" ? p.priceAnnualPaise : p.priceMonthlyPaise;
          const gst = gstOf(price);
          const current = p.key === currentKey;
          const tooSmall = students > p.studentCap;
          const downgrade = !current && currentCap != null && p.studentCap < currentCap;
          const label = current && !onTrial ? "Renew" : onTrial ? `Choose ${p.name}` : currentCap == null ? `Choose ${p.name}` : downgrade ? `Switch to ${p.name}` : `Upgrade to ${p.name}`;
          return (
            <Panel key={p.key} title={p.name} className="h-full bg-white/[0.035]"
              action={current ? <ToneBadge label={onTrial ? "Your trial plan" : "Current plan"} tone="info" /> : p.key === recommendedKey ? <ToneBadge label="Fits your school" tone="success" /> : null}>
              <p className="text-[30px] font-medium leading-none tabular-nums tracking-tight">
                {paise(price + gst)}<span className="ml-1.5 text-sm font-normal text-[var(--ds-on-surface-muted)]">/ {interval === "annual" ? "year" : "month"}</span>
              </p>
              <p className="mt-2 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{paise(price)} + {paise(gst)} GST{interval === "annual" ? ` · about ${paise(Math.round((price + gst) / 12))} a month` : ""}</p>
              <p className="mt-4 text-sm text-[var(--ds-on-surface-variant)]">Up to {p.studentCap.toLocaleString("en-IN")} students</p>
              {p.modules.length ? <p className="mt-2 text-xs leading-relaxed text-[var(--ds-on-surface-muted)]">{p.modules.slice(0, 8).join(" · ")}{p.modules.length > 8 ? ` · +${p.modules.length - 8} more` : ""}</p> : null}
              {canManage ? (
                <div className="mt-5 flex flex-col items-start gap-2">
                  <CheckoutButton action={startCheckout} values={{ planKey: p.key, interval }} disabled={tooSmall} label={label} variant={current && !onTrial ? "secondary" : "default"} />
                  {tooSmall ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Fits up to {p.studentCap.toLocaleString("en-IN")} students. You have {students.toLocaleString("en-IN")}.</span>
                    : downgrade ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Starts at your next renewal. Nothing to pay now.</span> : null}
                </div>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
