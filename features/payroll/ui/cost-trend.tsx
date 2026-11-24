"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";

const compact = (rupees: number) => (rupees >= 100_000 ? `${(rupees / 100_000).toFixed(1)}L` : rupees >= 1000 ? `${(rupees / 1000).toFixed(0)}K` : String(rupees));

/** What the school paid in salaries and employer contributions, month by month. */
export function CostTrend({ months }: { months: { month: string; costPaise: number }[] }) {
  const data = months.map((m) => ({ label: new Date(`${m.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), Cost: m.costPaise / 100 }));
  return <TrendArea data={data} xKey="label" series={[{ key: "Cost", label: "Salary cost", accent: true }]} format={compact} height={220} />;
}
