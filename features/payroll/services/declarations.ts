import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { ForbiddenError } from "@smw/feature-kit";
import { fyOf, monthStart, todayIST } from "@smw/feature-kit/money";
import { computeMonth } from "../compute";
import { PayrollService } from "../base";
import { payAssignments, payDeclarations, payProfiles } from "../schema";

const money = z.coerce.number().int().min(0).max(100_000_000_00);
const input = z.object({ userId: z.uuid().optional(), fy: z.string().regex(/^\d{4}-\d{2}$/).optional(), otherIncomePaise: money.default(0), deductionsPaise: money.default(0), previousSalaryPaise: money.default(0), previousTdsPaise: money.default(0), note: z.string().trim().max(300).optional() });

export interface TaxEstimate { fy: string; regime: "new" | "old"; yearlyIncomePaise: number; taxablePaise: number; yearlyTaxPaise: number; monthlyPaise: number; monthsLeft: number }

/** What a person declared for tax, and the estimate it gives. Own record for everyone; payroll staff may edit anyone's. */
export class DeclarationService extends PayrollService {
  private target(userId?: string) {
    const id = userId ?? this.ctx.userId;
    if (id !== this.ctx.userId && !this.can("manage")) throw new ForbiddenError();
    return id;
  }

  async get(userId?: string, fy = fyOf(todayIST())) {
    const id = this.target(userId);
    return this.read("self", async (tx) => (await tx.select().from(payDeclarations).where(and(eq(payDeclarations.userId, id), eq(payDeclarations.fy, fy))))[0] ?? null);
  }

  async save(raw: unknown) {
    const d = this.parse(input, raw);
    const userId = this.target(d.userId), fy = d.fy ?? fyOf(todayIST());
    this.authorize("self", "write");
    const { userId: _u, fy: _f, ...values } = d;
    return this.write("self", async (tx) => (await tx.insert(payDeclarations).values({ schoolId: this.ctx.schoolId, userId, fy, ...values, note: d.note ?? null })
      .onConflictDoUpdate({ target: [payDeclarations.userId, payDeclarations.fy], set: { ...values, note: d.note ?? null } }).returning())[0]!,
    (r) => ({ action: "declare", entity: "PayDeclaration", entityId: r.id, summary: `Saved a tax declaration for ${fy}`, meta: { userId } }));
  }

  /** The tax picture for this year from the person's pay today and what they declared. Null when no pay is set up or the year has no slabs. */
  async estimate(userId?: string): Promise<TaxEstimate | null> {
    const id = this.target(userId);
    return this.read("self", async (tx) => {
      const month = monthStart(todayIST());
      const [a] = await tx.select({ id: payAssignments.id }).from(payAssignments).where(and(eq(payAssignments.userId, id), lte(payAssignments.fromDate, month))).orderBy(desc(payAssignments.fromDate)).limit(1);
      if (!a) return null;
      const { done } = await computeMonth({ ...(await this.envOf(tx)), attendanceOn: false }, { userIds: [id], month, runId: null });
      const c = done[0];
      return c?.tax ? { fy: fyOf(month), regime: (await tx.select({ r: payProfiles.regime }).from(payProfiles).where(eq(payProfiles.userId, id)))[0]?.r ?? "new", yearlyIncomePaise: c.tax.incomePaise, taxablePaise: c.tax.taxablePaise, yearlyTaxPaise: c.tax.yearlyTaxPaise, monthlyPaise: c.tax.monthlyPaise, monthsLeft: c.tax.monthsLeft } : null;
    });
  }
}
