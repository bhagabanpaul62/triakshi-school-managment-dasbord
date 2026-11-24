import { eq, schools, withConsole, withSchool } from "@smw/db";
import { sendDueAlerts, sendMails } from "./alerts";
import { ensureCredit } from "./leave-ledger";
import { todayIST } from "./stats";

/** Every 10 minutes (the orchestrator adds the schedule): absence alerts past their grace window go to the student login. */
export default {
  "attendance.send-alerts": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    const now = new Date();
    let failed = 0;
    for (const id of ids) {
      try { await sendMails(await withSchool(id, (tx) => sendDueAlerts(tx, id, now))); } // emails only after the notices and markers commit
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "absence alerts failed", schoolId: id, err: String(err) })); }
    }
    if (failed) throw new Error(`Absence alerts failed for ${failed} of ${ids.length} schools`);
  },
  /** Daily (the orchestrator adds the schedule): yearly leave credit and carry forward. Rows already there are skipped, so a rerun adds nothing. */
  "attendance.leave-credit": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    let failed = 0;
    for (const id of ids) {
      try { await withSchool(id, (tx) => ensureCredit(tx, id, todayIST())); }
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "leave credit failed", schoolId: id, err: String(err) })); }
    }
    if (failed) throw new Error(`Leave credit failed for ${failed} of ${ids.length} schools`);
  },
} satisfies Record<string, () => Promise<unknown>>;
