"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "../motion";
import { cn } from "../../../lib/utils";

export type HatchedBar = {
  key: string;
  label: string;
  value: number;
  /** Text for the hover/highlight bubble; defaults to the raw value. */
  display?: string;
  href?: string;
};

/**
 * Vertical bars standing in hatched wells (the "Attendance Rate" chart). Every bar is a share of the
 * same maximum, so the empty hatch shows what is left. The busiest bar (or the hovered one) takes the
 * accent; the rest stay neutral, so the chart answers one question at a glance.
 */
export function HatchedBars({
  items,
  max,
  height = 200,
  className,
}: {
  items: HatchedBar[];
  /** Scale ceiling; defaults to the largest value. */
  max?: number;
  height?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = Math.max(1, max ?? Math.max(...items.map((i) => i.value), 1));
  const peak = items.reduce((best, item, i) => (item.value > (items[best]?.value ?? -Infinity) ? i : best), 0);
  const active = hover ?? peak;

  return (
    <div className={cn("flex items-stretch justify-center gap-2.5", className)} style={{ height }}>
      {items.map((item, i) => {
        const pct = Math.max(item.value > 0 ? 6 : 0, (item.value / ceiling) * 100);
        const isActive = i === active;
        const bar = (
          <div className="flex h-full flex-col items-center gap-2">
            <div className="relative w-full min-w-[14px] flex-1 overflow-hidden rounded-2xl bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_2px,transparent_2px_8px)]">
              <motion.div
                className={cn(
                  "absolute inset-x-0 bottom-0 rounded-2xl transition-colors duration-150",
                  isActive ? "bg-[var(--ds-color-primary-400)]" : "bg-white/[0.16]",
                )}
                initial={reduce ? false : { height: 0 }}
                animate={{ height: `${pct}%` }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.05 + i * 0.045 }}
              />
              {isActive ? (
                <span className="absolute inset-x-0 top-1.5 text-center text-[11px] font-medium tabular-nums text-[var(--ds-on-surface)]">
                  {item.display ?? item.value}
                </span>
              ) : null}
            </div>
            <span
              className={cn(
                "max-w-full truncate text-[11px] transition-colors duration-150",
                isActive ? "text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]",
              )}
              title={item.label}
            >
              {item.label}
            </span>
          </div>
        );
        const shared = {
          onMouseEnter: () => setHover(i),
          onMouseLeave: () => setHover(null),
          onFocus: () => setHover(i),
          onBlur: () => setHover(null),
          // Capped so two or three bars stand as bars, not as two slabs across the whole panel.
          className: "min-w-0 max-w-[104px] flex-1 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] rounded-2xl",
        };
        return item.href ? (
          <Link key={item.key} href={item.href} aria-label={`${item.label}: ${item.display ?? item.value}`} {...shared}>
            {bar}
          </Link>
        ) : (
          <div key={item.key} {...shared}>
            {bar}
          </div>
        );
      })}
    </div>
  );
}
