import { accountCredits, and, asc, count, creditNotes, desc, eq, gte, ilike, invoices, isNull, lt, or, payments, schools, sql, tdsCertificates, type Tx } from "@smw/db";
import type { SQL } from "drizzle-orm";
import { NotFoundError, PlatformService, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { z } from "zod";
import { dueOf } from "./amounts";
import { AccountCredits } from "./credits";
import { loadStatement, type Statement } from "./statement";
import { addDays } from "./util";

export interface ConsoleInvoiceRow {
  id: string; number: string; schoolId: string; schoolName: string; description: string; totalPaise: number; duePaise: number; tdsPaise: number;
  status: "issued" | "paid" | "void" | "overdue" | "draft"; dueAt: Date | null; createdAt: Date; paidAt: Date | null;
}
export interface AgeingBucket { key: "current" | "1-30" | "31-60" | "61-90" | "90+"; label: string; paise: number; count: number }
export interface ConsolePaymentRow {
  id: string; schoolId: string; schoolName: string; invoiceId: string | null; invoiceNumber: string | null; amountPaise: number; tdsPaise: number; method: string;
  status: string; reference: string | null; paidAt: Date | null; createdAt: Date;
}
export interface RevenueSummary {
  financialYear: string; collectedPaise: number; outstandingPaise: number; overduePaise: number; overdueCount: number;
  months: { month: string; paise: number }[];
}

const IST_MS = 5.5 * 3_600_000;
const AGE_BUCKETS = [["current", "Not yet due"], ["1-30", "1 to 30 days late"], ["31-60", "31 to 60 days late"], ["61-90", "61 to 90 days late"], ["90+", "Over 90 days late"]] as const;
const DUE_SQL = sql`(${invoices.totalPaise} - ${invoices.creditedPaise} - ${invoices.creditAppliedPaise})`;
/** Which unpaid invoices are in an ageing bucket, by how long past the due date they are at `now`. */
const ageClause = (key: string, now: Date) => {
  const at = (days: number) => addDays(now, -days);
  switch (key) {
    case "current": return or(isNull(invoices.dueAt), gte(invoices.dueAt, now));
    case "1-30": return and(lt(invoices.dueAt, now), gte(invoices.dueAt, at(30)));
    case "31-60": return and(lt(invoices.dueAt, at(30)), gte(invoices.dueAt, at(60)));
    case "61-90": return and(lt(invoices.dueAt, at(60)), gte(invoices.dueAt, at(90)));
    case "90+": return lt(invoices.dueAt, at(90));
    default: return undefined;
  }
};
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
      if (q.filters.age) clauses.push(and(eq(invoices.status, "issued"), ageClause(q.filters.age, now)));
      if (q.filters.schoolId && z.uuid().safeParse(q.filters.schoolId).success) clauses.push(eq(invoices.schoolId, q.filters.schoolId));
      if (q.q) clauses.push(or(ilike(invoices.number, `%${q.q}%`), ilike(schools.name, `%${q.q}%`)));
      const where = and(...clauses);
      const base = () => tx.select({
        id: invoices.id, number: invoices.number, schoolId: invoices.schoolId, schoolName: schools.name, description: invoices.description,
        totalPaise: invoices.totalPaise, status: invoices.status, dueAt: invoices.dueAt, createdAt: invoices.createdAt, paidAt: invoices.paidAt,
        creditedPaise: invoices.creditedPaise, creditAppliedPaise: invoices.creditAppliedPaise, tdsPaise: invoices.tdsPaise,
      }).from(invoices).innerJoin(schools, eq(schools.id, invoices.schoolId));
      const [rows, total] = await Promise.all([
        base().where(where).orderBy(desc(invoices.createdAt), asc(invoices.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(invoices).innerJoin(schools, eq(schools.id, invoices.schoolId)).where(where),
      ]);
      const out: ConsoleInvoiceRow[] = rows.map(({ creditedPaise, creditAppliedPaise, ...r }) => ({
        ...r, duePaise: dueOf({ status: r.status, totalPaise: r.totalPaise, creditedPaise, creditAppliedPaise }), status: r.status === "issued" && r.dueAt && r.dueAt < now ? "overdue" : r.status,
      }));
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
      const [open] = await tx.select({ total: sql<number>`coalesce(sum(${DUE_SQL}), 0)::bigint`, n: count() }).from(invoices).where(eq(invoices.status, "issued"));
      const [late] = await tx.select({ total: sql<number>`coalesce(sum(${DUE_SQL}), 0)::bigint`, n: count() }).from(invoices)
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

  /** What schools owe, by how late it is. Each bucket links to the invoice list through `?age=<key>`. */
  async ageing(now = new Date()): Promise<AgeingBucket[]> {
    return this.tx(async (tx) => Promise.all(AGE_BUCKETS.map(async ([key, label]) => {
      const [r] = await tx.select({ paise: sql<number>`coalesce(sum(${DUE_SQL}), 0)::bigint`, n: count() }).from(invoices).where(and(eq(invoices.status, "issued"), ageClause(key, now)));
      return { key, label, paise: Number(r?.paise ?? 0), count: Number(r?.n ?? 0) };
    })));
  }

  /** Payment history, all schools or one (`filters.schoolId`). Only payments that went through. */
  async payments(query: ListQuery = {}): Promise<Page<ConsolePaymentRow>> {
    const q = listQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const school = q.filters.schoolId && z.uuid().safeParse(q.filters.schoolId).success ? eq(payments.schoolId, q.filters.schoolId) : undefined;
      const where = and(eq(payments.status, "success"), school, q.q ? or(ilike(schools.name, `%${q.q}%`), ilike(payments.reference, `%${q.q}%`), ilike(invoices.number, `%${q.q}%`)) : undefined);
      const [rows, total] = await Promise.all([
        tx.select({ p: payments, schoolName: schools.name, number: invoices.number }).from(payments).innerJoin(schools, eq(schools.id, payments.schoolId)).leftJoin(invoices, eq(invoices.id, payments.invoiceId))
          .where(where).orderBy(desc(payments.paidAt), asc(payments.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(payments).innerJoin(schools, eq(schools.id, payments.schoolId)).leftJoin(invoices, eq(invoices.id, payments.invoiceId)).where(where),
      ]);
      return toPage(rows.map(({ p, schoolName, number }) => ({
        id: p.id, schoolId: p.schoolId, schoolName, invoiceId: p.invoiceId, invoiceNumber: number, amountPaise: p.amountPaise, tdsPaise: p.tdsPaise, method: p.method,
        status: p.status, reference: p.reference, paidAt: p.paidAt, createdAt: p.createdAt,
      })), Number(total[0]?.n ?? 0), q);
    });
  }

  /** One invoice with everything that happened to it, for the invoice page. */
  async invoice(id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Invoice");
    return this.tx(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!inv) throw new NotFoundError("Invoice");
      const [[school], pays, notes, certs] = await Promise.all([
        tx.select().from(schools).where(eq(schools.id, inv.schoolId)).limit(1),
        tx.select().from(payments).where(and(eq(payments.invoiceId, id), eq(payments.status, "success"))).orderBy(asc(payments.paidAt)),
        tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, id)).orderBy(asc(creditNotes.createdAt)),
        tx.select().from(tdsCertificates).where(eq(tdsCertificates.invoiceId, id)),
      ]);
      return { invoice: inv, school: school!, payments: pays, creditNotes: notes, certificates: certs, duePaise: dueOf(inv) };
    });
  }

  /** One school's money with us: what it owes, what we hold for it, and the statement for a period. */
  async schoolAccount(schoolId: string, period?: { from: string; to: string }, now = new Date()): Promise<{ school: typeof schools.$inferSelect; creditPaise: number; statement: Statement }> {
    if (!z.uuid().safeParse(schoolId).success) throw new NotFoundError("School");
    return this.tx(async (tx: Tx) => {
      const [school] = await tx.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      const today = todayIST(now);
      const p = period ?? { from: `${today.slice(0, 4)}-01-01`, to: today };
      return { school, creditPaise: await AccountCredits.balance(tx, schoolId), statement: await loadStatement(tx, schoolId, p.from, p.to) };
    });
  }

  async credits(schoolId: string) {
    return this.tx((tx) => tx.select().from(accountCredits).where(eq(accountCredits.schoolId, schoolId)).orderBy(desc(accountCredits.createdAt), asc(accountCredits.id)).limit(100));
  }
}
