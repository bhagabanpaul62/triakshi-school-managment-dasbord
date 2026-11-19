/**
 * Bearer-token auth and the JSON handler wrapper for the mobile REST API (`/api/v1`).
 * Same session layer as the cookie: the token from `POST /api/v1/auth/login` is a school session token.
 * Framework-light: takes a standard `Request`, so it is testable without Next.js.
 * @module @smw/runtime/bearer
 */
import { SchoolAuth, type ValidSession } from "@smw/auth";
import { eq, modules, planModules, schoolModuleOverrides, schools, withSchool } from "@smw/db";
import { AppError, NotFoundError, resolveEntitlements, UnauthenticatedError, ValidationError, type Ctx } from "@smw/feature-kit";
import type { z } from "zod";
import { REQUEST_ID_HEADER, resolveSchoolByHost } from "./host";

export interface ApiSchool { id: string; slug: string; name: string; features: Set<string>; readOnly: boolean }
export interface ApiSession { ctx: Ctx; school: ApiSchool; session: ValidSession }

/** The token in `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
const hostOf = (req: Request) => req.headers.get("host") ?? new URL(req.url).host;

/** The school for this request's Host with its enabled modules (same rules as the panel's getSchool). 404 when no school uses the host. */
export async function schoolFromRequest(req: Request): Promise<ApiSchool> {
  const hit = await resolveSchoolByHost(hostOf(req));
  if (!hit) throw new NotFoundError("School");
  return withSchool(hit.id, async (tx) => {
    const [row] = await tx.select().from(schools).where(eq(schools.id, hit.id)).limit(1);
    if (!row) throw new NotFoundError("School");
    const [mods, plan, overrides] = await Promise.all([
      tx.select().from(modules),
      row.planId ? tx.select().from(planModules).where(eq(planModules.planId, row.planId)) : Promise.resolve([]),
      tx.select().from(schoolModuleOverrides),
    ]);
    const ent = resolveEntitlements({
      status: row.status,
      modules: mods.map((m) => ({ key: m.key, stage: m.stage, requires: m.requires, core: m.core })),
      planModuleKeys: plan.map((p) => p.moduleKey),
      overrides,
    });
    return { id: row.id, slug: row.slug, name: row.name, features: ent.enabled, readOnly: ent.readOnly };
  });
}

/** Ctx plus the school and session behind a valid bearer token. A token from another school never validates on this host. */
export async function bearerSession(req: Request): Promise<ApiSession> {
  const token = bearerToken(req);
  if (!token) throw new UnauthenticatedError();
  const school = await schoolFromRequest(req);
  const session = await new SchoolAuth(school.id).validate(token);
  if (!session || session.user.schoolId !== school.id) throw new UnauthenticatedError();
  const ctx: Ctx = {
    schoolId: school.id, userId: session.user.id, role: session.user.role, name: session.user.name,
    features: school.features, readOnly: school.readOnly || session.readOnly,
    requestId: req.headers.get(REQUEST_ID_HEADER) ?? undefined, ip: clientIp(req), supportStaffId: session.supportStaffId,
  };
  return { ctx, school, session };
}

/** The Ctx every service takes, from the bearer token. Throws UnauthenticatedError. */
export async function bearerCtx(req: Request): Promise<Ctx> {
  return (await bearerSession(req)).ctx;
}

/** Parse a JSON request body with a zod schema; a bad or missing body is a 422 with field errors. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ValidationError({ _: "Send a JSON body." }); }
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
  throw new ValidationError(fieldErrors);
}

export const REQUEST_ID_RESPONSE_HEADER = "x-request-id";

/** The error body of every failed API call. */
export interface ApiErrorBody { error: { code: string; message: string; fieldErrors?: Record<string, string> } }

/**
 * Wrap a route handler: return any JSON-serialisable value (or a Response), and errors become
 * `{ error: { code, message, fieldErrors } }` with the AppError's status. Unknown errors are logged and sent as a generic 500.
 * Every response carries an `x-request-id` header.
 */
export function apiHandler<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<unknown> | unknown) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const headers = { [REQUEST_ID_RESPONSE_HEADER]: requestId, "cache-control": "no-store" };
    try {
      const out = await fn(req, ...rest);
      if (out instanceof Response) { out.headers.set(REQUEST_ID_RESPONSE_HEADER, requestId); return out; }
      return Response.json(out ?? { ok: true }, { headers });
    } catch (err) {
      // Next.js redirect()/notFound() throw on purpose; let them through.
      if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
      if (err instanceof AppError) {
        const body: ApiErrorBody = { error: { code: err.code, message: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) } };
        return Response.json(body, { status: err.status, headers });
      }
      console.error(JSON.stringify({ level: "error", msg: "api failed", requestId, err: String(err), stack: (err as Error)?.stack }));
      const body: ApiErrorBody = { error: { code: "internal", message: "Something went wrong. Please try again." } };
      return Response.json(body, { status: 500, headers });
    }
  };
}

/** A route for a feature whose service is not wired yet: authenticates, then answers 501 `not_ready`. */
export const notReady = (feature: string) => apiHandler(async (req) => {
  await bearerCtx(req);
  throw new AppError(`The ${feature} API is not available yet.`, "not_ready", 501);
});
