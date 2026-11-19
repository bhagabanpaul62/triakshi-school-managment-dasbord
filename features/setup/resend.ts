"use server";

import { SignupService } from "@smw/onboarding";
import { getSchool } from "@smw/runtime";

export type ResendState = { message?: string; error?: string } | undefined;

/** Public (the owner has no session yet): the answer is the same whether or not the address is registered. */
export async function resendVerification(_prev: ResendState, fd: FormData): Promise<ResendState> {
  const email = String(fd.get("email") ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter the email address you registered with." };
  const school = await getSchool();
  const r = await SignupService.resendVerification(school.id, email);
  if (r.limited) return { error: "Too many requests. Try again in an hour, or write to support." };
  return { message: "If that address is registered here, a new link is on its way. It works for 48 hours." };
}
