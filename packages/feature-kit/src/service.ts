import { z } from "zod";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { auditLogs, platformAuditLogs, withConsole, withSchool, type Tx } from "@smw/db";
import { allows, type Ctx, type StaffCtx } from "./context";
import type { FeatureDef } from "./feature";
import { ConflictError, FeatureOffError, ForbiddenError, NotFoundError, ReadOnlyError, parse } from "./errors";

/** The Postgres error code of a driver error (drizzle wraps it in `cause`). */
export const pgErrorCode = (e: unknown) => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

/**
 * Rows of another feature's table that match `where`, for `usage()` guards. A feature's dependents are read by raw SQL,
 * and a table that does not exist (feature never switched on) counts as zero. `table` and column names are code constants.
 */
export async function countIn(tx: Tx, table: string, where: SQL): Promise<number> {
  const [t] = [...(await tx.execute(sql`select to_regclass(${table}) as t`))] as { t: string | null }[];
  if (!t?.t) return 0;
  const [r] = [...(await tx.execute(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`))] as { n: number }[];
  return Number(r?.n ?? 0);
}
/** `where <col> = <id>` for countIn. */
export const by = (col: string, id: string) => sql`${sql.raw(col)} = ${id}`;

export interface AuditEntry { action: string; entity?: string; entityId?: string | null; summary?: string; meta?: Record<string, unknown> }

/**
 * Base class of every school service. Holds the caller's context and gives subclasses three things:
 * `read()` and `write()` (permission + module + read-only checks, then a school-scoped transaction),
 * and `audit()` (append-only log in the same transaction). Framework-free: no React, no Next.js.
 */
export abstract class SchoolService<P extends string = string> {
  protected abstract readonly feature: FeatureDef<P>;

  constructor(protected readonly ctx: Ctx) {}

  /** May the caller do this? For hiding buttons; services still enforce. */
  can(permission: P): boolean {
    return allows(this.ctx, this.feature, permission);
  }

  protected authorize(permission: P, mode: "read" | "write") {
    if (!this.ctx.features.has(this.feature.key)) throw new FeatureOffError(this.feature.key);
    if (!allows(this.ctx, this.feature, permission)) throw new ForbiddenError();
    if (mode === "write" && this.ctx.readOnly) throw new ReadOnlyError();
  }

  /** Run a read inside this school's RLS scope. */
  protected read<T>(permission: P, fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.authorize(permission, "read");
    return withSchool(this.ctx.schoolId, fn);
  }

  /** Run a change inside this school's RLS scope; pass `audit` to log it in the same transaction. */
  protected write<T>(permission: P, fn: (tx: Tx) => Promise<T>, audit?: (result: T) => AuditEntry): Promise<T> {
    this.authorize(permission, "write");
    return withSchool(this.ctx.schoolId, async (tx) => {
      const result = await fn(tx);
      if (audit) await this.audit(tx, audit(result));
      return result;
    });
  }

  protected async audit(tx: Tx, e: AuditEntry) {
    await tx.insert(auditLogs).values({
      schoolId: this.ctx.schoolId,
      actorUserId: this.ctx.userId,
      actorStaffId: this.ctx.supportStaffId ?? null,
      module: this.feature.key,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      summary: e.summary,
      meta: e.meta ?? {},
      ip: this.ctx.ip,
    });
  }

  /** Validate input against a zod schema or throw ValidationError. */
  protected parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
    return parse(schema, input);
  }
}

// ---------- lists ----------

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  filters: z.record(z.string(), z.string().optional()).default({}),
});
export type ListQuery = z.input<typeof listQuerySchema>;
export type ParsedListQuery = z.output<typeof listQuerySchema>;

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number; pageCount: number }

/** Build a Page from rows and a total. */
export const toPage = <T>(rows: T[], total: number, q: ParsedListQuery): Page<T> => ({
  rows, total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
});

/** Read list params from Next.js `searchParams` (any key not page/pageSize/q/sort/dir becomes a filter). */
export function listQueryFrom(params: Record<string, string | string[] | undefined>): ParsedListQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const { page, pageSize, q, sort, dir, ...rest } = params;
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) { const x = one(v); if (x) filters[k] = x; }
  return listQuerySchema.parse({ page: one(page), pageSize: one(pageSize), q: one(q) || undefined, sort: one(sort), dir: one(dir), filters });
}

type TenantTable = PgTable & { id: PgColumn; schoolId: PgColumn; createdAt: PgColumn };

/** Never written to the audit log: secrets, sealed values and health text. */
const AUDIT_HIDDEN = /password|token|secret|_?sealed|hash|medical|allerg|health|conditions|medication|private|blood|diagnos|disabilit|salary|wage|ctc|bank|ifsc|upi|last4|aadhaar|aadhar/i;
const AUDIT_SKIP = new Set(["id", "schoolId", "createdAt", "updatedAt"]);
const auditText = (v: unknown): string | number | boolean | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = v instanceof Date ? v.toISOString() : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 200)}...` : s;
};

/** What an update changed, field by field: `{ phone: ["98...", "99..."] }`. Hidden fields (and any in `hidden`) say only that they changed. */
export function auditChanges(before: Record<string, unknown>, after: Record<string, unknown>, hidden: readonly string[] = []): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    if (AUDIT_SKIP.has(k)) continue;
    const a = auditText(before[k]), b = auditText(after[k]);
    if (a === b) continue;
    out[k] = AUDIT_HIDDEN.test(k) || hidden.includes(k) ? ["(hidden)", "(hidden)"] : [a, b];
  }
  return out;
}

/**
 * Generic CRUD for one school-owned table: paginated search list, get, create, update, delete,
 * each permission-checked, RLS-scoped and audited. Subclasses declare the table, schemas and
 * searchable/sortable columns, and override the hooks for anything special.
 */
export abstract class CrudService<
  T extends TenantTable,
  P extends string = string,
  Row extends Record<string, unknown> = T["$inferSelect"],
> extends SchoolService<P> {
  protected abstract readonly table: T;
  /** Human name for messages and the audit log, e.g. "Student". */
  protected abstract readonly entityName: string;
  protected abstract readonly createSchema: z.ZodType<Record<string, unknown>>;
  protected abstract readonly updateSchema: z.ZodType<Record<string, unknown>>;
  protected abstract readonly readPermission: P;
  protected abstract readonly writePermission: P;

  protected searchColumns(): PgColumn[] { return []; }
  protected sortColumns(): Record<string, PgColumn> { return { createdAt: this.table.createdAt }; }
  protected defaultSort = "createdAt";
  /** Extra WHERE clauses from `query.filters` (e.g. classId, status). */
  protected filterClauses(_filters: Record<string, string | undefined>): (SQL | undefined)[] { return []; }
  /** Restrict what the caller may see (e.g. a parent sees only their children). */
  protected async scopeClause(_tx: Tx): Promise<SQL | undefined> { return undefined; }
  /** Text for the audit summary. */
  protected describe(row: Row): string { return String(row.name ?? row.title ?? row.id); }
  /** Columns whose old and new values never go to the audit log (private or sensitive text); the log says only that they changed. */
  protected auditHidden(): readonly string[] { return []; }

  protected async beforeCreate(_tx: Tx, data: Record<string, unknown>): Promise<Record<string, unknown>> { return data; }
  protected async afterCreate(_tx: Tx, _row: Row): Promise<void> {}
  protected async beforeUpdate(_tx: Tx, _existing: Row, data: Record<string, unknown>): Promise<Record<string, unknown>> { return data; }
  protected async beforeRemove(_tx: Tx, _existing: Row): Promise<void> {}
  /**
   * What still uses this row, as [what, how many] (see `countIn`). Anything above zero stops the delete with a friendly
   * "still in use" message, so history (marks, attendance, payments) is never cascaded away by accident.
   */
  protected async usage(_tx: Tx, _existing: Row): Promise<[string, number][]> { return []; }

  protected inUse(why?: string) {
    return new ConflictError(`This ${this.entityName.toLowerCase()} is still in use${why ? ` (${why})` : " elsewhere"}, so it can't be deleted.`);
  }

  async list(query: ListQuery = {}): Promise<Page<Row>> {
    const q = listQuerySchema.parse(query);
    return this.read(this.readPermission, async (tx) => {
      const search = q.q && this.searchColumns().length ? or(...this.searchColumns().map((c) => ilike(c, `%${q.q}%`))) : undefined;
      const where = and(search, await this.scopeClause(tx), ...this.filterClauses(q.filters));
      const sortCol = this.sortColumns()[q.sort ?? this.defaultSort] ?? this.table.createdAt;
      const t = this.table as TenantTable;
      const [rows, totals] = await Promise.all([
        tx.select().from(t).where(where).orderBy(q.dir === "asc" ? asc(sortCol) : desc(sortCol), asc(t.id))
          .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(t).where(where),
      ]);
      return toPage(rows as Row[], Number(totals[0]?.n ?? 0), q);
    });
  }

  async get(id: string): Promise<Row> {
    return this.read(this.readPermission, (tx) => this.findOrThrow(tx, id));
  }

  protected async findOrThrow(tx: Tx, id: string): Promise<Row> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError(this.entityName);
    const scope = await this.scopeClause(tx);
    const [row] = await tx.select().from(this.table as TenantTable).where(and(eq(this.table.id, id), scope)).limit(1);
    if (!row) throw new NotFoundError(this.entityName);
    return row as Row;
  }

  async create(input: unknown): Promise<Row> {
    this.authorize(this.writePermission, "write"); // permission errors before validation errors
    const data = this.parse(this.createSchema, input);
    return this.write(this.writePermission, async (tx) => {
      const values = await this.beforeCreate(tx, data);
      const [row] = await tx.insert(this.table).values({ ...values, schoolId: this.ctx.schoolId } as never).returning();
      await this.afterCreate(tx, row as Row);
      return row as Row;
    }, (row) => ({ action: "create", entity: this.entityName, entityId: String(row.id), summary: `Added ${this.entityName.toLowerCase()} ${this.describe(row)}` }));
  }

  async update(id: string, input: unknown): Promise<Row> {
    this.authorize(this.writePermission, "write");
    const data = this.parse(this.updateSchema, input);
    let changes: ReturnType<typeof auditChanges> = {};
    return this.write(this.writePermission, async (tx) => {
      const existing = await this.findOrThrow(tx, id);
      const values = await this.beforeUpdate(tx, existing, data);
      const [row] = await tx.update(this.table).set(values as never).where(eq(this.table.id, id)).returning();
      changes = auditChanges(existing, row as Row, this.auditHidden());
      return row as Row;
    }, (row) => ({ action: "update", entity: this.entityName, entityId: String(row.id), summary: `Updated ${this.entityName.toLowerCase()} ${this.describe(row)}`, meta: { changes } }));
  }

  async remove(id: string): Promise<{ id: string }> {
    let label = id;
    return this.write(this.writePermission, async (tx) => {
      const existing = await this.findOrThrow(tx, id);
      label = this.describe(existing);
      await this.beforeRemove(tx, existing);
      const used = (await this.usage(tx, existing)).filter(([, n]) => n > 0);
      if (used.length) throw this.inUse(used.map(([what, n]) => `${n} ${what}`).join(", "));
      try { await tx.delete(this.table).where(eq(this.table.id, id)); } catch (e) {
        // A foreign key that `usage()` did not list still protects the row; say so plainly.
        if (pgErrorCode(e) === "23503") throw this.inUse();
        throw e;
      }
      return { id };
    }, () => ({ action: "delete", entity: this.entityName, entityId: id, summary: `Deleted ${this.entityName.toLowerCase()} ${label}` }));
  }
}

// ---------- platform console ----------

/** Base class of console services: staff-role checks, cross-school transaction, platform audit log. */
export abstract class PlatformService {
  constructor(protected readonly ctx: StaffCtx) {}

  protected require(...roles: StaffCtx["role"][]) {
    if (!roles.includes(this.ctx.role)) throw new ForbiddenError();
  }

  protected tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withConsole(fn);
  }

  protected async audit(tx: Tx, action: string, summary: string, schoolId?: string | null, meta: Record<string, unknown> = {}) {
    await tx.insert(platformAuditLogs).values({ staffId: this.ctx.staffId, schoolId: schoolId ?? null, action, summary, meta });
  }

  protected parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
    return parse(schema, input);
  }
}
