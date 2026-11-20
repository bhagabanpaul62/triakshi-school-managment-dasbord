import { eq, schools, withConsole } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { istDate } from "./bell";
import { GeneratorService } from "./generator-service";

/** Nightly (the orchestrator adds the schedule): a timetable draft whose publish day has come goes live. */
export default {
  "timetable.publish-due": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    const today = istDate(new Date());
    let failed = 0;
    for (const id of ids) {
      // shortcut: the run assumes notifications is on (covers dropped by the new week are told); the insert checks the table exists.
      try { await new GeneratorService(systemCtx(id, ["timetable", "notifications"])).publishDue(today); }
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "timetable publish failed", schoolId: id, err: String(err) })); }
    }
    if (failed) throw new Error(`Timetable publish failed for ${failed} of ${ids.length} schools`);
  },
} satisfies Record<string, () => Promise<unknown>>;
