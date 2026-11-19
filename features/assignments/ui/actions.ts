"use server";

import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";
import { AssignmentService, SubmissionService, type UploadedFile } from "../service";

/** Files from a form field as plain values: `File` never reaches a service. */
async function uploadsFrom(fd: FormData, field: string): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const v of fd.getAll(field)) {
    if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) });
  }
  return out;
}

export async function createAssignment(fd: FormData) {
  return serviceAction(AssignmentService, async (s) => {
    const row = await s.create(formToObject(fd));
    const [file] = await uploadsFrom(fd, "file");
    if (file) {
      // Not one transaction: if the file is rejected, take the assignment back so a retry does not post it twice.
      try { await s.attach(row.id, file); } catch (e) { await s.remove(row.id); throw e; }
    }
    return row;
  }, "Assignment posted to the section");
}
export async function updateAssignment(fd: FormData) {
  return serviceAction(AssignmentService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Assignment updated");
}
export async function deleteAssignment(fd: FormData) {
  return serviceAction(AssignmentService, (s) => s.remove(String(fd.get("id"))), "Assignment deleted");
}
export async function addAttachment(fd: FormData) {
  return serviceAction(AssignmentService, async (s) => {
    const [file] = await uploadsFrom(fd, "file");
    if (!file) throw new ValidationError({ file: "Choose a file" });
    return s.attach(String(fd.get("id")), file);
  }, "File attached");
}
export async function removeAttachment(fd: FormData) {
  return serviceAction(AssignmentService, (s) => s.detach(String(fd.get("id"))), "File removed");
}
export async function gradeSubmission(fd: FormData) {
  return serviceAction(SubmissionService, (s) => s.grade(String(fd.get("id")), formToObject(fd)), "Saved");
}
export async function submitAssignment(fd: FormData) {
  return serviceAction(SubmissionService, async (s) => s.submit(formToObject(fd), await uploadsFrom(fd, "files")), "Handed in");
}
