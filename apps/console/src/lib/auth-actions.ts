"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginError, StaffAuth, loginLimiter } from "@smw/auth";
import { STAFF_COOKIE, clearStaffCookie, getStaffSession, setStaffCookie } from "@smw/runtime/console";

export type AuthState = { error?: string } | undefined;

export async function login(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  try {
    const { token } = await StaffAuth.login(email, password, ip);
    await setStaffCookie(token);
  } catch (e) {
    if (e instanceof LoginError) {
      return { error: e.reason === "rate_limited" ? "Too many attempts. Wait 15 minutes and try again." : e.reason === "disabled" ? "This account is disabled. Ask an owner." : "That email or password is not right." };
    }
    throw e;
  }
  redirect("/login/2fa");
}

/** Second step. A first-time login also enrols the secret the page showed (`enrol`). */
export async function verifyTwoFactor(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };
  if (!loginLimiter.take(`2fa:${session.staffId}`)) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const enrol = String(fd.get("enrol") ?? "");
  if (!session.totpEnabled && !/^[A-Z2-7]{16,64}$/.test(enrol)) return { error: "Reload the page to get a new setup code." };
  const token = (await cookies()).get(STAFF_COOKIE)?.value ?? "";
  const ok = await StaffAuth.verifyTwoFactor(token, code, session.totpEnabled ? undefined : enrol);
  if (!ok) return { error: "That code did not work. Check the time on your phone and try again." };
  loginLimiter.reset(`2fa:${session.staffId}`);
  redirect("/");
}

export async function logout() {
  await StaffAuth.logout((await cookies()).get(STAFF_COOKIE)?.value);
  await clearStaffCookie();
  redirect("/login");
}
