import { and, asc, count, desc, eq, gte, ilike, invoices, isNull, lt, or, payments, schools, sql } from "@smw/db";
import type { SQL } from "drizzle-orm";
import { PlatformService, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";

export interface ConsoleInvoiceRow {
  id: string; number: string; schoolId: string; schoolName: string; description: string; totalPaise: number;
  status: "issued" | "paid" | "void" | "overdue" | "draft"; dueAt: Date | null; createdAt: Date; paidAt: Date | null;
}
export interface RevenueSummary {
  financialYear: string; collectedPaise: number; outstandingPaise: number; overduePaise: number; overdueCount: number;
  months: { month: string; paise: number }[];
}

const IST_MS = 5.5 * 3_600_000;
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

/** Console reads: invoices across every school and the revenue panel. */
export class ConsoleBillingService extends PlatformService {
  /** Start of the Indian financial year (1 April, IST) containing `now`. */
  static fyStart(now: Date) {
    const ist = new Date(now.getTime() + IST_MS);
    const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
    return new Date(Date.UTC(y, 3, 1) - IST_MS);
  }

  async invoices(query: ListQuery = {}, now = new Date()): Promise<Page<ConsoleInvoiceRow>> {
    const q = listQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const clauses: (SQL | undefined)[] = [];
      const s = q.filters.status;
      if (s === "overdue") clauses.push(and(eq(invoices.status, "issued"), lt(invoices.dueAt, now)));
      else if (s === "issued" || s === "paid" || s === "void") clauses.push(eq(invoices.status, s));
      if (q.q) clauses.push(or(ilike(invoices.number, `%${q.q}%`), ilike(schools.name, `%${q.q}%`)));
      const where = and(...clauses);
      const base = () => tx.select({
        id: invoices.id, number: invoices.number, schoolId: invoices.schoolId, schoolName: schools.name, description: invoices.description,
        totalPaise: invoices.totalPaise, status: invoices.status, dueAt: invoices.dueAt, createdAt: invoices.createdAt, paidAt: invoices.paidAt,
      }).from(invoices).innerJoin(schools, eq(schools.id, invoices.schoolId));
      const [rows, total] = await Promise.all([
        base().where(where).orderBy(desc(invoices.createdAt), asc(invoices.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(invoices).innerJoin(schools, eq(schools.id, invoices.schoolId)).where(where),
      ]);
      const out: ConsoleInvoiceRow[] = rows.map((r) => ({ ...r, status: r.status === "issued" && r.dueAt && r.dueAt < now ? "overdue" : r.status }));
      return toPage(out, Number(total[0]?.n ?? 0), q);
    });
  }

  async revenue(now = new Date()): Promise<RevenueSummary> {
    return this.tx(async (tx) => {
      const start = ConsoleBillingService.fyStart(now);
      const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()));
      const paid = await tx.select({ amount: payments.amountPaise, paidAt: payments.paidAt }).from(payments)
        .where(and(eq(payments.status, "success"), gte(payments.paidAt, start), lt(payments.paidAt, end)));
      const buckets = new Array<number>(12).fill(0);
      for (const p of paid) {
        const m = new Date(p.paidAt!.getTime() + IST_MS).getUTCMonth();
        buckets[(m + 9) % 12]! += p.amount; // April is index 0
      }
      const [open] = await tx.select({ total: sql<number>`coalesce(sum(${invoices.totalPaise}), 0)::bigint`, n: count() }).from(invoices).where(eq(invoices.status, "issued"));
      const [late] = await tx.select({ total: sql<number>`coalesce(sum(${invoices.totalPaise}), 0)::bigint`, n: count() }).from(invoices)
        .where(and(eq(invoices.status, "issued"), lt(invoices.dueAt, now), isNull(invoices.paidAt)));
      const istStart = new Date(start.getTime() + IST_MS);
      return {
        financialYear: `${istStart.getUTCFullYear()}-${String((istStart.getUTCFullYear() + 1) % 100).padStart(2, "0")}`,
        collectedPaise: buckets.reduce((a, b) => a + b, 0),
        outstandingPaise: Number(open?.total ?? 0), overduePaise: Number(late?.total ?? 0), overdueCount: Number(late?.n ?? 0),
        months: MONTHS.map((month, i) => ({ month, paise: buckets[i]! })),
      };
    });
  }
}
