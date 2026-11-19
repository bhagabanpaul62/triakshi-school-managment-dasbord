import { eq, schools, withConsole } from "@smw/db";
import { FeeReminderJob } from "./reminders";

/** Daily (the orchestrator adds the schedule): remind guardians of installments that just fell overdue. */
export default {
  "fees.overdue-reminders": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    await new FeeReminderJob(ids).run();
  },
} satisfies Record<string, () => Promise<unknown>>;
