import { buildOpenApi } from "../_openapi";

/** GET /api/v1/openapi.json: the OpenAPI 3.1 description of this API (public, no token). */
export function GET(req: Request) {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return Response.json(buildOpenApi(`${proto}://${host}`), { headers: { "cache-control": "public, max-age=300" } });
}
