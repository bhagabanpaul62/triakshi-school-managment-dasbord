"use server";

// Role changes are checked against the real feature list, which only the school app can import.
import { RoleService } from "@smw/feature-settings/service";
import { formToObject, serviceAction } from "@smw/runtime";
import { FEATURES } from "@/generated/features";

const idOf = (fd: FormData) => String(fd.get("id"));

export async function createRole(fd: FormData) {
  return serviceAction(RoleService, (s) => s.create(formToObject(fd), FEATURES), "Role created");
}
export async function updateRole(fd: FormData) {
  return serviceAction(RoleService, (s) => s.update(idOf(fd), formToObject(fd), FEATURES), "Role saved");
}
export async function copyRole(fd: FormData) {
  return serviceAction(RoleService, (s) => s.copy(idOf(fd)), "Role copied");
}
export async function deleteRole(fd: FormData) {
  return serviceAction(RoleService, (s) => s.remove(idOf(fd)), "Role deleted");
}
