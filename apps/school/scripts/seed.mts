// Local demo data: modules from the feature registry, plans, one console owner, two schools with every role, then each feature's seed.
// Run with `pnpm db:fresh` (rebuilds the local database first). Refuses non-local databases.
import { env } from "@smw/config";
import { Passwords } from "@smw/auth";
import { closeDb, eq, platformStaff, schoolDomains, schoolRoles, schools, users, withConsole, withSchool, type SchoolRole } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { RoleService } from "@smw/feature-settings/service";
import { FEATURES } from "../src/generated/features";
import { SEEDS } from "../src/generated/seeds";
import { PLAN_DEFS, syncCatalog } from "./catalog.mjs";

if (!/127\.0\.0\.1|localhost/.test(env().DATABASE_URL_CONSOLE)) throw new Error("seed refuses a non-local database");

export const DEMO_PASSWORD = "demo12345";
/** Fixed TOTP secret for the local console owner, so tests can compute codes. Local only. */
export const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const SCHOOLS: { slug: string; name: string; status: "active" | "trial"; plan: string; board: string; state: string; city: string; preset: string; bare?: boolean }[] = [
  { slug: "greenvalley", name: "Green Valley Public School", status: "active" as const, plan: "pro", board: "CBSE", state: "Karnataka", city: "Bengaluru", preset: "ocean" },
  { slug: "sunrise", name: "Sunrise International School", status: "trial" as const, plan: "starter", board: "ICSE", state: "Maharashtra", city: "Pune", preset: "maroon" },
  // First day: a school with an admin and an accountant and nothing else.
  { slug: "riverside", name: "Riverside School", status: "active" as const, plan: "pro", board: "CBSE", state: "Kerala", city: "Kochi", preset: "ocean", bare: true },
];

const ROLE_USERS: { role: SchoolRole; loginId: string; name: string }[] = [
  { role: "admin", loginId: "admin", name: "Anita Rao" },
  { role: "accountant", loginId: "accounts", name: "Vikram Shetty" },
  { role: "teacher", loginId: "teacher", name: "Meera Iyer" },
];

async function main() {
  const hash = await Passwords.hash(DEMO_PASSWORD);
  const ids = await withConsole(async (tx) => {
    const planIds = await syncCatalog(tx);
    await tx.insert(platformStaff).values({ email: "owner@triakshi.test", name: "Platform Owner", role: "owner", passwordHash: hash, totpSecret: DEV_TOTP_SECRET, totpEnabled: true });
    await tx.insert(platformStaff).values({ email: "support@triakshi.test", name: "Support Desk", role: "support", passwordHash: hash });

    const out: { id: string; slug: string; adminId: string }[] = [];
    for (const s of SCHOOLS) {
      const [school] = await tx.insert(schools).values({
        slug: s.slug, name: s.name, status: s.status, planId: planIds[s.plan], studentCap: PLAN_DEFS.find((p) => p.key === s.plan)!.studentCap,
        board: s.board, state: s.state, city: s.city, theme: null, setupCompletedAt: new Date(),
        trialEndsAt: s.status === "trial" ? new Date(Date.now() + 21 * 86_400_000) : null,
        email: `office@${s.slug}.test`, phone: "9876543210", address: `12 MG Road, ${s.city}`,
      }).returning();
      await tx.insert(schoolDomains).values({ schoolId: school!.id, hostname: `${s.slug}.${env().ROOT_DOMAIN}`, kind: "subdomain", status: "verified", verifyToken: "-", isPrimary: true, verifiedAt: new Date() });
      let adminId = "";
      for (const u of ROLE_USERS) {
        const [row] = await tx.insert(users).values({ schoolId: school!.id, role: u.role, loginId: u.loginId, name: u.name, email: `${u.loginId}@${s.slug}.test`, passwordHash: hash }).returning();
        if (u.role === "admin") adminId = row!.id;
      }
      out.push({ id: school!.id, slug: s.slug, adminId });
    }
    return out;
  });

  for (const s of ids) {
    if (SCHOOLS.find((x) => x.slug === s.slug)?.bare) continue;
    const ctx: Ctx = { schoolId: s.id, userId: s.adminId, role: "admin", name: "Seed", features: new Set(FEATURES.map((f) => f.key)), readOnly: false };
    const state: Record<string, unknown> = { slug: s.slug, password: DEMO_PASSWORD, passwordHash: hash };
    // The books first: what the other modules spend and collect posts into them.
    for (const f of [...FEATURES].sort((a, b) => Number(b.key === "finance") - Number(a.key === "finance"))) {
      const seed = SEEDS[f.key];
      if (!seed) continue;
      try { await seed(ctx, state); } catch (e) { console.error(`seed ${f.key} failed for ${s.slug}:`, e); throw e; }
    }
    // One login per ready-made money role, after the feature seeds so payroll and attendance do not count them.
    await new RoleService(ctx).ensureTemplates(FEATURES);
    await withSchool(s.id, async (tx) => {
      for (const [loginId, name, role] of [["cashier", "Suresh Cashier", "Cashier"], ["bursar", "Leela Bursar", "Bursar"], ["auditor", "Ajit Auditor", "Auditor"]] as const) {
        const [r] = await tx.select({ id: schoolRoles.id }).from(schoolRoles).where(eq(schoolRoles.name, role));
        await tx.insert(users).values({ schoolId: s.id, role: "staff", roleId: r!.id, loginId, name, email: `${loginId}@${s.slug}.test`, passwordHash: hash });
      }
    });
  }
  console.log(`seeded ${ids.length} schools, ${FEATURES.length} modules. Logins are in docs/DEV.md.`);
}

await main().finally(closeDb);
