// Plain values (no "use client"), so server components can read them too.

export type Tone = "default" | "success" | "warning" | "danger" | "info";

/** One place that decides what a tone looks like, so the same status is the same colour on every widget. */
export const TONE: Record<Tone, { dot: string; text: string; chip: string; fill: string }> = {
  default: {
    dot: "bg-white/30",
    text: "text-[var(--ds-on-surface)]",
    chip: "bg-white/[0.06] text-[var(--ds-on-surface-variant)]",
    fill: "bg-white/55",
  },
  success: {
    dot: "bg-[var(--ds-color-success-400)]",
    text: "text-[var(--ds-color-success-400)]",
    chip: "bg-[color-mix(in_oklab,var(--ds-color-success-500)_14%,transparent)] text-[var(--ds-color-success-400)]",
    fill: "bg-[var(--ds-color-success-400)]",
  },
  warning: {
    dot: "bg-[var(--ds-color-warning-400)]",
    text: "text-[var(--ds-color-warning-400)]",
    chip: "bg-[color-mix(in_oklab,var(--ds-color-warning-500)_14%,transparent)] text-[var(--ds-color-warning-400)]",
    fill: "bg-[var(--ds-color-warning-400)]",
  },
  danger: {
    dot: "bg-[var(--ds-color-danger-400)]",
    text: "text-[var(--ds-color-danger-400)]",
    chip: "bg-[color-mix(in_oklab,var(--ds-color-danger-500)_14%,transparent)] text-[var(--ds-color-danger-400)]",
    fill: "bg-[var(--ds-color-danger-400)]",
  },
  info: {
    dot: "bg-[var(--ds-color-primary-400)]",
    text: "text-[var(--ds-color-primary-300)]",
    chip: "bg-[color-mix(in_oklab,var(--ds-color-primary-500)_16%,transparent)] text-[var(--ds-color-primary-300)]",
    fill: "bg-[var(--ds-color-primary-400)]",
  },
};

/** Small mono uppercase label: the "technical" voice of the theme. */
export const LABEL = "font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]";

export const ROW_HOVER = "transition-colors duration-150 hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none";

/** The one text-input look. */
export const INPUT = "h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)] outline-none placeholder:text-[var(--ds-on-surface-muted)] focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[var(--ds-color-danger-500)]";
