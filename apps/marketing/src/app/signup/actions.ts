"use server";

import { headers } from "next/headers";
import { isLocal } from "@smw/config";
import { AppError, SignupService, type SignupInput, type SlugCheck } from "@smw/onboarding";

export type SignupOutcome =
  | { ok: true; email: string; emailSent: boolean; loginUrl: string; mailpitUrl: string | null }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The proxy appends the real client address last; earlier entries are whatever the client sent. */
async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",").at(-1)?.trim() || "?";
}

export async function checkSlugAction(slug: string): Promise<SlugCheck> {
  return SignupService.checkSlug(String(slug ?? ""), { ip: await clientIp() });
}

export async function signupAction(input: SignupInput): Promise<SignupOutcome> {
  const ip = await clientIp();
  try {
    const r = await SignupService.start(input, { ip });
    return { ok: true, email: r.email, emailSent: r.emailSent, loginUrl: r.loginUrl, mailpitUrl: isLocal() ? "http://localhost:8025" : null };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}
