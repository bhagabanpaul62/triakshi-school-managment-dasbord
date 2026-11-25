// Class strings every calendar screen shares.
import { FOCUS, PILL_BTN as PILL, PRIMARY_BTN as PRIMARY } from "@smw/ui/finance/ui";
export { PILL, PRIMARY };
export const MUTED = "text-xs text-[var(--ds-on-surface-muted)]";
export const LINK = `underline underline-offset-2 hover:no-underline ${FOCUS}`;
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
