import { z } from "zod";
import { and, asc, auditLogs, count, desc, eq, gt, ilike, or, sql, users, type Tx } from "@smw/db";
import { NotFoundError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { AUDIT_LINK_TABLES, auditLink, type AuditLink } from "./audit-links";
import { DataService } from "./data-base";

export interface AuditRow {
  id: string; createdAt: Date; module: string; action: string; entity: string | null; entityId: string | null; summary: string | null;
  /** Who did it: the person's name, "Name (via support)" for a support session, "System" for jobs. */
  actor: string; actorId: string | null; /** True when Triakshi staff did it through a support session. */ support: boolean; ip: string | null;
}
export interface AuditChange { field: string; from: string; to: string }
export interface AuditDetail extends AuditRow { changes: AuditChange[]; link: AuditLink | null; related: AuditRow[] }

/** The most rows one CSV holds. */
export const AUDIT_CSV_LIMIT = 50_000;
const isDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "(empty)" : String(v));
/** "firstName" and "first_name" read as "First name". */
const fieldName = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Read-only view of the append-only audit log. Days are IST. Nothing here edits or deletes a row. */
export class AuditService extends DataService {
  private select(tx: Tx) {
    return tx.select({
      id: auditLogs.id, createdAt: auditLogs.createdAt, module: auditLogs.module, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId,
      summary: auditLogs.summary, ip: auditLogs.ip, ts: sql<string>`${auditLogs.createdAt}::text`, name: users.name, actorId: auditLogs.actorUserId, staffId: auditLogs.actorStaffId,
    }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId));
  }

  private shape = ({ name, staffId, ts: _ts, ...r }: Awaited<ReturnType<AuditService["select"]>>[number]): AuditRow => ({
    ...r, support: !!staffId, actor: name ? (staffId ? `${name} (via support)` : name) : staffId ? "Support" : "System",
  });

  /** Filters from the URL: text, module, action, actor, support=1, record (the thing's id), from and to (IST days). */
  private where(q: ReturnType<typeof listQuerySchema.parse>) {
    const { module, action, actor, support, record, from: f0, to: t0 } = q.filters;
    const from = isDay(f0), to = isDay(t0);
    const actorId = z.uuid().safeParse(actor).data;
    const day = sql`(${auditLogs.createdAt} at time zone 'Asia/Kolkata')::date`;
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : null;
    return and(
      like ? or(ilike(auditLogs.summary, like), ilike(auditLogs.entity, like)) : undefined,
      module ? eq(auditLogs.module, module) : undefined,
      action ? eq(auditLogs.action, action) : undefined,
      actorId ? eq(auditLogs.actorUserId, actorId) : undefined,
      support === "1" ? sql`${auditLogs.actorStaffId} is not null` : undefined,
      record ? eq(auditLogs.entityId, record.slice(0, 80)) : undefined,
      from ? sql`${day} >= ${from}::date` : undefined,
      to ? sql`${day} <= ${to}::date` : undefined,
      this.notAboutMe(),
    );
  }

  /** A report or complaint about someone is not theirs to read, not even as a line in the log. */
  private notAboutMe() {
    return sql`not (${auditLogs.module} in ('messages', 'requests') and jsonb_exists(coalesce(${auditLogs.meta}->'aboutUserIds', '[]'::jsonb), ${this.ctx.userId}))`;
  }

  async list(query: ListQuery = {}): Promise<Page<AuditRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("audit", async (tx) => {
      const where = this.where(q);
      const [rows, totals] = await Promise.all([
        this.select(tx).where(where).orderBy(desc(auditLogs.createdAt), asc(auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(auditLogs).where(where),
      ]);
      return toPage(rows.map(this.shape), Number(totals[0]?.n ?? 0), q);
    });
  }

  /** One entry opened: what changed field by field, the record if it still exists, and the other entries about the same record. */
  async detail(id: string): Promise<AuditDetail> {
    return this.read("audit", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Entry");
      const [row] = await this.select(tx).where(and(eq(auditLogs.id, id), this.notAboutMe())).limit(1);
      const [meta] = row ? await tx.select({ meta: auditLogs.meta }).from(auditLogs).where(eq(auditLogs.id, id)).limit(1) : [];
      if (!row || !meta) throw new NotFoundError("Entry");
      const raw = (meta.meta?.changes ?? {}) as Record<string, unknown>;
      // Written as [old, new] by auditChanges, or as { from, to } by hand; anything else is not a change we can show.
      const pair = (v: unknown): [unknown, unknown] | null =>
        Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : v && typeof v === "object" && ("from" in v || "to" in v) ? [(v as { from?: unknown }).from, (v as { to?: unknown }).to] : null;
      const changes = Object.entries(raw).flatMap(([field, v]) => { const p = pair(v); return p ? [{ field: fieldName(field), from: text(p[0]), to: text(p[1]) }] : []; });
      const related = row.entityId
        ? await this.select(tx).where(and(eq(auditLogs.entityId, row.entityId), sql`${auditLogs.id} <> ${id}`, this.notAboutMe())).orderBy(desc(auditLogs.createdAt)).limit(10)
        : [];
      return { ...this.shape(row), changes, link: await this.existing(tx, row.entity, row.entityId), related: related.map(this.shape) };
    });
  }

  /** The link, or null when the record has been deleted (the entry keeps its words). */
  private async existing(tx: Tx, entity: string | null, entityId: string | null): Promise<AuditLink | null> {
    const l = auditLink(entity, entityId);
    if (!l?.table) return l;
    if (!AUDIT_LINK_TABLES.has(l.table)) return null;
    const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass(${`public.${l.table}`})::text as t`);
    if (!has?.t) return null;
    const [found] = await tx.execute(sql`select 1 from ${sql.identifier(l.table)} where id = ${entityId!} limit 1`);
    return found ? l : null;
  }

  /**
   * Modules that have written to the log, for the filter. A loose index scan: it hops from one module to the next through the
   * (school, module, time) index, so it costs a few lookups however many entries the log has.
   */
  async modules(): Promise<string[]> {
    return this.read("audit", async (tx) => (await tx.execute<{ module: string }>(sql`
      with recursive t as (
        (select module from audit_logs where school_id = ${this.ctx.schoolId} order by module limit 1)
        union all
        select (select module from audit_logs where school_id = ${this.ctx.schoolId} and module > t.module order by module limit 1) from t where t.module is not null)
      select module from t where module is not null`)).map((r) => r.module));
  }

  /** What was done (create, update, delete, export...), for the filter: the last 90 days, so it stays cheap on a big log. */
  async actions(): Promise<string[]> {
    return this.read("audit", async (tx) => (await tx.selectDistinct({ a: auditLogs.action }).from(auditLogs).where(gt(auditLogs.createdAt, this.recent())).orderBy(asc(auditLogs.action))).map((r) => r.a));
  }

  /** People who appear in the log in the last 90 days, for the filter. */
  async actors(): Promise<{ id: string; name: string }[]> {
    return this.read("audit", (tx) => tx.selectDistinct({ id: users.id, name: users.name }).from(auditLogs).innerJoin(users, eq(users.id, auditLogs.actorUserId)).where(gt(auditLogs.createdAt, this.recent())).orderBy(asc(users.name)));
  }

  private recent() { return new Date(Date.now() - 90 * 86_400_000); }

  /**
   * The current filter as CSV rows, oldest chunk first is not needed: newest first, 1,000 at a time by (time, id), at most 50,000.
   * Asking is itself logged, once, before the first row. A caller streams the chunks so a big log never sits in memory.
   */
  async *csvChunks(query: ListQuery = {}): AsyncGenerator<AuditRow[]> {
    const q = listQuerySchema.parse({ ...query, page: 1, pageSize: 100 });
    this.authorize("audit", "read");
    const filters = Object.fromEntries(Object.entries(q.filters).filter(([, v]) => v));
    await this.read("audit", (tx) => this.audit(tx, { action: "export", entity: "Audit log", summary: `Downloaded the audit log as CSV${q.q || Object.keys(filters).length ? " (filtered)" : ""}`, meta: { filters: { ...(q.q ? { q: q.q } : {}), ...filters }, limit: AUDIT_CSV_LIMIT } }));
    let sent = 0;
    // The cursor is the row's own timestamp as text: a JS Date would drop microseconds and skip or repeat rows.
    let cursor: { ts: string; id: string } | null = null;
    while (sent < AUDIT_CSV_LIMIT) {
      const size = Math.min(1000, AUDIT_CSV_LIMIT - sent);
      const rows = await this.read("audit", async (tx) => {
        const after = cursor ? sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : undefined;
        return this.select(tx).where(and(this.where(q), after)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(size);
      });
      if (!rows.length) return;
      yield rows.map(this.shape);
      sent += rows.length;
      const last = rows[rows.length - 1]!;
      cursor = { ts: last.ts, id: last.id };
      if (rows.length < size) return;
    }
  }
}
