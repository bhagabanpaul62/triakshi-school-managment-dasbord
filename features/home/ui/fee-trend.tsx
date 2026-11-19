"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";
import { formatMoneyCompact } from "@smw/ui/money";
import { paise } from "@smw/ui/format";

/** Money collected per month. Drawn only from the payments the fees module reports. */
export function FeeTrend({ points }: { points: { label: string; paise: number }[] }) {
  const total = points.reduce((s, p) => s + p.paise, 0);
  return (
    <>
      <p className="mb-4 text-[26px] font-medium tabular-nums tracking-tight">
        {paise(total)}
        <span className="ml-2 text-xs font-normal text-[var(--ds-on-surface-muted)]">collected in the last {points.length} months</span>
      </p>
      <TrendArea
        data={points.map((p) => ({ label: p.label, collected: p.paise / 100 }))}
        xKey="label"
        series={[{ key: "collected", label: "Collected", accent: true }]}
        format={(v) => formatMoneyCompact(v)}
        height={220}
      />
    </>
  );
}
