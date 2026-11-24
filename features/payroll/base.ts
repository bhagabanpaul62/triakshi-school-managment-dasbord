import { eq, inArray } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, type Ctx } from "@smw/feature-kit";
import { MoneyService } from "@smw/feature-finance/base";
import { staffProfiles } from "@smw/feature-staff/schema";
import type { CalcEnv } from "./compute";
import { loadPayConfig } from "./config";
import payrollFeature from "./feature";
import { RateBook } from "./rate-book";
import { defaultSources, type Sources } from "./sources";

export type PayPerm = keyof typeof payrollFeature.permissions;

export interface Person { id: string; name: string; employeeId: string; designation: string | null; department: string | null; employmentType: string | null; joiningDate: string | null; left: boolean; email: string | null }

/** Every payroll service: acts as the payroll feature, with the shared reads (people, config, rates) in one place. */
export abstract class PayrollService extends MoneyService<PayPerm> {
  protected readonly feature = payrollFeature;
  protected readonly sources: Sources;
  constructor(ctx: Ctx, sources: Partial<Sources> = {}) { super(ctx); this.sources = { ...defaultSources, ...sources }; }

  protected config(tx: Tx) { return loadPayConfig(tx); }
  protected rateBook(tx: Tx) { return RateBook.load(tx); }
  protected async envOf(tx: Tx): Promise<CalcEnv> { return { tx, config: await this.config(tx), book: await this.rateBook(tx), sources: this.sources, attendanceOn: this.attendanceOn }; }
  protected get attendanceOn() { return this.ctx.features.has("attendance"); }

  /** Staff of this school by user id (RLS keeps it to one school). */
  protected async people(tx: Tx, ids?: string[]): Promise<Map<string, Person>> {
    if (ids && !ids.length) return new Map();
    const rows = await tx.select({
      id: users.id, name: users.name, email: users.email, employeeId: staffProfiles.employeeId, designation: staffProfiles.designation, department: staffProfiles.department,
      employmentType: staffProfiles.employmentType, joiningDate: staffProfiles.joiningDate, status: staffProfiles.status,
    }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId)).where(ids ? inArray(staffProfiles.userId, ids) : undefined);
    return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, email: r.email, employeeId: r.employeeId, designation: r.designation, department: r.department, employmentType: r.employmentType, joiningDate: r.joiningDate, left: r.status === "left" }]));
  }

  /** The caller may read this person's pay: payroll:read, or it is their own. */
  protected canSee(userId: string) { return this.can("read") || (userId === this.ctx.userId && this.can("self")); }
  protected assertCanSee(userId: string) { if (!this.canSee(userId)) throw new ForbiddenError(); }
}
