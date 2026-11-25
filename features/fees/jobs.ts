import { NotificationWriter } from "@smw/feature-notifications/writer";
import { and, eq, schools, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, systemCtx } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { ChecksService } from "./checks";
import { InvoiceService } from "./invoices";
import { ReminderService } from "./reminders";

/** Run `fn` for every active school. One school failing does not stop the rest; the job fails at the end so the queue retries (every job here is idempotent). A school with no academic year yet is skipped. */
async function eachSchool(name: string, fn: (schoolId: string) => Promise<unknown>) {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try { await fn(id); } catch (err) {
      if (err instanceof ConflictError) continue;
      failed++;
      console.error(JSON.stringify({ level: "error", msg: `${name} failed`, schoolId: id, err: String(err) }));
    }
  }
  if (failed) throw new Error(`${name} failed for ${failed} of ${ids.length} schools`);
}

/** Schedules (IST): fees.issue-invoices daily 01:00, fees.reminders daily 09:00, fees.control-checks daily 03:00. */
export default {
  "fees.issue-invoices": () => eachSchool("fees.issue-invoices", (id) => new InvoiceService(systemCtx(id, ["fees"])).issueBulk({}, todayIST())),
  "fees.reminders": () => eachSchool("fees.reminders", (id) => new ReminderService(systemCtx(id, ["fees"])).run()),
  "fees.control-checks": () => eachSchool("fees.control-checks", async (id) => {
    const { mismatches } = await new ChecksService(systemCtx(id, ["fees"])).run();
    if (!mismatches.length) return;
    await withSchool(id, async (tx) => {
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      await NotificationWriter.insert(tx, id, admins.map((a) => ({ userId: a.id, topic: "work.update" as const, subject: { type: "fee-checks", id: "books" }, groupKey: "fee-books-mismatch", title: "The fee books do not match", body: `${mismatches.length} check${mismatches.length === 1 ? "" : "s"} failed. Open Finance to see which.`, href: "/app/fees" })));
    });
  }),
} satisfies Record<string, () => Promise<unknown>>;
