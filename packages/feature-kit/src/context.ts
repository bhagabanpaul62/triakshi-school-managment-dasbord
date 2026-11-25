import type { SchoolRole, StaffRole } from "@smw/db";
import { ForbiddenError } from "./errors";

/** Everything a school service needs to know about the caller. Built per request by @smw/runtime; plain data, so a mobile API reuses it. */
export interface Ctx {
  schoolId: string;
  userId: string;
  role: SchoolRole;
  name: string;
  /** Module keys on for this school right now. */
  features: ReadonlySet<string>;
  /** Read-only school, or a read-only support session. */
  readOnly: boolean;
  requestId?: string;
  ip?: string;
  /** Custom-role grants like "fees:write". Undefined = each feature.ts default list for `role`. */
  grants?: ReadonlySet<string>;
  /** Set when platform staff act through support login. */
  supportStaffId?: string | null;
  /** Set only for a student who has left: the last day (IST, `YYYY-MM-DD`) this login still works. `features` is already cut to what such a login keeps. */
  leftUntil?: string;
}

/** Caller in the platform console. */
export interface StaffCtx {
  staffId: string;
  role: StaffRole;
  name: string;
  requestId?: string;
}

/** A system context for jobs and seeds acting as the school admin. */
export function systemCtx(schoolId: string, features: Iterable<string>, userId = "00000000-0000-0000-0000-000000000000"): Ctx {
  return { schoolId, userId, role: "admin", name: "System", features: new Set(features), readOnly: false };
}

/** The one permission rule: the module is on and the caller holds `feature:permission` (custom role) or their base role is listed (default). */
export function allows(ctx: Pick<Ctx, "role" | "features" | "grants">, feature: { key: string; permissions: Record<string, readonly SchoolRole[]> }, permission: string): boolean {
  if (!ctx.features.has(feature.key)) return false;
  return ctx.grants ? ctx.grants.has(`${feature.key}:${permission}`) : (feature.permissions[permission] ?? []).includes(ctx.role);
}

/** Support sessions look, they never act on private things. No-op for a normal session; in support it logs who tried what (no content) and refuses. */
export function refuseSupport(ctx: Pick<Ctx, "schoolId" | "supportStaffId">, what: string): void {
  if (!ctx.supportStaffId) return;
  console.warn(JSON.stringify({ level: "warn", msg: "support session refused", schoolId: ctx.schoolId, supportStaffId: ctx.supportStaffId, what }));
  throw new ForbiddenError("Not available in a support session.");
}

/** May Triakshi staff be inside this school now? `always`, `until` (only before the time), or `never`. One rule for making a link and for every request of a support session. */
export function supportMayEnter(s: { supportAccess: string; supportAccessUntil: Date | null }, now = new Date()): boolean {
  return s.supportAccess === "always" || (s.supportAccess === "until" && !!s.supportAccessUntil && s.supportAccessUntil > now);
}
