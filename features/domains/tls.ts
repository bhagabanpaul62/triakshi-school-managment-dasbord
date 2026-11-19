import type { SchoolStatus } from "@smw/db";

/** Statuses that may get a certificate: a school that can still be reached. Suspended and cancelled schools cannot. */
const TLS_STATUSES: readonly SchoolStatus[] = ["active", "trial", "past_due", "read_only"];

/** Only plain hostnames reach the database lookup (no wildcards, ports or paths). */
export const isPlainHostname = (host: string) => host.length <= 253 && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$|^localhost$|^[a-z0-9-]+\.localhost$/.test(host);

/** Caddy on-demand TLS asks this before issuing a certificate. `school` is what the host resolved to (verified domain or <slug>.ROOT_DOMAIN). */
export function tlsAllowed(host: string, school: { status: SchoolStatus } | null): boolean {
  return isPlainHostname(host) && !!school && TLS_STATUSES.includes(school.status);
}
