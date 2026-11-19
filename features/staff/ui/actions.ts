"use server";

import { headers } from "next/headers";
import { SchoolAuth, LoginError } from "@smw/auth";
import { getSchool, formToObject, serviceAction, setSessionCookie } from "@smw/runtime";
import { resetPasswordInput } from "../inputs";
import { StaffService } from "../service";
import { loginIdOf } from "./reset-link";

export async function createStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.create(formToObject(fd)), "Staff member added");
}
export async function updateStaff(fd: FormData) {
  return serviceAction(StaffService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Staff details saved");
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

export type SetPasswordState = { error?: string; next?: string } | undefined;

/** Public (no login): the invite link's form. Sets the password and signs the person straight in. */
export async function setPassword(_prev: SetPasswordState, fd: FormData): Promise<SetPasswordState> {
  const input = resetPasswordInput.safeParse(Object.fromEntries(fd));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Check the form and try again" };
  const school = await getSchool();
  const auth = new SchoolAuth(school.id);
  let loginId: string | null;
  try {
    loginId = await loginIdOf(school.id, await auth.resetPassword(input.data.token, input.data.password));
  } catch (err) {
    if (err instanceof LoginError) return { error: "This link has expired or was already used. Ask your school admin to send a new invite." };
    throw err;
  }
  try {
    const h = await headers();
    const { token, expiresAt } = await auth.login(loginId ?? "", input.data.password, { ip: h.get("x-forwarded-for")?.split(",")[0] ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    if (!(err instanceof LoginError)) throw err;
    return { next: "/login" }; // password is set; the sign-in page is the safe fallback
  }
  // Not redirect(): the form navigates itself, so the next page is always rendered fresh for this school's host.
  return { next: "/app" };
}
