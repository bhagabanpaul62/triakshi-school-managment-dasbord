import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { fyOf, monthStart, todayIST } from "@smw/feature-kit/money";
import type { Tx } from "@smw/db";
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

  /** Save what a person declares. It counts for tax only once the office accepts it, and any change takes the acceptance away. Payroll staff saving for someone else are the office, so theirs counts at once. */
  async save(raw: unknown) {
    const d = this.parse(input, raw);
    const userId = this.target(d.userId), fy = d.fy ?? fyOf(todayIST());
    this.authorize("self", "write");
    const { userId: _u, fy: _f, ...values } = d;
    const figures = (r: { otherIncomePaise: number; deductionsPaise: number; previousSalaryPaise: number; previousTdsPaise: number } | undefined) => r && ({ otherIncomePaise: Number(r.otherIncomePaise), deductionsPaise: Number(r.deductionsPaise), previousSalaryPaise: Number(r.previousSalaryPaise), previousTdsPaise: Number(r.previousTdsPaise) });
    return this.write("self", async (tx) => {
      const [before] = await tx.select().from(payDeclarations).where(and(eq(payDeclarations.userId, userId), eq(payDeclarations.fy, fy)));
      const office = userId !== this.ctx.userId;
      const set = { ...values, note: d.note ?? null, returnedNote: null, acceptedBy: office ? this.ctx.userId : null, acceptedAt: office ? new Date() : null };
      const [row] = await tx.insert(payDeclarations).values({ schoolId: this.ctx.schoolId, userId, fy, ...set }).onConflictDoUpdate({ target: [payDeclarations.userId, payDeclarations.fy], set }).returning();
      await this.audit(tx, { action: "declare", entity: "PayDeclaration", entityId: row!.id, summary: `Saved a tax declaration for ${fy}${office ? " (entered by the office)" : ""}`, meta: { userId, from: figures(before) ?? null, to: figures(row!) } });
      return row!;
    });
  }

  /** The office takes a declaration as true: from now on it counts for tax. */
  async accept(userId: string, fy = fyOf(todayIST())) {
    this.authorize("manage", "write");
    return this.write("manage", async (tx) => {
      const row = await this.open(tx, userId, fy);
      await this.notSelf(tx, userId, "accept your own tax declaration");
      await tx.update(payDeclarations).set({ acceptedBy: this.ctx.userId, acceptedAt: new Date(), returnedNote: null }).where(eq(payDeclarations.id, row.id));
      return row.id;
    }, (id) => ({ action: "accept_declaration", entity: "PayDeclaration", entityId: id, summary: `Accepted a tax declaration for ${fy}`, meta: { userId } }));
  }

  /** The office sends a declaration back with the reason; it does not count until the person saves it again and it is accepted. */
  async sendBack(userId: string, note: string, fy = fyOf(todayIST())) {
    this.authorize("manage", "write");
    const why = this.parse(z.string().trim().min(3, "Say what to fix.").max(300), note);
    return this.write("manage", async (tx) => {
      const row = await this.open(tx, userId, fy);
      await tx.update(payDeclarations).set({ acceptedBy: null, acceptedAt: null, returnedNote: why }).where(eq(payDeclarations.id, row.id));
      return row.id;
    }, (id) => ({ action: "return_declaration", entity: "PayDeclaration", entityId: id, summary: `Sent a tax declaration back: ${why}`, meta: { userId } }));
  }

  private async open(tx: Tx, userId: string, fy: string) {
    const [row] = await tx.select().from(payDeclarations).where(and(eq(payDeclarations.userId, userId), eq(payDeclarations.fy, fy)));
    if (!row) throw new NotFoundError("Declaration");
    if (row.acceptedAt) throw new ConflictError("This declaration is already accepted.");
    return row;
  }

  /** How many declarations wait for the office, for the people page. */
  async waiting(fy = fyOf(todayIST())): Promise<number> {
    return this.read("manage", async (tx) => (await tx.select({ id: payDeclarations.id }).from(payDeclarations).where(and(eq(payDeclarations.fy, fy), isNull(payDeclarations.acceptedAt)))).length);
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
