import { and, eq, gte, lte } from "drizzle-orm";
import { users } from "@smw/db";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import transportFeature from "./feature";
import { DOCUMENT_LABEL, daysToExpiry, dueAlertDays } from "./rules";
import { vehicleDocumentAlerts, vehicleDocuments, vehicles } from "./schema";
import { todayIST } from "./vehicle-care";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * One school's paper-expiry alerts: admins get a notice (email by their own settings) 30 days before, 7 days before and on the day a
 * vehicle paper expires. Each (paper, expiry date, threshold) is claimed once, so a re-run or a catch-up never repeats it.
 */
export class DocumentExpiryAlerts extends SchoolService<"read" | "manage" | "self"> {
  protected feature = transportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Returns how many papers raised an alert. */
  async run(today = todayIST()): Promise<{ alerted: number }> {
    const alerted = await this.write("manage", async (tx) => {
      const docs = await tx.select({ id: vehicleDocuments.id, kind: vehicleDocuments.kind, expiresOn: vehicleDocuments.expiresOn, reg: vehicles.registrationNo, vehicleId: vehicles.id })
        .from(vehicleDocuments).innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
        .where(and(gte(vehicleDocuments.expiresOn, addDays(today, -7)), lte(vehicleDocuments.expiresOn, addDays(today, 30))));
      const reached = docs.flatMap((d) => dueAlertDays(d.expiresOn, today).map((days) => ({ d, days })));
      if (!reached.length) return 0;
      // Claim first: only rows we inserted are ours to announce, so two runs at once never both send.
      const claimed = await tx.insert(vehicleDocumentAlerts).values(reached.map(({ d, days }) => ({
        schoolId: this.ctx.schoolId, documentId: d.id, expiresOn: d.expiresOn, daysBefore: days, sentOn: today,
      }))).onConflictDoNothing().returning({ documentId: vehicleDocumentAlerts.documentId });
      const fresh = docs.filter((d) => claimed.some((c) => c.documentId === d.id));
      if (!fresh.length) return 0;

      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      for (const d of fresh) {
        const left = daysToExpiry(d.expiresOn, today);
        const what = `${DOCUMENT_LABEL[d.kind]} of ${d.reg}`;
        const title = left < 0 ? `${what} has expired` : left === 0 ? `${what} expires today` : `${what} expires in ${left} ${left === 1 ? "day" : "days"}`;
        const body = `Valid until ${d.expiresOn}. Renew it and upload the new copy on the vehicle page.`;
        await NotificationWriter.insert(tx, this.ctx.schoolId, admins.map((a) => ({ userId: a.id, topic: "work.update" as const, subject: { type: "vehicle-document", id: d.id }, title, body, href: `/app/transport/vehicles/${d.vehicleId}` })));
      }
      return fresh.length;
    }, (n) => ({ action: "document_alerts", entity: "Vehicle", summary: `Raised ${n} paper-expiry ${n === 1 ? "alert" : "alerts"}` }));
    return { alerted };
  }
}

/** The worker job "transport.document-expiry": every given school, once. One school failing does not stop the rest; the run fails at the end so the queue retries (safe: each alert is claimed once). */
export class DocumentExpiryJob {
  constructor(private readonly schoolIds: string[], private readonly today = todayIST()) {}

  async run(): Promise<{ schools: number; alerted: number; failed: number }> {
    const out = { schools: this.schoolIds.length, alerted: 0, failed: 0 };
    for (const id of this.schoolIds) {
      try { const r = await new DocumentExpiryAlerts(systemCtx(id, ["transport"])).run(this.today); out.alerted += r.alerted; }
      catch (err) { out.failed++; console.error(JSON.stringify({ level: "error", msg: "document expiry alerts failed", schoolId: id, err: String(err) })); }
    }
    if (out.failed) throw new Error(`Document expiry alerts failed for ${out.failed} of ${out.schools} schools`);
    return out;
  }
}
