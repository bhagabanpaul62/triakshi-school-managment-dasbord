"use client";

import { useId, useState } from "react";
import { cn } from "../../lib/utils";
import { Money } from "./Money";
import { MoneyInput } from "./MoneyInput";
import { PILL_BTN } from "./ui";
import { formatPaise, splitState } from "./logic";

export interface SplitMethod {
  key: string;
  label: string;
  /** Most this method can take in paise (an advance balance). */
  maxPaise?: number;
}

export interface SplitPart { method: string; amountPaise: number }

export interface AmountSplitProps {
  /** What the parts must add up to, in paise. */
  totalPaise: number;
  methods: SplitMethod[];
  /** Fires on every edit with the non-zero parts and whether they now add up exactly. */
  onChange?: (parts: SplitPart[], state: { leftPaise: number; overPaise: number; valid: boolean }) => void;
  /** Starting amounts by method key. */
  initial?: Record<string, number>;
  /** When set, posts the non-zero parts as one JSON field: [{"method":"cash","amountPaise":50000}]. */
  name?: string;
  /** Names the group for screen readers. */
  label?: string;
}

/** Several payment methods that must add up to one total. Says what is left, and fills it in on request. */
export function AmountSplit({ totalPaise, methods, onChange, initial, name, label = "Payment methods" }: AmountSplitProps) {
  const [amounts, setAmounts] = useState<Record<string, number>>(initial ?? {});
  const uid = useId();
  const list = methods.map((m) => amounts[m.key] ?? 0);
  const s = splitState(totalPaise, list);
  const parts = methods.flatMap((m) => ((amounts[m.key] ?? 0) > 0 ? [{ method: m.key, amountPaise: amounts[m.key] as number }] : []));

  const set = (next: Record<string, number>) => {
    setAmounts(next);
    const st = splitState(totalPaise, methods.map((m) => next[m.key] ?? 0));
    onChange?.(methods.flatMap((m) => ((next[m.key] ?? 0) > 0 ? [{ method: m.key, amountPaise: next[m.key] as number }] : [])), { leftPaise: st.left, overPaise: st.over, valid: st.done });
  };

  const status = s.done ? "All of it is assigned." : s.over > 0 ? `${formatPaise(s.over)} too much. Reduce an amount.` : `${formatPaise(s.left)} left to assign.`;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">{label}</legend>
      <ul className="flex flex-col gap-3">
        {methods.map((m, i) => {
          const rest = Math.max(0, totalPaise - (s.assigned - (list[i] ?? 0)));
          const cap = m.maxPaise === undefined ? rest : Math.min(rest, m.maxPaise);
          return (
            <li key={m.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[8rem_1fr_auto] sm:gap-3">
              <span className="col-span-2 text-sm text-[var(--ds-on-surface)] sm:col-span-1 sm:pb-2.5" aria-hidden>
                {m.label}
                {m.maxPaise !== undefined ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">up to {formatPaise(m.maxPaise)}</span> : null}
              </span>
              <MoneyInput label={m.label} labelHidden valuePaise={amounts[m.key] ?? null} max={m.maxPaise} onChange={(p) => set({ ...amounts, [m.key]: p ?? 0 })} />
              <button type="button" disabled={cap <= 0 || cap === (list[i] ?? 0)} onClick={() => set({ ...amounts, [m.key]: cap })} aria-label={`Put the rest in ${m.label}`} className={PILL_BTN}>
                Rest
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
        <span className="text-[var(--ds-on-surface-variant)]">Total <Money paise={totalPaise} /></span>
        <span id={`${uid}-left`} role="status" aria-live="polite" className={cn("tabular-nums", s.done ? "text-[var(--ds-color-success-400)]" : s.over > 0 ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-color-warning-400)]")}>{status}</span>
      </div>
      {name ? <input type="hidden" name={name} value={JSON.stringify(parts)} /> : null}
    </fieldset>
  );
}
