"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "../motion";
import { TONE, type Tone } from "../widgets/WidgetPrimitives";
import { cn } from "../../../lib/utils";

/** A horizontal meter drawn over a faint ruler of ticks (the "Resource Allocation" bars). */
export function TickBar({
  value,
  tone = "info",
  delay = 0,
  className,
}: {
  /** 0-100 */
  value: number;
  tone?: Tone;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "relative h-2.5 overflow-hidden rounded-full bg-white/[0.04]",
        "bg-[repeating-linear-gradient(90deg,transparent_0_5px,rgba(255,255,255,0.06)_5px_6px)]",
        className,
      )}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <motion.div
        className={cn("h-full rounded-full", TONE[tone].fill)}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: EASE, delay }}
      />
    </div>
  );
}
