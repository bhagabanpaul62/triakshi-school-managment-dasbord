import { ConsoleBillingService, CreditNoteService, TdsService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { staffActionCtx } from "@smw/runtime/console";
import { csvResponse } from "../../csv";

export const dynamic = "force-dynamic";
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const money = (p: number) => (p / 100).toFixed(2);

/** GET /billing/export/<kind>?<the screen's filters>: invoices, payments, credit-notes (refund register with ?settlement=refund) or tds (awaited report with ?status=awaited). */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const staff = await staffActionCtx();
    switch ((await params).kind) {
      case "invoices": return csvResponse(req, "invoices", (q) => new ConsoleBillingService(staff).invoices(q), [
        { label: "Invoice", value: (r) => r.number }, { label: "School", value: (r) => r.schoolName }, { label: "For", value: (r) => r.description }, { label: "Issued", value: (r) => day(r.createdAt) },
        { label: "Due date", value: (r) => day(r.dueAt) }, { label: "Total", value: (r) => money(r.totalPaise) }, { label: "Due now", value: (r) => money(r.duePaise) }, { label: "TDS withheld", value: (r) => money(r.tdsPaise) }, { label: "Status", value: (r) => r.status }]);
      case "payments": return csvResponse(req, "payments", (q) => new ConsoleBillingService(staff).payments(q), [
        { label: "Paid on", value: (r) => day(r.paidAt) }, { label: "School", value: (r) => r.schoolName }, { label: "Invoice", value: (r) => r.invoiceNumber }, { label: "Cash received", value: (r) => money(r.amountPaise) },
        { label: "TDS withheld", value: (r) => money(r.tdsPaise) }, { label: "Method", value: (r) => r.method }, { label: "Reference", value: (r) => r.reference }]);
      case "credit-notes": return csvResponse(req, "credit-notes", (q) => new CreditNoteService(staff).list(q), [
        { label: "Credit note", value: (r) => r.number }, { label: "Date", value: (r) => day(r.createdAt) }, { label: "School", value: (r) => r.schoolName }, { label: "Invoice", value: (r) => r.invoiceNumber },
        { label: "Kind", value: (r) => r.kind }, { label: "Reason", value: (r) => r.reason }, { label: "Taxable", value: (r) => money(r.taxablePaise) }, { label: "CGST", value: (r) => money(r.cgstPaise) },
        { label: "SGST", value: (r) => money(r.sgstPaise) }, { label: "IGST", value: (r) => money(r.igstPaise) }, { label: "Total", value: (r) => money(r.totalPaise) }, { label: "Settled as", value: (r) => r.settlement },
        { label: "Refund method", value: (r) => r.refundMethod }, { label: "Refund reference", value: (r) => r.refundReference }, { label: "Refunded on", value: (r) => r.refundedOn }]);
      case "tds": return csvResponse(req, "tds-certificates", (q) => new TdsService(staff).list(q), [
        { label: "School", value: (r) => r.schoolName }, { label: "Invoice", value: (r) => r.invoiceNumber }, { label: "Quarter", value: (r) => r.quarter }, { label: "Tax withheld", value: (r) => rupees(r.amountPaise) },
        { label: "Status", value: (r) => r.status }, { label: "Remind on", value: (r) => r.remindOn }, { label: "Uploaded", value: (r) => day(r.uploadedAt) }]);
      default: return new Response("Not found", { status: 404 });
    }
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
