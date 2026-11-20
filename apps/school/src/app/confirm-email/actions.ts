"use server";

import { AuthInputError, LoginError, SchoolAuth } from "@smw/auth";
import { getSchool } from "@smw/runtime";

export type ConfirmState = { error?: string; email?: string } | undefined;

/** Public: the link itself is the proof. Done by a button, not on page load, so mail scanners that open links cannot confirm for you. */
export async function confirmEmail(_prev: ConfirmState, fd: FormData): Promise<ConfirmState> {
  const school = await getSchool();
  try {
    const { email } = await new SchoolAuth(school.id).confirmEmailChange(String(fd.get("token") ?? ""));
    return { email };
  } catch (err) {
    if (err instanceof LoginError) return { error: "This link has expired or was already used. Change your email again from your profile." };
    if (err instanceof AuthInputError) return { error: err.message };
    throw err;
  }
}
