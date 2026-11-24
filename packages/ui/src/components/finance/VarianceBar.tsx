import { cn } from "../../lib/utils";
import { TONE } from "../../lib/tone";
import { Money } from "./Money";
import { formatPaise, variance } from "./logic";

export interface VarianceBarProps {
  /** Integer paise spent or earned so far. */
  actual: number;
  /** Integer paise planned. */
  budget: number;
  label?: string;
  /** true for income (more is better); false for expense, where passing the budget turns red. */
  higherIsBetter?: boolean;
}

/** Actual against budget on one bar; the tick marks the budget. */
export function VarianceBar({ actual, budget, label, higherIsBetter = false }: VarianceBarProps) {
  const v = variance(actual, budget);
  const tone = higherIsBetter ? (!v.over && v.pct !== null && v.pct >= 100 ? "success" : "default") : v.over ? "danger" : v.pct !== null && v.pct >= 90 ? "warning" : "default";
  const diffText = v.diff === 0 ? "On budget" : `${formatPaise(Math.abs(v.diff))} ${v.over ? "over" : "under"}`;
  const sentence = `${label ? label + ": " : ""}${formatPaise(actual)} of ${formatPaise(budget)}${v.pct === null ? "" : `, ${v.pct}%`}, ${diffText}`;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {label ? <span className="truncate text-[13px] text-[var(--ds-on-surface-variant)]">{label}</span> : null}
        <span className="text-xs text-[var(--ds-on-surface-muted)]">
          <Money paise={actual} size="sm" tone={tone} /> of <Money paise={budget} size="sm" />
          {v.pct === null ? null : <span className="tabular-nums"> · {v.pct}%</span>}
        </span>
      </div>
      <div role="img" aria-label={sentence} className="relative h-2.5 w-full rounded-full bg-white/[0.06]">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", TONE[tone].fill)} style={{ width: `${(actual / v.scaleMax) * 100}%` }} />
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 rounded bg-[var(--ds-on-surface)]" style={{ left: `calc(${(budget / v.scaleMax) * 100}% - 1px)` }} />
      </div>
      <p className="mt-1.5 text-xs text-[var(--ds-on-surface-muted)]">{diffText}</p>
    </div>
  );
}
