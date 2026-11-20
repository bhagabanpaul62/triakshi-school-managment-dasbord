"use server";

import { headers } from "next/headers";
import { LoginError, PasswordError, SchoolAuth } from "@smw/auth";
import { authMails, services, trySend } from "@smw/integrations";
import { getSchool, setSessionCookie } from "@smw/runtime";
import { resetPasswordInput } from "../inputs";

export type SetPasswordState = { error?: string; next?: string } | undefined;

/** Public (no login): the invite and reset links' form. Checks the policy, ends all sessions, clears must-change, signs the person in. */
export async function setPassword(_prev: SetPasswordState, fd: FormData): Promise<SetPasswordState> {
  const input = resetPasswordInput.safeParse(Object.fromEntries(fd));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Check the form and try again" };
  const school = await getSchool();
  const auth = new SchoolAuth(school.id);
  let userId: string;
  try {
    userId = await auth.resetPassword(input.data.token, input.data.password);
  } catch (err) {
    if (err instanceof PasswordError) return { error: err.message }; // the link is not used up
    if (err instanceof LoginError) return { error: "This link has expired or was already used. Use Forgot password on the sign-in page, or ask your school office for a new link." };
    throw err;
  }
  const who = await auth.contactOf(userId);
  if (who?.email) void trySend(services().email, { to: who.email, ...authMails.passwordChanged(school.name, who.name) });
  const h = await headers();
  const { token, expiresAt } = await auth.startSession(userId, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined });
  await setSessionCookie(token, expiresAt);
  // Not redirect(): the form navigates itself, so the next page is always rendered fresh for this school's host.
  return { next: "/app" };
}
