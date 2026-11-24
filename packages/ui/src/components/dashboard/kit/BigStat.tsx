"use client";

import type { ReactNode } from "react";
import { CountUp } from "../motion";
import { Inset } from "./Panel";
import { TONE, type Tone } from "../../../lib/tone";
import { cn } from "../../../lib/utils";

/**
 * A number that lives inside a panel (StatCard is a whole card and would nest a card in a card): muted label,
 * big tabular figure, optional chip + hint. Colour goes on the figure only when it needs attention.
 */
export function BigStat({
  label,
  value,
  hint,
  delta,
  tone = "default",
  size = "md",
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  /** A DeltaChip, shown before the hint. */
  delta?: ReactNode;
  tone?: Tone;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-[13px] text-[var(--ds-on-surface-variant)]">{label}</p>
      <p className={cn("mt-2 font-medium leading-none tabular-nums tracking-tight", size === "lg" ? "text-[40px]" : "text-[26px]", TONE[tone].text)}>
        <CountUp value={value} />
      </p>
      {delta || hint ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta}
          {hint ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const COLUMNS = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" } as const;

/** One `Inset` well holding a few BigStats side by side. */
export function StatGroup({ children, columns = 3, className }: { children: ReactNode; columns?: keyof typeof COLUMNS; className?: string }) {
  return <Inset className={cn("grid gap-x-6 gap-y-5", COLUMNS[columns], className)}>{children}</Inset>;
}
