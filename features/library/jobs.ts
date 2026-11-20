import { eq, schools, withConsole } from "@smw/db";
import { OverdueReminderJob } from "./reminders";

/** Weekly or daily (the orchestrator adds the schedule; a loan is reminded at most once a week whatever the cadence). */
export default {
  "library.overdue-reminders": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    await new OverdueReminderJob(ids).run();
  },
} satisfies Record<string, () => Promise<unknown>>;
