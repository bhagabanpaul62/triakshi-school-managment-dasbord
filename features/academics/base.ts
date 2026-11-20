// The one base every academics entity service extends: create, update, delete (with an "in use" guard), audit and list come from
// CrudService; this adds friendly database errors, the read-only closed year rule, teacher checks and the usage check.
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { users, type Tx } from "@smw/db";
import { ConflictError, CrudService, ValidationError, pgErrorCode, rethrowUnique, type Ctx } from "@smw/feature-kit";

// The usage guard and its helpers now live in @smw/feature-kit; re-exported so academics imports stay put.
export { by, countIn } from "@smw/feature-kit";
import academicsFeature from "./feature";
import { academicYears } from "./schema";

export type Perm = keyof typeof academicsFeature.permissions;
export type Tenant = PgTable & { id: PgColumn; schoolId: PgColumn; createdAt: PgColumn };
export type Option = { value: string; label: string };
export type AcademicYear = typeof academicYears.$inferSelect;

export const pgCode = pgErrorCode;

/** The school's current academic year, or null when none is set. */
export async function currentYear(tx: Tx): Promise<AcademicYear | null> {
  const [y] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y ?? null;
}

export abstract class AcademicsCrud<T extends Tenant> extends CrudService<T, Perm> {
  protected feature = academicsFeature;
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected abstract readonly duplicateMessage: string;
  /** Optional columns an edit form may blank: a missing value on update means "clear it", not "keep it". */
  protected readonly nullable: readonly string[] = [];

  constructor(ctx: Ctx) { super(ctx); }

  override async create(input: unknown): Promise<T["$inferSelect"]> { return this.guard(() => super.create(input)); }
  override async update(id: string, input: unknown): Promise<T["$inferSelect"]> { return this.guard(() => super.update(id, input)); }

  /** A closed academic year is read-only: refuse any change to what hangs off it. */
  protected async assertOpen(tx: Tx, yearId: string) {
    const [y] = await tx.select({ name: academicYears.name, status: academicYears.status }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
    if (y?.status === "closed") throw new ConflictError(`${y.name} is closed, so this can't be changed. Reopen the year first.`);
  }

  protected withNulls(data: Record<string, unknown>) {
    return { ...data, ...Object.fromEntries(this.nullable.map((k) => [k, data[k] ?? null])) };
  }

  /** A foreign key bypasses row-level security, so every id from a form must be checked as visible to this school. */
  protected async assertVisible(tx: Tx, table: Tenant, id: unknown, field: string, what: string) {
    const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, String(id))).limit(1);
    if (!row) throw new ValidationError({ [field]: `Pick a valid ${what}` });
  }

  private async guard<R>(fn: () => Promise<R>): Promise<R> {
    try { return await fn(); } catch (e) {
      if (pgCode(e) === "23503") throw new ConflictError("Something this depends on no longer exists. Refresh and try again.");
      return rethrowUnique(e, this.duplicateMessage);
    }
  }

  protected all(tx: Tx, ...order: SQL[]): Promise<T["$inferSelect"][]> {
    return tx.select().from(this.table as Tenant).orderBy(...(order.length ? order : [asc(this.table.createdAt)])) as Promise<T["$inferSelect"][]>;
  }

  /** Only users with role teacher may be class or subject teachers. */
  protected async assertTeacher(tx: Tx, userId: string | null | undefined, field = "classTeacherId") {
    if (!userId) return;
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.role, "teacher"))).limit(1);
    if (!u) throw new ValidationError({ [field]: "Pick a teacher from your staff" });
  }

  /** Active teachers for selects. */
  async teacherOptions(): Promise<Option[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), eq(users.status, "active"))).orderBy(asc(users.name));
      return rows.map((r) => ({ value: r.id, label: r.name }));
    });
  }
}
