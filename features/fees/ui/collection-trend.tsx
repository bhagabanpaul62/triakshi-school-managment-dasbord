"use client";

import { useState } from "react";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { TrendArea } from "@smw/ui/kit/TrendArea";
import { Panel } from "@smw/ui/kit/Panel";
import { formatMoneyCompact } from "@smw/ui/money";
import { whole } from "./fields";

type Point = { key: string; label: string; paise: number };

/** Money collected over time. Both ranges arrive from the server; the switch is instant. */
export function CollectionTrend({ days, months }: { days: Point[]; months: Point[] }) {
  const [unit, setUnit] = useState<"day" | "month">("day");
  const points = unit === "day" ? days : months;
  const total = points.reduce((s, p) => s + p.paise, 0);
  const data = points.map((p) => ({ label: p.label, collected: p.paise / 100 }));
  return (
    <Panel title="Collection" action={<SegmentedControl size="sm" label="Range" value={unit} onChange={setUnit}
      options={[{ value: "day", label: "30 days" }, { value: "month", label: "12 months" }]} />}>
      <p className="mb-4 text-[26px] font-medium tabular-nums tracking-tight">{whole(total)}
        <span className="ml-2 text-xs font-normal text-[var(--ds-on-surface-muted)]">collected in {unit === "day" ? "the last 30 days" : "the last 12 months"}</span>
      </p>
      {total === 0
        ? <p className="py-10 text-center text-sm text-[var(--ds-on-surface-muted)]">No payments in this period yet.</p>
        : <TrendArea data={data} xKey="label" series={[{ key: "collected", label: "Collected", accent: true }]} format={(v) => formatMoneyCompact(v)} height={220} />}
    </Panel>
  );
}
