"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Passwords, SchoolAuth } from "@smw/auth";
import { eq, users, withSchool } from "@smw/db";
import { getSchool, setSessionCookie } from "@smw/runtime";

export type VerifyState = { error?: string } | undefined;

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

/** Consume the email-verification token, set the admin's password, activate them and sign them in. */
export async function completeVerification(_prev: VerifyState, fd: FormData): Promise<VerifyState> {
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
  const school = await getSchool();
  const auth = new SchoolAuth(school.id);
  const h = await headers();
  const hash = await Passwords.hash(p.data.password);

  const session = await withSchool(school.id, async (tx) => {
    const row = await auth.consumeToken(tx, "verify_email", p.data.token);
    if (!row?.userId) return null;
    await tx.update(users).set({ passwordHash: hash, status: "active" }).where(eq(users.id, row.userId));
    return auth.createSession(tx, row.userId, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined });
  });
  if (!session) return { error: "This link has expired or was already used." };
  await setSessionCookie(session.token, session.expiresAt);
  // The panel layout shows the awaiting-approval screen while the school is pending; after approval they sign in and land in setup.
  redirect("/app");
}
