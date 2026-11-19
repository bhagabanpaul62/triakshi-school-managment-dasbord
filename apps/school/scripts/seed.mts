// Local demo data: modules from the feature registry, plans, one console owner, two schools with every role, then each feature's seed.
// Run with `pnpm db:fresh` (rebuilds the local database first). Refuses non-local databases.
import { env } from "@smw/config";
import { Passwords } from "@smw/auth";
import { closeDb, modules, planModules, plans, platformStaff, schoolDomains, schools, users, withConsole, type SchoolRole } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { FEATURES } from "../src/generated/features";
import { SEEDS } from "../src/generated/seeds";

if (!/127\.0\.0\.1|localhost/.test(env().DATABASE_URL_CONSOLE)) throw new Error("seed refuses a non-local database");

export const DEMO_PASSWORD = "demo12345";
/** Fixed TOTP secret for the local console owner, so tests can compute codes. Local only. */
export const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const PLAN_DEFS = [
  { key: "starter", name: "Starter", studentCap: 300, annual: 30_000_00, monthly: 3_000_00, exclude: ["domains", "transport", "library", "api"] },
  { key: "growth", name: "Growth", studentCap: 1000, annual: 75_000_00, monthly: 7_500_00, exclude: ["api"] },
  { key: "pro", name: "Pro", studentCap: 3000, annual: 1_80_000_00, monthly: 18_000_00, exclude: [] },
  { key: "enterprise", name: "Enterprise", studentCap: 100000, annual: 0, monthly: 0, exclude: [], isPublic: false },
];

const SCHOOLS = [
  { slug: "greenvalley", name: "Green Valley Public School", status: "active" as const, plan: "growth", board: "CBSE", state: "Karnataka", city: "Bengaluru", preset: "ocean" },
  { slug: "sunrise", name: "Sunrise International School", status: "trial" as const, plan: "starter", board: "ICSE", state: "Maharashtra", city: "Pune", preset: "maroon" },
];

const ROLE_USERS: { role: SchoolRole; loginId: string; name: string }[] = [
  { role: "admin", loginId: "admin", name: "Anita Rao" },
  { role: "accountant", loginId: "accounts", name: "Vikram Shetty" },
  { role: "teacher", loginId: "teacher", name: "Meera Iyer" },
];

async function main() {
  const hash = await Passwords.hash(DEMO_PASSWORD);
  const ids = await withConsole(async (tx) => {
    for (const f of FEATURES) {
      const row = { key: f.key, name: f.name, stage: f.stage, requires: [...(f.requires ?? [])], core: !!f.core, description: f.description };
      await tx.insert(modules).values(row).onConflictDoUpdate({ target: modules.key, set: row });
    }
    const planIds: Record<string, string> = {};
    for (const [i, p] of PLAN_DEFS.entries()) {
      const [plan] = await tx.insert(plans).values({ key: p.key, name: p.name, studentCap: p.studentCap, priceAnnualPaise: p.annual, priceMonthlyPaise: p.monthly,
        isPublic: p.isPublic ?? true, sortOrder: i, limits: { websitePages: p.key === "starter" ? 5 : 20, fullThemeEditor: p.key !== "starter", customDomain: p.key !== "starter" } }).returning();
      planIds[p.key] = plan!.id;
      const keys = FEATURES.filter((f) => !f.core && !p.exclude.includes(f.key)).map((f) => f.key);
      if (keys.length) await tx.insert(planModules).values(keys.map((moduleKey) => ({ planId: plan!.id, moduleKey })));
    }
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
    const ctx: Ctx = { schoolId: s.id, userId: s.adminId, role: "admin", name: "Seed", features: new Set(FEATURES.map((f) => f.key)), readOnly: false };
    const state: Record<string, unknown> = { slug: s.slug, password: DEMO_PASSWORD, passwordHash: hash };
    for (const f of FEATURES) {
      const seed = SEEDS[f.key];
      if (!seed) continue;
      try { await seed(ctx, state); } catch (e) { console.error(`seed ${f.key} failed for ${s.slug}:`, e); throw e; }
    }
  }
  console.log(`seeded ${ids.length} schools, ${FEATURES.length} modules. Logins are in docs/DEV.md.`);
}

await main().finally(closeDb);
