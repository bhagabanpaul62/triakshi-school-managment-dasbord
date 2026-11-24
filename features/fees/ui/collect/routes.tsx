import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { CertificateService, ReceiptService } from "../../service";
import { DeskService } from "./desk-service";
import { csvCell } from "./logic";
import { PdfBuilder } from "@smw/integrations";
import { listQueryFrom } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";

type Ids = { params: Promise<{ id: string }> };
const pdf = (f: { filename: string; bytes: Uint8Array }) => new Response(Buffer.from(f.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${f.filename}"`, "cache-control": "private, no-store" } });
const fail = (err: unknown) => { if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status }); throw err; };

/** GET /app/fees/receipts/[id]/pdf: the service checks the caller may see it and logs the print (the second one says DUPLICATE). */
export async function receiptPdf(_r: Request, { params }: Ids) {
  try { return pdf(await new ReceiptService(await actionCtx()).receiptFile((await params).id)); } catch (e) { return fail(e); }
}

/** GET /app/fees/receipts/csv: the register with the same filters as the screen, up to 5,000 rows. */
export async function receiptsCsv(req: Request) {
  try {
    const desk = new DeskService(await actionCtx());
    const q = listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));
    const rows = [];
    for (let page = 1; page <= 50; page++) {
      const r = await desk.register({ ...q, page, pageSize: 100 });
      rows.push(...r.rows);
      if (page >= r.pageCount) break;
    }
    const head = ["Receipt", "Date", "Student", "Class", "Methods", "Amount", "Status", "Cashier"];
    const body = [head, ...rows.map((r) => [r.number, r.date, r.studentName, r.classLabel, r.methods, (r.amountPaise / 100).toFixed(2), r.status, r.cashier])].map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new Response(`${"﻿"}${body}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="receipts.csv"', "cache-control": "private, no-store" } });
  } catch (e) { return fail(e); }
}

/** GET /app/fees/counter/[id]/slip */
export async function counterSlip(_r: Request, { params }: Ids) {
  try { return pdf(await new DeskService(await actionCtx()).counterSlipPdf((await params).id)); } catch (e) { return fail(e); }
}
/** GET /app/fees/cheques/slip?ids=a,b */
export async function chequeSlip(req: Request) {
  try { return pdf(await new DeskService(await actionCtx()).chequeSlipPdf((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean))); } catch (e) { return fail(e); }
}
/** GET /app/fees/refunds/[id]/voucher */
export async function refundVoucher(_r: Request, { params }: Ids) {
  try { return pdf(await new DeskService(await actionCtx()).refundVoucherPdf((await params).id)); } catch (e) { return fail(e); }
}

/** GET /app/fees/pay/statement?student=id: the statement of account, all years. A student login gets only their own. */
export async function statementPdf(req: Request) {
  try {
    const ctx = await actionCtx();
    const studentId = new URL(req.url).searchParams.get("student") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) return Response.json({ error: "Student not found" }, { status: 404 });
    const [st, school] = await Promise.all([new CertificateService(ctx).statement(studentId), new DeskService(ctx).config()]);
    const money = PdfBuilder.money, doc = await PdfBuilder.create();
    doc.header({ title: "STATEMENT OF ACCOUNT", orgName: school.school.name, rightLines: [`Date: ${school.today}`] });
    doc.facts([["Student", st.student.name], ["Admission no", st.student.admissionNo], ["Class", st.student.classLabel], ["Balance due", rupees(st.closingPaise)]]);
    doc.table({ columns: [{ label: "Date", width: 62 }, { label: "Entry", width: 188 }, { label: "Billed", width: 66, align: "right" }, { label: "Paid", width: 66, align: "right" }, { label: "Balance", width: 67, align: "right" }], rows: st.rows.map((r) => [r.date, r.memo, r.debitPaise ? money(r.debitPaise) : "", r.creditPaise ? money(r.creditPaise) : "", money(r.balancePaise)]) });
    doc.totals([["Balance due", money(st.closingPaise), true]]);
    return pdf({ filename: `statement-${st.student.admissionNo}.pdf`, bytes: await doc.save() });
  } catch (e) { return fail(e); }
}
