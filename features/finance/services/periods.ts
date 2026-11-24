import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { addMonths, fyOf, fyRange, monthStart, todayIST } from "@smw/feature-kit/money";
import { finApprovals, finJournals, finPeriods, type PERIOD_STATUSES } from "../schema";
import { FinanceService, day } from "./common";

export interface PeriodRow { month: string; status: (typeof PERIOD_STATUSES)[number]; reason: string | null; entries: number; pendingApprovals: number }

const reasonInput = z.object({ reason: z.string().trim().min(3, "Say why it is being reopened.").max(300) });

/** Month locks. A locked month refuses new entries; they land in the next open month with their own date kept (posting.ts). */
export class PeriodService extends FinanceService {
  /** The 12 months of a financial year ("2026-27"; default this one) with status, entries made and requests still waiting. */
  async list(fy = fyOf(todayIST())): Promise<PeriodRow[]> {
    const [start] = fyRange(fy);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
    return this.read("read", async (tx) => {
      const month = (col: unknown) => sql<string>`to_char(${col}, 'YYYY-MM-01')`;
      const [locks, counts, waiting] = await Promise.all([
        tx.select().from(finPeriods),
        tx.select({ m: month(finJournals.date), n: sql<number>`count(*)::int` }).from(finJournals).groupBy(month(finJournals.date)),
        tx.select({ m: month(sql`${finApprovals.createdAt} at time zone 'Asia/Kolkata'`), n: sql<number>`count(*)::int` }).from(finApprovals).where(eq(finApprovals.status, "pending")).groupBy(month(sql`${finApprovals.createdAt} at time zone 'Asia/Kolkata'`)),
      ]);
      return months.map((m) => {
        const lock = locks.find((l) => l.month === m);
        return { month: m, status: lock?.status ?? "open", reason: lock?.reason ?? null, entries: counts.find((c) => c.m === m)?.n ?? 0, pendingApprovals: waiting.find((c) => c.m === m)?.n ?? 0 };
      });
    });
  }

  softClose(month: string) { return this.set(month, "soft"); }
  close(month: string) { return this.set(month, "closed"); }
  /** Open a locked month again. The reason is kept with the audit entry. */
  async reopen(month: string, input: unknown) { return this.set(month, "open", this.parse(reasonInput, input).reason); }

  private async set(raw: string, status: PeriodRow["status"], reason?: string): Promise<{ month: string; status: PeriodRow["status"] }> {
    this.authorize("close", "write");
    const parsed = day.safeParse(raw);
    if (!parsed.success || raw !== monthStart(raw)) throw new ValidationError({ month: "Choose a month." });
    if (raw > monthStart(todayIST())) throw new ValidationError({ month: "A month that has not started cannot be closed." });
    return this.write("close", async (tx) => {
      const [now] = await tx.select().from(finPeriods).where(eq(finPeriods.month, raw)).for("update");
      const was = now?.status ?? "open";
      if (was === status) throw new ConflictError(`That month is already ${status === "soft" ? "soft closed" : status}.`);
      if (status === "soft" && was === "closed") throw new ConflictError("That month is closed. Reopen it first, with a reason, from Finance setup, Periods.");
      await tx.insert(finPeriods).values({ schoolId: this.ctx.schoolId, month: raw, status, reason: reason ?? null, changedBy: this.ctx.userId })
        .onConflictDoUpdate({ target: [finPeriods.schoolId, finPeriods.month], set: { status, reason: reason ?? null, changedBy: this.ctx.userId } });
      return { month: raw, status, was };
    }, (r) => ({ action: status === "open" ? "reopen" : status === "soft" ? "soft-close" : "close", entity: "Period", entityId: null,
      summary: `${status === "open" ? "Reopened" : status === "soft" ? "Soft closed" : "Closed"} ${raw.slice(0, 7)}${reason ? `: ${reason}` : ""}`, meta: { month: raw, from: r.was, to: status, reason } }))
      .then(({ month, status: s }) => ({ month, status: s }));
  }
}
