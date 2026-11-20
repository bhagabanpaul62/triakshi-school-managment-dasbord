"use server";

import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";
import { ExportService, SchoolProfileService, UserAdminService, type UploadFile } from "../service";

/** The one place a browser `File` becomes plain data, so services never see it. */
async function uploadFrom(fd: FormData, field: string): Promise<UploadFile> {
  const file = fd.get(field);
  if (!(file instanceof File) || file.size === 0) throw new ValidationError({ [field]: "Choose a file" });
  return { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const idOf = (fd: FormData) => String(fd.get("id"));

// School profile
export async function updateSchoolProfile(fd: FormData) {
  return serviceAction(SchoolProfileService, (s) => s.update(formToObject(fd)), "School details saved");
}
export async function uploadLogo(fd: FormData) {
  return serviceAction(SchoolProfileService, async (s) => s.setLogo(await uploadFrom(fd, "logo")), "Logo updated");
}

// Users and roles
export async function changeUserRole(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.changeRole(idOf(fd), formToObject(fd)), "Role changed");
}
export async function disableUser(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.disable(idOf(fd)), "Account disabled and signed out");
}
export async function enableUser(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.enable(idOf(fd)), "Account enabled");
}
/** `mode` rides in the form: "email" (default) mails a link, "temporary" returns a one-time password. */
export async function sendPasswordReset(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.resetPassword(idOf(fd), formToObject(fd)), "Reset link sent by email");
}
export async function makeAccessLink(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.accessLink(idOf(fd)));
}
export async function signOutUser(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.signOutEverywhere(idOf(fd)), "Signed out everywhere");
}

// Data export
export async function exportSchoolData() {
  return serviceAction(ExportService, (s) => s.exportSchool(), "Export ready. Download it from the list.");
}
export async function exportStudentData(fd: FormData) {
  return serviceAction(ExportService, (s) => s.exportStudent(formToObject(fd)), "Export ready. Download it from the list.");
}
