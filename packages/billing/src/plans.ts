import { and, asc, desc, eq, inArray, modules, planModules, plans, withConsole, type Tx } from "@smw/db";

export interface PlanView {
  id: string; key: string; name: string; version: number; studentCap: number;
  priceAnnualPaise: number; priceMonthlyPaise: number;
  limits: Record<string, number | boolean>;
  modules: { key: string; name: string }[];
}

/** Public plans with their modules, read from the database (never hard-coded prices). */
export class PlanCatalog {
  /** The newest version of each plan key. Old versions stay for existing subscribers only. */
  static latestPerKey<T extends { key: string; version: number }>(rows: T[]): T[] {
    const best = new Map<string, T>();
    for (const r of rows) { const b = best.get(r.key); if (!b || r.version > b.version) best.set(r.key, r); }
    return [...best.values()];
  }

  /** Smallest plan that covers `students`; null means "talk to us" (above every cap). */
  static recommend<T extends { studentCap: number }>(list: T[], students: number): T | null {
    return [...list].sort((a, b) => a.studentCap - b.studentCap).find((p) => p.studentCap >= students) ?? null;
  }

  async publicPlans(tx?: Tx): Promise<PlanView[]> {
    const run = async (t: Tx) => {
      const rows = await t.select().from(plans).where(and(eq(plans.isPublic, true), eq(plans.isActive, true))).orderBy(asc(plans.sortOrder), desc(plans.version));
      return this.withModules(t, PlanCatalog.latestPerKey(rows).sort((a, b) => a.sortOrder - b.sortOrder));
    };
    return tx ? run(tx) : withConsole(run);
  }

  /** The newest active version of a plan by key (public or not), for checkout. */
  async byKey(tx: Tx, key: string): Promise<PlanView | null> {
    const rows = await tx.select().from(plans).where(and(eq(plans.key, key), eq(plans.isActive, true))).orderBy(desc(plans.version)).limit(1);
    return rows[0] ? (await this.withModules(tx, rows))[0]! : null;
  }

  private async withModules(tx: Tx, rows: (typeof plans.$inferSelect)[]): Promise<PlanView[]> {
    if (!rows.length) return [];
    const links = await tx.select({ planId: planModules.planId, key: modules.key, name: modules.name })
      .from(planModules).innerJoin(modules, eq(modules.key, planModules.moduleKey)).where(inArray(planModules.planId, rows.map((r) => r.id)));
    return rows.map((p) => ({
      id: p.id, key: p.key, name: p.name, version: p.version, studentCap: p.studentCap,
      priceAnnualPaise: p.priceAnnualPaise, priceMonthlyPaise: p.priceMonthlyPaise, limits: p.limits,
      modules: links.filter((l) => l.planId === p.id).map((l) => ({ key: l.key, name: l.name })),
    }));
  }
}
