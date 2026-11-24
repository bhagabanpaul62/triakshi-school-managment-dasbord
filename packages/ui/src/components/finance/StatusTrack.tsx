import { IconCheck, IconX } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { shortDate } from "../../lib/format";

export interface TrackStep {
  label: string;
  state: "done" | "now" | "todo" | "failed";
  /** Date the step happened, "YYYY-MM-DD" or a timestamp. */
  at?: string | null;
}

export interface StatusTrackProps {
  steps: TrackStep[];
  /** Describes the whole track for screen readers, for example "Receipt progress". */
  label?: string;
}

const SPOKEN = { done: "done", now: "current step", todo: "not yet", failed: "failed" } as const;

/** Where a record is in its life: draft, issued, paid. An ordered list; the current step has aria-current. */
export function StatusTrack({ steps, label = "Progress" }: StatusTrackProps) {
  return (
    <ol aria-label={label} className="flex flex-col gap-4 sm:flex-row sm:gap-0">
      {steps.map((s, i) => (
        <li key={`${i}-${s.label}`} aria-current={s.state === "now" ? "step" : undefined} className="flex min-w-0 items-start gap-3 sm:flex-1 sm:flex-col sm:gap-2">
          <div className="flex items-center sm:w-full">
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs",
                s.state === "done" && "bg-[var(--ds-color-success-500)]/20 text-[var(--ds-color-success-400)]",
                s.state === "now" && "bg-[var(--ds-on-surface)] text-[var(--ds-surface)]",
                s.state === "todo" && "bg-white/[0.06] text-[var(--ds-on-surface-muted)]",
                s.state === "failed" && "bg-[var(--ds-color-danger-500)]/20 text-[var(--ds-color-danger-400)]",
              )}
            >
              {s.state === "done" ? <IconCheck className="h-4 w-4" /> : s.state === "failed" ? <IconX className="h-4 w-4" /> : <span className="tabular-nums">{i + 1}</span>}
            </span>
            {i < steps.length - 1 ? <span aria-hidden className={cn("mx-2 hidden h-px flex-1 sm:block", s.state === "done" ? "bg-[var(--ds-color-success-400)]/50" : "bg-white/[0.1]")} /> : null}
          </div>
          <div className="min-w-0 pr-2">
            <p className={cn("text-sm", s.state === "todo" ? "text-[var(--ds-on-surface-muted)]" : "text-[var(--ds-on-surface)]", s.state === "now" && "font-medium", s.state === "failed" && "text-[var(--ds-color-danger-400)]")}>
              {s.label}
              <span className="sr-only">, {SPOKEN[s.state]}</span>
            </p>
            {s.at ? <p className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{shortDate(s.at)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
