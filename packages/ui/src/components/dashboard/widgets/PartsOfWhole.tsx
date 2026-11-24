"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../../../lib/utils";
import { EASE } from "../motion";
import { TONE, type Tone } from "../../../lib/tone";

export interface WholeSegment {
  id: string;
  label: string;
  value: number;
  tone: Tone;
  /** Makes the legend entry a deeplink to the filtered list. */
  href?: string;
}

/**
 * Parts of a whole as one segmented bar plus a labelled legend: the replacement for a row of boxes or a
 * donut when there are <=5 categories. Zero-value segments are dropped so the bar never shows a hairline.
 */
export function SegmentedBar({
  segments,
  layout = "list",
}: {
  segments: WholeSegment[];
  /** "list": one legend row per part with count and share. "inline": a compact wrapping line. */
  layout?: "list" | "inline";
}) {
  const reduce = useReducedMotion();
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {parts.map((s, i) => (
          <motion.div
            key={s.id}
            className={cn("min-w-[3px] origin-left", TONE[s.tone].fill)}
            style={{ flexGrow: s.value, flexBasis: 0 }}
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.05 }}
          />
        ))}
      </div>

      {layout === "inline" ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {parts.map((s) => (
            <li key={s.id}>
              <LegendEntry segment={s} className="gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[s.tone].dot)} aria-hidden />
                <span className="text-[var(--ds-on-surface-muted)]">{s.label}</span>
                <span className="font-medium tabular-nums text-[var(--ds-on-surface)]">{s.value}</span>
              </LegendEntry>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 flex flex-col gap-0.5">
          {parts.map((s) => (
            <li key={s.id}>
              <LegendEntry segment={s} className="-mx-2 gap-3 rounded-lg px-2 py-2 text-sm">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[s.tone].dot)} aria-hidden />
                <span className="flex-1 text-[var(--ds-on-surface)]">{s.label}</span>
                <span className="font-medium tabular-nums text-[var(--ds-on-surface)]">{s.value}</span>
                <span className="w-10 text-right text-xs tabular-nums text-[var(--ds-on-surface-muted)]">
                  {Math.round((s.value / total) * 100)}%
                </span>
              </LegendEntry>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LegendEntry({
  segment,
  className,
  children,
}: {
  segment: WholeSegment;
  className: string;
  children: React.ReactNode;
}) {
  const base = cn("flex items-center", className);
  if (!segment.href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={segment.href}
      className={cn(
        base,
        "transition-colors duration-150 hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none",
      )}
    >
      {children}
    </Link>
  );
}
