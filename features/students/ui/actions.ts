"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import {
  ConsentService, CredentialService, DocumentService, GuardianService, ImportService, LifecycleService, PhotoService, PromotionService, StudentSelfService, StudentService,
} from "../service";
import { fileFrom } from "./upload";

const id = (fd: FormData, key = "id") => String(fd.get(key));

export async function createStudent(fd: FormData) {
  const r = await serviceAction(StudentService, (s) => s.admit(formToObject(fd)), "Student admitted");
  if (!r.ok) return r;
  const note = [r.data.capacity.message, ...r.data.warnings].filter(Boolean).join(" ");
  return note ? { ...r, message: `${r.data.student.status === "joining" ? "Student admitted, joining later" : "Student admitted"}. ${note}` } : r.data.student.status === "joining" ? { ...r, message: "Student admitted. They start on their joining day" } : r;
}
export async function updateStudent(fd: FormData) {
  return serviceAction(StudentService, (s) => s.update(id(fd), formToObject(fd)), "Student updated");
}
export async function deleteStudent(fd: FormData) {
  return serviceAction(StudentService, (s) => s.remove(id(fd)), "Student deleted");
}
export async function startStudentNow(fd: FormData) {
  return serviceAction(LifecycleService, (s) => s.startNow(id(fd)), "The student has started");
}
export async function changeJoiningDay(fd: FormData) {
  return serviceAction(LifecycleService, (s) => s.setJoiningDay(id(fd), formToObject(fd)), "Joining day changed");
}
export async function withdrawStudent(fd: FormData) {
  return serviceAction(LifecycleService, (s) => s.withdraw(id(fd), formToObject(fd)), "Marked as not joining");
}
export async function markStudentLeft(fd: FormData) {
  return serviceAction(LifecycleService, (s) => s.markLeft(id(fd), formToObject(fd)), "Marked as left");
}
export async function bringStudentBack(fd: FormData) {
  return serviceAction(LifecycleService, (s) => s.bringBack(id(fd), formToObject(fd)), "Brought back");
}
export async function resetStudentLogin(fd: FormData) {
  return serviceAction(CredentialService, (s) => s.resetLogin(id(fd)), "Login reset to the first password");
}
export async function uploadPhoto(fd: FormData) {
  return serviceAction(PhotoService, async (s) => s.upload(id(fd, "studentId"), await fileFrom(fd)), "Photo updated");
}

export async function addGuardian(fd: FormData) {
  return serviceAction(GuardianService, (s) => s.add(formToObject(fd)), "Guardian added");
}
export async function removeGuardian(fd: FormData) {
  return serviceAction(GuardianService, (s) => s.remove(formToObject(fd)), "Guardian removed");
}
export async function setPrimaryGuardian(fd: FormData) {
  return serviceAction(GuardianService, (s) => s.setPrimary(formToObject(fd)), "Primary guardian changed");
}

export async function recordConsent(fd: FormData) {
  return serviceAction(ConsentService, (s) => s.record(formToObject(fd)), "Consent recorded");
}
export async function uploadDocument(fd: FormData) {
  return serviceAction(DocumentService, async (s) => s.upload(formToObject(fd), await fileFrom(fd)), "Document uploaded");
}
export async function deleteDocument(fd: FormData) {
  return serviceAction(DocumentService, (s) => s.remove(id(fd)), "Document deleted");
}

export async function checkImport(fd: FormData) {
  return serviceAction(ImportService, async (s) => s.dryRun(await fileFrom(fd)));
}
export async function commitImport(fd: FormData) {
  return serviceAction(ImportService, async (s) => s.commit(await fileFrom(fd)), "Students imported");
}

export async function promoteSection(fd: FormData) {
  return serviceAction(PromotionService, (s) => s.promote(formToObject(fd)), "Section promoted");
}

export async function updateMyContact(fd: FormData) {
  return serviceAction(StudentSelfService, (s) => s.updateMyContact(formToObject(fd)), "Your details are saved");
}
