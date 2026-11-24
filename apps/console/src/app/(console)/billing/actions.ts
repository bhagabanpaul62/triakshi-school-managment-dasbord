"use server";

import { CreditNoteService, OfflinePaymentService, TdsService } from "@smw/billing";
import { formToObject } from "@smw/runtime";
import { consoleAction, field } from "@/lib/console-action";

export async function recordOfflinePayment(fd: FormData) {
  return consoleAction(OfflinePaymentService, (s) => s.record(formToObject(fd)), "Payment recorded");
}

export async function issueCreditNote(fd: FormData) {
  return consoleAction(CreditNoteService, (s) => s.issue(formToObject(fd)), "Credit note issued and emailed");
}

export async function cancelInvoice(fd: FormData) {
  return consoleAction(CreditNoteService, (s) => s.cancelInvoice(formToObject(fd)), "Invoice cancelled");
}

export async function recordRefund(fd: FormData) {
  return consoleAction(CreditNoteService, (s) => s.recordRefund(formToObject(fd)), "Refund recorded");
}

export async function resendCreditNote(fd: FormData) {
  return consoleAction(CreditNoteService, async (s) => {
    if (!(await s.email(field(fd, "id")))) throw new Error("We could not email this school. Check its contact email.");
    return null;
  }, "Credit note emailed again");
}

export async function verifyTds(fd: FormData) {
  return consoleAction(TdsService, (s) => s.verify(field(fd, "id")), "Certificate verified");
}

export async function sendBackTds(fd: FormData) {
  return consoleAction(TdsService, (s) => s.sendBack(field(fd, "id"), field(fd, "reason")), "Sent back to the school");
}
