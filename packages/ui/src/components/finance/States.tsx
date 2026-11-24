import type { ReactNode } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { PILL_BTN } from "./ui";

export interface EmptyLineProps {
  /** One plain sentence: "No receipts today." */
  title: string;
  hint?: string;
  /** The one primary action, if there is one. */
  action?: ReactNode;
}

/** Nothing to show: one line, an optional hint, one action. */
export function EmptyLine({ title, hint, action }: EmptyLineProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl bg-white/[0.035] p-6">
      <p className="text-sm text-[var(--ds-on-surface)]">{title}</p>
      {hint ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p> : null}
      {action}
    </div>
  );
}

export interface SkeletonRowsProps {
  rows?: number;
  className?: string;
}

/** Placeholder rows while data loads (loading.tsx). Announces "Loading" once. */
export function SkeletonRows({ rows = 5, className }: SkeletonRowsProps) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex h-12 items-center gap-3 rounded-xl bg-white/[0.035] px-4">
          <span className="h-3 w-1/4 rounded-full bg-white/[0.07] motion-safe:animate-pulse" />
          <span className="h-3 w-1/3 rounded-full bg-white/[0.05] motion-safe:animate-pulse" />
          <span className="ml-auto h-3 w-16 rounded-full bg-white/[0.07] motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export interface ErrorLineProps {
  /** What went wrong in plain words. */
  message?: string;
  /** Wire to error.tsx `reset`. Shows the Try again button. */
  retry?: () => void;
}

/** Something failed to load: says so and offers a retry. */
export function ErrorLine({ message = "This did not load.", retry }: ErrorLineProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--ds-color-danger-500)]/10 p-4 text-sm text-[var(--ds-color-danger-300)]">
      <IconAlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      {retry ? <button type="button" onClick={retry} className={PILL_BTN}><IconRefresh className="h-4 w-4" aria-hidden />Try again</button> : null}
    </div>
  );
}
