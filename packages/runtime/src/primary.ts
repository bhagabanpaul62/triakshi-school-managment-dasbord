/** Paths that hold a session or an API: sessions are per host, so these never move to another address. */
const STAY = ["/app", "/login", "/api", "/_next", "/support-login", "/reset-password", "/forgot-password", "/verify-email", "/confirm-email", "/unsubscribe"];

export interface PrimaryRedirectInput {
  /** The host the visitor asked for. */
  host: string;
  /** The free address, <slug>.ROOT_DOMAIN. */
  freeHost: string;
  /** The main custom domain when it is verified and not broken, else null. */
  primaryHost: string | null;
  /** The school's "send visitors to the main domain" switch. */
  redirect: boolean;
  /** Path and query, as asked: "/about?x=1". */
  path: string;
}

/** Where a public page should go (permanent redirect, path and query kept), or null to serve it here. Pure. */
export function primaryRedirect({ host, freeHost, primaryHost, redirect, path }: PrimaryRedirectInput): { status: 308; location: string } | null {
  const h = host.split(":")[0]!.trim().toLowerCase();
  if (!redirect || !primaryHost || primaryHost === freeHost.toLowerCase() || h === primaryHost.toLowerCase()) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  const pathname = p.split(/[?#]/)[0]!;
  if (STAY.some((s) => pathname === s || pathname.startsWith(`${s}/`))) return null;
  return { status: 308, location: `https://${primaryHost}${p}` };
}
