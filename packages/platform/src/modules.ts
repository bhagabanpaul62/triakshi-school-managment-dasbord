import { auditLogs, eq, gte, modules, plans, planModules, schools, sql, count, type ModuleStage } from "@smw/db";
import { NotFoundError, PlatformService } from "@smw/feature-kit";
import { stageInput } from "./inputs";
import { entitlementsBySchool } from "./entitlements";

/** The module catalogue: stage, how many schools have each module on, and 30-day usage from the audit log. */
export class ModuleAdminService extends PlatformService {
  async list() {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [mods, ent, usage, inPlans] = await Promise.all([
        tx.select().from(modules).orderBy(modules.key),
        entitlementsBySchool(tx),
        tx.select({ module: auditLogs.module, n: sql<number>`count(distinct ${auditLogs.schoolId})::int` }).from(auditLogs).where(gte(auditLogs.createdAt, since)).groupBy(auditLogs.module),
        tx.select({ key: planModules.moduleKey, n: count() }).from(planModules).innerJoin(plans, eq(plans.id, planModules.planId)).groupBy(planModules.moduleKey),
      ]);
      const [{ n: schoolCount } = { n: 0 }] = await tx.select({ n: count() }).from(schools);
      return mods.map((m) => ({
        ...m,
        schoolsEnabled: [...ent.values()].filter((s) => s.has(m.key)).length,
        schoolCount: Number(schoolCount),
        activeSchools30d: usage.find((u) => u.module === m.key)?.n ?? 0,
        plansIncluding: Number(inPlans.find((p) => p.key === m.key)?.n ?? 0),
      }));
    });
  }

  async setStage(key: string, stage: ModuleStage) {
    this.require("owner");
    const s = this.parse(stageInput, stage);
    return this.tx(async (tx) => {
      const [m] = await tx.update(modules).set({ stage: s }).where(eq(modules.key, key)).returning();
      if (!m) throw new NotFoundError("Module");
      await this.audit(tx, "module.stage", `Moved ${m.name} to ${s}`, null, { module: key, stage: s });
      return m;
    });
  }
}
