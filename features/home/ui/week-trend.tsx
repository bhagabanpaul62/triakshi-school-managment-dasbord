"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";

/** Percent present per marked day. A client file because the chart's formatter is a function. */
export function WeekTrend({ points }: { points: { label: string; present: number }[] }) {
  return <TrendArea data={points} xKey="label" series={[{ key: "present", label: "Present", accent: true }]} format={(v) => `${Math.round(v)}%`} height={200} />;
}
