import { env } from "@smw/config";
import type { creditNotes, invoices, schools } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import { dmy } from "./util";

const SETTLED_AS = {
  adjusted: "Taken off the unpaid invoice.",
  refund: "To be paid back to you.",
  credit: "Kept as credit on your account. It is used on your next invoice.",
} as const;

/** GST credit note, laid out like the tax invoice it corrects. */
export class CreditNotePdf {
  static async render(note: typeof creditNotes.$inferSelect, inv: Pick<typeof invoices.$inferSelect, "number" | "createdAt" | "placeOfSupply" | "schoolGstin" | "sacCode">, school: Pick<typeof schools.$inferSelect, "name" | "address" | "city" | "state" | "gstin">) {
    const e = env();
    const money = PdfBuilder.money;
    const pdf = await PdfBuilder.create();
    pdf.header({
      title: "CREDIT NOTE", orgName: e.PLATFORM_LEGAL_NAME, orgLines: [`GSTIN: ${e.PLATFORM_GSTIN}`, `State: ${e.PLATFORM_STATE}`],
      rightLines: [`Credit note no: ${note.number}`, `Date: ${dmy(note.createdAt)}`, `Against invoice: ${inv.number} (${dmy(inv.createdAt)})`],
    });
    pdf.text("Issued to", { size: 9, color: [0.4, 0.4, 0.45] });
    pdf.text(school.name, { size: 11, bold: true });
    for (const l of [school.address, [school.city, school.state].filter(Boolean).join(", ")].filter(Boolean)) pdf.text(l!, { size: 9 });
    if (inv.schoolGstin ?? school.gstin) pdf.text(`GSTIN: ${inv.schoolGstin ?? school.gstin}`, { size: 9 });
    pdf.space(8);
    pdf.facts([["Place of supply", inv.placeOfSupply ?? school.state ?? "-"], ["SAC", inv.sacCode], ["Settled", SETTLED_AS[note.settlement]]]);
    pdf.table({
      columns: [{ label: "Reason", width: 330 }, { label: "SAC", width: 60 }, { label: "Taxable value", width: 109, align: "right" }],
      rows: [[note.reason, inv.sacCode, money(note.taxablePaise)]],
    });
    const tax: [string, string][] = note.igstPaise > 0 ? [["IGST 18%", money(note.igstPaise)]] : [["CGST 9%", money(note.cgstPaise)], ["SGST 9%", money(note.sgstPaise)]];
    pdf.totals([["Taxable value", money(note.taxablePaise)], ...tax, ["Credit total", money(note.totalPaise), true]]);
    pdf.space(24);
    pdf.text("This is a computer generated credit note and needs no signature.", { size: 8, color: [0.4, 0.4, 0.45] });
    return pdf.save();
  }
}
