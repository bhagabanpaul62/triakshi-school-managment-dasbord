// Fixtures for service tests: schools, users and contexts. Test-only; never imported by apps.
import { Passwords } from "@smw/auth";
import { modules, schools, users, withConsole, type SchoolRole } from "@smw/db";
import type { Ctx } from "./context";
import type { FeatureDef } from "./feature";

export interface TestSchool {
  id: string;
  slug: string;
  /** A context per role, each backed by a real user row. */
  as: Record<SchoolRole, Ctx>;
  users: Record<SchoolRole, string>;
}

const ROLES: SchoolRole[] = ["admin", "accountant", "teacher", "student", "parent"];

/** Register the features under test in `modules` (as ga + core so every school has them). */
export async function registerFeatures(defs: FeatureDef[]) {
  await withConsole(async (tx) => {
    for (const d of defs) {
      await tx.insert(modules).values({ key: d.key, name: d.name, stage: "ga", requires: [...(d.requires ?? [])], core: true })
        .onConflictDoNothing();
    }
  });
}

/** A school with one active user per role. Password for every user: "password123". */
export async function createTestSchool(slug: string, features: string[]): Promise<TestSchool> {
  const hash = await Passwords.hash("password123");
  return withConsole(async (tx) => {
    const [school] = await tx.insert(schools).values({ slug, name: `School ${slug.toUpperCase()}`, status: "active" }).returning();
    const ids = {} as Record<SchoolRole, string>;
    const as = {} as Record<SchoolRole, Ctx>;
    for (const role of ROLES) {
      const [u] = await tx.insert(users).values({
        schoolId: school!.id, role, loginId: `${role}-${slug}`, name: `${role} ${slug}`, email: `${role}@${slug}.test`, passwordHash: hash,
      }).returning();
      ids[role] = u!.id;
      as[role] = { schoolId: school!.id, userId: u!.id, role, name: u!.name, features: new Set(features), readOnly: false };
    }
    return { id: school!.id, slug, as, users: ids };
  });
}

/** Two schools, A and B, for isolation tests. Slugs get a suffix so suites can call this more than once. */
export async function createSchoolPair(features: string[], suffix = "") {
  return { a: await createTestSchool(`a${suffix}`, features), b: await createTestSchool(`b${suffix}`, features) };
}
