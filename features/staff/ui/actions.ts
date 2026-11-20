"use server";

import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";
import { StaffService } from "../service";

export async function createStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.create(formToObject(fd)), "Staff member added");
}
export async function updateStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Staff details saved");
}
export async function updateMyContact(fd: FormData) {
  return serviceAction(StaffService, (s) => s.updateMyContact(formToObject(fd)), "Your details are saved");
}
const upload = async (fd: FormData) => {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new ValidationError({ file: "Choose a file" });
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
};
export async function checkStaffImport(fd: FormData) {
  return serviceAction(StaffService, async (s) => s.importCheck(await upload(fd)));
}
export async function commitStaffImport(fd: FormData) {
  return serviceAction(StaffService, async (s) => s.importCommit(await upload(fd)));
}
export async function changeStaffRole(fd: FormData) {
  return serviceAction(StaffService, (s) => s.changeRole(String(fd.get("id")), formToObject(fd)), "Role changed");
}
export async function resendStaffInvite(fd: FormData) {
  return serviceAction(StaffService, (s) => s.resendInvite(String(fd.get("id"))), "Invite sent again");
}
export async function deactivateStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.deactivate(String(fd.get("id"))), "Deactivated. They are signed out everywhere.");
}
export async function reactivateStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.reactivate(String(fd.get("id"))), "Reactivated");
}
