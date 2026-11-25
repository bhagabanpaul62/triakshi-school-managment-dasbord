// Same strings as packages/ui/src/components/finance/ui.ts, which the @smw/ui exports map cannot reach (it only exposes .tsx).
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
export const PILL_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white/[0.07] px-4 text-sm font-medium text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.12] disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const PRIMARY_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const CARD = "rounded-2xl bg-white/[0.04] p-4";
