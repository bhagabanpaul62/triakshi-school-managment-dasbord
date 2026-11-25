// Host → school lookup, safe to call from the Next.js proxy. Cached in memory for 60 seconds.
import { env, schoolUrl } from "@smw/config";
import { and, eq, inArray, schoolDb, schoolDomains, sql, type DomainRecordCheck, type SchoolStatus, type Tx } from "@smw/db";

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

/**
 * May this verified domain be the school's main address? Not broken, and a certificate that works: the first visit issues
 * it on demand, so a domain is only promoted when a later check has seen it. Redirects and mail links wait for this.
 */
export function healthyMain(d: { health: string | null; certExpiresAt: Date | null; records: DomainRecordCheck[] }, now = new Date()): boolean {
  return d.health !== "broken" && !!d.certExpiresAt && d.certExpiresAt.getTime() > now.getTime() && d.records.some((r) => r.key === "https" && r.ok);
}

/** The address links to families should start with, per school: the healthy main custom domain, else the free address. The one place mail links ask. */
export async function schoolOrigins(tx: Tx, schools: { id: string; slug: string }[]): Promise<Map<string, string>> {
  const rows = schools.length
    ? await tx.select({ schoolId: schoolDomains.schoolId, hostname: schoolDomains.hostname, health: schoolDomains.health, certExpiresAt: schoolDomains.certExpiresAt, records: schoolDomains.records }).from(schoolDomains)
      .where(and(inArray(schoolDomains.schoolId, schools.map((s) => s.id)), eq(schoolDomains.isPrimary, true), eq(schoolDomains.kind, "custom"), eq(schoolDomains.status, "verified")))
    : [];
  const main = new Map(rows.filter((r) => healthyMain(r)).map((r) => [r.schoolId, r.hostname]));
  return new Map(schools.map((s) => [s.id, main.has(s.id) ? `${env().APP_PROTOCOL}://${main.get(s.id)}` : schoolUrl(s.slug)]));
}
