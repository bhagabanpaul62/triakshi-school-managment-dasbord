import { and, asc, desc, eq, plans, withConsole } from "@smw/db";

export interface PublicPlan {
  id: string;
  key: string;
  name: string;
  studentCap: number;
  priceAnnualPaise: number;
  priceMonthlyPaise: number;
}

/** Plans shown on the marketing site and used to pick a plan by student count. */
export class PlanCatalog {
  /** Active public plans, newest version of each key, smallest first. Prices are paise, ex-GST. */
  static async publicPlans(): Promise<PublicPlan[]> {
    const rows = await withConsole((tx) => tx.select().from(plans)
      .where(and(eq(plans.isPublic, true), eq(plans.isActive, true))).orderBy(asc(plans.sortOrder), asc(plans.studentCap), desc(plans.version)));
    const seen = new Set<string>();
    return rows.filter((p) => !seen.has(p.key) && seen.add(p.key)).map((p) => ({
      id: p.id, key: p.key, name: p.name, studentCap: p.studentCap, priceAnnualPaise: p.priceAnnualPaise, priceMonthlyPaise: p.priceMonthlyPaise,
    }));
  }

  /** The smallest plan whose cap covers `students`; the largest public plan when none does; null with no plans. */
  static pick(list: PublicPlan[], students: number): PublicPlan | null {
    const sorted = [...list].sort((a, b) => a.studentCap - b.studentCap);
    return sorted.find((p) => p.studentCap >= students) ?? sorted.at(-1) ?? null;
  }
}
