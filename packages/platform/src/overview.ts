import { and, asc, count, customDesignRequests, desc, eq, gte, inArray, invoices, isNull, lt, lte, plans, schools, sql, subscriptions, supportTickets, type SchoolStatus } from "@smw/db";
import { PlatformService } from "@smw/feature-kit";

/** Monthly recurring revenue in paise: annual subscriptions count as a twelfth. */
export const monthlyPaise = (s: { interval: "annual" | "monthly"; pricePaise: number }) => (s.interval === "annual" ? Math.round(s.pricePaise / 12) : s.pricePaise);

/** Numbers for the console home. Honest: 0 when there is nothing. */
export class OverviewService extends PlatformService {
  async summary() {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => {
      const now = new Date();
      const [byStatus, trialEnding, subs, tickets, recent, endingSoon, late, unassigned, urgent, toQuote] = await Promise.all([
        tx.select({ status: schools.status, n: count() }).from(schools).groupBy(schools.status),
        tx.select({ n: count() }).from(schools).where(and(eq(schools.status, "trial"), gte(schools.trialEndsAt, now), lte(schools.trialEndsAt, new Date(now.getTime() + 7 * 86_400_000)))),
        tx.select({ interval: subscriptions.interval, pricePaise: subscriptions.pricePaise }).from(subscriptions).where(eq(subscriptions.status, "active")),
        tx.select({ n: count() }).from(supportTickets).where(inArray(supportTickets.status, ["open", "pending"])),
        tx.select({ id: schools.id, name: schools.name, slug: schools.slug, status: schools.status, city: schools.city, createdAt: schools.createdAt, planName: plans.name, students: sql<number>`(select count(*)::int from students st where st.school_id = ${schools.id} and st.status = 'active')` })
          .from(schools).leftJoin(plans, eq(plans.id, schools.planId)).orderBy(desc(schools.createdAt)).limit(8),
        tx.select({ id: schools.id, name: schools.name, trialEndsAt: schools.trialEndsAt }).from(schools)
          .where(and(eq(schools.status, "trial"), gte(schools.trialEndsAt, now), lte(schools.trialEndsAt, new Date(now.getTime() + 7 * 86_400_000)))).orderBy(asc(schools.trialEndsAt)).limit(5),
        tx.select({ n: count(), total: sql<number>`coalesce(sum(${invoices.totalPaise}), 0)` }).from(invoices).where(and(eq(invoices.status, "issued"), lt(invoices.dueAt, now))),
        tx.select({ n: count() }).from(supportTickets).where(and(inArray(supportTickets.status, ["open", "pending"]), isNull(supportTickets.assignedStaffId))),
        tx.select({ n: count() }).from(supportTickets).where(and(inArray(supportTickets.status, ["open", "pending"]), inArray(supportTickets.priority, ["high", "urgent"]))),
        tx.select({ n: count() }).from(customDesignRequests).where(eq(customDesignRequests.status, "requested")),
      ]);
      const status = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Partial<Record<SchoolStatus, number>>;
      return {
        status,
        totalSchools: Object.values(status).reduce((a, b) => a + b, 0),
        trialEnding7d: Number(trialEnding[0]?.n ?? 0),
        mrrPaise: subs.reduce((a, s) => a + monthlyPaise(s), 0),
        activeSubscriptions: subs.length,
        openTickets: Number(tickets[0]?.n ?? 0),
        unassignedTickets: Number(unassigned[0]?.n ?? 0),
        urgentTickets: Number(urgent[0]?.n ?? 0),
        trialsEnding: endingSoon,
        overdueInvoices: { count: Number(late[0]?.n ?? 0), paise: Number(late[0]?.total ?? 0) },
        designToQuote: Number(toQuote[0]?.n ?? 0),
        recentSignups: recent,
      };
    });
  }
}
