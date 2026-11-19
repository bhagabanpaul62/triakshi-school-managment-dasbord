// Caddy on-demand TLS asks here before it issues a certificate: GET /api/internal/tls-allowed?domain=<host>.
// 200 = issue, 404 = refuse. NOT for the internet: Caddy must block /api/internal on public listeners and call
// this over the Docker network only (it holds no secret; it only says whether a host belongs to one of our schools).
import { resolveSchoolByHost, normalizeHost } from "@smw/runtime/host";
import { isPlainHostname, tlsAllowed } from "@smw/feature-domains/tls";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const host = normalizeHost(new URL(req.url).searchParams.get("domain"));
  // Validate before the lookup so odd input never reaches the database.
  const school = isPlainHostname(host) ? await resolveSchoolByHost(host) : null;
  return new Response(null, { status: tlsAllowed(host, school) ? 200 : 404 });
}
