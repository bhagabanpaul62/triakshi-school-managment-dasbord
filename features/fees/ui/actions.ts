"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import {
  ConcessionService, ConcessionTypeService, DuesService, HeadService, InvoiceService, NoteService, PlanService, PromiseService, SettlementService,
} from "../service";
import { OpeningImport } from "../opening";
import { FeesLookup } from "./lookups";
import { ReminderDesk } from "./remind";

const id = (fd: FormData, key = "id") => String(fd.get(key) ?? "");
const body = (fd: FormData) => { const o = formToObject(fd); delete o.next; return o; };

// ---- lookups for pickers and previews
export async function findStudents(q: string) { const r = await serviceAction(FeesLookup, (s) => s.students(q)); if (!r.ok) throw new Error(r.error); return r.data; }
export async function groupOf(classId: string, sectionId: string) { return serviceAction(FeesLookup, (s) => s.group(classId, sectionId || undefined)); }
/** The open bills of a student with their lines, to show what a concession would do to each before it is saved. */
export async function openBillsOf(studentId: string) {
  return serviceAction(DuesService, async (s) => {
    const a = await s.studentAccount(studentId);
    return a.invoices.filter((i) => i.status === "issued" && i.openPaise > 0).map((i) => ({ id: i.id, number: i.number, label: i.label, dueDate: i.dueDate, lines: i.lines.map((l) => ({ headId: l.headId, kind: l.kind, amountPaise: l.amountPaise - l.concessionPaise })) }));
  });
}

// ---- bills
export async function saveInvoice(payload: string) { return serviceAction(InvoiceService, (s) => s.saveDraft(JSON.parse(payload)).then((invoiceId) => ({ id: invoiceId }))); }
export async function chargeGroup(payload: string) { return serviceAction(InvoiceService, (s) => s.chargeMany(JSON.parse(payload)).then((ids) => ({ count: ids.length }))); }
export async function issueInvoice(fd: FormData) { return serviceAction(InvoiceService, (s) => s.issue(id(fd)), "Bill issued"); }
export async function issueInvoices(ids: string[]) { return serviceAction(InvoiceService, (s) => s.issueMany(ids).then((r) => ({ count: r.length }))); }
export async function deleteInvoiceDraft(fd: FormData) { return serviceAction(InvoiceService, (s) => s.deleteDraft(id(fd)), "Draft deleted"); }
export async function cancelInvoice(fd: FormData) {
  const r = await serviceAction(InvoiceService, (s) => s.cancel(id(fd), String(fd.get("reason") ?? "")));
  return r.ok ? { ...r, message: r.data.requested ? "Sent for approval. The bill stays as it is until someone approves." : "Bill cancelled" } : r;
}
export async function reviseInvoice(payload: string) {
  const o = JSON.parse(payload) as { id: string };
  return serviceAction(InvoiceService, (s) => s.revise(o.id, o));
}
export async function withdrawInvoiceChange(fd: FormData) { return serviceAction(InvoiceService, (s) => s.withdrawChange(id(fd)), "Request taken back"); }
export async function resubmitInvoiceChange(payload: string) {
  const o = JSON.parse(payload) as { changeId: string };
  return serviceAction(InvoiceService, (s) => s.resubmitChange(o.changeId, o));
}
export async function proposeNote(payload: string) {
  const r = await serviceAction(NoteService, (s) => s.propose(JSON.parse(payload)));
  return r.ok ? { ...r, message: r.data.status === "approved" ? "Note applied" : "Sent for approval" } : r;
}
export async function withdrawNote(fd: FormData) { return serviceAction(NoteService, (s) => s.withdraw(id(fd)), "Request taken back"); }
export async function previewIssue(payload: string) { return serviceAction(InvoiceService, (s) => s.previewBulk(JSON.parse(payload))); }
export async function issueFromPlans(payload: string) { return serviceAction(InvoiceService, (s) => s.issueBulk(JSON.parse(payload))); }
export async function importOpening(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Choose the filled sheet first.", code: "validation", fieldErrors: { file: "Choose the filled sheet first." } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return serviceAction(InvoiceService, (s) => s.importOpening({ name: file.name, bytes }, fd.get("dry") === "1"));
}
export async function remindStudents(ids: string[]) { return serviceAction(ReminderDesk, (s) => s.remind(ids)); }
export async function remindInvoiceFamilies(ids: string[]) { return serviceAction(ReminderDesk, async (s) => s.remind(await s.studentsOf(ids))); }

// ---- plans and heads
export async function savePlan(payload: string) { return serviceAction(PlanService, (s) => s.saveDraft(JSON.parse(payload)).then((v) => ({ id: v.plan.id }))); }
export async function submitPlan(fd: FormData) { return serviceAction(PlanService, (s) => s.submit(id(fd)), "Sent for approval"); }
export async function withdrawPlan(fd: FormData) { return serviceAction(PlanService, (s) => s.withdraw(id(fd)), "Taken back to draft"); }
export async function newPlanVersion(fd: FormData) { return serviceAction(PlanService, (s) => s.newVersion(id(fd, "rootId")).then((v) => ({ id: v.plan.id }))); }
export async function copyPlan(fd: FormData) { return serviceAction(PlanService, (s) => s.copy(id(fd), body(fd)).then((v) => ({ id: v.plan.id })), "Plan copied as a draft"); }
export async function archivePlan(fd: FormData) { return serviceAction(PlanService, (s) => s.archive(id(fd)), "Plan archived. Bills already issued stay."); }
export async function deletePlanDraft(fd: FormData) { return serviceAction(PlanService, (s) => s.removeDraft(id(fd)), "Draft deleted"); }
export async function setStudentPlan(fd: FormData) { return serviceAction(PlanService, (s) => s.setStudentPlan(body(fd)), "Student moved to this plan"); }
export async function setOptIns(fd: FormData) {
  const o = body(fd);
  return serviceAction(PlanService, (s) => s.setOptIns({ ...o, headIds: ([] as unknown[]).concat(o.headIds ?? []) }), "Optional fees saved");
}
export async function saveHead(fd: FormData) { return serviceAction(HeadService, (s) => (fd.get("id") ? s.update(id(fd), body(fd)) : s.create(body(fd))), "Fee saved"); }
export async function deleteHead(fd: FormData) { return serviceAction(HeadService, (s) => s.remove(id(fd)), "Fee deleted"); }

// ---- concessions
export async function saveConcessionType(fd: FormData) { return serviceAction(ConcessionTypeService, (s) => (fd.get("id") ? s.update(id(fd), body(fd)) : s.create(body(fd))), "Concession type saved"); }
export async function deleteConcessionType(fd: FormData) { return serviceAction(ConcessionTypeService, (s) => s.remove(id(fd)), "Concession type deleted"); }
export async function proposeConcession(fd: FormData) {
  const r = await serviceAction(ConcessionService, (s) => s.propose(body(fd)));
  return r.ok ? { ...r, message: r.data.status === "approved" ? "Concession applied" : "Sent for approval" } : r;
}
export async function resubmitConcession(fd: FormData) { return serviceAction(ConcessionService, (s) => s.resubmit(id(fd), body(fd)), "Sent again"); }
export async function withdrawConcession(fd: FormData) { return serviceAction(ConcessionService, (s) => s.withdraw(id(fd)), "Request taken back"); }
export async function endConcession(fd: FormData) { return serviceAction(ConcessionService, (s) => s.end(id(fd)), "Concession ended. Bills already issued keep what they got."); }

// ---- settlements, promises, leaving
export async function previewSettlement(payload: string) { return serviceAction(SettlementService, (s) => s.preview(JSON.parse(payload))); }
export async function proposeSettlement(payload: string) { return serviceAction(SettlementService, (s) => s.propose(JSON.parse(payload)), "Sent for approval"); }
export async function resubmitSettlement(payload: string) {
  const o = JSON.parse(payload) as { settlementId: string };
  return serviceAction(SettlementService, (s) => s.resubmit(o.settlementId, o), "Sent again");
}
export async function withdrawSettlement(fd: FormData) { return serviceAction(SettlementService, (s) => s.withdraw(id(fd)), "Request taken back"); }
export async function settleUpLeaving(fd: FormData) {
  const o = body(fd);
  const r = await serviceAction(SettlementService, (s) => s.settleUp({ studentId: String(o.studentId), reason: String(o.reason ?? ""), method: o.method as "cash", cashAccountId: o.cashAccountId as string | undefined, reference: o.reference as string | undefined }));
  return r.ok ? { ...r, message: `Advance and deposit put against dues. ${r.data.refunds.length ? `${r.data.refunds.length} refund request${r.data.refunds.length === 1 ? "" : "s"} sent for approval.` : "Nothing is left to refund."}${r.data.stillOwedPaise ? " The student still owes money." : ""}` } : r;
}
export async function addPromise(fd: FormData) { return serviceAction(PromiseService, (s) => s.add(body(fd)), "Promise saved. Reminders pause until that day."); }
export async function stopReminders(fd: FormData) { return serviceAction(PromiseService, (s) => s.stopReminders(body(fd)), "Reminders stopped for this student"); }
export async function resumeReminders(fd: FormData) { return serviceAction(PromiseService, (s) => s.resumeReminders(id(fd, "studentId")), "Reminders resumed"); }

export async function remindOne(fd: FormData) { return serviceAction(ReminderDesk, (s) => s.remind([id(fd, "studentId")])); }

export async function withdrawOpening(fd: FormData) { return serviceAction(OpeningImport, (s) => s.withdraw(id(fd)), "Taken back"); }
export async function resendOpening(fd: FormData) { return serviceAction(OpeningImport, (s) => s.resubmit(id(fd)), "Sent for approval again"); }
