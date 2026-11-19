"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import {
  ConsentService, DocumentService, GuardianService, ImportService, PhotoService, PromotionService, StudentService,
} from "../service";
import { csvFrom, fileFrom } from "./upload";

const id = (fd: FormData, key = "id") => String(fd.get(key));

export async function createStudent(fd: FormData) {
  const r = await serviceAction(StudentService, (s) => s.admit(formToObject(fd)), "Student admitted");
  return r.ok && r.data.capacity.message ? { ...r, message: `Student admitted. ${r.data.capacity.message}` } : r;
}
export async function updateStudent(fd: FormData) {
  return serviceAction(StudentService, (s) => s.update(id(fd), formToObject(fd)), "Student updated");
}
export async function deleteStudent(fd: FormData) {
  return serviceAction(StudentService, (s) => s.remove(id(fd)), "Student deleted");
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
  return serviceAction(ImportService, async (s) => s.dryRun(await csvFrom(fd)));
}
export async function commitImport(fd: FormData) {
  return serviceAction(ImportService, async (s) => s.commit(await csvFrom(fd)), "Students imported");
}

export async function promoteSection(fd: FormData) {
  return serviceAction(PromotionService, (s) => s.promote(formToObject(fd)), "Section promoted");
}
