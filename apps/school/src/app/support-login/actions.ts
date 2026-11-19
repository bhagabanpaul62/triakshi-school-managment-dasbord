"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginError, SchoolAuth } from "@smw/auth";
import { getSchool, setSessionCookie } from "@smw/runtime";

/** Exchange the console's one-time token for a 30-minute support session, then open the panel. */
export async function startSupportSession(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const school = await getSchool();
  const h = await headers();
  let session: { token: string; expiresAt: Date };
  try {
    session = await new SchoolAuth(school.id).supportLogin(token, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined });
  } catch (e) {
    if (e instanceof LoginError) redirect("/support-login?failed=1");
    throw e;
  }
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/app");
}
