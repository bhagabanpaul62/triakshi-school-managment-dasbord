import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { addDays, daysBetween, monthEnd, monthStart } from "@smw/feature-kit/money";
import { day, paiseAmount } from "@smw/feature-finance/services/common";
import { computeMonth, openLoans, type CalcEnv } from "../compute";
import { monthlyWages } from "../engine";
import { PayrollService } from "../base";
import { undoExit, exitTotals, type ExitLine } from "../exit-ledger";
import { payAssignments, payComponents, payExits, payItems, payRuns } from "../schema";
import { staffProfiles } from "@smw/feature-staff/schema";

export type Exit = typeof payExits.$inferSelect;
const otherLine = z.object({ kind: z.enum(["earning", "deduction"]), label: z.string().trim().min(1).max(60), amountPaise: paiseAmount });
const exitInput = z.object({
  userId: z.uuid(), lastDay: day, reason: z.string().trim().min(3, "Say why they are leaving.").max(200),
  /** Days of notice: more than zero = the school pays in lieu; less than zero = the person pays for notice not served. */
  noticeDays: z.coerce.number().int().min(-180).max(180).default(0),
  other: z.array(otherLine).max(10).default([]),
});
export interface ExitView { exit: Exit; name: string; employeeId: string; due: { wages: string; gratuity: string | null }; totals: ReturnType<typeof exitTotals>; noticeDays: number; blockers: string[]; stillActive: boolean; paid: boolean; sources: { key: string; source: string; confidence: string }[] }

const workingDaysAfter = (from: string, n: number) => { let d = from, left = n; while (left > 0) { d = addDays(d, 1); if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) left--; } return d; };

export class ExitService extends PayrollService {
  async list(query: ListQuery = {}): Promise<Page<Exit & { name: string; netPaise: number }>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const rows = await tx.select().from(payExits).where(and(q.filters.status ? eq(payExits.status, q.filters.status as Exit["status"]) : undefined, q.filters.userId ? eq(payExits.userId, q.filters.userId) : undefined)).orderBy(desc(payExits.lastDay));
      const people = await this.people(tx, [...new Set(rows.map((r) => r.userId))]);
      const needle = q.q?.toLowerCase();
      const full = rows.map((r) => ({ ...r, name: people.get(r.userId)?.name ?? "", netPaise: exitTotals(r.lines).net })).filter((r) => !needle || r.name.toLowerCase().includes(needle));
      return toPage(full.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), full.length, q);
    });
  }

  async get(id: string): Promise<ExitView> {
    return this.read("read", async (tx) => {
      const [x] = await tx.select().from(payExits).where(eq(payExits.id, id));
      if (!x) throw new NotFoundError("Exit");
      const [p] = await this.people(tx, [x.userId]).then((m) => [m.get(x.userId)]);
      const book = await this.rateBook(tx);
      const wages = book.resolve<number>("exit_pay_days", x.lastDay), gratuity = book.resolve<number>("gratuity_days", x.lastDay);
      const notice = x.lines.find((l) => l.code === "notice_pay" || l.code === "notice_recovery");
      const days = Number((notice?.note ?? "").replace("days=", "")) || 0;
      return {
        exit: x, name: p?.name ?? "", employeeId: p?.employeeId ?? "",
        due: { wages: workingDaysAfter(x.lastDay, wages?.value ?? 2), gratuity: x.lines.some((l) => l.code === "gratuity") ? addDays(x.lastDay, gratuity?.value ?? 30) : null },
        totals: exitTotals(x.lines), noticeDays: days, stillActive: !!p && !p.left, paid: x.status === "paid",
        blockers: [...x.lines.filter((l) => l.amountPaise === 0 && l.note?.startsWith("needs:")).map((l) => `${l.label}: ${l.note!.slice(6)}`), ...(exitTotals(x.lines).net < 0 ? ["Deductions are more than the settlement. Lower a deduction or pay part of the loan back first."] : [])],
        sources: [wages, gratuity].filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ key: r.key, source: r.source, confidence: r.confidence })),
      };
    });
  }

  async create(input: unknown): Promise<Exit> {
    this.authorize("manage", "write");
    const d = this.parse(exitInput, input);
    return this.write("manage", async (tx) => {
      const people = await this.people(tx, [d.userId]);
      if (!people.has(d.userId)) throw new NotFoundError("Person");
      const [open] = await tx.select({ id: payExits.id }).from(payExits).where(and(eq(payExits.userId, d.userId), sql`${payExits.status} not in ('rejected', 'paid')`));
      if (open) throw new ConflictError("This person already has an exit in progress. Open it from the list.");
      const lines = await this.build(tx, d);
      const [row] = await tx.insert(payExits).values({ schoolId: this.ctx.schoolId, userId: d.userId, lastDay: d.lastDay, reason: d.reason, lines, createdBy: this.ctx.userId }).returning();
      return row!;
    }, (r) => ({ action: "create", entity: "PayExit", entityId: r.id, summary: `Started an exit settlement, last day ${r.lastDay}` }));
  }

  /** Change the last day, reason, notice or typed lines of a draft or rejected exit; everything else is worked out again. */
  async update(id: string, input: unknown): Promise<Exit> {
    this.authorize("manage", "write");
    const d = this.parse(exitInput.omit({ userId: true }), input);
    return this.write("manage", async (tx) => {
      const [x] = await tx.select().from(payExits).where(eq(payExits.id, id)).for("update");
      if (!x) throw new NotFoundError("Exit");
      if (x.status !== "draft" && x.status !== "rejected") throw new ConflictError(`This exit is ${x.status}, so it cannot be changed.`);
      const lines = await this.build(tx, { ...d, userId: x.userId });
      return (await tx.update(payExits).set({ lastDay: d.lastDay, reason: d.reason, lines, status: "draft" }).where(eq(payExits.id, id)).returning())[0]!;
    }, (r) => ({ action: "update", entity: "PayExit", entityId: r.id, summary: "Changed an exit settlement" }));
  }

  /** Add one typed line (a bonus, a recovery) to a draft settlement. */
  async addLine(id: string, input: unknown): Promise<Exit> {
    const line = this.parse(otherLine, input);
    const v = await this.get(id);
    return this.update(id, { lastDay: v.exit.lastDay, reason: v.exit.reason, noticeDays: v.noticeDays, other: [...this.others(v), line] });
  }

  async removeLine(id: string, index: number): Promise<Exit> {
    const v = await this.get(id);
    return this.update(id, { lastDay: v.exit.lastDay, reason: v.exit.reason, noticeDays: v.noticeDays, other: this.others(v).filter((_, i) => i !== index) });
  }

  private others(v: ExitView) { return v.exit.lines.filter((l) => l.code === "other").map((l) => ({ kind: l.kind as "earning" | "deduction", label: l.label, amountPaise: l.amountPaise })); }

  async remove(id: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [x] = await tx.select().from(payExits).where(eq(payExits.id, id)).for("update");
      if (!x) throw new NotFoundError("Exit");
      if (x.status !== "draft" && x.status !== "rejected") throw new ConflictError("Only a draft or rejected exit can be deleted.");
      await tx.delete(payExits).where(eq(payExits.id, id));
    }, () => ({ action: "delete", entity: "PayExit", entityId: id, summary: "Deleted an exit draft" }));
  }

  async submit(id: string) {
    this.authorize("manage", "write");
    const v = await this.get(id);
    if (v.exit.status !== "draft" && v.exit.status !== "rejected") throw new ConflictError(`This exit is already ${v.exit.status}.`);
    if (v.blockers.length) throw new ConflictError(v.blockers[0]!);
    return this.write("manage", async (tx) => {
      await tx.update(payExits).set({ status: "pending" }).where(eq(payExits.id, id));
      return this.askApproval(tx, { kind: "payroll.exit", refType: "pay_exit", refId: id, title: `Final settlement: ${v.name}`, amountPaise: v.totals.net, reason: v.exit.reason, href: `/app/payroll/exits/${id}` });
    }, (a) => ({ action: "submit", entity: "PayExit", entityId: id, summary: "Sent a final settlement for approval", meta: { approvalId: a.id } }));
  }

  /** Take back an approved settlement that has not been paid. */
  async undo(id: string, input: unknown): Promise<void> {
    this.authorize("manage", "write");
    const why = this.parse(z.object({ reason: z.string().trim().min(3, "Say why.").max(200) }), input).reason;
    await this.write("manage", (tx) => undoExit(tx, this.poster, id, why), () => ({ action: "undo", entity: "PayExit", entityId: id, summary: `Undid a final settlement: ${why}` }));
  }

  /** The lines of a settlement, each with how it was worked out. */
  private async build(tx: Tx, d: z.infer<typeof exitInput>): Promise<ExitLine[]> {
    const env: CalcEnv = await this.envOf(tx);
    const { userId, lastDay } = d;
    const month = monthStart(lastDay);
    const lines: ExitLine[] = [];
    const [a] = await tx.select().from(payAssignments).where(and(eq(payAssignments.userId, userId), lte(payAssignments.fromDate, lastDay))).orderBy(desc(payAssignments.fromDate)).limit(1);
    if (!a) throw new ConflictError("This person has no pay set up. Set it up first so the settlement can be worked out.");
    const gross = Number(a.grossPaise), div = env.config.dayDivisor;

    // Salary for the days worked in the last month, unless a monthly run already pays this person for it.
    const [paidIn] = await tx.select({ id: payItems.id }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId)).where(and(eq(payItems.userId, userId), eq(payRuns.month, month), ne(payRuns.status, "cancelled"), sql`${payItems.skippedReason} is null`));
    if (paidIn) lines.push({ kind: "earning", code: "info", label: "Salary for the last month", amountPaise: 0, note: "Paid in that month's pay run" });
    else {
      const after = (monthEnd(month) > lastDay ? daysBetween(lastDay, monthEnd(month)) : 0) * 2;
      const { done } = await computeMonth(env, { userIds: [userId], month, runId: null, leftOn: { [userId]: lastDay }, extraUnpaid: { [userId]: after } });
      for (const l of done[0]?.result.lines ?? []) {
        if (l.code === "loan") continue;
        lines.push({ kind: l.kind, code: l.code ?? "salary", label: l.code ? l.label : `${l.label} (to ${lastDay.slice(8)}th)`, amountPaise: l.amountPaise, note: l.needsInput ? `needs:${l.note}` : l.note ?? undefined });
      }
    }

    // Leave paid out.
    if (this.attendanceOn) for (const e of await this.sources.days.encashable(tx, userId, lastDay)) {
      const amount = Math.round((gross * (e.halfDays / 2)) / div);
      if (amount > 0) lines.push({ kind: "earning", code: "leave_encashment", label: `Leave paid out: ${e.name}, ${e.halfDays / 2} days`, amountPaise: amount, note: `${e.typeId}:${e.halfDays}` });
    }
    if (d.noticeDays) lines.push({ kind: d.noticeDays > 0 ? "earning" : "deduction", code: d.noticeDays > 0 ? "notice_pay" : "notice_recovery", label: d.noticeDays > 0 ? `Notice pay, ${d.noticeDays} days` : `Notice not served, ${-d.noticeDays} days`, amountPaise: Math.round((gross * Math.abs(d.noticeDays)) / div), note: `days=${d.noticeDays}` });

    // What is still owed on loans comes out of the settlement.
    for (const l of (await openLoans(tx, [userId], addDaysToMonth(lastDay))).get(userId) ?? []) lines.push({ kind: "deduction", code: "loan", label: "Loan balance", amountPaise: l.balance, note: l.id });
    const g = await this.gratuity(tx, env, userId, lastDay, a, gross);
    if (g) lines.push(g);
    for (const o of d.other) lines.push({ ...o, code: "other" });
    return lines;
  }

  /** 15/26 of the last monthly wage for each year of service, when the person has served the minimum for their kind of job; never above the cap. */
  private async gratuity(tx: Tx, env: CalcEnv, userId: string, lastDay: string, a: typeof payAssignments.$inferSelect, gross: number): Promise<ExitLine | null> {
    const [s] = await tx.select({ joined: staffProfiles.joiningDate, type: staffProfiles.employmentType }).from(staffProfiles).where(eq(staffProfiles.userId, userId));
    if (!s?.joined || a.hourlyPaise != null || (s.type !== "permanent" && s.type !== "contract")) return null;
    const rate = (k: string) => env.book.resolve<number>(k, lastDay);
    const minYears = rate(s.type === "permanent" ? "gratuity_years" : "gratuity_years_fixed")?.value, cap = rate("gratuity_max")?.value;
    if (minYears === undefined || cap === undefined) return { kind: "earning", code: "gratuity", label: "Gratuity", amountPaise: 0, note: "needs:There is no gratuity rule for this date. Type the amount as another pay line." };
    const months = (+lastDay.slice(0, 4) - +s.joined.slice(0, 4)) * 12 + (+lastDay.slice(5, 7) - +s.joined.slice(5, 7)) - (+lastDay.slice(8) < +s.joined.slice(8) ? 1 : 0);
    const years = Math.floor(months / 12);
    if (years < minYears) return null;
    const counted = years + (months % 12 >= 6 ? 1 : 0);
    const comps = await tx.select().from(payComponents).where(eq(payComponents.structureId, a.structureId));
    const wage = monthlyWages(comps.map((c) => ({ id: c.id, label: c.label, kind: c.kind, mode: c.mode, value: Number(c.value), isBasic: c.isBasic, isWage: c.isWage, proRata: c.proRata, taxable: c.taxable, sort: c.sort })), gross, a.overrides, env.book.resolve<number>("wage_exclusion_bp", lastDay)?.value ?? 5000);
    return { kind: "earning", code: "gratuity", label: `Gratuity, ${counted} years`, amountPaise: Math.min(cap, Math.round((wage * 15 * counted) / 26)), note: `15/26 of ${wage / 100} a month for ${counted} years` };
  }
}
const addDaysToMonth = (d: string) => monthStart(d);
