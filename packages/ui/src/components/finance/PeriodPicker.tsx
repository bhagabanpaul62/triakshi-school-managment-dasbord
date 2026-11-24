"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "../../lib/utils";
import { INPUT } from "../../shell/FormModal";
import { FOCUS, PILL_BTN } from "./ui";
import { fyPeriod, fyStartOf, monthPeriod, parsePeriod, periodLabel, periodParams, presetPeriod, quarterPeriod, type Period, type PeriodKind, type PresetKey } from "./logic";

export type { Period, PresetKey } from "./logic";

export interface PeriodPickerProps {
  /** Today as "YYYY-MM-DD" (todayIST() on the server). Passed in so server and browser agree. */
  today: string;
  /** Quick buttons shown beside the picker. Default: this month, last month, this quarter, this FY. */
  presets?: PresetKey[];
  /** Used when the address has no period. Default: this month. */
  fallback?: Period;
}

const PRESET_LABEL: Record<PresetKey, string> = { this_month: "This month", last_month: "Last month", this_quarter: "This quarter", last_quarter: "Last quarter", this_fy: "This year", last_fy: "Last year" };
const KINDS: { value: PeriodKind; label: string }[] = [{ value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "fy", label: "Financial year" }, { value: "custom", label: "Custom range" }];

/** Reads the period from the address (?period=2026-11, 2026-Q3, FY2026, or custom with from and to) and writes it back. The server page reads the same params with parsePeriod. */
export function PeriodPicker({ today, presets = ["this_month", "last_month", "this_quarter", "this_fy"], fallback }: PeriodPickerProps) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const value = params.get("period") ? parsePeriod({ period: params.get("period"), from: params.get("from"), to: params.get("to") }, today) : (fallback ?? presetPeriod("this_month", today));
  const [kind, setKind] = useState<PeriodKind>(value.kind);
  const [range, setRange] = useState({ from: value.from, to: value.to });
  const fy = fyStartOf(today);

  const write = (p: Period) => {
    const next = new URLSearchParams(params.toString());
    next.delete("from"); next.delete("to"); next.delete("page");
    for (const [k, v] of Object.entries(periodParams(p))) if (v) next.set(k, v);
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };
  const curQ = (v: Period) => periodParams(v).period;
  const quarters = Array.from({ length: 8 }, (_, i) => { const n = fy * 4 + 3 - i; return quarterPeriod(Math.floor(n / 4), (n % 4) + 1); });
  const sel = cn(INPUT, "w-auto");

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="sr-only" htmlFor="period-kind">Period type</label>
      <select id="period-kind" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)} className={sel}>
        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      {kind === "month" ? (
        <label className="contents"><span className="sr-only">Month</span>
          <input type="month" value={value.kind === "month" ? value.from.slice(0, 7) : today.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) write(monthPeriod(y, m)); }} className={sel} />
        </label>
      ) : kind === "quarter" ? (
        <label className="contents"><span className="sr-only">Quarter</span>
          <select value={value.kind === "quarter" ? curQ(value) : ""} onChange={(e) => { const q = quarters.find((x) => curQ(x) === e.target.value); if (q) write(q); }} className={sel}>
            {value.kind === "quarter" ? null : <option value="" disabled>Choose a quarter</option>}
            {quarters.map((q) => <option key={curQ(q)} value={curQ(q)}>{periodLabel(q)}</option>)}
          </select>
        </label>
      ) : kind === "fy" ? (
        <label className="contents"><span className="sr-only">Financial year</span>
          <select value={value.kind === "fy" ? value.from.slice(0, 4) : ""} onChange={(e) => write(fyPeriod(Number(e.target.value)))} className={sel}>
            {value.kind === "fy" ? null : <option value="" disabled>Choose a year</option>}
            {Array.from({ length: 5 }, (_, i) => fy - i).map((y) => <option key={y} value={y}>{periodLabel(fyPeriod(y))}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label className="contents"><span className="sr-only">From</span><input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className={sel} /></label>
          <span aria-hidden className="text-sm text-[var(--ds-on-surface-muted)]">to</span>
          <label className="contents"><span className="sr-only">To</span><input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} className={sel} /></label>
          <button type="button" disabled={!range.from || !range.to || range.from > range.to} onClick={() => write({ kind: "custom", ...range })} className={PILL_BTN}>Apply</button>
        </>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick periods">
        {presets.map((k) => {
          const p = presetPeriod(k, today);
          const current = p.from === value.from && p.to === value.to;
          return (
            <button key={k} type="button" aria-pressed={current} onClick={() => { setKind(p.kind); write(p); }}
              className={cn("inline-flex h-10 items-center rounded-full px-3 text-xs transition-colors", FOCUS, current ? "bg-[var(--ds-on-surface)] text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>
              {PRESET_LABEL[k]}
            </button>
          );
        })}
      </div>
      <p className="w-full text-xs tabular-nums text-[var(--ds-on-surface-muted)]" aria-live="polite">Showing {periodLabel(value)}</p>
    </div>
  );
}
