import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { Tone } from "../../lib/tone";
import { Money } from "./Money";

export interface KeyTotal {
  label: string;
  paise: number;
  tone?: Tone;
  /** One short line under the number. */
  hint?: ReactNode;
  /** The one number people came for: shown larger. */
  strong?: boolean;
}

export interface KeyTotalsProps {
  items: KeyTotal[];
  className?: string;
}

/** A compact row of totals (billed, collected, due). Wraps to two columns on a phone. */
export function KeyTotals({ items, className }: KeyTotalsProps) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:items-end sm:gap-x-10", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="truncate text-[13px] text-[var(--ds-on-surface-variant)]">{it.label}</dt>
          <dd className="mt-1">
            <Money paise={it.paise} tone={it.tone} size={it.strong ? "xl" : "lg"} />
            {it.hint ? <span className="mt-1 block text-xs text-[var(--ds-on-surface-muted)]">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
