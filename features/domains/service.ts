import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { RateLimiter } from "@smw/auth";
import { env } from "@smw/config";
import { plans, schoolDomainEvents, schoolDomains, schools, type Tx } from "@smw/db";
import { ConflictError, LimitError, NotFoundError, SchoolService, ValidationError, auditChanges, rethrowUnique, type Ctx } from "@smw/feature-kit";
import domainsFeature from "./feature";
import { MAX_DOMAINS, dnsInstructions, domainInput, pairOf, sitesIp } from "./hostname";
import { COULD_NOT_CHECK, DomainVerificationJob, addEvent, healthyMain, type SchoolDomain } from "./monitor";
import { staffReleaseReason } from "./state";

export { DomainVerificationJob, VERIFY_WINDOW_MS, nextDomainState, type SchoolDomain } from "./monitor";
/** Every check makes DNS and network calls. Shared by all instances. */
export const checkLimiter = new RateLimiter(20, 10 * 60_000);

type Perm = keyof typeof domainsFeature.permissions;
export type DomainEvent = typeof schoolDomainEvents.$inferSelect;

/** A school's own domains: add, show DNS records, check, choose main, remove. Adding needs a plan with customDomain on. */
export class DomainService extends SchoolService<Perm> {
  protected feature = domainsFeature;

  constructor(ctx: Ctx, private readonly job: DomainVerificationJob = new DomainVerificationJob()) { super(ctx); }

  async list(): Promise<SchoolDomain[]> {
    return this.read("read", (tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.kind, "custom")).orderBy(asc(schoolDomains.createdAt)));
  }

  /** Why Triakshi released this domain, while the school may not bring it back; null when it may check. */
  async staffBlock(id: string): Promise<string | null> {
    return this.read("read", async (tx) => {
      const d = await this.find(tx, id);
      if (d.status !== "failed") return null;
      return staffReleaseReason(await tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, id)).orderBy(desc(schoolDomainEvents.createdAt), desc(schoolDomainEvents.id)).limit(20));
    });
  }

  /** The free <slug> address, as a row (so it can be made main again). */
  async free(): Promise<SchoolDomain | null> {
    return this.read("read", async (tx) => (await tx.select().from(schoolDomains).where(eq(schoolDomains.kind, "subdomain")).limit(1))[0] ?? null);
  }

  async get(id: string): Promise<SchoolDomain> {
    return this.read("read", (tx) => this.find(tx, id));
  }

  /** What happened to one domain, newest first. */
  async events(id: string): Promise<DomainEvent[]> {
    return this.read("read", async (tx) => {
      await this.find(tx, id);
      return tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, id)).orderBy(desc(schoolDomainEvents.createdAt), desc(schoolDomainEvents.id)).limit(60);
    });
  }

  /** Does the school's plan include custom domains? Existing domains keep working when it does not. */
  async planAllows(): Promise<{ allowed: boolean; planName: string | null }> {
    return this.read("read", async (tx) => {
      const [row] = await tx.select({ limits: plans.limits, name: plans.name }).from(schools)
        .leftJoin(plans, eq(schools.planId, plans.id)).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      return { allowed: row?.limits?.customDomain === true, planName: row?.name ?? null };
    });
  }

  /** Add a domain, and with `pair` its www or bare twin in the same step. Returns the one that was typed. */
  async add(input: unknown): Promise<SchoolDomain> {
    this.authorize("manage", "write");
    const { hostname, pair } = this.parse(domainInput(env().ROOT_DOMAIN), input);
    const twin = pair ? pairOf(hostname) : null;
    if (pair && !twin) throw new ValidationError({ hostname: "Only a bare domain (school.in) and its www form can be added together." });
    const names = twin ? [hostname, twin] : [hostname];
    if (!(await this.planAllows()).allowed) throw new LimitError("Custom domains are not part of your plan. Upgrade in Billing to use your own domain.");
    return this.write("manage", async (tx) => {
      const [n] = await tx.select({ n: count() }).from(schoolDomains).where(eq(schoolDomains.kind, "custom"));
      if ((n?.n ?? 0) + names.length > MAX_DOMAINS) throw new LimitError(`You can have up to ${MAX_DOMAINS} domains. Remove one first.`);
      const rows: SchoolDomain[] = [];
      for (const h of names) {
        try {
          const [row] = await tx.insert(schoolDomains).values({ schoolId: this.ctx.schoolId, hostname: h, kind: "custom", status: "pending", verifyToken: randomBytes(18).toString("base64url") }).returning();
          await addEvent(tx, row!, "added", null, this.ctx.name);
          rows.push(row!);
        } catch (err) { return rethrowUnique(err, `${h} is already in your list.`); }
      }
      return rows[0]!;
    }, (r) => ({ action: "create", entity: "Domain", entityId: r.id, summary: `Added domain ${names.join(" and ")}` }));
  }

  private async find(tx: Tx, id: string, kinds: ("custom" | "subdomain")[] = ["custom"]) {
    const [row] = await tx.select().from(schoolDomains).where(eq(schoolDomains.id, id)).limit(1);
    if (!row || !kinds.includes(row.kind)) throw new NotFoundError("Domain");
    return row;
  }

  /** The DNS records to add at the registrar. */
  async instructions(id: string) {
    const d = await this.read("read", (tx) => this.find(tx, id));
    return dnsInstructions(d, env().ROOT_DOMAIN, sitesIp());
  }

  /** A live domain is removed only when its name is typed; the free address then becomes the main one. */
  async remove(id: string, confirm?: string): Promise<{ id: string; hostname: string }> {
    const gone: { d?: SchoolDomain } = {};
    await this.write("manage", async (tx) => {
      const removed = (gone.d = await this.find(tx, id));
      if (removed.status === "verified" && (confirm ?? "").trim().toLowerCase() !== removed.hostname) throw new ValidationError({ confirm: `Type ${removed.hostname} to confirm.` });
      await tx.delete(schoolDomains).where(eq(schoolDomains.id, id));
      await addEvent(tx, removed, "removed", null, this.ctx.name);
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

  /** Make a live domain, or the free address, the main one. A domain with a broken record cannot be main. */
  async setPrimary(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const d = await this.find(tx, id, ["custom", "subdomain"]);
      if (d.status !== "verified") throw new ConflictError("Only a verified domain can be the main domain.");
      if (d.health === "broken") throw new ConflictError(`${d.hostname} is not reaching your school right now. Fix its records first.`);
      if (d.kind === "custom" && !healthyMain(d)) throw new ConflictError(`${d.hostname} is getting its secure certificate. Open https://${d.hostname} once, press Check again, and make it main when the certificate works.`);
      await tx.update(schoolDomains).set({ isPrimary: false }).where(eq(schoolDomains.isPrimary, true));
      await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, id));
      await addEvent(tx, d, "primary", "Made the main domain.", this.ctx.name);
      return { id };
    }, (r) => ({ action: "update", entity: "Domain", entityId: r.id, summary: "Changed the main domain" }));
  }

  /** Visitors on the other addresses are sent to the main domain (on), or every address shows the site (off). */
  async setRedirect(on: boolean): Promise<{ on: boolean }> {
    let changes: ReturnType<typeof auditChanges> = {};
    return this.write("manage", async (tx) => {
      const [before] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      const [after] = await tx.update(schools).set({ redirectToPrimary: on }).where(eq(schools.id, this.ctx.schoolId)).returning();
      changes = auditChanges(before!, after!);
      return { on };
    }, (r) => ({ action: "update", entity: "Domain", summary: r.on ? "Turned on sending visitors to the main domain" : "Turned off sending visitors to the main domain", meta: { changes } }));
  }

  /** Run the DNS and certificate check for one domain now. */
  async checkNow(id: string): Promise<SchoolDomain> {
    this.authorize("manage", "write");
    if (!checkLimiter.take(this.ctx.schoolId)) throw new LimitError("You have checked many times just now. Wait ten minutes; we also check by ourselves.");
    const d = await this.read("manage", (tx) => this.find(tx, id));
    const blocked = await this.staffBlock(id);
    if (blocked) throw new ConflictError(`Released by Triakshi: ${blocked} Ask support (/app/support/new).`);
    const saved = await this.job.check(d, this.ctx.name);
    if (saved.checkError === COULD_NOT_CHECK) throw new ConflictError(COULD_NOT_CHECK);
    await this.write("manage", async (tx) => { await addEvent(tx, d, "checked", saved.status === "verified" ? `Health: ${saved.health}` : `Status: ${saved.status}`, this.ctx.name); }, () => ({
      action: "update", entity: "Domain", entityId: id, summary: `Checked DNS for ${d.hostname}: ${saved.status}`,
    }));
    return saved;
  }
}
