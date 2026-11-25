"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginError, SchoolAuth } from "@smw/auth";
import { and, eq, isNull, supportVisits, withConsole } from "@smw/db";
import { getSchool, setSessionCookie } from "@smw/runtime";

/**
 * Exchange the console's one-time token for a 30-minute support session, then open the panel.
 * The school's own setting is checked again here (it may have changed since the link was made): `never`, or `until` a time that has passed,
 * refuses unless the link was made as an owner's emergency entry. The visit is stamped as entered, so the school's list shows it was used.
 */
export async function startSupportSession(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const school = await getSchool();
  const auth = new SchoolAuth(school.id);
  const peek = await auth.peekToken("support_login", token);
  if (peek.state !== "ok") redirect("/support-login?failed=1");
  const meta = peek.meta as { visitId?: string; emergency?: boolean };
  const { supportAccess: access, supportAccessUntil: until } = school.row;
  if (!(access === "always" || (access === "until" && !!until && until > new Date())) && !meta.emergency) redirect("/support-login?failed=refused");
  const h = await headers();
  let session: { token: string; expiresAt: Date };
  try {
    session = await auth.supportLogin(token, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined });
  } catch (e) {
    if (e instanceof LoginError) redirect("/support-login?failed=1");
    throw e;
  }
  // The school's database role cannot change the visit list: the stamp is written on the console connection.
  if (meta.visitId) await withConsole((tx) => tx.update(supportVisits).set({ enteredAt: new Date() }).where(and(eq(supportVisits.id, meta.visitId!), eq(supportVisits.schoolId, school.id), isNull(supportVisits.enteredAt)))).catch(() => undefined);
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/app");
}
