"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";

/** Present % per day. Client side because the axis formatter is a function, which a server page cannot pass down. */
export function AttendanceTrend({ data }: { data: { label: string; pct: number }[] }) {
  return <TrendArea data={data} xKey="label" series={[{ key: "pct", label: "Present %", accent: true }]} format={(v) => `${v}%`} />;
}
