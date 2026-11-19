"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";
import { formatMoneyCompact } from "@smw/ui/money";

/** Money collected per month of the financial year (rupees in, compact rupees on the axis). */
export function RevenueChart({ data }: { data: { month: string; rupees: number }[] }) {
  return <TrendArea data={data} xKey="month" series={[{ key: "rupees", label: "Collected", accent: true }]} format={(v) => formatMoneyCompact(v)} />;
}
