import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { f, type Ctx } from "@smw/feature-kit";
import { scope, viewerOf } from "./access";
import { RequestBase } from "./base";
import { isOpen, isOverdue, median } from "./clock";
import { requestCategories, requests } from "./schema";
import type { RequestState } from "./constants";

const range = z.object({ from: f.optDate(), to: f.optDate() });
const HOUR = 3_600_000;

export interface CategoryCount { name: string; total: number; open: number; overdue: number; resolved: number }
export interface Report {
  total: number; open: number; overdue: number; reopened: number;
  byCategory: CategoryCount[]; byState: Record<RequestState, number>;
  /** Median hours from raised to the first answer, and to resolved. Null when nothing has been answered. */
  medianFirstAnswerHours: number | null; medianResolveHours: number | null;
}

/** What the office reports to the principal. Counts only what this person may see (the same rule as the queue). */
export class ReportService extends RequestBase {
  constructor(ctx: Ctx) { super(ctx); }

  async summary(input: unknown = {}): Promise<Report> {
    const q = this.parse(range, input), now = new Date();
    return this.read("manage", async (tx) => {
      const v = await viewerOf(tx, this.ctx);
      const rows = await tx.select({ r: requests, category: requestCategories.name }).from(requests).innerJoin(requestCategories, eq(requestCategories.id, requests.categoryId))
        .where(and(scope(tx, v), q.from ? gte(requests.createdAt, new Date(`${q.from}T00:00:00+05:30`)) : undefined, q.to ? lt(requests.createdAt, new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000)) : undefined));
      const byState: Record<RequestState, number> = { new: 0, assigned: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };
      const cats = new Map<string, CategoryCount>();
      const first: number[] = [], done: number[] = [];
      let overdue = 0, reopened = 0;
      for (const { r, category } of rows) {
        byState[r.state]++;
        const c = cats.get(category) ?? { name: category, total: 0, open: 0, overdue: 0, resolved: 0 };
        c.total++;
        if (isOpen(r.state)) c.open++;
        if (r.state === "resolved" || r.state === "closed") c.resolved++;
        if (isOverdue(r, now)) { c.overdue++; overdue++; }
        if (r.reopenedCount) reopened++;
        if (r.firstAnswerAt) first.push((r.firstAnswerAt.getTime() - r.createdAt.getTime()) / HOUR);
        if (r.resolvedAt) done.push((r.resolvedAt.getTime() - r.createdAt.getTime()) / HOUR);
        cats.set(category, c);
      }
      return {
        total: rows.length, open: byState.new + byState.assigned + byState.in_progress + byState.waiting, overdue, reopened,
        byCategory: [...cats.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
        byState, medianFirstAnswerHours: median(first), medianResolveHours: median(done),
      };
    });
  }
}
