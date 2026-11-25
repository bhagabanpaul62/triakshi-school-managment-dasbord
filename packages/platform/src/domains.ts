import { and, count, desc, eq, ilike, or, schoolDomainEvents, schoolDomains, schools } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService, ValidationError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { oneOf } from "./inputs";

export type DomainRow = typeof schoolDomains.$inferSelect;
/** What the check or the release did, for the audit line. The work itself is passed in: it lives in the domains feature, which a package must not import. */
export type DomainRun = (d: DomainRow, by: string) => Promise<{ status: string; health: string | null }>;

/** Released by staff and not yet allowed back: the school's Check now is refused until then. The domains feature reads the same two event kinds. */
const staffReleased = (events: { kind: string; byName: string | null }[]) => {
  const last = events.find((e) => e.kind === "released" || e.kind === "recovered");
  return last?.kind === "released" && !!last.byName;
};

/** Every hostname on the platform, with its status, health and last check. Filters: `status`, `kind`, `health`. */
export class DomainAdminService extends PlatformService {
  async list(query: ListQuery = {}) {
    this.require("owner", "support", "sales");
    const q = listQuerySchema.parse(query);
    const status = oneOf(q.filters.status, ["pending", "verified", "failed"] as const), kind = oneOf(q.filters.kind, ["subdomain", "custom"] as const);
    const health = oneOf(q.filters.health, ["ok", "warning", "broken"] as const);
    const where = and(
      q.q ? or(ilike(schoolDomains.hostname, `%${q.q}%`), ilike(schools.name, `%${q.q}%`)) : undefined,
      status ? eq(schoolDomains.status, status) : undefined,
      kind ? eq(schoolDomains.kind, kind) : undefined,
      health ? eq(schoolDomains.health, health) : undefined,
    );
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: schoolDomains.id, hostname: schoolDomains.hostname, kind: schoolDomains.kind, status: schoolDomains.status, isPrimary: schoolDomains.isPrimary,
          health: schoolDomains.health, certExpiresAt: schoolDomains.certExpiresAt, failingSince: schoolDomains.failingSince, dnsProvider: schoolDomains.dnsProvider,
          lastCheckedAt: schoolDomains.lastCheckedAt, checkError: schoolDomains.checkError, schoolName: schools.name, schoolId: schoolDomains.schoolId,
        }).from(schoolDomains).innerJoin(schools, eq(schools.id, schoolDomains.schoolId)).where(where)
          .orderBy(desc(schoolDomains.createdAt), schoolDomains.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(schoolDomains).innerJoin(schools, eq(schools.id, schoolDomains.schoolId)).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  /** One domain with its school and history. */
  async get(id: string) {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => {
      const [d] = await tx.select({ d: schoolDomains, schoolName: schools.name }).from(schoolDomains).innerJoin(schools, eq(schools.id, schoolDomains.schoolId)).where(eq(schoolDomains.id, id)).limit(1);
      if (!d) throw new NotFoundError("Domain");
      const events = await tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, id)).orderBy(desc(schoolDomainEvents.createdAt), desc(schoolDomainEvents.id)).limit(60);
      return { ...d.d, schoolName: d.schoolName, events, staffReleased: staffReleased(events) };
    });
  }

  /** Run the DNS and certificate check now (owner, support). */
  async checkNow(id: string, run: DomainRun) {
    this.require("owner", "support");
    const d = (await this.get(id)) as DomainRow;
    const out = await run(d, this.ctx.name);
    await this.tx((tx) => this.audit(tx, "domain.check", `Checked ${d.hostname}: ${out.status}${out.health ? `, ${out.health}` : ""}`, d.schoolId, { domainId: id }));
    return out;
  }

  /** End a claim or take a domain out of service, with a reason the school is shown (owner, support). */
  async release(id: string, reason: string, run: DomainRun) {
    this.require("owner", "support");
    const why = String(reason ?? "").trim();
    if (why.length < 5) throw new ValidationError({ reason: "Say why, in a few words. The school is shown this." });
    const d = (await this.get(id)) as DomainRow;
    const out = await run(d, this.ctx.name);
    await this.tx((tx) => this.audit(tx, "domain.release", `Released ${d.hostname}: ${why}`, d.schoolId, { domainId: id, reason: why }));
    return out;
  }

  /** Let the school press Check now again on a domain staff released (owner, support). The domain stays stopped until its records check out. */
  async allow(id: string) {
    this.require("owner", "support");
    const d = await this.get(id);
    if (d.status !== "failed" || !d.staffReleased) throw new ConflictError("This domain was not released by staff, so nothing is blocked.");
    await this.tx(async (tx) => {
      await tx.insert(schoolDomainEvents).values({ schoolId: d.schoolId, domainId: id, hostname: d.hostname, kind: "recovered", detail: "Triakshi allowed the school to check this domain again.", byName: this.ctx.name });
      await this.audit(tx, "domain.allow", `Allowed ${d.hostname} to be checked again`, d.schoolId, { domainId: id });
    });
  }
}
