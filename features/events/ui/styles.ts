// Class strings every calendar screen shares.
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
export const PILL = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white/[0.08] px-4 text-sm font-medium text-[var(--ds-on-surface)] hover:bg-white/[0.12] ${FOCUS}`;
export const PRIMARY = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] hover:opacity-90 ${FOCUS}`;
export const MUTED = "text-xs text-[var(--ds-on-surface-muted)]";
export const LINK = `underline underline-offset-2 hover:no-underline ${FOCUS}`;
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
