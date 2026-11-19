"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CountUp, EASE } from "../motion";
import { ArrowButton, IconChip } from "./Panel";
import { cn } from "../../../lib/utils";

/**
 * KPI card: icon chip + label, the number, how it moved, and (only when there is real data for it) a small
 * visual on the right. The whole card is the link; the corner arrow is its affordance.
 */
export function StatCard({
  label,
  value,
  icon,
  delta,
  meta,
  viz,
  href,
  tooltip,
  delay = 0,
  className,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  /** A DeltaChip (or any short status) shown beside the number. */
  delta?: ReactNode;
  /** Muted comparison text: "vs last month". */
  meta?: ReactNode;
  /** A mini SegmentedGauge / MiniBars: never decoration, only real data. */
  viz?: ReactNode;
  href?: string;
  tooltip?: ReactNode;
  delay?: number;
  className?: string;
}) {
  const card = (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay }}
      className={cn(
        "group/card flex h-full min-h-[136px] flex-col justify-between gap-5 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 transition-colors duration-150",
        href && "hover:bg-[var(--ds-surface-container)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? <IconChip>{icon}</IconChip> : null}
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">
            <span className="truncate">{label}</span>
            {tooltip}
          </p>
        </div>
        {href ? <ArrowButton decorative /> : null}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[34px] font-medium leading-none tabular-nums tracking-tight text-[var(--ds-on-surface)]">
            <CountUp value={value} />
          </p>
          {delta || meta ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {delta}
              {meta ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{meta}</span> : null}
            </div>
          ) : null}
        </div>
        {viz ? <div className="shrink-0">{viz}</div> : null}
      </div>
    </motion.article>
  );

  return href ? (
    <Link href={href} className="block h-full rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]/50">
      {card}
    </Link>
  ) : (
    card
  );
}
