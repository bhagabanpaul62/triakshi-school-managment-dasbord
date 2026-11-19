import { eq, schoolDomains, schools, users, withConsole, type Tx } from "@smw/db";
import { env } from "@smw/config";
import { Tokens } from "@smw/auth";
import { parse, rethrowUnique } from "@smw/feature-kit";
import { BOARDS, phoneSchema, signupSchema } from "./schema";
import { PlanCatalog } from "./plans";
import { z } from "zod";

const DAY = 86_400_000;
const DEFAULT_CAP = 300;

const createSchema = signupSchema.extend({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: phoneSchema.or(z.literal("").transform(() => null)).nullable().optional(),
  board: z.enum(BOARDS).nullish(),
  approxStudents: z.coerce.number().int().min(0).max(100_000).default(0),
  state: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  planKey: z.string().optional(),
  planId: z.uuid().optional(),
  trialDays: z.number().int().min(1).max(365).default(30),
  /** "pending" (self-serve signup, awaiting approval, no trial clock yet) or "trial" (sales-assisted, already approved). */
  status: z.enum(["pending", "trial"]).default("trial"),
});
export type CreateSchoolInput = z.input<typeof createSchema>;
export interface CreatedSchool { schoolId: string; adminUserId: string; domainId: string; slug: string; hostname: string }

/**
 * One transaction: the school (trial, or pending approval), its subdomain, and the admin account (invited, no password yet).
 * Shared by self-serve signup and the console's sales-assisted path. Pass `tx` to join a caller's transaction.
 */
export async function createSchool(input: CreateSchoolInput, tx?: Tx): Promise<CreatedSchool> {
  const d = parse(createSchema, input);
  const run = async (t: Tx): Promise<CreatedSchool> => {
    const list = await PlanCatalog.publicPlans();
    const plan = (d.planId && list.find((p) => p.id === d.planId)) || (d.planKey && list.find((p) => p.key === d.planKey)) || PlanCatalog.pick(list, d.approxStudents) ||
      null;
    const hostname = `${d.slug}.${env().ROOT_DOMAIN}`;
    try {
      const [school] = await t.insert(schools).values({
        slug: d.slug, name: d.name, status: d.status, planId: plan?.id ?? null, studentCap: plan?.studentCap ?? DEFAULT_CAP,
        board: d.board ?? null, state: d.state ?? null, city: d.city ?? null, phone: d.phone ?? null, email: d.email,
        trialEndsAt: d.status === "trial" ? new Date(Date.now() + d.trialDays * DAY) : null,
      }).returning({ id: schools.id });
      const [domain] = await t.insert(schoolDomains).values({
        schoolId: school!.id, hostname, kind: "subdomain", status: "verified", verifiedAt: new Date(), isPrimary: true, verifyToken: Tokens.generate(),
      }).returning({ id: schoolDomains.id });
      const [admin] = await t.insert(users).values({
        schoolId: school!.id, role: "admin", loginId: d.email, name: d.adminName, email: d.email, phone: d.phone ?? null, status: "invited",
      }).returning({ id: users.id });
      return { schoolId: school!.id, adminUserId: admin!.id, domainId: domain!.id, slug: d.slug, hostname };
    } catch (e) {
      return rethrowUnique(e, "That school address is already taken. Pick another.");
    }
  };
  return tx ? run(tx) : withConsole(run);
}

/** True when a school already uses this slug. */
export async function slugTaken(slug: string): Promise<boolean> {
  const rows = await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1));
  return rows.length > 0;
}
