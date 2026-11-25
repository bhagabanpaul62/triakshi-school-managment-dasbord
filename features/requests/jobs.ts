import { eq, schools, withConsole } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { RequestService } from "./service";

/** Schedule (IST): requests.clock hourly 08:00 to 18:00. Every school in turn; one failing never stops the rest, and the run fails at the end so the queue retries. */
export async function runClock(now = new Date()) {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try { await new RequestService(systemCtx(id, ["requests", "messages"])).clock(now); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "requests.clock failed", schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`requests.clock failed for ${failed} of ${ids.length} schools`);
}

export default { "requests.clock": () => runClock() };
