"use server";

import { ValidationError } from "@smw/feature-kit";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { services } from "@smw/integrations";
import { CashAccountService } from "@smw/feature-finance/service";
import { ChequeService, CounterService, ReceiptService, RefundService, SettlementService, SlipService } from "../service";
import { DeskService } from "./collect/desk-service";

const id = (fd: FormData) => String(fd.get("id") ?? "");
const input = (fd: FormData) => formToObject(fd);

/** The counter's one search box: a name, admission number, phone or bill number. */
export async function findStudents(q: string) {
  const r = await serviceAction(DeskService, (s) => s.find(q));
  return r.ok ? r.data : [];
}

// ---------- the counter desk ----------

/** `payload` is what ReceiptService.collect takes (the desk builds it from the screen). */
export async function collectReceipt(payload: unknown) {
  return serviceAction(ReceiptService, async (s) => {
    const r = await s.collect(payload);
    return { id: r.id, number: r.number, amountPaise: r.amountPaise, advancePaise: r.advancePaise, studentId: r.studentId, warnings: r.warnings };
  });
}
export async function openCounter(fd: FormData) { return serviceAction(CounterService, (s) => s.open(input(fd)), "Counter open"); }
export async function closeCounter(payload: unknown) {
  return serviceAction(CounterService, async (s) => { const r = await s.close(payload); return { id: r.counter.id, differencePaise: r.differencePaise }; });
}

/** Cash from the box to the bank: one transfer in the ledger. */
export async function depositToBank(fd: FormData) { return serviceAction(CashAccountService, (s) => s.transfer(input(fd)).then((r) => ({ id: r.journalId })), "Deposit recorded"); }

// ---------- receipts ----------

export async function requestReversal(fd: FormData) {
  return serviceAction(ReceiptService, (s) => s.requestReversal(id(fd), String(fd.get("reason") ?? "")), "Asked. Nothing changes until it is approved.");
}
export async function withdrawReversal(fd: FormData) { return serviceAction(ReceiptService, (s) => s.withdrawReversal(id(fd)), "Request withdrawn"); }

// ---------- cheques ----------

export async function depositCheque(fd: FormData) { return serviceAction(ChequeService, (s) => s.deposit(input(fd)), "Marked deposited"); }
export async function clearCheque(fd: FormData) { return serviceAction(ChequeService, (s) => s.clear(input(fd)), "Marked cleared"); }
export async function bounceCheque(fd: FormData) { return serviceAction(ChequeService, (s) => s.bounce(input(fd)), "Marked bounced. The dues are open again."); }
/** Deposit several cheques to one bank account; each is its own step, so a failure names the cheque and leaves the rest done. */
export async function depositCheques(fd: FormData) {
  const ids = String(fd.get("ids") ?? "").split(",").filter(Boolean);
  return serviceAction(ChequeService, async (s) => {
    const failed: string[] = [];
    for (const chequeId of ids) {
      try { await s.deposit({ id: chequeId, cashAccountId: fd.get("cashAccountId") || undefined, date: fd.get("date") || undefined }); } catch (e) { failed.push(e instanceof Error ? e.message : "failed"); }
    }
    if (failed.length) throw new ValidationError({ ids: failed[0]! }, `${ids.length - failed.length} deposited. ${failed[0]}`);
    return { count: ids.length };
  }, "Marked deposited");
}

// ---------- UPI slips ----------

export async function verifySlip(fd: FormData) { return serviceAction(SlipService, (s) => s.verify(id(fd)).then((r) => ({ receiptId: r.receipt.id, number: r.receipt.number })), "Verified. The receipt is made."); }
export async function rejectSlip(fd: FormData) { return serviceAction(SlipService, (s) => s.reject(input(fd)), "Rejected. The family sees the reason."); }

const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];
/** The family's "I have paid" form. The screenshot is optional; its key is made here, never read from the form. */
export async function submitSlip(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    const o = input(fd);
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
      if (!FILE_TYPES.includes(file.type)) throw new ValidationError({ file: "Attach a JPG, PNG or PDF." });
      if (file.size > 5 * 1024 * 1024) throw new ValidationError({ file: "The file is larger than 5 MB." });
      const key = `${ctx.schoolId}/fees/slips/${crypto.randomUUID()}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-50)}`;
      await services().storage.put(key, new Uint8Array(await file.arrayBuffer()), file.type);
      o.fileKey = key;
    }
    delete o.file;
    o.invoiceIds = ([] as unknown[]).concat(o.invoiceIds ?? []);
    const slip = await new SlipService(ctx).submit(o);
    return { id: slip.id };
  }, "Sent. The school will check it and send your receipt.");
}

// ---------- refunds ----------

export async function proposeRefund(fd: FormData) { return serviceAction(RefundService, (s) => s.propose(input(fd)), "Refund asked. It waits for approval."); }
export async function withdrawRefund(fd: FormData) { return serviceAction(RefundService, (s) => s.withdraw(id(fd)), "Refund withdrawn"); }
export async function resubmitRefund(fd: FormData) { const { id: refundId, ...rest } = input(fd); return serviceAction(RefundService, (s) => s.resubmit(String(refundId), rest), "Sent again"); }
/** A leaving student: advance and deposit go against what they owe, the rest is asked back (J9). */
export async function settleUpLeaving(fd: FormData) {
  const o = input(fd);
  return serviceAction(SettlementService, (s) => s.settleUp({ studentId: String(o.studentId), reason: String(o.reason ?? ""), method: o.method as "cash", cashAccountId: o.cashAccountId as string | undefined, reference: o.reference as string | undefined }), "Adjusted. Any refund waits for approval.");
}
