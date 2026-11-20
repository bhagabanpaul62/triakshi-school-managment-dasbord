import { SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { and, eq, ne, platformStaff, schools, sql, users, withConsole, withSchool } from "@smw/db";

/** How long the "set your password" link in an approval or reminder email works. */
export const SET_PASSWORD_MINUTES = 7 * 24 * 60;

/**
 * Where an emailed button should take a school user: the "Set up your account" page when they have no password yet
 * (one-time link, signs them in when done), otherwise the sign-in page with their email already filled in.
 */
export async function signInLink(schoolId: string, slug: string, user: { id: string; email: string; hasPassword: boolean }): Promise<{ url: string; setPassword: boolean }> {
  if (user.hasPassword) return { url: schoolUrl(slug, `/login?id=${encodeURIComponent(user.email)}`), setPassword: false };
  const token = await withSchool(schoolId, (tx) =>
    new SchoolAuth(schoolId).issueToken(tx, "invite", { userId: user.id, minutes: SET_PASSWORD_MINUTES, meta: { email: user.email.toLowerCase() } }));
  return { url: schoolUrl(slug, `/reset-password?token=${encodeURIComponent(token)}`), setPassword: true };
}

export type EmailOwner =
  | { kind: "school"; schoolId: string; slug: string; schoolName: string; schoolStatus: string; userId: string; name: string; hasPassword: boolean }
  | { kind: "console" };

/** Who already uses this email anywhere on the platform (a school login that is not disabled, or console staff), or null. */
export async function emailOwner(email: string): Promise<EmailOwner | null> {
  const e = email.trim().toLowerCase();
  return withConsole(async (tx) => {
    const [u] = await tx.select({ userId: users.id, name: users.name, hasPassword: sql<boolean>`${users.passwordHash} is not null`, schoolId: schools.id, slug: schools.slug, schoolName: schools.name, schoolStatus: schools.status })
      .from(users).innerJoin(schools, eq(schools.id, users.schoolId))
      .where(and(sql`lower(${users.email}) = ${e}`, ne(users.status, "disabled"))).orderBy(sql`${users.role} = 'admin' desc`, users.createdAt).limit(1);
    if (u) return { kind: "school", ...u };
    const [s] = await tx.select({ id: platformStaff.id }).from(platformStaff).where(sql`lower(${platformStaff.email}) = ${e}`).limit(1);
    return s ? { kind: "console" } : null;
  });
}
