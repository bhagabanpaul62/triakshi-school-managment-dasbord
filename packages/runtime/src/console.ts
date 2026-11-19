// Next.js glue for the console app: staff session cookie and StaffCtx.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { StaffAuth } from "@smw/auth";
import { secureCookies } from "@smw/config";
import { UnauthenticatedError, type StaffCtx } from "@smw/feature-kit";

export const STAFF_COOKIE = "smw_staff";

export const getStaffSession = cache(async () => StaffAuth.validate((await cookies()).get(STAFF_COOKIE)?.value));

/** StaffCtx for console pages. Redirects to login, or to the 2FA step when it is not done yet. */
export const requireStaff = cache(async (): Promise<StaffCtx> => {
  const s = await getStaffSession();
  if (!s) redirect("/login");
  if (!s.twoFactorPassed) redirect("/login/2fa");
  return { staffId: s.staffId, role: s.role, name: s.name };
});

export async function staffActionCtx(): Promise<StaffCtx> {
  const s = await getStaffSession();
  if (!s?.twoFactorPassed) throw new UnauthenticatedError();
  return { staffId: s.staffId, role: s.role, name: s.name };
}

export async function setStaffCookie(token: string) {
  (await cookies()).set(STAFF_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/", maxAge: 12 * 3600 });
}
export async function clearStaffCookie() {
  (await cookies()).delete(STAFF_COOKIE);
}
