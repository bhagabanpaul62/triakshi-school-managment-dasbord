import { and, eq, sql } from "drizzle-orm";
import { allows } from "@smw/feature-kit";
import financeFeature from "@smw/feature-finance/feature";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { FeesBase } from "./base";
import { feeCounters, feeHeads, feeInvoices, feePlans } from "./schema";

/** What the school still has to set up before the first receipt, in the order to do it. Each step says where to go and who can do it. */
export class SetupService extends FeesBase {
  async status() {
    return this.read(this.can("collect") ? "collect" : "read", async (tx) => {
      const year = await this.currentYear(tx).catch(() => null);
      const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
      const [cash, bank, upi, heads, drafts, published, issued, open, settings] = await Promise.all([
        count(tx.select({ n: sql<number>`count(*)::int` }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, "cash"), eq(finCashAccounts.isActive, true)))),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, "bank"), eq(finCashAccounts.isActive, true)))),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(finCashAccounts).where(and(sql`${finCashAccounts.upiId} is not null`, eq(finCashAccounts.isActive, true)))),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(feeHeads).where(eq(feeHeads.isActive, true))),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(feePlans).where(year ? and(eq(feePlans.yearId, year.id), sql`${feePlans.status} in ('draft', 'pending')`) : sql`false`)),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(feePlans).where(year ? and(eq(feePlans.yearId, year.id), eq(feePlans.status, "published")) : sql`false`)),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(feeInvoices).where(eq(feeInvoices.status, "issued"))),
        count(tx.select({ n: sql<number>`count(*)::int` }).from(feeCounters).where(and(eq(feeCounters.userId, this.ctx.userId), sql`${feeCounters.closedAt} is null`))),
        this.settings(tx),
      ]);
      const who = (perm: "setup" | "collect") => (this.can(perm) ? null : "an admin or accountant");
      const admin = this.ctx.role === "admin" ? null : "an admin";
      const settingsWho = allows(this.ctx, financeFeature, "settings") ? null : "an admin";
      const steps = [
        { key: "year", label: "Set the academic year", done: !!year, href: "/app/academics/years", who: admin },
        { key: "cash", label: "Add the cash box and a bank account", done: cash > 0 && bank > 0, href: "/app/finance/settings?tab=cash&next=/app/fees", who: settingsWho },
        { key: "upi", label: "Add the school's UPI ID (to take UPI payments from families)", done: upi > 0 && settings.upiOn, href: upi > 0 ? "/app/finance/settings?tab=rules&next=/app/fees" : "/app/finance/settings?tab=cash&next=/app/fees", who: settingsWho },
        { key: "heads", label: "Add fee heads, like Tuition", done: heads > 0, href: "/app/fees/heads", who: who("setup") },
        { key: "plan", label: drafts > 0 && !published ? "Send the draft plan for approval" : "Make a fee plan and publish it", done: published > 0, href: "/app/fees/plans", who: who("setup") },
        { key: "issue", label: "Issue the bills", done: issued > 0, href: "/app/fees/invoices/issue", who: who("setup") },
        { key: "counter", label: "Open your counter", done: open > 0, href: "/app/fees/counter", who: who("collect") },
      ];
      return { steps, next: steps.find((s) => !s.done) ?? null, complete: steps.every((s) => s.done) };
    });
  }
}
