import { eq, schools, withConsole, withSchool } from "@smw/db";
import { sendDueAlerts, sendMails } from "./alerts";

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
} satisfies Record<string, () => Promise<unknown>>;
