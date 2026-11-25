/**
 * Next.js glue for the school app: the current school (from the Host header), the session cookie,
 * and the `Ctx` every service takes. Everything here is cached per request.
 * @module @smw/runtime
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SchoolAuth, type ValidSession } from "@smw/auth";
import { secureCookies } from "@smw/config";
import { and, eq, modules, planModules, schoolDomains, schoolModuleOverrides, schools, withSchool } from "@smw/db";
import { ForbiddenError, resolveEntitlements, UnauthenticatedError, type Ctx } from "@smw/feature-kit";
import { safeImage, themeOf, type Theme } from "@smw/themes";
import { supportSessionAllowed } from "./support-session";
import { REQUEST_ID_HEADER, healthyMain, requestHost, resolveSchoolByHost } from "./host";
import { runAction } from "./action";

export const SESSION_COOKIE = "smw_session";

export interface CurrentSchool {
  id: string;
  slug: string;
  name: string;
  status: (typeof schools.$inferSelect)["status"];
  logoUrl: string | null;
  theme: Theme;
  setupCompleted: boolean;
  trialEndsAt: Date | null;
  studentCap: number;
  features: Set<string>;
  readOnly: boolean;
  /** Host of the main address, when it is verified and not broken. Null = the free address. */
  primaryHost: string | null;
  row: typeof schools.$inferSelect;
}

/** The school for this request's Host (subdomain or verified custom domain), with theme and modules. 404 when no school uses the host. */
export const getSchool = cache(async (): Promise<CurrentSchool> => {
  const h = await headers();
  const hit = await resolveSchoolByHost(requestHost(h));
  if (!hit) notFound();
  const id = hit.id;
  return withSchool(id, async (tx) => {
    const [row] = await tx.select().from(schools).where(eq(schools.id, id)).limit(1);
    if (!row) notFound();
    const [mods, plan, overrides, primary] = await Promise.all([
      tx.select().from(modules),
      row.planId ? tx.select().from(planModules).where(eq(planModules.planId, row.planId)) : Promise.resolve([]),
      tx.select().from(schoolModuleOverrides),
      tx.select({ hostname: schoolDomains.hostname, health: schoolDomains.health, certExpiresAt: schoolDomains.certExpiresAt, records: schoolDomains.records }).from(schoolDomains)
        .where(and(eq(schoolDomains.isPrimary, true), eq(schoolDomains.kind, "custom"), eq(schoolDomains.status, "verified"))).limit(1),
    ]);
    const ent = resolveEntitlements({
      status: row.status,
      modules: mods.map((m) => ({ key: m.key, stage: m.stage, requires: m.requires, core: m.core })),
      planModuleKeys: plan.map((p) => p.moduleKey),
      overrides,
    });
    return {
      id: row.id, slug: row.slug, name: row.name, status: row.status, logoUrl: safeImage(row.logoUrl),
      theme: themeOf(row.theme), setupCompleted: !!row.setupCompletedAt, trialEndsAt: row.trialEndsAt,
      studentCap: row.studentCap, features: ent.enabled, readOnly: ent.readOnly, row,
      primaryHost: primary[0] && healthyMain(primary[0]) ? primary[0].hostname : null,
    };
  });
});

/** The signed-in session on this school's host, or null. A session from another school never validates here. */
export const getSession = cache(async (): Promise<ValidSession | null> => {
  const school = await getSchool();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await new SchoolAuth(school.id).validate(token);
  if (!s || s.user.schoolId !== school.id) return null;
  // The school may have said "never" since the visit began: the next request ends it, unless an owner entered in an emergency.
  return (await supportSessionAllowed(school, s.supportStaffId)) ? s : null;
});

async function buildCtx(): Promise<{ ctx: Ctx; mustChange: boolean } | null> {
  const [school, session, h] = await Promise.all([getSchool(), getSession(), headers()]);
  if (!session) return null;
  return {
    // Support sessions never get stuck behind the school user's password change.
    mustChange: session.user.mustChangePassword && !session.supportStaffId,
    ctx: {
      schoolId: school.id, userId: session.user.id, role: session.user.role, name: session.user.name, grants: session.user.grants,
      features: school.features, readOnly: school.readOnly || session.readOnly,
      requestId: h.get(REQUEST_ID_HEADER) ?? undefined, ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
      supportStaffId: session.supportStaffId,
    },
  };
}

/** Ctx for pages: redirects to /login when signed out, and to /app/change-password while a default or temporary password is in use. */
export const requireCtx = cache(async (): Promise<Ctx> => {
  const r = await buildCtx();
  if (!r) redirect("/login");
  if (r.mustChange) redirect("/app/change-password");
  return r.ctx;
});

/**
 * Ctx for server actions and API routes: throws instead of redirecting. Layouts do not run for action POSTs, so the
 * must-change gate lives here too. The change-password and logout actions read the session directly and stay usable.
 */
export async function actionCtx(): Promise<Ctx> {
  const r = await buildCtx();
  if (!r) throw new UnauthenticatedError();
  if (r.mustChange) throw new ForbiddenError("Choose a new password first.");
  return r.ctx;
}

/** Host-only cookie: never sets Domain, so a session cannot leak to another school's subdomain. */
export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", expires: expiresAt });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export { primaryRedirect, type PrimaryRedirectInput } from "./primary";
export { runAction, formToObject, type ActionResult } from "./action";
export { trustedClientIp } from "./ip";

/**
 * The body of almost every server action: build the service for the signed-in user, run one method, return an ActionResult.
 *   export async function createStudent(fd: FormData) { return serviceAction(StudentService, (s) => s.create(formToObject(fd)), "Student added"); }
 */
export async function serviceAction<S, T>(Service: new (ctx: Ctx) => S, fn: (svc: S) => Promise<T>, message?: string) {
  return runAction(async () => fn(new Service(await actionCtx())), message);
}
