"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginError, OtpError, PasswordError, SchoolAuth, otpMessage } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { authMails, trySend } from "@smw/integrations";
import { accountMailer } from "@smw/feature-notifications/delivery";
import { clearSessionCookie, getSchool, setSessionCookie, SESSION_COOKIE } from "@smw/runtime";
import { cookies } from "next/headers";

export type LoginState = { error?: string } | undefined;

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const school = await getSchool();
  const id = String(fd.get("identifier") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!id || !password) return { error: "Enter your login ID and password." };
  const h = await headers();
  let mustChange: boolean;
  try {
    const { token, expiresAt, mustChangePassword } = await new SchoolAuth(school.id).login(id, password, { ip: h.get("x-forwarded-for")?.split(",")[0] ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    await setSessionCookie(token, expiresAt);
    mustChange = mustChangePassword;
  } catch (e) {
    if (e instanceof LoginError) {
      return { error: e.reason === "rate_limited" ? "Too many attempts. Wait 15 minutes and try again." : e.reason === "disabled" ? "This account is disabled. Ask your school office." : "That login ID or password is not right." };
    }
    throw e;
  }
  if (mustChange) redirect("/app/change-password");
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/app") ? next : "/app");
}

export type ForgotState = { done?: true; identifier?: string; error?: string } | undefined;

/** Same answer for every login, known or not. Only the rate limit differs, and it is keyed on what was typed, not on the account. */
export async function forgotPassword(_prev: ForgotState, fd: FormData): Promise<ForgotState> {
  const id = String(fd.get("identifier") ?? "").trim();
  if (!id) return { error: "Enter your email, phone or admission number." };
  const school = await getSchool();
  const h = await headers();
  const r = await new SchoolAuth(school.id).requestPasswordReset(id, h.get("x-forwarded-for")?.split(",")[0]?.trim());
  if (r.limited) return { error: "Too many requests. Try again in an hour, or ask your school office for a reset link." };
  // Not awaited: a known account and an unknown one must take the same time to answer.
  if (r.send) void trySend(accountMailer(school.id), { to: r.send.to, ...authMails.resetPassword(school.name, r.send.name, schoolUrl(school.slug, `/reset-password?token=${r.send.token}`), r.send.code) });
  return { done: true, identifier: id };
}

const ipOf = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
const TOO_MANY = "Too many requests. Try again in an hour, or ask your school office.";

export type CodeState = { sent?: true; identifier?: string; error?: string } | undefined;

/** Send a code for "reset" or "login". Same answer for every login, known or not; the mail is not awaited so timing does not tell them apart. */
async function sendCode(fd: FormData, use: "reset" | "login"): Promise<CodeState> {
  const identifier = String(fd.get("identifier") ?? "").trim();
  if (!identifier) return { error: "Enter your email, phone or admission number." };
  const school = await getSchool();
  const r = await new SchoolAuth(school.id).sendOtp(identifier, use, await ipOf());
  if (r.limited) return { error: TOO_MANY };
  if (r.send) void trySend(accountMailer(school.id), { to: r.send.to, ...authMails.otp(school.name, r.send.name, r.send.code, use) });
  return { sent: true, identifier };
}
export const resendResetCode = async (_prev: CodeState, fd: FormData) => sendCode(fd, "reset");
export const requestLoginCode = async (_prev: CodeState, fd: FormData) => sendCode(fd, "login");

function codeError(e: unknown): { error: string } {
  if (e instanceof OtpError) return { error: otpMessage(e) };
  if (e instanceof PasswordError) return { error: e.message };
  if (e instanceof LoginError) return { error: "Too many attempts. Wait 15 minutes and try again." };
  throw e;
}

export type ResetCodeState = { error?: string } | undefined;

/** Step 2 of forgot password: code + new password. Same result as the link: policy, sessions ended, must-change cleared, signed in. */
export async function resetWithCode(_prev: ResetCodeState, fd: FormData): Promise<ResetCodeState> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two passwords do not match." };
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Enter the 6-digit code from the email." };
  const school = await getSchool();
  const auth = new SchoolAuth(school.id);
  const h = await headers();
  try {
    const userId = await auth.resetPasswordWithCode(String(fd.get("identifier") ?? ""), code, password, await ipOf());
    const who = await auth.contactOf(userId);
    if (who?.email) void trySend(accountMailer(school.id), { to: who.email, ...authMails.passwordChanged(school.name, who.name) });
    const { token, expiresAt } = await auth.startSession(userId, { ip: await ipOf(), userAgent: h.get("user-agent") ?? undefined });
    await setSessionCookie(token, expiresAt);
  } catch (e) { return codeError(e); }
  redirect("/app");
}

/** Step 2 of "Email me a code": signs in without a password. Disabled or email-less accounts get the neutral message; must-change still gates. */
export async function loginWithCode(_prev: ResetCodeState, fd: FormData): Promise<ResetCodeState> {
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Enter the 6-digit code from the email." };
  const school = await getSchool();
  const h = await headers();
  let mustChange: boolean;
  try {
    const r = await new SchoolAuth(school.id).loginWithCode(String(fd.get("identifier") ?? ""), code, { ip: await ipOf(), userAgent: h.get("user-agent") ?? undefined });
    await setSessionCookie(r.token, r.expiresAt);
    mustChange = r.mustChangePassword;
  } catch (e) { return codeError(e); }
  if (mustChange) redirect("/app/change-password");
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/app") ? next : "/app");
}

export async function logout() {
  const school = await getSchool();
  await new SchoolAuth(school.id).logout((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}
