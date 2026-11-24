"use client";

import { IconX } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { FOCUS, ICON_BTN } from "./ui";

export interface BulkAction {
  label: string;
  onClick: () => void;
  /** "danger" for destructive actions. */
  tone?: "default" | "danger";
  disabled?: boolean;
}

export interface BulkBarProps {
  /** How many rows are selected. The bar renders nothing at 0. */
  count: number;
  actions: BulkAction[];
  /** Clears the selection. Shows the close button. */
  onClear?: () => void;
  /** What a row is called, singular: "bill". Default "item". */
  noun?: string;
}

/** Appears only while rows are selected. Sticks to the bottom of the screen; the count is announced politely. */
export function BulkBar({ count, actions, onClear, noun = "item" }: BulkBarProps) {
  if (count <= 0) return null;
  return (
    <div role="region" aria-label="Actions for selected rows" className="sticky bottom-4 z-30 mx-auto mt-4 flex w-full max-w-full flex-wrap items-center gap-2 rounded-3xl bg-[var(--ds-surface-container-highest)] p-2 pl-5 shadow-lg sm:w-fit">
      <p aria-live="polite" className="mr-auto text-sm tabular-nums text-[var(--ds-on-surface)]">{count} {noun}{count === 1 ? "" : "s"} selected</p>
      {actions.map((a) => (
        <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled}
          className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50", FOCUS, a.tone === "danger" ? "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)] hover:bg-[var(--ds-color-danger-500)]/25" : "bg-white/[0.08] text-[var(--ds-on-surface)] hover:bg-white/[0.14]")}>
          {a.label}
        </button>
      ))}
      {onClear ? <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection" className={ICON_BTN}><IconX className="h-4 w-4" aria-hidden /></button> : null}
    </div>
  );
}
