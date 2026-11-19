import { PlanCatalog, type PublicPlan } from "@smw/onboarding";

/** Public plans from the database. An unreachable database shows "ask us" instead of broken prices. */
export async function loadPlans(): Promise<PublicPlan[]> {
  try { return await PlanCatalog.publicPlans(); } catch { return []; }
}
