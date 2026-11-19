import { and, eq, invoices, payments, platformAuditLogs, schools } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService, ValidationError } from "@smw/feature-kit";
import { offlinePaymentInput } from "./inputs";
import { Settlement } from "./settlement";
import { PdfBuilder } from "@smw/integrations";

/** Staff records a bank transfer, cheque, cash or UPI payment against an invoice; it settles exactly like an online one. */
export class OfflinePaymentService extends PlatformService {
  async record(input: unknown) {
    this.require("owner", "sales");
    const data = this.parse(offlinePaymentInput, input);
    return this.tx(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, data.invoiceId)).for("update");
      if (!inv) throw new NotFoundError("Invoice");
      if (inv.status !== "issued") throw new ConflictError(inv.status === "paid" ? "This invoice is already paid." : "This invoice was cancelled.");
      if (data.amountPaise !== inv.totalPaise) throw new ValidationError({ amountPaise: `Enter the full invoice amount, ${PdfBuilder.money(inv.totalPaise).replace("Rs.", "₹")}.` });
      const paidAt = data.paidOn ? new Date(`${data.paidOn}T12:00:00+05:30`) : new Date();
      const [pay] = await tx.insert(payments).values({
        schoolId: inv.schoolId, invoiceId: inv.id, amountPaise: data.amountPaise, method: data.method, status: "created",
        reference: data.reference, recordedBy: this.ctx.staffId, paidAt,
      }).returning();
      const r = await Settlement.apply(tx, pay!.id, { now: paidAt });
      const [school] = await tx.select({ name: schools.name }).from(schools).where(and(eq(schools.id, inv.schoolId))).limit(1);
      await tx.insert(platformAuditLogs).values({
        staffId: this.ctx.staffId, schoolId: inv.schoolId, action: "billing.offline_payment",
        summary: `Recorded ${data.method.replace("_", " ")} for ${inv.number} (${school?.name ?? "school"})`, meta: { invoiceId: inv.id, reference: data.reference ?? null },
      });
      return r;
    });
  }
}
