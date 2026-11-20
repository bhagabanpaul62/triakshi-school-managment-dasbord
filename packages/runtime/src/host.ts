// Host → school lookup, safe to call from the Next.js proxy. Cached in memory for 60 seconds.
import { env } from "@smw/config";
import { schoolDb, sql, type SchoolStatus } from "@smw/db";

export type HostSchool = { id: string; slug: string; status: SchoolStatus };
const TTL = 60_000;
const cache = new Map<string, { at: number; value: HostSchool | null }>();

/** Strip the port and lower-case: "A.Localhost:4100" → "a.localhost". */
export const normalizeHost = (host: string | null | undefined) => (host ?? "").split(":")[0]!.trim().toLowerCase();

export async function resolveSchoolByHost(rawHost: string): Promise<HostSchool | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const rows = await schoolDb().execute<HostSchool>(sql`select id, slug, status from resolve_school_by_host(${host}, ${env().ROOT_DOMAIN})`);
  const value = rows[0] ?? null;
  cache.set(host, { at: Date.now(), value });
  return value;
}

/** Drop a cached host (after a domain is verified or a school changes status). */
export const forgetHost = (host?: string) => (host ? cache.delete(normalizeHost(host)) : cache.clear());

/** Headers the proxy sets. Any incoming copy is deleted first, so the school comes only from the host. */
export const SCHOOL_HEADER = "x-smw-school-id";
export const STATUS_HEADER = "x-smw-school-status";
export const REQUEST_ID_HEADER = "x-smw-request-id";
/**
 * The host the browser asked for. Next.js renders a server action's redirect target through an internal request whose
 * `host` is the server's own origin, but it keeps the original in x-forwarded-host (Caddy also overwrites that header in
 * production). A spoofed value can at most render another school's public page: cookies are host-only and sessions are
 * checked inside that school's RLS scope.
 */
export const requestHost = (h: Headers) => h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "";
