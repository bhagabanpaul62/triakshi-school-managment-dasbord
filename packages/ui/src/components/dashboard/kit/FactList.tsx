"use client";

import { useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { cn } from "../../../lib/utils";

/** Definition list for a record's facts: muted label, value, empty values shown as a muted dash. */
export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("flex flex-col", className)}>{children}</dl>;
}

/**
 * One fact. Pass `copy` (the raw string) for emails, phones and ids: a copy button appears on hover/focus and
 * swaps to a check for a second. Long values truncate with the full text in the tooltip.
 */
export function Fact({
  label,
  children,
  copy,
  wrap,
  className,
}: {
  label: string;
  children?: ReactNode;
  copy?: string;
  /** Let the value wrap onto more lines instead of truncating (dates, sentences). */
  wrap?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const empty = children === undefined || children === null || children === "" || children === false;

  const onCopy = async () => {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the value is still selectable, so stay quiet.
    }
  };

  return (
    <div
      className={cn(
        "group/fact grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-baseline gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-white/[0.03]",
        className,
      )}
    >
      <dt className="truncate text-[13px] text-[var(--ds-on-surface-muted)]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--ds-on-surface)]">
        {empty ? (
          <span className="text-[var(--ds-on-surface-muted)]">—</span>
        ) : (
          <span className={cn("min-w-0", wrap ? "break-words" : "truncate")} title={typeof children === "string" ? children : undefined}>
            {children}
          </span>
        )}
        {copy && !empty ? (
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${label}`}
            title={copied ? "Copied" : `Copy ${label}`}
            className="shrink-0 rounded-md p-1 text-[var(--ds-on-surface-muted)] opacity-0 transition-opacity duration-150 hover:text-[var(--ds-on-surface)] focus-visible:opacity-100 group-hover/fact:opacity-100"
          >
            {copied ? <IconCheck className="h-3.5 w-3.5 text-[var(--ds-color-success-400)]" aria-hidden /> : <IconCopy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        ) : null}
      </dd>
    </div>
  );
}
