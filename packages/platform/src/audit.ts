import { and, auditLogs, count, desc, eq, ilike, or, platformAuditLogs, platformStaff, schools, users } from "@smw/db";
import { assertId } from "./inputs";
import { PlatformService, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";

/** Two read-only views: what platform staff did, and what happened inside one school. */
export class AuditAdminService extends PlatformService {
  /** Platform log, newest first. Filters: `school`, `staff`. */
  async platform(query: ListQuery = {}) {
    this.require("owner", "support", "sales");
    const q = listQuerySchema.parse(query);
    const where = and(
      q.q ? or(ilike(platformAuditLogs.summary, `%${q.q}%`), ilike(platformAuditLogs.action, `%${q.q}%`)) : undefined,
      q.filters.school ? eq(platformAuditLogs.schoolId, assertId(q.filters.school, "School")) : undefined,
      q.filters.staff ? eq(platformAuditLogs.staffId, assertId(q.filters.staff, "Staff member")) : undefined,
    );
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: platformAuditLogs.id, createdAt: platformAuditLogs.createdAt, action: platformAuditLogs.action, summary: platformAuditLogs.summary,
          staffName: platformStaff.name, schoolName: schools.name, schoolId: platformAuditLogs.schoolId,
        }).from(platformAuditLogs).leftJoin(platformStaff, eq(platformStaff.id, platformAuditLogs.staffId)).leftJoin(schools, eq(schools.id, platformAuditLogs.schoolId))
          .where(where).orderBy(desc(platformAuditLogs.createdAt), platformAuditLogs.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(platformAuditLogs).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  /** The school's own audit log (including support sessions, which carry `actorStaffId`). */
  async school(schoolId: string, query: ListQuery = {}) {
    this.require("owner", "support", "sales");
    const q = listQuerySchema.parse(query);
    assertId(schoolId, "School");
    const where = and(eq(auditLogs.schoolId, schoolId), q.q ? or(ilike(auditLogs.summary, `%${q.q}%`), ilike(auditLogs.module, `%${q.q}%`)) : undefined);
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: auditLogs.id, createdAt: auditLogs.createdAt, module: auditLogs.module, action: auditLogs.action, summary: auditLogs.summary,
          userName: users.name, viaSupport: auditLogs.actorStaffId,
        }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where)
          .orderBy(desc(auditLogs.createdAt), auditLogs.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(auditLogs).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }
}
