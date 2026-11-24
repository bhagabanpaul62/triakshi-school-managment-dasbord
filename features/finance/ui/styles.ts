// Class strings and tiny helpers every finance page shares.
export const PILL = "inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
export const PRIMARY = "inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
export const FLAT = "flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm";
export const ROW = `${FLAT} transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`;
export const LINK = "underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
export const FIELD = "h-10 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
export const MUTED = "text-xs text-[var(--ds-on-surface-muted)]";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** A `?next=` that stays inside the app: a path under /app/, never another site. */
export const safeNext = (v: string | string[] | undefined): string | undefined => {
  const n = one(v);
  return n && /^\/app\/[A-Za-z0-9/_\-?=&%.]*$/.test(n) && !n.includes("//") ? n : undefined;
};

/** A path with these query values, leaving out any that are empty. */
export const href = (path: string, query: Record<string, string | number | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.size ? `${path}?${q}` : path;
};
