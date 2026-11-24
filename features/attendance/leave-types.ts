import { eq, sql } from "drizzle-orm";
import { CrudService, ValidationError, type Ctx } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import attendanceFeature from "./feature";
import { leaveTypeInput } from "./inputs";
import { ensureTypes } from "./leave-ledger";
import { leaveLedger, leaveRequests, leaveTypes } from "./schema";

type Perm = keyof typeof attendanceFeature.permissions;
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;

/** The leave types of a school. Anyone who may apply for leave can read them; attendance:manage changes them. */
export class LeaveTypeService extends CrudService<typeof leaveTypes, Perm> {
  protected feature = attendanceFeature;
  protected table = leaveTypes;
  protected entityName = "Leave type";
  protected readPermission = "leave" as const;
  protected writePermission = "manage" as const;
  protected createSchema = leaveTypeInput;
  protected updateSchema = leaveTypeInput;
  protected defaultSort = "sort";

  constructor(ctx: Ctx) { super(ctx); }

  protected sortColumns() { return { sort: leaveTypes.sort, name: leaveTypes.name }; }
  protected searchColumns() { return [leaveTypes.name, leaveTypes.code]; }
  protected describe(r: LeaveTypeRow) { return `${r.name} (${r.code})`; }

  /** Every type, in order, creating the defaults the first time. Inactive ones only for the admin page. */
  async all(opts: { inactive?: boolean } = {}): Promise<LeaveTypeRow[]> {
    return this.read("leave", async (tx) => {
      await ensureTypes(tx, this.ctx.schoolId);
      const rows = await tx.select().from(leaveTypes).orderBy(leaveTypes.sort, leaveTypes.name);
      return opts.inactive && this.can("manage") ? rows : rows.filter((t) => t.isActive);
    });
  }

  protected async usage(tx: Tx, t: LeaveTypeRow): Promise<[string, number][]> {
    const [[reqs], [rows]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).where(eq(leaveRequests.typeId, t.id)),
      tx.select({ n: sql<number>`count(*)::int` }).from(leaveLedger).where(eq(leaveLedger.typeId, t.id)),
    ]);
    return [["requests", reqs?.n ?? 0], ["balance entries", rows?.n ?? 0]];
  }

  /** Changing paid or unpaid rewrites what past leave cost in salary, so a type in use keeps its answer. */
  protected async beforeUpdate(tx: Tx, existing: LeaveTypeRow, data: Record<string, unknown>) {
    if (data.paid !== existing.paid && (await this.usage(tx, existing)).some(([, n]) => n > 0)) throw new ValidationError({ paid: "This type is already used. Add a new type instead of changing paid or unpaid." });
    return data;
  }
}
