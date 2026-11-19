"use server";

import { formToObject, requireCtx, serviceAction } from "@smw/runtime";
import { ConcessionService, DuesService, FeeHeadService, FeeStructureService, PaymentService } from "../service";

const id = (fd: FormData) => String(fd.get("id"));

export async function createHead(fd: FormData) {
  return serviceAction(FeeHeadService, (s) => s.create(formToObject(fd)), "Fee added");
}
export async function updateHead(fd: FormData) {
  return serviceAction(FeeHeadService, (s) => s.update(id(fd), formToObject(fd)), "Fee updated");
}
export async function deleteHead(fd: FormData) {
  return serviceAction(FeeHeadService, (s) => s.remove(id(fd)), "Fee deleted");
}

/** The structure editor posts everything as one JSON `payload`. */
export async function saveStructure(fd: FormData) {
  return serviceAction(FeeStructureService, (s) => s.save(formToObject(fd).payload), "Fee structure saved");
}
export async function copyStructure(fd: FormData) {
  return serviceAction(FeeStructureService, (s) => s.copyTo(formToObject(fd)), "Fee structure copied");
}
export async function deleteStructure(fd: FormData) {
  return serviceAction(FeeStructureService, (s) => s.remove(id(fd)), "Fee structure deleted");
}

export async function addConcession(fd: FormData) {
  return serviceAction(ConcessionService, (s) => s.create(formToObject(fd)), "Concession added");
}
export async function deleteConcession(fd: FormData) {
  return serviceAction(ConcessionService, (s) => s.remove(id(fd)), "Concession removed");
}

export async function recordPayment(fd: FormData) {
  return serviceAction(PaymentService, (s) => s.record(formToObject(fd)).then((r) => ({ id: r.payment.id, receiptNo: r.payment.receiptNo })), "Payment recorded");
}
export async function cancelPayment(fd: FormData) {
  return serviceAction(PaymentService, (s) => s.cancel(formToObject(fd)).then((p) => ({ id: p.id })), "Payment cancelled");
}

/** The counter's one search box: name or admission number to a few students with what each owes. */
export async function findStudents(q: string) {
  if (q.trim().length < 2) return [];
  const { rows } = await new DuesService(await requireCtx()).duesReport({ q, pageSize: 6 });
  return rows.map((r) => ({ id: r.id, name: r.name, admissionNo: r.admissionNo, classLabel: r.classLabel, due: r.due, overdue: r.overdue, status: r.status }));
}
