"use client";

import { TrendArea } from "@smw/ui/kit/TrendArea";

/** Visits and enquiries per day. A client file because the chart's formatter is a function. */
export function VisitsTrend({ points }: { points: { day: string; views: number; enquiries: number }[] }) {
  return <TrendArea data={points} xKey="day" series={[{ key: "views", label: "Visits", accent: true }, { key: "enquiries", label: "Enquiries", dashed: true }]} format={(n) => n.toLocaleString("en-IN")} />;
}
