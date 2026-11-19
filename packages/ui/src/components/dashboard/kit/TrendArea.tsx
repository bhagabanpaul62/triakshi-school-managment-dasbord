"use client";

import { useId } from "react";
import { useReducedMotion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "../widgets/WidgetPrimitives";

export type TrendSeries = {
  key: string;
  label: string;
  /** The one series the chart is about gets the accent; comparisons stay neutral (and usually dashed). */
  accent?: boolean;
  dashed?: boolean;
};

const AXIS_TICK = { fill: "var(--ds-on-surface-muted)", fontSize: 11 };

/**
 * Hero time-series (the "Total Profit" / "Analytics" charts): time on x, y from zero, dashed faint grid, an
 * accent area for the subject and a dashed neutral line for the comparison, one mount animation.
 */
export function TrendArea({
  data,
  xKey,
  series,
  height = 220,
  format,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: TrendSeries[];
  /** A pixel height, or "fill" to take the parent's height (parent needs a definite height or flex-1). */
  height?: number | "fill";
  format?: (value: number) => string;
}) {
  const reduce = useReducedMotion();
  const gradientId = useId().replace(/:/g, "");
  // Size the y axis to its widest label: a fixed width clipped "180.0K" and pushed the leading characters out.
  const top = Math.max(0, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0)));
  const yWidth = Math.min(96, Math.max(40, String(format ? format(top) : top).length * 7 + 14));

  return (
    <div style={height === "fill" ? undefined : { height }} className={height === "fill" ? "h-full min-h-[220px] w-full" : "w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ds-color-primary-400)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--ds-color-primary-400)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 5" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} padding={{ left: 8, right: 8 }} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={yWidth}
            domain={[0, "auto"]}
            tickFormatter={(v: number) => (format ? format(v) : String(v))}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.18)", strokeDasharray: "3 4" }}
            content={<ChartTooltip formatter={(v) => (format ? format(v) : String(v))} />}
          />
          {/* Comparisons first so the accent area paints on top. */}
          {[...series].sort((a, b) => Number(a.accent) - Number(b.accent)).map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.accent ? "var(--ds-color-primary-400)" : "rgba(255,255,255,0.32)"}
              strokeWidth={s.accent ? 2 : 1.5}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              fill={s.accent ? `url(#${gradientId})` : "transparent"}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: s.accent ? "var(--ds-color-primary-400)" : "rgba(255,255,255,0.6)" }}
              isAnimationActive={!reduce}
              animationDuration={700}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
