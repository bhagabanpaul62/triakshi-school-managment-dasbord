"use server";

import { formToObject, runAction, serviceAction, actionCtx } from "@smw/runtime";
import { SupportAccessService } from "../access-service";
import { ExportService } from "../export-service";
import { PrivacyService } from "../privacy-service";

const idOf = (fd: FormData) => String(fd.get("id"));

// Exports
export async function askSchoolExport(fd: FormData) {
  return serviceAction(ExportService, (s) => s.exportSchool(formToObject(fd)), "Your export is queued. It appears below when it is ready.");
}
export async function askStudentExport(fd: FormData) {
  return serviceAction(ExportService, (s) => s.exportStudent(formToObject(fd)), "Your export is queued. It appears below when it is ready.");
}
export async function retryExport(fd: FormData) {
  return serviceAction(ExportService, (s) => s.retry(idOf(fd)), "Asked again. It appears below when it is ready.");
}
/** Server search for the person picker. Throws when the caller may not export, and the picker says "Search failed". */
export async function searchStudents(q: string) {
  return new ExportService(await actionCtx()).searchStudents(q);
}

// Privacy register
/** `subject` is "student:<id>" or "staff:<id>" from the picker, or empty for someone who is not in the school's records. */
export async function writeDownRequest(fd: FormData) {
  const o = formToObject(fd);
  const [type, id] = String(o.subject ?? "").split(":");
  const known = (type === "student" || type === "staff") && id;
  return serviceAction(PrivacyService, (s) => s.create({ ...o, subjectType: known ? type : "other", subjectId: known ? id : undefined }), "Request written down");
}
export async function searchPeople(q: string) {
  return new PrivacyService(await actionCtx()).people(q);
}
export async function raiseMyRequest(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.raise(formToObject(fd)), "Your request was sent. The school must answer it in time.");
}
export async function withdrawMyRequest(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.withdraw(idOf(fd)), "Request withdrawn");
}
export async function assignRequest(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.assign(idOf(fd), String(fd.get("ownerId"))), "Owner changed");
}
export async function addRequestStep(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.addStep(idOf(fd), formToObject(fd)), "Step added");
}
export async function closeRequest(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.close(idOf(fd), formToObject(fd)), "Saved");
}
export async function makeAccessExport(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.makeAccessExport(idOf(fd)), "Export queued. Download it from Exports when it is ready.");
}
export async function setPrivacyDays(fd: FormData) {
  return serviceAction(PrivacyService, (s) => s.setDays(formToObject(fd)), "Saved");
}

/** The one place a browser File becomes plain data. */
export async function addPrivacyFiles(fd: FormData) {
  return runAction(async () => {
    const files = await Promise.all(fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => ({ name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) })));
    return new PrivacyService(await actionCtx()).addFiles(idOf(fd), files);
  }, "Documents added");
}

// Support access
export async function readSupportAccess(): Promise<void> {
  await serviceAction(SupportAccessService, (s) => s.markRead());
}
export async function setSupportAccess(fd: FormData) {
  return serviceAction(SupportAccessService, (s) => s.setMode(formToObject(fd)), "Support access changed");
}


