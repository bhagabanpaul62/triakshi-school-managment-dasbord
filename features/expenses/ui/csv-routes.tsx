import { actionCtx } from "@smw/runtime";
import { csvResponse } from "../csv-route";
import { BillService, ClaimService, IncomeService, PaymentService, VendorService } from "../service";

const rupees = (p: number) => (p / 100).toFixed(2);

export async function billsCsv(req: Request) {
  const svc = new BillService(await actionCtx());
  return csvResponse(req, "bills", (q) => svc.list(q), [
    { label: "Bill no", value: (r) => r.billNo }, { label: "Vendor", value: (r) => r.vendorName }, { label: "Bill date", value: (r) => r.billDate }, { label: "Due date", value: (r) => r.dueDate },
    { label: "State", value: (r) => r.state }, { label: "Gross", value: (r) => rupees(r.grossPaise) }, { label: "TDS", value: (r) => rupees(r.tdsPaise) }, { label: "Net", value: (r) => rupees(r.netPaise) },
    { label: "Paid", value: (r) => rupees(r.paidPaise) }, { label: "Open", value: (r) => rupees(r.openPaise) },
  ]);
}
export async function paymentsCsv(req: Request) {
  const svc = new PaymentService(await actionCtx());
  return csvResponse(req, "payments", (q) => svc.list(q), [
    { label: "Voucher", value: (r) => r.number }, { label: "Date", value: (r) => r.date }, { label: "Vendor", value: (r) => r.vendorName }, { label: "Bills", value: (r) => r.billNos },
    { label: "Method", value: (r) => r.method }, { label: "Reference", value: (r) => r.reference }, { label: "Amount", value: (r) => rupees(r.amountPaise) }, { label: "Status", value: (r) => r.status },
  ]);
}
export async function vendorsCsv(req: Request) {
  const svc = new VendorService(await actionCtx());
  return csvResponse(req, "vendors", (q) => svc.list(q), [
    { label: "Name", value: (r) => r.name }, { label: "Phone", value: (r) => r.phone }, { label: "GSTIN", value: (r) => r.gstin }, { label: "PAN (last 4)", value: (r) => r.panLast4 },
    { label: "TDS %", value: (r) => r.tdsBasisPoints / 100 }, { label: "Owed", value: (r) => rupees(r.owedPaise ?? 0) }, { label: "Active", value: (r) => (r.isActive ? "yes" : "no") },
  ]);
}
export async function claimsCsv(req: Request) {
  const svc = new ClaimService(await actionCtx());
  return csvResponse(req, "claims", (q) => svc.list(q), [
    { label: "Person", value: (r) => r.userName }, { label: "What for", value: (r) => r.title }, { label: "Spent on", value: (r) => r.spentOn }, { label: "Amount", value: (r) => rupees(r.amountPaise) },
    { label: "State", value: (r) => r.state }, { label: "Paid with", value: (r) => r.payWith }, { label: "Paid on", value: (r) => r.paidOn },
  ]);
}
export async function incomeCsv(req: Request) {
  const svc = new IncomeService(await actionCtx());
  return csvResponse(req, "other-income", (q) => svc.list(q), [
    { label: "Receipt", value: (r) => r.number }, { label: "Date", value: (r) => r.date }, { label: "From", value: (r) => r.fromName }, { label: "For", value: (r) => r.label },
    { label: "Method", value: (r) => r.method }, { label: "Amount", value: (r) => rupees(r.amountPaise) }, { label: "Status", value: (r) => r.status },
  ]);
}
