"use client";

import { motion, useReducedMotion } from "framer-motion";
import { TONE, type Tone } from "../../../lib/tone";
import { CountUp } from "../motion";
import { cn } from "../../../lib/utils";

const TICKS = 36;
const R_IN = 72;
const R_OUT = 92;
const CX = 100;
const CY = 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Tone -> a real colour for the SVG stroke; CSS classes can't be used on SVG strokes via TONE.fill.
const STROKE: Record<Tone, string> = {
  default: "rgba(255,255,255,0.55)",
  success: "var(--ds-color-success-400)",
  warning: "var(--ds-color-warning-400)",
  danger: "var(--ds-color-danger-400)",
  info: "var(--ds-color-primary-400)",
};

/**
 * Half-ring of ticks that fills to a percentage (the "Repeat Customer Rate" / "Task completion" gauges).
 * The ring is the proportion; the centre carries the number. Use for a single 0-100 ratio only.
 */
export function SegmentedGauge({
  value,
  tone = "info",
  label,
  caption,
  className,
}: {
  /** 0-100 */
  value: number;
  tone?: Tone;
  /** Shown under the number, e.g. "utilised". */
  label?: string;
  /** Extra line under the label, e.g. "On track for 80%". */
  caption?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const filled = Math.round((pct / 100) * TICKS);

  return (
    <div className={cn("@container mx-auto w-full max-w-[260px]", className)} role="img" aria-label={`${Math.round(pct)}%${label ? ` ${label}` : ""}`}>
      {/* Only the ring box is `relative`: the number is placed against the ring, never against the label below it. */}
      <div className="relative">
      <svg viewBox="0 0 200 108" className="w-full" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => {
          const angle = Math.PI + (i / (TICKS - 1)) * Math.PI; // left -> right across the top
          // Rounded: server and browser print raw floats differently in the last digit, which trips hydration.
          const x1 = round2(CX + R_IN * Math.cos(angle));
          const y1 = round2(CY + R_IN * Math.sin(angle));
          const x2 = round2(CX + R_OUT * Math.cos(angle));
          const y2 = round2(CY + R_OUT * Math.sin(angle));
          const on = i < filled;
          return (
            <motion.line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={4}
              strokeLinecap="round"
              stroke={on ? STROKE[tone] : "rgba(255,255,255,0.08)"}
              initial={reduce || !on ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: i * 0.018 }}
            />
          );
        })}
      </svg>
      {/* The number sits inside the ring; the words go underneath it, so a small gauge never draws text over its ticks. */}
      <div className="absolute inset-x-0 bottom-[6%] flex justify-center">
        {/* The % hangs off the digits (smaller, on the baseline) so the digits, not digits+sign, are what sits centred in the ring. */}
        <p className={cn("relative text-[clamp(20px,16cqw,34px)] font-medium leading-none tabular-nums tracking-tight", TONE[tone === "info" ? "default" : tone].text)}>
          <CountUp value={String(Math.round(pct))} />
          <span className="absolute bottom-[0.06em] left-full ml-[0.08em] text-[0.5em] font-normal leading-none opacity-70" aria-hidden>
            %
          </span>
        </p>
      </div>
      </div>
      {label || caption ? (
        <div className="mt-2 text-center">
          {label ? <p className="text-xs leading-tight text-[var(--ds-on-surface-muted)]">{label}</p> : null}
          {caption ? <p className="mt-0.5 text-[11px] leading-tight text-[var(--ds-on-surface-muted)]">{caption}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
