"use client";

import { TrendArea, type TrendSeries } from "../dashboard/kit/TrendArea";
import { formatMoneyCompact } from "../../lib/hooks/useCurrency";

export interface MoneyTrendProps {
  /** One row per month: `label` plus paise per series key. */
  rows: ({ label: string } & Record<string, number | string>)[];
  series: TrendSeries[];
  height?: number | "fill";
}

/** Money over time. Takes paise and plain data, so server pages can render it. */
export function MoneyTrend({ rows, series, height = 220 }: MoneyTrendProps) {
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(series.map((s) => [s.key, Number(r[s.key] ?? 0) / 100])) }));
  return <TrendArea data={data} xKey="label" series={series} height={height} format={(v) => formatMoneyCompact(v)} />;
}
