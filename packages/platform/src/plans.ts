import { max } from "drizzle-orm";
import { and, count, desc, eq, inArray, modules, planModules, plans, schools } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService } from "@smw/feature-kit";
import { planEditInput } from "./inputs";

/** Plans are versioned: an edit adds a new row (same key, version + 1), so schools on the old plan keep their plan_id and price. */
export class PlanAdminService extends PlatformService {
  async list() {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => {
      const [rows, links, subs] = await Promise.all([
        tx.select().from(plans).orderBy(plans.sortOrder, plans.key, desc(plans.version)),
        tx.select().from(planModules),
        tx.select({ planId: schools.planId, n: count() }).from(schools).groupBy(schools.planId),
      ]);
      const latest = new Map<string, number>();
      for (const p of rows) latest.set(p.key, Math.max(latest.get(p.key) ?? 0, p.version));
      return rows.map((p) => ({
        ...p,
        moduleKeys: links.filter((l) => l.planId === p.id).map((l) => l.moduleKey).sort(),
        schools: Number(subs.find((s) => s.planId === p.id)?.n ?? 0),
        isLatest: latest.get(p.key) === p.version,
      }));
    });
  }

  /** Save an edit as a new version. The old version stays for its subscribers and is hidden from new signups. */
  async edit(planId: string, input: unknown) {
    this.require("owner");
    const d = this.parse(planEditInput, input);
    return this.tx(async (tx) => {
      const [old] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!old) throw new NotFoundError("Plan");
      const [{ v } = { v: old.version }] = await tx.select({ v: max(plans.version) }).from(plans).where(eq(plans.key, old.key));
      if (old.version !== v) throw new ConflictError("A newer version of this plan exists. Edit that one.");
      const known = d.moduleKeys.length ? await tx.select({ key: modules.key }).from(modules).where(inArray(modules.key, d.moduleKeys)) : [];
      if (known.length !== new Set(d.moduleKeys).size) throw new NotFoundError("Module");
      const [fresh] = await tx.insert(plans).values({
        key: old.key, name: d.name, version: old.version + 1, studentCap: d.studentCap, priceAnnualPaise: d.priceAnnualPaise,
        priceMonthlyPaise: d.priceMonthlyPaise, limits: old.limits, isPublic: d.isPublic, isActive: old.isActive, sortOrder: old.sortOrder,
      }).returning();
      if (known.length) await tx.insert(planModules).values(known.map((m) => ({ planId: fresh!.id, moduleKey: m.key })));
      await tx.update(plans).set({ isPublic: false }).where(eq(plans.id, old.id));
      await this.audit(tx, "plan.version", `Saved ${d.name} v${fresh!.version}`, null, { key: old.key, from: old.id, to: fresh!.id });
      return fresh!;
    });
  }

  async setFlags(planId: string, flags: { isPublic?: boolean; isActive?: boolean }) {
    this.require("owner");
    return this.tx(async (tx) => {
      const [p] = await tx.update(plans).set({ ...(flags.isPublic !== undefined && { isPublic: flags.isPublic }), ...(flags.isActive !== undefined && { isActive: flags.isActive }) })
        .where(and(eq(plans.id, planId))).returning();
      if (!p) throw new NotFoundError("Plan");
      await this.audit(tx, "plan.flags", `${p.name} v${p.version}: public ${p.isPublic ? "on" : "off"}, active ${p.isActive ? "on" : "off"}`, null, flags);
      return p;
    });
  }
}
