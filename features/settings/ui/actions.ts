"use server";

import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";
import { ExportService, ProfileService, SchoolProfileService, UserAdminService, type UploadFile } from "../service";

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
export async function sendPasswordReset(fd: FormData) {
  return serviceAction(UserAdminService, (s) => s.resetPassword(idOf(fd)), "Reset link sent by email");
}

// My profile
export async function updateMyProfile(fd: FormData) {
  return serviceAction(ProfileService, (s) => s.update(formToObject(fd)), "Profile saved");
}
export async function changeMyPassword(fd: FormData) {
  return serviceAction(ProfileService, (s) => s.changePassword(formToObject(fd)), "Password changed");
}

// Data export
export async function exportSchoolData() {
  return serviceAction(ExportService, (s) => s.exportSchool(), "Export ready. Download it from the list.");
}
export async function exportStudentData(fd: FormData) {
  return serviceAction(ExportService, (s) => s.exportStudent(formToObject(fd)), "Export ready. Download it from the list.");
}
