"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { toast } from "../../shell/toast";
import { FOCUS } from "./ui";

export interface CopyValueProps {
  /** The text that is copied (a receipt number, a UPI id, a reference). */
  value: string;
  /** What it is, for the button's name: "receipt number". */
  label?: string;
  /** Widest the text may grow before it is cut with an ellipsis. Default 24ch. */
  maxWidth?: string;
  className?: string;
}

/** A value you copy with one press; shows a tick for a second. The full text is in the tooltip. */
export function CopyValue({ value, label = "value", maxWidth = "24ch", className }: CopyValueProps) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1000);
    } catch {
      toast("Could not copy. Select the text and copy it by hand.", "danger");
    }
  };
  return (
    <button type="button" onClick={copy} title={value} aria-label={`Copy ${label}`} className={cn("group inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg px-2 font-mono text-xs text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.06]", FOCUS, className)}>
      <span className="truncate" style={{ maxWidth }}>{value}</span>
      {done ? <IconCheck className="h-4 w-4 shrink-0 text-[var(--ds-color-success-400)]" aria-hidden /> : <IconCopy className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)] group-hover:text-[var(--ds-on-surface)]" aria-hidden />}
      <span role="status" className="sr-only">{done ? "Copied" : ""}</span>
    </button>
  );
}
