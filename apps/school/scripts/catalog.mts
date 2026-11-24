// The product catalogue: modules come from the feature registry (code), the default plans are created once.
// Used by the local seed and by `pnpm --filter @smw/school bootstrap` on a production database.
import { modules, planModules, plans, type Tx } from "@smw/db";
import { FEATURES } from "../src/generated/features";

type PlanDef = { key: string; name: string; studentCap: number; annual: number; monthly: number; exclude: string[]; isPublic?: boolean };

export const PLAN_DEFS: PlanDef[] = [
  { key: "starter", name: "Starter", studentCap: 300, annual: 30_000_00, monthly: 3_000_00, exclude: ["domains", "transport", "library", "expenses", "payroll", "api"] },
  { key: "growth", name: "Growth", studentCap: 1000, annual: 75_000_00, monthly: 7_500_00, exclude: ["payroll", "api"] },
  { key: "pro", name: "Pro", studentCap: 3000, annual: 1_80_000_00, monthly: 18_000_00, exclude: [] },
  { key: "enterprise", name: "Enterprise", studentCap: 100000, annual: 0, monthly: 0, exclude: [], isPublic: false },
];

/**
 * Upserts every module (safe on every deploy); creates the default plans only when there are none. A module seen for the
 * first time joins the existing default plans; modules the console took out of a plan stay out. Returns plan ids by key.
 */
export async function syncCatalog(tx: Tx): Promise<Record<string, string>> {
  const known = new Set((await tx.select({ key: modules.key }).from(modules)).map((m) => m.key));
  for (const f of FEATURES) {
    const row = { key: f.key, name: f.name, stage: f.stage, requires: [...(f.requires ?? [])], core: !!f.core, description: f.description };
    await tx.insert(modules).values(row).onConflictDoUpdate({ target: modules.key, set: row });
  }
  const existing = await tx.select({ id: plans.id, key: plans.key }).from(plans);
  if (existing.length) {
    const fresh = FEATURES.filter((f) => !f.core && !known.has(f.key)).map((f) => f.key);
    const rows = existing.flatMap((p) => {
      const def = PLAN_DEFS.find((d) => d.key === p.key);
      return def ? fresh.filter((k) => !def.exclude.includes(k)).map((moduleKey) => ({ planId: p.id, moduleKey })) : [];
    });
    if (rows.length) await tx.insert(planModules).values(rows).onConflictDoNothing();
    return Object.fromEntries(existing.map((p) => [p.key, p.id]));
  }

  const planIds: Record<string, string> = {};
  for (const [i, p] of PLAN_DEFS.entries()) {
    const [plan] = await tx.insert(plans).values({ key: p.key, name: p.name, studentCap: p.studentCap, priceAnnualPaise: p.annual, priceMonthlyPaise: p.monthly,
      isPublic: p.isPublic ?? true, sortOrder: i, limits: { websitePages: p.key === "starter" ? 5 : 20, fullThemeEditor: p.key !== "starter", customDomain: p.key !== "starter" } }).returning();
    planIds[p.key] = plan!.id;
    const keys = FEATURES.filter((f) => !f.core && !p.exclude.includes(f.key)).map((f) => f.key);
    if (keys.length) await tx.insert(planModules).values(keys.map((moduleKey) => ({ planId: plan!.id, moduleKey })));
  }
  return planIds;
}
