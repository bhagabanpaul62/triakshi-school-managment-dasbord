"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { rupees } from "@smw/feature-kit/money";
import type { UploadedFile } from "../files";
import {
  BillService, BudgetService, ClaimService, IncomeService, LookupService, PaymentService, PettyCashService, RecurringService, VendorService,
} from "../service";

const id = (fd: FormData, key = "id") => String(fd.get(key) ?? "");
/** The file field of a form as bytes; nothing when none was chosen. */
async function upload(fd: FormData, key = "file"): Promise<UploadedFile | undefined> {
  const f = fd.get(key);
  return f instanceof File && f.size > 0 ? { name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) } : undefined;
}
const body = (fd: FormData) => { const o = formToObject(fd); delete o.file; return o; };

// ---- vendors
export async function saveVendor(fd: FormData) {
  const o = body(fd);
  if (o.tdsPercent !== undefined) o.tdsBasisPoints = Math.round(Number(o.tdsPercent) * 100);
  delete o.tdsPercent; delete o.next;
  const r = await serviceAction(VendorService, (s) => (fd.get("id") ? s.update(id(fd), o) : s.create(o)));
  return r.ok ? { ...r, message: r.data.warnings?.length ? `Saved. Check: ${r.data.warnings.join(" ")}` : "Vendor saved" } : r;
}
export async function setVendorActive(fd: FormData) { return serviceAction(VendorService, (s) => s.setActive(id(fd), fd.get("active") === "1"), "Vendor updated"); }
export async function deleteVendor(fd: FormData) { return serviceAction(VendorService, (s) => s.remove(id(fd)), "Vendor deleted"); }
export async function revealVendor(vendorId: string) { return serviceAction(VendorService, (s) => s.reveal(vendorId)); }

// ---- bills
export async function saveBill(fd: FormData) {
  return serviceAction(BillService, async (s) => {
    const bill = await s.save(body(fd), await upload(fd));
    if (fd.get("submit") !== "1") return { id: bill.id, outcome: "draft" as const, warnings: [] as string[] };
    const r = await s.submit(bill.id);
    return { id: bill.id, outcome: r.outcome, warnings: r.warnings };
  });
}
export async function previewBill(input: string) { return serviceAction(BillService, (s) => s.preview(JSON.parse(input))); }
export async function submitBill(fd: FormData) {
  const r = await serviceAction(BillService, (s) => s.submit(id(fd)));
  return r.ok ? { ...r, message: `${r.data.outcome === "approved" ? "Approved and posted." : "Sent for approval."}${r.data.warnings.length ? ` ${r.data.warnings.join(" ")}` : ""}` } : r;
}
export async function submitBills(ids: string[]) { return serviceAction(BillService, (s) => s.submitMany(ids)); }
export async function withdrawBill(fd: FormData) { return serviceAction(BillService, (s) => s.withdraw(id(fd)), "Taken back to draft"); }
export async function cancelBill(fd: FormData) { return serviceAction(BillService, (s) => s.cancel(id(fd), String(fd.get("reason") ?? "")), "Bill cancelled"); }

// ---- payments
export async function previewPayment(input: string) { return serviceAction(PaymentService, (s) => s.preview(JSON.parse(input))); }
export async function payBills(fd: FormData) {
  const r = await serviceAction(PaymentService, (s) => s.pay(body(fd)));
  return r.ok ? { ...r, message: `Paid ${rupees(r.data.payment.amountPaise)}, voucher ${r.data.payment.number}.${r.data.warnings.length ? ` ${r.data.warnings.join(" ")}` : ""}` } : r;
}
export async function requestPaymentReversal(fd: FormData) { return serviceAction(PaymentService, (s) => s.requestReversal(id(fd), String(fd.get("reason") ?? "")), "Asked for approval to reverse"); }
export async function findVendors(q: string) { const r = await serviceAction(LookupService, (s) => s.vendors(q)); if (!r.ok) throw new Error(r.error); return r.data; }

// ---- petty cash
export async function saveFloat(fd: FormData) { return serviceAction(PettyCashService, (s) => s.create(body(fd)), "Float opened"); }
export async function topUpFloat(fd: FormData) { return serviceAction(PettyCashService, (s) => s.topUp(id(fd, "floatId"), body(fd)), "Topped up"); }
export async function spendFloat(fd: FormData) { return serviceAction(PettyCashService, async (s) => s.spend(id(fd, "floatId"), body(fd), await upload(fd)), "Spend recorded"); }
export async function returnFloat(fd: FormData) { return serviceAction(PettyCashService, (s) => s.giveBack(id(fd, "floatId"), body(fd)), "Cash returned"); }
export async function reversePettyEntry(fd: FormData) { return serviceAction(PettyCashService, (s) => s.reverseEntry(id(fd)), "Entry reversed"); }

// ---- claims
export async function saveClaim(fd: FormData) {
  return serviceAction(ClaimService, async (s) => s.submit(body(fd), await upload(fd), fd.get("id") ? id(fd) : undefined), "Claim sent");
}
export async function withdrawClaim(fd: FormData) { return serviceAction(ClaimService, (s) => s.withdraw(id(fd)), "Claim withdrawn. You can edit it and send again."); }
export async function approveClaim(fd: FormData) {
  const r = await serviceAction(ClaimService, (s) => s.approve(id(fd), body(fd)));
  return r.ok ? { ...r, message: r.data.outcome === "approved" ? "Claim approved" : "Sent to an approver" } : r;
}
export async function rejectClaim(fd: FormData) { return serviceAction(ClaimService, (s) => s.reject(id(fd), String(fd.get("reason") ?? "")), "Claim turned down"); }
export async function payClaim(fd: FormData) { return serviceAction(ClaimService, (s) => s.pay(id(fd), body(fd)), "Claim paid"); }

// ---- budgets
export async function saveBudget(fd: FormData) {
  const o = body(fd);
  const months = Array.from({ length: 12 }, (_, i) => o[`m${i}`]).filter((v) => v !== undefined);
  return serviceAction(BudgetService, (s) => s.save({ fy: o.fy, accountId: o.accountId, costCentreId: o.costCentreId, onOver: o.onOver, ...(months.length ? { months: months.map(Number) } : { yearlyPaise: o.yearlyPaise }) }), "Budget saved");
}
export async function deleteBudget(fd: FormData) { return serviceAction(BudgetService, (s) => s.remove(id(fd)), "Budget removed"); }
export async function copyBudget(fd: FormData) {
  const r = await serviceAction(BudgetService, (s) => s.copyActuals(String(fd.get("fy"))));
  return r.ok ? { ...r, message: r.data.created ? `Made ${r.data.created} budget line(s) from ${r.data.from} spending` : `Nothing to copy from ${r.data.from}: no spending there, or budgets already exist.` } : r;
}
export async function importBudget(fd: FormData) {
  const file = await upload(fd);
  return serviceAction(BudgetService, async (s) => { if (!file) throw new Error("Choose a file."); return s.importSheet(String(fd.get("fy")), file); }, "Budget imported");
}

// ---- recurring
export async function saveRecurring(fd: FormData) {
  const o = body(fd);
  return serviceAction(RecurringService, async (s) => {
    const old = o.id ? await s.get(String(o.id)) : null;
    const keep = old && old.lines.length > 1;
    const lines = keep ? old.lines : [{ accountId: o.accountId, label: o.label, amountPaise: o.amountPaise }];
    const input = { vendorId: o.vendorId, label: o.label, frequency: o.frequency, nextOn: o.nextOn, endsOn: o.endsOn, dueDays: o.dueDays, lines };
    return o.id ? s.update(String(o.id), input) : s.create(input);
  }, "Recurring cost saved");
}
export async function setRecurringActive(fd: FormData) { return serviceAction(RecurringService, (s) => s.setActive(id(fd), fd.get("active") === "1"), "Updated"); }
export async function deleteRecurring(fd: FormData) { return serviceAction(RecurringService, (s) => s.remove(id(fd)), "Removed"); }
export async function runRecurring() {
  const r = await serviceAction(RecurringService, (s) => s.runNow());
  return r.ok ? { ...r, message: r.data.recurring + r.data.triakshi ? `Made ${r.data.recurring + r.data.triakshi} draft bill(s)` : "Nothing is due yet." } : r;
}

// ---- other income
export async function recordIncome(fd: FormData) { return serviceAction(IncomeService, (s) => s.record(body(fd)), "Receipt recorded"); }
export async function requestIncomeReversal(fd: FormData) { return serviceAction(IncomeService, (s) => s.requestReversal(id(fd), String(fd.get("reason") ?? "")), "Asked for approval to reverse"); }
