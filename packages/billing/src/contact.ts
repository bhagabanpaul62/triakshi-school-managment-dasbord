import { and, eq, schools, users, type Tx } from "@smw/db";

/** Where to write to a school: its own email, else its first active admin. Null when it has neither. */
export async function schoolContact(tx: Tx, schoolId: string) {
  const [school] = await tx.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) return null;
  const [admin] = school.email ? [] : await tx.select({ email: users.email }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.role, "admin"), eq(users.status, "active"))).limit(1);
  const to = school.email ?? admin?.email ?? null;
  return to ? { to, school } : null;
}
