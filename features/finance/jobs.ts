import { and, eq, schools, users, withConsole, withSchool } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { runControlChecks, type ControlCheck } from "./services/control";

/** Nightly (the orchestrator adds the schedule): run the ledger checks and any the worker passes in for every active school and tell its admins if the books disagree. One school failing does not stop the rest. */
export const financeJobs = (extra: ControlCheck[] = []) => ({
  "finance.control-checks": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    for (const schoolId of ids) {
      try {
        await withSchool(schoolId, async (tx) => {
          const found = await runControlChecks(tx, schoolId, extra);
          if (!found.length) return;
          const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
          await NotificationWriter.insert(tx, schoolId, admins.map((a) => ({
            userId: a.id, kind: "system" as const, title: "The books do not match",
            body: `${found.length} problem${found.length === 1 ? "" : "s"}. First: ${found[0]!.problem}`, href: "/app/finance",
          })));
        });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "finance control checks failed", schoolId, err: String(e) }));
      }
    }
  },
}) satisfies Record<string, () => Promise<unknown>>;

/** The worker adds fees, expenses and payroll checks with `financeJobs([...])`; this plain export runs the ledger checks alone. */
export default financeJobs();
