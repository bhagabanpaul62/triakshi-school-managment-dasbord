import { modules, planModules, schoolModuleOverrides, schools, withConsole } from "@smw/db";
import { resolveEntitlements, systemCtx, type Ctx } from "@smw/feature-kit";

/**
 * The schools a website job may act for, each with a context that carries what the school really has: its modules, and read-only.
 * A school that is suspended, cancelled, waiting for approval or without the website module is left out; one that is read-only comes
 * back with `readOnly: true` so the job can wait instead of writing.
 */
export async function jobSchools(only?: string[]): Promise<Ctx[]> {
  const { mods, plans, overrides, rows } = await withConsole(async (tx) => ({
    mods: await tx.select().from(modules), plans: await tx.select().from(planModules), overrides: await tx.select().from(schoolModuleOverrides),
    rows: await tx.select({ id: schools.id, status: schools.status, planId: schools.planId }).from(schools),
  }));
  const info = mods.map((m) => ({ key: m.key, stage: m.stage, requires: m.requires, core: m.core }));
  const out: Ctx[] = [];
  for (const s of rows) {
    if (only && !only.includes(s.id)) continue;
    if (["pending", "rejected", "suspended", "cancelled"].includes(s.status)) continue;
    const { enabled, readOnly } = resolveEntitlements({
      status: s.status, modules: info, planModuleKeys: plans.filter((p) => p.planId === s.planId).map((p) => p.moduleKey), overrides: overrides.filter((o) => o.schoolId === s.id),
    });
    if (enabled.has("website")) out.push({ ...systemCtx(s.id, enabled), readOnly });
  }
  return out;
}
