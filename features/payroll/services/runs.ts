import { and, desc, eq, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { monthEnd, monthStart, todayIST } from "@smw/feature-kit/money";
import { finApprovals } from "@smw/feature-finance/schema";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { computeMonth, refreshTotals, saveItem, ratesOf, TYPED_CODES, type CalcEnv, type ItemRow, type LineRow } from "../compute";
import { monthLabel } from "../csv";
import type { Flag } from "../engine";
import { PayrollService, type Person } from "../base";
import { bankOf, describeMove, frozenBank, movedBank } from "../bank";
import { reviewBlockers, type Blocker } from "../review";
import { RUN_KINDS } from "../constants";
import { payAssignments, payComponents, payExits, payItems, payLines, payProfiles, payRuns } from "../schema";
import { recallRun, runWithItems, type RunRow } from "../ledger";

export const ADJUSTMENT_CODES = { arrears: "earning", bonus: "earning", extra_classes: "earning", lop_reversal: "earning", other_earning: "earning", deduction: "deduction" } as const;
const DEFAULT_LABEL: Record<keyof typeof ADJUSTMENT_CODES, string> = { arrears: "Arrears", bonus: "Bonus", extra_classes: "Extra classes", lop_reversal: "Loss of pay reversed", other_earning: "Other pay", deduction: "Deduction" };
const SWING_BP = 2000;

const createInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Pick a month."),
  kind: z.enum(RUN_KINDS).exclude(["exit"]).default("monthly"),
  department: z.string().trim().optional(),
  employmentType: z.string().trim().optional(),
  label: z.string().trim().max(80).optional(),
  userIds: z.array(z.uuid()).optional(),
});
const adjustmentInput = z.object({ code: z.enum(Object.keys(ADJUSTMENT_CODES) as [keyof typeof ADJUSTMENT_CODES]), label: z.string().trim().max(80).optional(), amountPaise: z.coerce.number().int().positive("Enter an amount above zero.").max(100_000_000_00), note: z.string().trim().max(200).optional() });
const daysInput = z.object({ unpaidDays: z.coerce.number().min(0).max(31).multipleOf(0.5).optional(), hours: z.coerce.number().min(0).max(744).optional() });
const reason = z.string().trim().min(3, "Say why.").max(200);

export type { Blocker };
export interface Warning { code: string; message: string; itemId?: string; href?: string }
export interface RunItemView {
  id: string; userId: string; name: string; employeeId: string; department: string | null;
  calendarDays: number; unpaidHalfDays: number; unmarkedDays: number; hours: number | null;
  grossPaise: number; deductionsPaise: number; employerPaise: number; netPaise: number; prevNetPaise: number | null; changeBp: number | null;
  skippedReason: string | null; payout: ItemRow["payout"]; payoutRef: string | null; failReason: string | null; paidOn: string | null; payslipNo: string | null; flags: Flag[]; payBy: string; bankLast4: string | null;
  /** Set when the live bank details are not the ones the run was approved with: what changed, for the payouts screen. */
  bankMoved: string | null;
}
export interface RunView {
  run: RunRow; items: RunItemView[]; totals: Record<string, number>; blockers: Blocker[]; warnings: Warning[];
  lowConfidence: { key: string; state: string | null; confidence: string; source: string }[];
  approval: { id: string; kind: string; requestedByName: string | null; mine: boolean } | null;
  notIncluded: { userId: string; name: string; why: string; href: string }[];
  previous: { label: string; netPaise: number } | null;
  attendanceOn: boolean; canEdit: boolean;
}
export interface LineView { id: string; kind: LineRow["kind"]; code: string | null; label: string; amountPaise: number; manual: boolean; note: string | null; needsInput: boolean; source: string }
export interface ItemDetail { item: RunItemView; lines: LineView[]; rates: { key: string; state: string | null; confidence: string; source: string; overridden: boolean }[]; run: RunRow }

export class RunService extends PayrollService {
  // ---------------------------------------------------------------- reads

  async list(query: ListQuery = {}): Promise<Page<RunRow & { net: number; people: number }>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = and(q.filters.status ? eq(payRuns.status, q.filters.status as RunRow["status"]) : undefined, q.filters.kind ? eq(payRuns.kind, q.filters.kind as RunRow["kind"]) : undefined, q.q ? sql`${payRuns.label} ilike ${`%${q.q}%`}` : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select().from(payRuns).where(where).orderBy(desc(payRuns.month), desc(payRuns.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(payRuns).where(where),
      ]);
      return toPage(rows.map((r) => ({ ...r, net: r.totals.net ?? 0, people: r.totals.people ?? 0 })), Number(n?.n ?? 0), q);
    });
  }

  async get(id: string): Promise<RunView> {
    return this.read("read", async (tx) => {
      const { run, items, lines } = await runWithItems(tx, id);
      const people = await this.people(tx, items.map((i) => i.userId));
      const profiles = await tx.select().from(payProfiles).where(inArray(payProfiles.userId, items.map((i) => i.userId)));
      const prev = await this.previous(tx, run);
      const views = items.map((i): RunItemView => {
        const p = people.get(i.userId), prof = profiles.find((x) => x.userId === i.userId), before = prev?.nets.get(i.userId) ?? null;
        const snap = i.snapshot as { flags?: Flag[] };
        const frozen = ["approved", "paid"].includes(run.status), bank = frozen ? frozenBank(i, prof) : bankOf(prof);
        const moved = frozen && i.payout !== "paid" ? movedBank(i, prof, this.ctx.schoolId) : null;
        return {
          id: i.id, userId: i.userId, name: p?.name ?? "Unknown", employeeId: p?.employeeId ?? "", department: p?.department ?? null, calendarDays: i.calendarDays, unpaidHalfDays: i.unpaidHalfDays, unmarkedDays: i.unmarkedDays,
          hours: i.hours == null ? null : Number(i.hours), grossPaise: Number(i.grossPaise), deductionsPaise: Number(i.deductionsPaise), employerPaise: Number(i.employerPaise), netPaise: Number(i.netPaise),
          prevNetPaise: before, changeBp: before ? Math.round(((Number(i.netPaise) - before) * 10_000) / before) : null, skippedReason: i.skippedReason, payout: i.payout, payoutRef: i.payoutRef, failReason: i.failReason,
          paidOn: i.paidOn, payslipNo: i.payslipNo, flags: snap.flags ?? [], payBy: bank.payBy, bankLast4: bank.last4, bankMoved: moved ? describeMove(bank, moved) : null,
        };
      });
      const live = views.filter((v) => !v.skippedReason);
      const names = new Map([...people].map(([id, p]) => [id, p.name]));
      const blockers = reviewBlockers(run, items.filter((i) => !i.skippedReason), names, lines, profiles, this.attendanceOn);
      const warnings: Warning[] = [];
      if (this.attendanceOn && run.status === "draft" && run.kind === "monthly" && monthEnd(run.month) > todayIST()) warnings.push({ code: "early", message: "The month is not over. The days still to come are paid as worked; take any later absence off next month." });
      const recent = new Date(Date.now() - 30 * 86_400_000);
      for (const v of live) {
        const changed = profiles.find((x) => x.userId === v.userId)?.bankChangedAt;
        if (changed && changed > recent) warnings.push({ code: "bank_changed", message: `${v.name}: the bank account was changed on ${changed.toISOString().slice(0, 10)}. Check with them that it is theirs.`, itemId: v.id });
      }
      for (const v of live) {
        for (const f of v.flags) if (f.code !== "needs_input" && f.code !== "net_negative") warnings.push({ code: f.code, message: `${v.name}: ${f.message}`, itemId: v.id });
        if (v.changeBp !== null && Math.abs(v.changeBp) > SWING_BP) warnings.push({ code: "swing", message: `${v.name}: net pay is ${v.changeBp > 0 ? "up" : "down"} ${Math.abs(Math.round(v.changeBp / 100))}% on last month.`, itemId: v.id });
      }
      const rates = ratesOf(items) as { key: string; state: string | null; confidence: string; source: string }[];
      const [approval] = await tx.select().from(finApprovals).where(and(eq(finApprovals.refId, id), eq(finApprovals.status, "pending"), sql`${finApprovals.kind} like 'payroll.%'`));
      if (approval && !this.ctx.readOnly && !this.ctx.supportStaffId) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "approval", id: approval.id }, this.ctx);
      const asker = approval ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, approval.requestedBy)))[0]?.name ?? null : null;
      return {
        run, items: views, totals: run.totals, blockers, warnings, lowConfidence: rates.filter((r) => r.confidence === "low").map(({ key, state, confidence, source }) => ({ key, state, confidence, source })),
        approval: approval ? { id: approval.id, kind: approval.kind, requestedByName: asker, mine: approval.requestedBy === this.ctx.userId } : null,
        notIncluded: run.status === "draft" && run.kind === "monthly" ? await this.notIncluded(tx, run, items) : [],
        previous: prev ? { label: prev.label, netPaise: prev.total } : null, attendanceOn: this.attendanceOn, canEdit: run.status === "draft" && this.can("manage"),
      };
    });
  }

  /** The last approved monthly run before this one, with each person's net pay. */
  private async previous(tx: Tx, run: RunRow) {
    if (run.kind === "exit") return null;
    const [p] = await tx.select().from(payRuns).where(and(eq(payRuns.kind, "monthly"), inArray(payRuns.status, ["approved", "paid"]), lt(payRuns.month, run.month))).orderBy(desc(payRuns.month)).limit(1);
    if (!p) return null;
    const rows = await tx.select({ userId: payItems.userId, net: payItems.netPaise }).from(payItems).where(and(eq(payItems.runId, p.id), sql`${payItems.skippedReason} is null`));
    return { label: p.label, total: Number(p.totals.net ?? 0), nets: new Map(rows.map((r) => [r.userId, Number(r.net)])) };
  }

  private async notIncluded(tx: Tx, run: RunRow, items: ItemRow[]) {
    const people = await this.people(tx);
    const have = new Set(items.map((i) => i.userId));
    const out: RunView["notIncluded"] = [];
    const missing = [...people.values()].filter((p) => !p.left && !have.has(p.id));
    const assigned = new Set(missing.length ? (await tx.selectDistinct({ id: payAssignments.userId }).from(payAssignments).where(and(inArray(payAssignments.userId, missing.map((m) => m.id)), lte(payAssignments.fromDate, run.month)))).map((r) => r.id) : []);
    const exits = missing.length ? await tx.select({ userId: payExits.userId, id: payExits.id }).from(payExits).where(and(inArray(payExits.userId, missing.map((m) => m.id)), inArray(payExits.status, ["pending", "approved", "paid"]))) : [];
    for (const p of missing) { const x = exits.find((e) => e.userId === p.id); out.push({ userId: p.id, name: p.name, why: x ? "Paid in their final settlement" : assigned.has(p.id) ? "Not added to this run" : "No pay set up", href: x ? `/app/payroll/exits/${x.id}` : `/app/payroll/people/${p.id}` }); }
    return out;
  }

  async item(itemId: string): Promise<ItemDetail> {
    const view = await this.read("read", async (tx) => {
      const [i] = await tx.select().from(payItems).where(eq(payItems.id, itemId));
      if (!i) throw new NotFoundError("Pay item");
      return i;
    });
    const full = await this.get(view.runId);
    const item = full.items.find((x) => x.id === itemId)!;
    return this.read("read", async (tx) => {
      const lines = await tx.select().from(payLines).where(eq(payLines.itemId, itemId)).orderBy(payLines.sort);
      const [i] = await tx.select().from(payItems).where(eq(payItems.id, itemId));
      const refs = lines.map((l) => l.refId).filter((r): r is string => !!r);
      const comps = refs.length ? await tx.select({ id: payComponents.id, mode: payComponents.mode, value: payComponents.value }).from(payComponents).where(inArray(payComponents.id, refs)) : [];
      const rates = ((i!.snapshot as { rates?: ItemDetail["rates"] }).rates ?? []);
      return { item, run: full.run, rates, lines: lines.map((l): LineView => ({ id: l.id, kind: l.kind, code: l.code, label: l.label, amountPaise: Number(l.amountPaise), manual: l.manual, note: l.note, needsInput: !l.manual && Number(l.amountPaise) === 0 && (TYPED_CODES as readonly string[]).includes(l.code ?? ""), source: explain(l, comps) })) };
    });
  }

  // ---------------------------------------------------------------- build

  async create(input: unknown): Promise<RunRow> {
    this.authorize("manage", "write");
    const d = this.parse(createInput, input);
    const month = monthStart(d.month.length === 7 ? `${d.month}-01` : d.month);
    if (month > monthStart(todayIST())) throw new ValidationError({ month: "Pick this month or an earlier one." });
    if (d.kind === "off_cycle" && !d.userIds?.length) throw new ValidationError({ userIds: "Pick who is paid." });
    return this.write("manage", async (tx) => {
      if (d.kind === "monthly") {
        const [have] = await tx.select({ id: payRuns.id }).from(payRuns).where(and(eq(payRuns.kind, "monthly"), eq(payRuns.month, month), ne(payRuns.status, "cancelled")));
        if (have) throw new ConflictError(`There is already a pay run for ${monthLabel(month)}. Open it from the list.`);
      }
      const env = await this.envOf(tx);
      const people = [...(await this.people(tx)).values()].filter((p) => !p.left && (!d.userIds || d.userIds.includes(p.id)) && (!d.department || p.department === d.department) && (!d.employmentType || p.employmentType === d.employmentType));
      const off = await tx.select({ id: payProfiles.userId }).from(payProfiles).where(eq(payProfiles.paysMonthly, false));
      const skipMonthly = d.kind === "monthly" ? new Set(off.map((o) => o.id)) : new Set<string>();
      const group = [d.department, d.employmentType].filter(Boolean).join(", ");
      const label = d.label || `${d.kind === "off_cycle" ? "Extra pay" : "Salary"} ${monthLabel(month)}${group ? ` (${group})` : ""}`;
      const [run] = await tx.insert(payRuns).values({ schoolId: this.ctx.schoolId, kind: d.kind, month, label, createdBy: this.ctx.userId, payDate: null }).returning();
      const ids = people.filter((p) => !skipMonthly.has(p.id)).map((p) => p.id);
      const { done } = await computeMonth(env, { userIds: ids, month, runId: run!.id, offCycle: d.kind === "off_cycle" });
      if (!done.length) throw new ConflictError("Nobody has pay set up yet. Set up pay for your people first.");
      for (const c of done) await saveItem(tx, this.ctx.schoolId, run!.id, c);
      if (d.kind === "monthly") await this.addArrears(tx, run!, done.map((c) => c.userId));
      await this.refresh(tx, env, run!);
      return (await tx.select().from(payRuns).where(eq(payRuns.id, run!.id)))[0]!;
    }, (r) => ({ action: "create", entity: "PayRun", entityId: r.id, summary: `Started pay run ${r.label}` }));
  }

  /** People left out of an earlier run are owed that pay: it comes in as an arrears line, once. */
  private async addArrears(tx: Tx, run: RunRow, userIds: string[]) {
    const skipped = await tx.select({ item: payItems, run: payRuns }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
      .where(and(inArray(payItems.userId, userIds), isNotNull(payItems.skippedReason), ne(payRuns.status, "cancelled"), lt(payRuns.month, run.month), ne(payRuns.id, run.id)));
    if (!skipped.length) return;
    const taken = new Set((await tx.select({ ref: payLines.refId }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId)).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
      .where(and(eq(payLines.code, "arrears"), inArray(payLines.refId, skipped.map((s) => s.item.id)), ne(payRuns.status, "cancelled")))).map((r) => r.ref));
    const mine = await tx.select().from(payItems).where(eq(payItems.runId, run.id));
    for (const s of skipped.filter((x) => !taken.has(x.item.id) && Number(x.item.grossPaise) > 0)) {
      const target = mine.find((m) => m.userId === s.item.userId);
      if (target) await tx.insert(payLines).values({ schoolId: this.ctx.schoolId, itemId: target.id, kind: "earning", code: "arrears", label: `Arrears for ${monthLabel(s.run.month)}`, amountPaise: Number(s.item.grossPaise), manual: true, refId: s.item.id, note: s.item.skippedReason, sort: 900 });
    }
  }

  /** Work every item out again and update the totals and the rates used. */
  private async refresh(tx: Tx, env: CalcEnv, run: RunRow, only?: string[]) {
    const { items, lines } = await runWithItems(tx, run.id);
    const existing = new Map(items.filter((i) => !only || only.includes(i.userId)).map((i) => [i.userId, { item: i, lines: lines.filter((l) => l.itemId === i.id) }]));
    const { done, settled } = await computeMonth(env, { userIds: [...existing.keys()], month: run.month, runId: run.id, existing, offCycle: run.kind === "off_cycle" });
    for (const c of done) await saveItem(tx, this.ctx.schoolId, run.id, c);
    // A final settlement approved after this run was made pays them instead.
    for (const u of settled) await tx.update(payItems).set({ skippedReason: "Paid in their final settlement" }).where(and(eq(payItems.runId, run.id), eq(payItems.userId, u)));
    await refreshTotals(env, run.id);
    const fresh = await tx.select().from(payItems).where(eq(payItems.runId, run.id));
    await tx.update(payRuns).set({ rates: ratesOf(fresh) }).where(eq(payRuns.id, run.id));
  }

  /** A draft run, locked for the change; refuses anything later. */
  protected async draft(tx: Tx, runId: string): Promise<RunRow> {
    const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
    if (!run) throw new NotFoundError("Pay run");
    if (run.status !== "draft") throw new ConflictError(run.status === "cancelled" ? "This run was cancelled." : `This run is ${run.status} and locked. ${run.status === "reviewed" ? "Reopen it to change it." : run.status === "approved" ? "Ask for a recall to change it." : ""}`.trim());
    return run;
  }
  private async itemOf(tx: Tx, itemId: string) {
    const [i] = await tx.select().from(payItems).where(eq(payItems.id, itemId));
    if (!i) throw new NotFoundError("Pay item");
    return { item: i, run: await this.draft(tx, i.runId) };
  }
  private async touch(tx: Tx, run: RunRow, userId: string) { await this.refresh(tx, await this.envOf(tx), run, [userId]); }

  async recompute(runId: string): Promise<void> {
    await this.write("manage", async (tx) => { await this.refresh(tx, await this.envOf(tx), await this.draft(tx, runId)); }, () => ({ action: "recompute", entity: "PayRun", entityId: runId, summary: "Worked the run out again" }));
  }

  async addPerson(runId: string, userId: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const run = await this.draft(tx, runId);
      if (!(await this.people(tx, [userId])).has(userId)) throw new NotFoundError("Person");
      const env = await this.envOf(tx);
      const [dup] = await tx.select({ id: payItems.id }).from(payItems).where(and(eq(payItems.runId, runId), eq(payItems.userId, userId)));
      if (dup) throw new ConflictError("This person is already in the run.");
      const { done, settled } = await computeMonth(env, { userIds: [userId], month: run.month, runId, offCycle: run.kind === "off_cycle" });
      if (settled.length) throw new ConflictError("Their final settlement already pays this month. Open it from the Exits page.");
      if (!done.length) throw new ConflictError("This person has no pay set up. Set it up from the People page.");
      await saveItem(tx, this.ctx.schoolId, runId, done[0]!);
      if (run.kind === "monthly") await this.addArrears(tx, run, [userId]);
      await this.refresh(tx, env, run, [userId]);
    }, () => ({ action: "add_person", entity: "PayRun", entityId: runId, summary: "Added a person to the run", meta: { userId } }));
  }

  /** Leave someone out of this run with a reason; what they were owed comes in as arrears on the next monthly run. */
  async skip(itemId: string, input: unknown): Promise<void> {
    const why = this.parse(z.object({ reason }), input).reason;
    await this.write("manage", async (tx) => {
      const { run } = await this.itemOf(tx, itemId);
      await tx.update(payItems).set({ skippedReason: why }).where(eq(payItems.id, itemId));
      await refreshTotals(await this.envOf(tx), run.id);
    }, () => ({ action: "skip", entity: "PayItem", entityId: itemId, summary: `Left a person out of the run: ${why}` }));
  }

  async include(itemId: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const { item, run } = await this.itemOf(tx, itemId);
      await tx.update(payItems).set({ skippedReason: null }).where(eq(payItems.id, itemId));
      await this.touch(tx, run, item.userId);
    }, () => ({ action: "include", entity: "PayItem", entityId: itemId, summary: "Put a person back in the run" }));
  }

  async addAdjustment(itemId: string, input: unknown): Promise<void> {
    const d = this.parse(adjustmentInput, input);
    await this.write("manage", async (tx) => {
      const { item, run } = await this.itemOf(tx, itemId);
      await this.notSelf(tx, item.userId, "add to your own pay");
      await tx.insert(payLines).values({ schoolId: this.ctx.schoolId, itemId, kind: ADJUSTMENT_CODES[d.code], code: d.code, label: d.label || DEFAULT_LABEL[d.code], amountPaise: d.amountPaise, manual: true, note: d.note ?? null, sort: 900 });
      await this.touch(tx, run, item.userId);
    }, () => ({ action: "adjust", entity: "PayItem", entityId: itemId, summary: `Added ${DEFAULT_LABEL[d.code].toLowerCase()}`, meta: { amountPaise: d.amountPaise } }));
  }

  async removeAdjustment(lineId: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [l] = await tx.select().from(payLines).where(eq(payLines.id, lineId));
      if (!l || !l.manual) throw new NotFoundError("Line");
      const { item, run } = await this.itemOf(tx, l.itemId);
      await this.notSelf(tx, item.userId, "change your own pay lines");
      await tx.delete(payLines).where(eq(payLines.id, lineId));
      await this.touch(tx, run, item.userId);
      return item.id;
    }, (itemId) => ({ action: "remove_adjustment", entity: "PayItem", entityId: itemId, summary: "Removed a typed line", meta: { lineId } }));
  }

  /** Type the amount of a statutory deduction that has no rule (professional tax, welfare fund, income tax), or replace the worked-out one. */
  async setTyped(itemId: string, code: string, amountPaise: number): Promise<void> {
    if (!(TYPED_CODES as readonly string[]).includes(code)) throw new ValidationError({ code: "This amount cannot be typed." });
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new ValidationError({ amountPaise: "Enter an amount of zero or more." });
    await this.write("manage", async (tx) => {
      const { item, run } = await this.itemOf(tx, itemId);
      await this.notSelf(tx, item.userId, "type your own tax or deduction amounts");
      const [have] = await tx.select().from(payLines).where(and(eq(payLines.itemId, itemId), eq(payLines.code, code)));
      if (!have) throw new ConflictError("This deduction does not apply to this person.");
      await tx.delete(payLines).where(and(eq(payLines.itemId, itemId), eq(payLines.code, code)));
      await tx.insert(payLines).values({ schoolId: this.ctx.schoolId, itemId, kind: "deduction", code, label: have.label, amountPaise, manual: true, sort: have.sort });
      await this.touch(tx, run, item.userId);
    }, () => ({ action: "type_amount", entity: "PayItem", entityId: itemId, summary: `Typed the amount for ${code}`, meta: { amountPaise } }));
  }

  /** Days by hand: needed when attendance is off, and hours for people paid by the hour. */
  async setDays(itemId: string, input: unknown): Promise<void> {
    const d = this.parse(daysInput, input);
    await this.write("manage", async (tx) => {
      const { item, run } = await this.itemOf(tx, itemId);
      await this.notSelf(tx, item.userId, "change your own days or hours");
      const set: Partial<typeof payItems.$inferInsert> = {};
      if (d.unpaidDays !== undefined) {
        if (this.attendanceOn) throw new ConflictError("Days come from attendance. Mark attendance or leave instead.");
        set.unpaidHalfDays = Math.round(d.unpaidDays * 2);
      }
      if (d.hours !== undefined) set.hours = String(d.hours);
      await tx.update(payItems).set(set).where(eq(payItems.id, itemId));
      await this.touch(tx, run, item.userId);
    }, () => ({ action: "set_days", entity: "PayItem", entityId: itemId, summary: "Changed days or hours" }));
  }

  /** Days nobody marked: pay them as worked, on record with who decided. */
  async countWorked(itemId: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const { item, run } = await this.itemOf(tx, itemId);
      await this.notSelf(tx, item.userId, "count your own unmarked days as worked");
      await tx.update(payItems).set({ unmarkedOk: item.unmarkedDays }).where(eq(payItems.id, itemId));
      await this.touch(tx, run, item.userId);
      return item.unmarkedDays;
    }, (n) => ({ action: "set_days", entity: "PayItem", entityId: itemId, summary: `Counted ${n} unmarked day${n === 1 ? "" : "s"} as worked` }));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Mark the run reviewed. Refused, with the list, while anything blocks it. */
  async review(runId: string): Promise<RunRow> {
    this.authorize("manage", "write");
    const view = await this.get(runId);
    if (view.run.status !== "draft") throw new ConflictError(`This run is already ${view.run.status}.`);
    if (view.blockers.length) throw new ConflictError(`${view.blockers.length} thing${view.blockers.length === 1 ? "" : "s"} must be fixed first: ${view.blockers[0]!.message}`);
    return this.write("manage", async (tx) => {
      const run = await this.draft(tx, runId);
      await this.refresh(tx, await this.envOf(tx), run);
      return (await tx.update(payRuns).set({ status: "reviewed" }).where(eq(payRuns.id, runId)).returning())[0]!;
    }, (r) => ({ action: "review", entity: "PayRun", entityId: r.id, summary: `Reviewed ${r.label}` }));
  }

  /** Back to draft. Allowed while nobody has approved; a request waiting for approval is withdrawn first (by the person who sent it). */
  async reopen(runId: string): Promise<RunRow> {
    return this.write("manage", async (tx) => {
      const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
      if (!run) throw new NotFoundError("Pay run");
      if (run.status !== "reviewed") throw new ConflictError("Only a reviewed run can be reopened.");
      await this.withdrawOpen(tx, runId, "payroll.run");
      return (await tx.update(payRuns).set({ status: "draft" }).where(eq(payRuns.id, runId)).returning())[0]!;
    }, (r) => ({ action: "reopen", entity: "PayRun", entityId: r.id, summary: `Reopened ${r.label}` }));
  }

  private async withdrawOpen(tx: Tx, refId: string, kind: string) {
    const [a] = await tx.select().from(finApprovals).where(and(eq(finApprovals.refId, refId), eq(finApprovals.kind, kind), eq(finApprovals.status, "pending"))).for("update");
    if (!a) return;
    if (a.requestedBy !== this.ctx.userId) throw new ForbiddenError("Someone else sent this for approval. Ask them to withdraw it.");
    await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(eq(finApprovals.id, a.id));
    await NotificationWriter.done(tx, this.ctx.schoolId, { type: "approval", id: a.id });
  }

  /** Ask for approval; the money is posted when someone else approves. */
  async submit(runId: string, note?: string) {
    this.authorize("manage", "write");
    const view = await this.get(runId);
    if (view.run.status !== "reviewed") throw new ConflictError(view.run.status === "draft" ? "Review the run first." : `This run is already ${view.run.status}.`);
    if (view.blockers.length) throw new ConflictError(`${view.blockers[0]!.message}`);
    return this.write("manage", (tx) => this.askApproval(tx, {
      kind: "payroll.run", refType: "pay_run", refId: runId, title: `Payroll: ${view.run.label}`, amountPaise: view.totals.net ?? 0,
      reason: note || `${view.totals.people ?? 0} people, net pay to staff`, href: `/app/payroll/runs/${runId}`,
    }), (a) => ({ action: "submit", entity: "PayRun", entityId: runId, summary: `Sent ${view.run.label} for approval`, meta: { approvalId: a.id } }));
  }

  /** Ask to undo an approved run before any salary was paid. A second person decides. */
  async requestRecall(runId: string, input: unknown) {
    this.authorize("manage", "write");
    const why = this.parse(z.object({ reason }), input).reason;
    return this.write("manage", async (tx) => {
      const { run, items } = await runWithItems(tx, runId, true);
      if (run.status !== "approved") throw new ConflictError(run.status === "paid" ? "This run is paid, so it cannot be recalled." : "Only an approved run can be recalled.");
      if (run.kind === "exit") throw new ConflictError("A final settlement is undone from the exit page.");
      if (items.some((i) => i.payout === "paid")) throw new ConflictError("Some people are already paid, so this run cannot be recalled.");
      return this.askApproval(tx, { kind: "payroll.recall", refType: "pay_run", refId: runId, title: `Recall payroll: ${run.label}`, amountPaise: run.totals.net ?? 0, reason: why, href: `/app/payroll/runs/${runId}` });
    }, (a) => ({ action: "request_recall", entity: "PayRun", entityId: runId, summary: "Asked to recall an approved run", meta: { approvalId: a.id } }));
  }

  /** A draft or reviewed run that is not wanted. Approved runs are recalled, never cancelled. */
  async cancel(runId: string): Promise<RunRow> {
    return this.write("manage", async (tx) => {
      const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
      if (!run) throw new NotFoundError("Pay run");
      if (run.status !== "draft" && run.status !== "reviewed") throw new ConflictError("Only a run that is not approved can be cancelled. Ask for a recall instead.");
      await this.withdrawOpen(tx, runId, "payroll.run");
      return (await tx.update(payRuns).set({ status: "cancelled" }).where(eq(payRuns.id, runId)).returning())[0]!;
    }, (r) => ({ action: "cancel", entity: "PayRun", entityId: r.id, summary: `Cancelled ${r.label}` }));
  }

  /** Used by the recall approval and tests. */
  recallNow(tx: Tx, runId: string, why: string) { return recallRun(tx, this.poster, runId, why); }

  /** Salary register rows for CSV: one line per person. */
  async registerRows(runId: string): Promise<(string | number)[][]> {
    const v = await this.get(runId);
    return [["Employee ID", "Name", "Department", "Days", "Gross", "Deductions", "Net", "Payout"], ...v.items.filter((i) => !i.skippedReason).map((i) => [i.employeeId, i.name, i.department ?? "", i.calendarDays - i.unpaidHalfDays / 2, i.grossPaise / 100, i.deductionsPaise / 100, i.netPaise / 100, i.payout])];
  }

  /** People for the "add person" picker: not yet in the run. */
  async addable(runId: string): Promise<Person[]> {
    return this.read("manage", async (tx) => {
      const have = new Set((await tx.select({ id: payItems.userId }).from(payItems).where(eq(payItems.runId, runId))).map((r) => r.id));
      return [...(await this.people(tx)).values()].filter((p) => !p.left && !have.has(p.id));
    });
  }
}

function explain(l: { code: string | null; kind: string; manual: boolean; refId: string | null; note: string | null }, comps: { id: string; mode: string; value: number | string }[]): string {
  if (l.manual) return l.code === "arrears" ? `Arrears: ${l.note ?? "left out of an earlier run"}` : "Typed by a person";
  const c = comps.find((x) => x.id === l.refId);
  if (c) {
    const v = Number(c.value);
    return c.mode === "fixed" ? "A fixed amount, cut by unpaid days" : c.mode === "remainder" ? "The rest of the gross after the other components" : `${v / 100}% of ${c.mode === "percent_of_basic" ? "basic" : "gross"}`;
  }
  const text: Record<string, string> = {
    pf_employee: "12% of PF wages, up to the PF ceiling", pf_employer: "Employer's 12% less the pension share", eps_employer: "8.33% of wages up to the ceiling", edli: "0.5% of wages up to the ceiling", pf_admin: "0.5% of PF wages",
    esi_employee: "0.75% of gross while gross is within the ESI limit", esi_employer: "3.25% of gross while gross is within the ESI limit", pt: "Professional tax slab of the person's state",
    tds: "Tax for the year estimated from pay so far, divided by the months left", lwf_employee: "Labour welfare fund for the state", lwf_employer: "Labour welfare fund, employer share",
    loan: "The loan's monthly instalment, never more than what is owed", claim: "An approved claim paid with salary, not taxed", hourly: "Hours times the hourly rate", leave_encashment: "Leave balance at the daily rate", gratuity: "15 days of last pay for each year of service",
  };
  return text[l.code ?? ""] ?? "Worked out from the structure";
}
