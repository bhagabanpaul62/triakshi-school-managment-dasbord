// Shared class strings so every finance control focuses, sizes and rests the same way.
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
/** 40 px round icon button. */
export const ICON_BTN = `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)] transition-colors hover:bg-white/[0.1] disabled:pointer-events-none disabled:opacity-40 ${FOCUS}`;
export const PILL_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white/[0.07] px-4 text-sm font-medium text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.12] disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const PRIMARY_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const SR_ONLY = "sr-only";
