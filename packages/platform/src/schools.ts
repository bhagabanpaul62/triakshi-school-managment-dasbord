import { z } from "zod";
import { and, count, desc, eq, ilike, oneTimeTokens, or, plans, schoolDomains, schoolModuleOverrides, modules, invoices, schools, supportTickets, users, sql, SCHOOL_STATUSES as ALL_STATUSES, type SchoolStatus, type Tx } from "@smw/db";
import { Tokens } from "@smw/auth";
import { createSchool } from "@smw/onboarding";
import { ConflictError, NotFoundError, listQuerySchema, toPage, PlatformService, type ListQuery, type Page } from "@smw/feature-kit";
import { assertId, oneOf, createSchoolInput, overrideInput, type CreateSchoolInput } from "./inputs";
import { entitlementsBySchool } from "./entitlements";

const DAY = 86_400_000;
const SCHOOL_STATUSES: readonly SchoolStatus[] = ALL_STATUSES;

/** Active students of a school, counted from the students table (a platform-level read, so a plain SQL subquery). */
export const studentCountSql = sql<number>`(select count(*)::int from students st where st.school_id = ${schools.id} and st.status = 'active')`;

export interface CreatedSchool { schoolId: string; slug: string; adminUserId: string; inviteToken: string }

/**
 * Sales-assisted creation: delegates to @smw/onboarding createSchool (status "trial", already approved) inside the console
 * transaction, then adds the 7-day invite token for the welcome email.
 */
export async function createSchoolRecord(tx: Tx, input: CreateSchoolInput): Promise<CreatedSchool> {
  if (input.planId) {
    const [plan] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw new NotFoundError("Plan");
  }
  const r = await createSchool({
    name: input.name, slug: input.slug, adminName: input.adminName, email: input.adminEmail, planId: input.planId,
    board: input.board as never, state: input.state, city: input.city, trialDays: input.trialDays ?? 30, status: "trial",
  }, tx);
  const inviteToken = Tokens.generate();
  await tx.insert(oneTimeTokens).values({
    schoolId: r.schoolId, purpose: "invite", tokenHash: Tokens.hash(inviteToken), userId: r.adminUserId, expiresAt: new Date(Date.now() + 7 * DAY),
  });
  return { schoolId: r.schoolId, slug: r.slug, adminUserId: r.adminUserId, inviteToken };
}

export type SchoolRow = { id: string; slug: string; name: string; status: SchoolStatus; city: string | null; state: string | null; planName: string | null; planKey: string | null; studentCap: number; studentCount: number; trialEndsAt: Date | null; createdAt: Date };

/** Schools across the platform: search, filter, detail and every lifecycle action. Each change writes the platform audit log. */
export class SchoolAdminService extends PlatformService {
  async list(query: ListQuery = {}): Promise<Page<SchoolRow>> {
    this.require("owner", "support", "sales");
    const q = listQuerySchema.parse(query);
    const status = oneOf(q.filters.status, SCHOOL_STATUSES);
    const where = and(
      q.q ? or(ilike(schools.name, `%${q.q}%`), ilike(schools.slug, `%${q.q}%`), ilike(schools.city, `%${q.q}%`)) : undefined,
      status ? eq(schools.status, status) : undefined,
      q.filters.plan ? eq(plans.key, q.filters.plan) : undefined,
    );
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: schools.id, slug: schools.slug, name: schools.name, status: schools.status, city: schools.city, state: schools.state,
          planName: plans.name, planKey: plans.key, studentCap: schools.studentCap, studentCount: studentCountSql,
          trialEndsAt: schools.trialEndsAt, createdAt: schools.createdAt,
        }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(where)
          .orderBy(desc(schools.createdAt), schools.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  async detail(id: string) {
    this.require("owner", "support", "sales");
    assertId(id, "School");
    return this.tx(async (tx) => {
      const [row] = await tx.select({ school: schools, plan: plans, studentCount: studentCountSql }).from(schools)
        .leftJoin(plans, eq(plans.id, schools.planId)).where(eq(schools.id, id)).limit(1);
      if (!row) throw new NotFoundError("School");
      return row;
    });
  }

  /** Every module with this school's override (if any) and whether it is on right now. */
  async moduleStates(id: string) {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => {
      const [mods, overrides, ent] = await Promise.all([
        tx.select().from(modules).orderBy(modules.key),
        tx.select().from(schoolModuleOverrides).where(eq(schoolModuleOverrides.schoolId, id)),
        entitlementsBySchool(tx),
      ]);
      const on = ent.get(id) ?? new Set<string>();
      return mods.map((m) => {
        const o = overrides.find((x) => x.moduleKey === m.key);
        return { key: m.key, name: m.name, stage: m.stage, core: m.core, enabled: on.has(m.key), override: o ? { enabled: o.enabled, note: o.note, expiresAt: o.expiresAt } : null };
      });
    });
  }

  async domains(id: string) {
    this.require("owner", "support", "sales");
    return this.tx((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.schoolId, id)).orderBy(desc(schoolDomains.isPrimary), schoolDomains.hostname));
  }

  async invoices(id: string) {
    this.require("owner", "support", "sales");
    return this.tx((tx) => tx.select().from(invoices).where(eq(invoices.schoolId, id)).orderBy(desc(invoices.createdAt)).limit(50));
  }

  async tickets(id: string) {
    this.require("owner", "support", "sales");
    return this.tx((tx) => tx.select().from(supportTickets).where(eq(supportTickets.schoolId, id)).orderBy(desc(supportTickets.lastMessageAt)).limit(50));
  }

  /** Staff-visible users of a school (for the support-login picker). */
  async admins(id: string) {
    this.require("owner", "support");
    return this.tx((tx) => tx.select({ id: users.id, name: users.name, email: users.email, status: users.status }).from(users)
      .where(and(eq(users.schoolId, id), eq(users.role, "admin"))).orderBy(users.createdAt));
  }

  /** Sales-assisted creation: school in trial plus an invited administrator. Returns the invite token for the welcome email. */
  async create(input: unknown): Promise<CreatedSchool> {
    this.require("owner", "sales");
    const data = this.parse(createSchoolInput, input);
    return this.tx(async (tx) => {
      const r = await createSchoolRecord(tx, data);
      await this.audit(tx, "school.create", `Created school ${data.name} (${data.slug})`, r.schoolId, { plan: data.planId ?? null });
      return r;
    });
  }

  private async mutate<T>(id: string, fn: (tx: Tx, s: typeof schools.$inferSelect) => Promise<{ set: Partial<typeof schools.$inferInsert>; action: string; summary: string; meta?: Record<string, unknown>; result?: T }>) {
    assertId(id, "School");
    return this.tx(async (tx) => {
      const [s] = await tx.select().from(schools).where(eq(schools.id, id)).limit(1);
      if (!s) throw new NotFoundError("School");
      const r = await fn(tx, s);
      const [updated] = await tx.update(schools).set({ ...r.set, updatedAt: new Date() }).where(eq(schools.id, id)).returning();
      await this.audit(tx, r.action, r.summary.replace("{name}", s.name), id, r.meta);
      return updated!;
    });
  }

  private async setStatus(id: string, status: SchoolStatus, action: string, verb: string, reason?: string) {
    this.require("owner", "support");
    return this.mutate(id, async (_tx, s) => {
      notUnderReview(s);
      if (s.status === status) throw new ConflictError(`${s.name} is already ${status.replace("_", "-")}.`);
      return { set: { status, statusChangedAt: new Date() }, action, summary: `${verb} {name}${reason ? `: ${reason}` : ""}`, meta: { from: s.status, to: status, reason: reason ?? null } };
    });
  }

  async suspend(id: string, reason?: string) { return this.setStatus(id, "suspended", "school.suspend", "Suspended", reason); }
  async setReadOnly(id: string, reason?: string) { return this.setStatus(id, "read_only", "school.read_only", "Made read-only", reason); }

  /** Back to work: `trial` while the trial runs, otherwise `active`. Clears a scheduled deletion. */
  async reactivate(id: string) {
    this.require("owner", "support");
    return this.mutate(id, async (_tx, s) => {
      notUnderReview(s);
      if (s.status === "active" || s.status === "trial") throw new ConflictError(`${s.name} is already running.`);
      const status: SchoolStatus = s.trialEndsAt && s.trialEndsAt > new Date() ? "trial" : "active";
      return { set: { status, statusChangedAt: new Date(), deletionScheduledAt: null }, action: "school.reactivate", summary: "Reactivated {name}", meta: { from: s.status, to: status } };
    });
  }

  /** Add days to the trial, counted from today when the trial already ended. A lapsed read-only trial opens again. */
  async extendTrial(id: string, days: number) {
    this.require("owner", "sales");
    const n = this.parse(overrideDays, days);
    return this.mutate(id, async (_tx, s) => {
      notUnderReview(s);
      const base = s.trialEndsAt && s.trialEndsAt > new Date() ? s.trialEndsAt : new Date();
      const trialEndsAt = new Date(base.getTime() + n * DAY);
      return {
        set: { trialEndsAt, ...(s.status === "read_only" ? { status: "trial" as const, statusChangedAt: new Date() } : {}) },
        action: "school.extend_trial", summary: `Extended trial of {name} by ${n} days`, meta: { days: n, trialEndsAt: trialEndsAt.toISOString() },
      };
    });
  }

  /** Move to another plan: sets plan_id and the student cap. */
  async changePlan(id: string, planId: string) {
    this.require("owner", "sales");
    return this.mutate(id, async (tx, s) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) throw new NotFoundError("Plan");
      if (!plan.isActive) throw new ConflictError("That plan is switched off.");
      return { set: { planId: plan.id, studentCap: plan.studentCap }, action: "school.change_plan", summary: `Moved {name} to ${plan.name} v${plan.version}`, meta: { from: s.planId, to: plan.id } };
    });
  }

  /** Mark the school's data for deletion in 30 days. Reactivating cancels it. Owner only. */
  async scheduleDeletion(id: string) {
    this.require("owner");
    return this.mutate(id, async () => {
      const at = new Date(Date.now() + 30 * DAY);
      return { set: { deletionScheduledAt: at }, action: "school.schedule_deletion", summary: "Scheduled deletion of {name}", meta: { at: at.toISOString() } };
    });
  }

  /** Force one module on or off for this school, with a note and an optional expiry. */
  async setOverride(id: string, input: unknown) {
    this.require("owner", "support");
    const d = this.parse(overrideInput, input);
    assertId(id, "School");
    return this.tx(async (tx) => {
      const [m] = await tx.select().from(modules).where(eq(modules.key, d.moduleKey)).limit(1);
      if (!m) throw new NotFoundError("Module");
      const expiresAt = d.expiresAt ? new Date(`${d.expiresAt}T23:59:59+05:30`) : null;
      const values = { enabled: d.enabled, note: d.note ?? null, expiresAt, setBy: this.ctx.staffId };
      await tx.insert(schoolModuleOverrides).values({ schoolId: id, moduleKey: d.moduleKey, ...values })
        .onConflictDoUpdate({ target: [schoolModuleOverrides.schoolId, schoolModuleOverrides.moduleKey], set: { ...values, updatedAt: new Date() } });
      await this.audit(tx, "school.override", `${d.enabled ? "Enabled" : "Disabled"} ${m.name} for the school`, id, { module: d.moduleKey, enabled: d.enabled, note: d.note ?? null, expiresAt: expiresAt?.toISOString() ?? null });
    });
  }

  async removeOverride(id: string, moduleKey: string) {
    this.require("owner", "support");
    return this.tx(async (tx) => {
      await tx.delete(schoolModuleOverrides).where(and(eq(schoolModuleOverrides.schoolId, id), eq(schoolModuleOverrides.moduleKey, moduleKey)));
      await this.audit(tx, "school.override_removed", `Removed the ${moduleKey} override`, id, { module: moduleKey });
    });
  }
}

/** Pending and rejected schools are decided in Approvals only; no other lifecycle action may skip the review. */
function notUnderReview(s: { name: string; status: SchoolStatus }) {
  if (s.status === "pending" || s.status === "rejected") throw new ConflictError(`${s.name} is ${s.status}. Approve it from Approvals first.`);
}

const overrideDays = z.coerce.number().int().min(1, "Add at least 1 day").max(365, "At most 365 days");
