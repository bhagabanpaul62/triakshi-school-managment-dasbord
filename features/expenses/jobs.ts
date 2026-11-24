import { eq, schools, withConsole, withSchool } from "@smw/db";
import { sendBudgetAlerts } from "./budgets";
import { runRecurringJob } from "./recurring";

/** Daily 02:00 IST (the orchestrator adds the schedule): draft the bills that are due, then tell people about budgets passing 80% and 100%. One school failing does not stop the rest. */
export default {
  "expenses.recurring": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    for (const schoolId of ids) {
      try {
        await withSchool(schoolId, async (tx) => { await runRecurringJob(tx, schoolId); await sendBudgetAlerts(tx, schoolId); });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "expenses recurring failed", schoolId, err: String(e) }));
      }
    }
  },
} satisfies Record<string, () => Promise<unknown>>;
