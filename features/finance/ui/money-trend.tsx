"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";

const compact = (rupees: number) => (rupees >= 100_000 ? `${(rupees / 100_000).toFixed(1)}L` : rupees >= 1000 ? `${(rupees / 1000).toFixed(0)}K` : String(rupees));

/** Twelve months of money in against money out. */
export function MoneyTrend({ months }: { months: { month: string; inPaise: number; outPaise: number }[] }) {
  const data = months.map((m) => ({ label: new Date(`${m.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), In: m.inPaise / 100, Out: m.outPaise / 100 }));
  return <TrendArea data={data} xKey="label" series={[{ key: "In", label: "Money in", accent: true }, { key: "Out", label: "Money out", dashed: true }]} format={compact} height={240} />;
}
