import { inArray, schools, withConsole } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { LifecycleService } from "./lifecycle-service";

/** Daily 00:10 IST (the schedule is in apps/worker/src/registry.ts): every child whose joining day has come becomes an active student. */
export default {
  "students.join-due": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(inArray(schools.status, ["trial", "active", "past_due"])))).map((s) => s.id);
    let failed = 0;
    for (const id of ids) {
      try {
        // shortcut: the run assumes notifications is on; the writer drops rows for people who cannot be told.
        const r = await new LifecycleService(systemCtx(id, ["students", "academics", "notifications"])).joinDue();
        failed += r.failed;
      } catch (err) {
        failed++;
        console.error(JSON.stringify({ level: "error", msg: "join-due failed", schoolId: id, err: String(err) }));
      }
    }
    if (failed) throw new Error(`Joining failed for ${failed} students or schools`);
  },
} satisfies Record<string, () => Promise<unknown>>;
