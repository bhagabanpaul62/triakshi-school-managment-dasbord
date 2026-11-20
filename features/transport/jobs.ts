import { eq, schools, withConsole } from "@smw/db";
import { resyncSchoolTransport } from "./billing";
import { DocumentExpiryJob } from "./expiry";
import { todayIST } from "./vehicle-care";

/** Daily (the orchestrator adds the schedule): tell admins when a vehicle paper is 30 days, 7 days or 0 days from expiring. */
export default {
  "transport.document-expiry": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    await new DocumentExpiryJob(ids).run();
  },
  /** Monthly: fill the new academic year's transport months and re-price unpaid months after a stop fee change. */
  "transport.fee-sync": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    let failed = 0;
    for (const id of ids) {
      try { await resyncSchoolTransport(id, todayIST()); }
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "transport fee sync failed", schoolId: id, err: String(err) })); }
    }
    if (failed) throw new Error(`Transport fee sync failed for ${failed} of ${ids.length} schools`);
  },
} satisfies Record<string, () => Promise<unknown>>;
