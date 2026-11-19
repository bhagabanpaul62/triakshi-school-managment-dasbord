"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginError, SchoolAuth } from "@smw/auth";
import { clearSessionCookie, getSchool, setSessionCookie, SESSION_COOKIE } from "@smw/runtime";
import { cookies } from "next/headers";

export type LoginState = { error?: string } | undefined;

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const school = await getSchool();
  const id = String(fd.get("identifier") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!id || !password) return { error: "Enter your login ID and password." };
  const h = await headers();
  try {
    const { token, expiresAt } = await new SchoolAuth(school.id).login(id, password, { ip: h.get("x-forwarded-for")?.split(",")[0] ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    await setSessionCookie(token, expiresAt);
  } catch (e) {
    if (e instanceof LoginError) {
      return { error: e.reason === "rate_limited" ? "Too many attempts. Wait 15 minutes and try again." : e.reason === "disabled" ? "This account is disabled. Ask your school office." : "That login ID or password is not right." };
    }
    throw e;
  }
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/app") ? next : "/app");
}

export async function logout() {
  const school = await getSchool();
  await new SchoolAuth(school.id).logout((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}
