import { env } from "@smw/config";
import type { invoices, schools } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import { dmy } from "./util";

/** GST tax invoice for one of our invoices. SAC 998431 (CA to confirm). */
export class InvoicePdf {
  static async render(inv: typeof invoices.$inferSelect, school: Pick<typeof schools.$inferSelect, "name" | "address" | "city" | "state" | "gstin">) {
    const e = env();
    const money = PdfBuilder.money;
    const pdf = await PdfBuilder.create();
    pdf.header({
      title: "TAX INVOICE", orgName: e.PLATFORM_LEGAL_NAME, orgLines: [`GSTIN: ${e.PLATFORM_GSTIN}`, `State: ${e.PLATFORM_STATE}`],
      rightLines: [`Invoice no: ${inv.number}`, `Date: ${dmy(inv.createdAt)}`, inv.status === "paid" ? `Paid on: ${dmy(inv.paidAt)}` : `Due: ${dmy(inv.dueAt)}`],
    });
    pdf.text("Bill to", { size: 9, color: [0.4, 0.4, 0.45] });
    pdf.text(school.name, { size: 11, bold: true });
    const place = [school.address, [school.city, school.state].filter(Boolean).join(", ")].filter(Boolean);
    for (const l of place) pdf.text(l!, { size: 9 });
    if (inv.schoolGstin ?? school.gstin) pdf.text(`GSTIN: ${inv.schoolGstin ?? school.gstin}`, { size: 9 });
    pdf.space(8);
    pdf.facts([["Place of supply", inv.placeOfSupply ?? school.state ?? "-"], ["SAC", inv.sacCode]]);
    pdf.table({
      columns: [{ label: "Description", width: 330 }, { label: "SAC", width: 60 }, { label: "Taxable value", width: 109, align: "right" }],
      rows: [[inv.description, inv.sacCode, money(inv.taxablePaise)]],
    });
    const tax: [string, string][] = inv.igstPaise > 0 ? [["IGST 18%", money(inv.igstPaise)]] : [["CGST 9%", money(inv.cgstPaise)], ["SGST 9%", money(inv.sgstPaise)]];
    pdf.totals([["Taxable value", money(inv.taxablePaise)], ...tax, ["Total", money(inv.totalPaise), true]]);
    pdf.space(24);
    pdf.text("This is a computer generated invoice and needs no signature.", { size: 8, color: [0.4, 0.4, 0.45] });
    return pdf.save();
  }
}
