import { modules, planModules, schoolModuleOverrides, schools, type Tx } from "@smw/db";
import { resolveEntitlements } from "@smw/feature-kit";

/** Modules each school has right now, computed the same way the school app does (resolveEntitlements). Fine at this scale: four queries, in memory. */
export async function entitlementsBySchool(tx: Tx) {
  const [mods, plans, overrides, rows] = await Promise.all([
    tx.select().from(modules), tx.select().from(planModules), tx.select().from(schoolModuleOverrides),
    tx.select({ id: schools.id, status: schools.status, planId: schools.planId }).from(schools),
  ]);
  const info = mods.map((m) => ({ key: m.key, stage: m.stage, requires: m.requires, core: m.core }));
  const out = new Map<string, Set<string>>();
  for (const s of rows) {
    const { enabled } = resolveEntitlements({
      status: s.status, modules: info,
      planModuleKeys: plans.filter((p) => p.planId === s.planId).map((p) => p.moduleKey),
      overrides: overrides.filter((o) => o.schoolId === s.id),
    });
    out.set(s.id, enabled);
  }
  return out;
}
