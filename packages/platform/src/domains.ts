import { and, count, desc, eq, ilike, or, schoolDomains, schools } from "@smw/db";
import { oneOf } from "./inputs";
import { PlatformService, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";

/** Every hostname on the platform, with its verification status and last DNS check. Filters: `status`, `kind`. */
export class DomainAdminService extends PlatformService {
  async list(query: ListQuery = {}) {
    this.require("owner", "support", "sales");
    const q = listQuerySchema.parse(query);
    const status = oneOf(q.filters.status, ["pending", "verified", "failed"] as const), kind = oneOf(q.filters.kind, ["subdomain", "custom"] as const);
    const where = and(
      q.q ? or(ilike(schoolDomains.hostname, `%${q.q}%`), ilike(schools.name, `%${q.q}%`)) : undefined,
      status ? eq(schoolDomains.status, status) : undefined,
      kind ? eq(schoolDomains.kind, kind) : undefined,
    );
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: schoolDomains.id, hostname: schoolDomains.hostname, kind: schoolDomains.kind, status: schoolDomains.status, isPrimary: schoolDomains.isPrimary,
          lastCheckedAt: schoolDomains.lastCheckedAt, checkError: schoolDomains.checkError, schoolName: schools.name, schoolId: schoolDomains.schoolId,
        }).from(schoolDomains).innerJoin(schools, eq(schools.id, schoolDomains.schoolId)).where(where)
          .orderBy(desc(schoolDomains.createdAt), schoolDomains.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(schoolDomains).innerJoin(schools, eq(schools.id, schoolDomains.schoolId)).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }
}
