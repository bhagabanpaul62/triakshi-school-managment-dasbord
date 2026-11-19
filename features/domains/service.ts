import { randomBytes } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { env } from "@smw/config";
import { plans, schoolDomains, schools, withConsole, type Tx } from "@smw/db";
import { ConflictError, LimitError, NotFoundError, SchoolService, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { services, type DnsResolver } from "@smw/integrations";
import domainsFeature from "./feature";
import { MAX_DOMAINS, dnsInstructions, domainInput } from "./hostname";
import { DomainVerifier, type VerifyResult } from "./verifier";

type Perm = keyof typeof domainsFeature.permissions;
export type SchoolDomain = typeof schoolDomains.$inferSelect;

/** DNS is rechecked every 10 minutes for this long, then the domain is marked failed. */
export const VERIFY_WINDOW_MS = 72 * 3_600_000;

/** What happens to a domain after one DNS check. Pure. */
export function nextDomainState(d: Pick<SchoolDomain, "createdAt">, r: VerifyResult, now: Date) {
  if (r.ok) return { status: "verified" as const, verifiedAt: now, lastCheckedAt: now, checkError: null };
  const expired = now.getTime() - d.createdAt.getTime() >= VERIFY_WINDOW_MS;
  return {
    status: expired ? ("failed" as const) : ("pending" as const),
    lastCheckedAt: now,
    checkError: expired ? `${r.error ?? "DNS records not found."} We stopped checking after 3 days. Fix the records and press Check now.` : (r.error ?? null),
  };
}

/** The platform side of verification: checks DNS and saves the result. Runs in the worker and behind "Check now". */
export class DomainVerificationJob {
  constructor(
    dns: DnsResolver = services().dns,
    private readonly rootDomain = env().ROOT_DOMAIN,
    private readonly now: () => Date = () => new Date(),
  ) { this.verifier = new DomainVerifier(dns); }
  private readonly verifier: DomainVerifier;

  /** Check one domain and save the outcome (platform access: this is the only writer of status). */
  async checkDomain(d: SchoolDomain): Promise<SchoolDomain> {
    const result = await this.verifier.verify(d.hostname, d.verifyToken, this.rootDomain);
    const patch = nextDomainState(d, result, this.now());
    const row = await withConsole(async (tx) => {
      const [saved] = await tx.update(schoolDomains).set(patch).where(eq(schoolDomains.id, d.id)).returning();
      if (saved && patch.status === "verified") {
        // The free <slug> address is primary from signup; the first verified custom domain takes over (one primary per school).
        const [hasPrimary] = await tx.select({ id: schoolDomains.id }).from(schoolDomains)
          .where(and(eq(schoolDomains.schoolId, d.schoolId), eq(schoolDomains.kind, "custom"), eq(schoolDomains.isPrimary, true))).limit(1);
        if (!hasPrimary) {
          await tx.update(schoolDomains).set({ isPrimary: false }).where(eq(schoolDomains.schoolId, d.schoolId));
          await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, d.id));
        }
      }
      return saved;
    });
    return row ?? d;
  }

  /** The worker job "domains.verify-pending": every pending custom domain, once. */
  async run() {
    const pending = await withConsole((tx) => tx.select().from(schoolDomains)
      .where(and(eq(schoolDomains.status, "pending"), eq(schoolDomains.kind, "custom"))).orderBy(asc(schoolDomains.createdAt)));
    const out = { checked: 0, verified: 0, failed: 0 };
    for (const d of pending) {
      try {
        const saved = await this.checkDomain(d);
        out.checked++;
        if (saved.status === "verified") out.verified++;
        if (saved.status === "failed") out.failed++;
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "domain check failed", domain: d.hostname, err: String(err) }));
      }
    }
    return out;
  }
}

/** A school's own domains: add, show DNS records, check, choose primary, remove. Needs a plan with customDomain on. */
export class DomainService extends SchoolService<Perm> {
  protected feature = domainsFeature;

  constructor(ctx: Ctx, private readonly job: DomainVerificationJob = new DomainVerificationJob()) { super(ctx); }

  async list(): Promise<SchoolDomain[]> {
    return this.read("read", (tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.kind, "custom")).orderBy(asc(schoolDomains.createdAt)));
  }

  /** Does the school's plan include custom domains? */
  async planAllows(): Promise<{ allowed: boolean; planName: string | null }> {
    return this.read("read", async (tx) => {
      const [row] = await tx.select({ limits: plans.limits, name: plans.name }).from(schools)
        .leftJoin(plans, eq(schools.planId, plans.id)).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      return { allowed: row?.limits?.customDomain === true, planName: row?.name ?? null };
    });
  }

  async add(input: unknown): Promise<SchoolDomain> {
    this.authorize("manage", "write");
    const { hostname } = this.parse(domainInput(env().ROOT_DOMAIN), input);
    if (!(await this.planAllows()).allowed) throw new LimitError("Custom domains are not part of your plan. Upgrade in Billing to use your own domain.");
    return this.write("manage", async (tx) => {
      const [n] = await tx.select({ n: count() }).from(schoolDomains).where(eq(schoolDomains.kind, "custom"));
      if ((n?.n ?? 0) >= MAX_DOMAINS) throw new LimitError(`You can add up to ${MAX_DOMAINS} domains. Remove one first.`);
      try {
        const [row] = await tx.insert(schoolDomains).values({
          schoolId: this.ctx.schoolId, hostname, kind: "custom", status: "pending", verifyToken: randomBytes(18).toString("base64url"),
        }).returning();
        return row!;
      } catch (err) { return rethrowUnique(err, "This domain is already added. If it is yours, contact support."); }
    }, (r) => ({ action: "create", entity: "Domain", entityId: r.id, summary: `Added domain ${r.hostname}` }));
  }

  private async find(tx: Tx, id: string) {
    const [row] = await tx.select().from(schoolDomains).where(and(eq(schoolDomains.id, id), eq(schoolDomains.kind, "custom"))).limit(1);
    if (!row) throw new NotFoundError("Domain");
    return row;
  }

  /** The DNS records to add at the registrar. */
  async instructions(id: string) {
    const d = await this.read("read", (tx) => this.find(tx, id));
    return dnsInstructions(d, env().ROOT_DOMAIN, process.env.SITES_IP || "203.0.113.10");
  }

  async remove(id: string): Promise<{ id: string; hostname: string }> {
    const gone: { d?: SchoolDomain } = {};
    await this.write("manage", async (tx) => {
      const removed = (gone.d = await this.find(tx, id));
      await tx.delete(schoolDomains).where(eq(schoolDomains.id, id));
      if (removed.isPrimary) {
        const [next] = await tx.select({ id: schoolDomains.id }).from(schoolDomains)
          .where(and(eq(schoolDomains.kind, "custom"), eq(schoolDomains.status, "verified"))).orderBy(asc(schoolDomains.createdAt)).limit(1);
        // No other verified custom domain: the free address is the main one again.
        const [fallback] = next ? [next] : await tx.select({ id: schoolDomains.id }).from(schoolDomains).where(eq(schoolDomains.kind, "subdomain")).limit(1);
        if (fallback) await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, fallback.id));
      }
    }, () => ({ action: "delete", entity: "Domain", entityId: id, summary: `Removed domain ${gone.d?.hostname}` }));
    return { id, hostname: gone.d?.hostname ?? "" };
  }

  async setPrimary(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const d = await this.find(tx, id);
      if (d.status !== "verified") throw new ConflictError("Only a verified domain can be the main domain.");
      await tx.update(schoolDomains).set({ isPrimary: false }).where(eq(schoolDomains.isPrimary, true));
      await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, id));
      return { id };
    }, (r) => ({ action: "update", entity: "Domain", entityId: r.id, summary: "Changed the main domain" }));
  }

  /** Run the DNS check for one domain now. */
  async checkNow(id: string): Promise<SchoolDomain> {
    this.authorize("manage", "write");
    const d = await this.read("manage", (tx) => this.find(tx, id));
    if (d.status === "verified") return d;
    const saved = await this.job.checkDomain(d);
    await this.write("manage", async () => undefined, () => ({
      action: "update", entity: "Domain", entityId: id, summary: `Checked DNS for ${d.hostname}: ${saved.status}`,
    }));
    return saved;
  }
}
