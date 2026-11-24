import { env } from "@smw/config";
import type { schools } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import { dmy } from "./util";
import type { Statement } from "./statement";

const day = (d: string) => dmy(`${d}T12:00:00+05:30`);

/** Account statement: what the school was billed, paid and credited, with the running balance. */
export class StatementPdf {
  static async render(school: Pick<typeof schools.$inferSelect, "name" | "address" | "city" | "state" | "gstin">, s: Statement) {
    const money = PdfBuilder.money;
    const pdf = await PdfBuilder.create();
    pdf.header({
      title: "ACCOUNT STATEMENT", orgName: env().PLATFORM_LEGAL_NAME, orgLines: [`GSTIN: ${env().PLATFORM_GSTIN}`],
      rightLines: [`From: ${day(s.from)}`, `To: ${day(s.to)}`],
    });
    pdf.text(school.name, { size: 11, bold: true });
    for (const l of [school.address, [school.city, school.state].filter(Boolean).join(", ")].filter(Boolean)) pdf.text(l!, { size: 9 });
    pdf.space(8);
    const bal = (p: number) => (p < 0 ? `${money(-p)} credit` : money(p));
    pdf.table({
      columns: [{ label: "Date", width: 62 }, { label: "Document", width: 110 }, { label: "Details", width: 130 }, { label: "Debit", width: 62, align: "right" }, { label: "Credit", width: 62, align: "right" }, { label: "Balance", width: 73, align: "right" }],
      rows: [["", "Opening balance", "", "", "", bal(s.openingPaise)], ...s.rows.map((r) => [dmy(r.at), r.ref, r.text, r.debitPaise ? money(r.debitPaise) : "", r.creditPaise ? money(r.creditPaise) : "", bal(r.balancePaise)])],
    });
    pdf.totals([["Billed and refunded", money(s.debitPaise)], ["Paid and credited", money(s.creditPaise)], [s.closingPaise < 0 ? "Credit with us" : "You owe", money(Math.abs(s.closingPaise)), true]]);
    pdf.space(20);
    pdf.text("This is a computer generated statement and needs no signature.", { size: 8, color: [0.4, 0.4, 0.45] });
    return pdf.save();
  }
}
