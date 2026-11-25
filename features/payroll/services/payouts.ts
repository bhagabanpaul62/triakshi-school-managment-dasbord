import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { unseal } from "@smw/feature-kit/secret";
import { cashAccount, type PostLine } from "@smw/feature-finance/posting";
import { day } from "@smw/feature-finance/services/common";
import { bankOf, describeMove, frozenBank, movedBank } from "../bank";
import { BANK_COLUMN_LABEL } from "../config";
import { monthLabel, rupeeText, toCsv } from "../csv";
import { PayrollService } from "../base";
import { runWithItems } from "../ledger";
import { payExits, payItems, payProfiles, payRuns } from "../schema";
import type { ItemRow } from "../compute";

const markInput = z.object({ itemIds: z.array(z.uuid()).optional(), date: day.optional(), reference: z.string().trim().max(80).optional(), cashAccountId: z.uuid().optional() });
const failInput = z.object({ itemIds: z.array(z.uuid()).min(1, "Pick who failed."), reason: z.string().trim().min(3, "Say what the bank said.").max(200) });

/** Paying out an approved run: the bank file, then paid or failed for each person. Each paid batch posts once: salary payable to cash or bank. Everyone is paid as they were when the run was approved. */
export class PayoutService extends PayrollService {
  /** Refuses while someone's bank details differ from the ones frozen at approval: the money must not follow a change nobody confirmed. */
  private refuseMoved(run: { label: string }, items: ItemRow[], profiles: (typeof payProfiles.$inferSelect)[], people: Map<string, { name: string }>) {
    const moved = items.flatMap((i) => { const p = profiles.find((x) => x.userId === i.userId), now = movedBank(i, p, this.ctx.schoolId); return now ? [`${people.get(i.userId)?.name ?? "Someone"} (${describeMove(frozenBank(i, p), now)})`] : []; });
    if (moved.length) throw new ConflictError(`Bank details changed after ${run.label} was approved: ${moved.join("; ")}. Open the Payouts tab to confirm the new account for each, or ask for a recall.`);
  }

  /** Accept the account a person has now for this run. Someone other than that person must do it; it is logged with the old and new last four. */
  async confirmBank(runId: string, itemId: string): Promise<void> {
    this.authorize("manage", "write");
    await this.write("manage", async (tx) => {
      const { run } = await runWithItems(tx, runId, true);
      if (run.status !== "approved") throw new ConflictError("Only an approved run that is not fully paid can take a new account.");
      const [i] = await tx.select().from(payItems).where(and(eq(payItems.id, itemId), eq(payItems.runId, runId))).for("update");
      if (!i) throw new NotFoundError("Person in this run");
      if (i.payout === "paid") throw new ConflictError("This person is already paid.");
      await this.notSelf(tx, i.userId, "confirm a new bank account for yourself");
      const [p] = await tx.select().from(payProfiles).where(eq(payProfiles.userId, i.userId));
      const now = movedBank(i, p, this.ctx.schoolId);
      if (!now) throw new ConflictError("Their bank details are the same as when the run was approved.");
      const change = describeMove(frozenBank(i, p), now);
      await tx.update(payItems).set({ snapshot: { ...i.snapshot, bank: bankOf(p) } }).where(eq(payItems.id, i.id));
      return { userId: i.userId, change };
    }, (r) => ({ action: "confirm_bank", entity: "PayItem", entityId: itemId, summary: "Used a changed bank account for a run", meta: r }));
  }

  /** The bank's upload file for everyone still to be paid by bank. Account numbers are opened only here, and the audit says how many, not which. */
  async bankFile(runId: string, itemIds?: string[]): Promise<{ filename: string; csv: string; count: number; totalPaise: number }> {
    this.authorize("manage", "read");
    return this.write("manage", async (tx) => {
      const { run, items } = await runWithItems(tx, runId);
      if (run.status !== "approved") throw new ConflictError(run.status === "paid" ? "Everyone is paid already." : "Approve the run before making the bank file.");
      const config = await this.config(tx);
      const pick = items.filter((i) => !i.skippedReason && Number(i.netPaise) > 0 && i.payout !== "paid" && (!itemIds || itemIds.includes(i.id)));
      const people = await this.people(tx, pick.map((i) => i.userId));
      const profiles = await tx.select().from(payProfiles).where(inArray(payProfiles.userId, pick.map((i) => i.userId)));
      this.refuseMoved(run, pick, profiles, people);
      const rows: (string | number)[][] = [config.bankColumns.map((c) => BANK_COLUMN_LABEL[c])];
      let total = 0;
      for (const i of pick) {
        const p = frozenBank(i, profiles.find((x) => x.userId === i.userId));
        if (p.payBy !== "bank") continue;
        if (!p.sealed || !p.ifsc) throw new ConflictError(`${people.get(i.userId)?.name ?? "Someone"} has no bank account. Add one or pay by cash or cheque.`);
        const who = people.get(i.userId);
        const cells: Record<(typeof config.bankColumns)[number], string | number> = {
          name: who?.name ?? "", employeeId: who?.employeeId ?? "", account: unseal(p.sealed, this.ctx.schoolId), ifsc: p.ifsc, bank: p.bankName ?? "",
          amount: rupeeText(Number(i.netPaise)), narration: `Salary ${monthLabel(run.month)}`, payslipNo: i.payslipNo ?? "",
        };
        rows.push(config.bankColumns.map((c) => cells[c]));
        total += Number(i.netPaise);
      }
      if (rows.length === 1) throw new ConflictError("Nobody is waiting for a bank transfer in this run.");
      await this.audit(tx, { action: "bank_file", entity: "PayRun", entityId: runId, summary: `Made the bank file for ${rows.length - 1} people`, meta: { count: rows.length - 1, totalPaise: total } });
      return { filename: `salary-${run.month.slice(0, 7)}.csv`, csv: toCsv(rows), count: rows.length - 1, totalPaise: total };
    });
  }

  /** Mark people paid (everyone still waiting when no ids are given). Two people clicking at once pay each person once. */
  async markPaid(runId: string, input: unknown = {}): Promise<{ paid: number; totalPaise: number; runPaid: boolean }> {
    this.authorize("manage", "write");
    const d = this.parse(markInput, input);
    const batch = crypto.randomUUID();
    const result = await this.write("manage", async (tx) => {
      const { run } = await runWithItems(tx, runId, true);
      if (run.status !== "approved") throw new ConflictError(run.status === "paid" ? "Everyone in this run is paid." : "The run must be approved before anyone is paid.");
      const date = await this.moneyDate(tx, d.date);
      const all = await tx.select().from(payItems).where(and(eq(payItems.runId, runId), sql`${payItems.skippedReason} is null`)).orderBy(payItems.id).for("update");
      const pick = d.itemIds ? all.filter((i) => d.itemIds!.includes(i.id)) : all.filter((i) => i.payout === "pending");
      if (d.itemIds && pick.length !== new Set(d.itemIds).size) throw new NotFoundError("Person in this run");
      const already = pick.filter((i) => i.payout === "paid");
      if (already.length) throw new ConflictError("Some of these people are already marked paid.");
      if (!pick.length) throw new ConflictError("Nobody is waiting to be paid.");
      for (const i of pick.filter((x) => x.userId === this.ctx.userId)) await this.notSelf(tx, i.userId, "mark your own salary as paid");
      const profiles = await tx.select().from(payProfiles).where(inArray(payProfiles.userId, pick.map((i) => i.userId)));
      this.refuseMoved(run, pick, profiles, await this.people(tx, pick.map((i) => i.userId)));
      const byAccount = new Map<string, { account: Awaited<ReturnType<typeof cashAccount>>; items: typeof pick }>();
      for (const i of pick) {
        const by = frozenBank(i, profiles.find((p) => p.userId === i.userId)).payBy;
        const account = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: by === "cash" ? "cash" : "bank" });
        const g = byAccount.get(account.id) ?? { account, items: [] };
        g.items.push(i); byAccount.set(account.id, g);
      }
      let total = 0;
      for (const { account, items } of byAccount.values()) {
        const lines: PostLine[] = items.map((i) => ({ account: "salary_payable" as const, debit: Number(i.netPaise), party: { type: "staff" as const, id: i.userId } }));
        const sum = items.reduce((a, i) => a + Number(i.netPaise), 0);
        total += sum;
        await this.post(tx, { date, sourceKey: `payroll:payout:${batch}:${account.id}`, sourceType: "payroll_payout", sourceId: runId, memo: `Salary paid: ${run.label}`, lines: [...lines, { account: { id: account.accountId }, credit: sum }] });
        await tx.update(payItems).set({ payout: "paid", paidOn: date, payoutRef: d.reference ?? null, cashAccountId: account.id, failReason: null }).where(inArray(payItems.id, items.map((i) => i.id)));
      }
      const left = await tx.select({ id: payItems.id }).from(payItems).where(and(eq(payItems.runId, runId), sql`${payItems.skippedReason} is null`, sql`${payItems.payout} <> 'paid'`)).limit(1);
      const runPaid = left.length === 0;
      if (runPaid) {
        await tx.update(payRuns).set({ status: "paid" }).where(eq(payRuns.id, runId));
        await tx.update(payExits).set({ status: "paid" }).where(eq(payExits.runId, runId));
      }
      return { paid: pick.length, totalPaise: total, runPaid, exitUserId: runPaid && run.kind === "exit" ? pick[0]!.userId : null };
    }, (r) => ({ action: "pay", entity: "PayRun", entityId: runId, summary: `Marked ${r.paid} people paid`, meta: { totalPaise: r.totalPaise, batch } }));
    // The login is switched off after the money is committed, and only when the person doing this may manage staff.
    if (result.exitUserId) await this.leave(result.exitUserId);
    return { paid: result.paid, totalPaise: result.totalPaise, runPaid: result.runPaid };
  }

  /** A transfer the bank returned. Nothing is posted; the person goes back to waiting after a retry. */
  async markFailed(runId: string, input: unknown): Promise<number> {
    this.authorize("manage", "write");
    const d = this.parse(failInput, input);
    return this.write("manage", async (tx) => {
      await runWithItems(tx, runId, true);
      const rows = await tx.update(payItems).set({ payout: "failed", failReason: d.reason }).where(and(eq(payItems.runId, runId), inArray(payItems.id, d.itemIds), eq(payItems.payout, "pending"))).returning({ id: payItems.id });
      if (rows.length !== d.itemIds.length) throw new ConflictError("Only people still waiting can be marked failed.");
      return rows.length;
    }, (n) => ({ action: "payout_failed", entity: "PayRun", entityId: runId, summary: `${n} transfers failed: ${d.reason}` }));
  }

  async retry(runId: string, itemIds: string[]): Promise<number> {
    this.authorize("manage", "write");
    if (!itemIds.length) throw new ValidationError({ itemIds: "Pick who to retry." });
    return this.write("manage", async (tx) => {
      const rows = await tx.update(payItems).set({ payout: "pending", failReason: null }).where(and(eq(payItems.runId, runId), inArray(payItems.id, itemIds), eq(payItems.payout, "failed"))).returning({ id: payItems.id });
      return rows.length;
    }, (n) => ({ action: "payout_retry", entity: "PayRun", entityId: runId, summary: `${n} transfers set to try again` }));
  }

  /** After the final payment the login is switched off when this person may do that. When they may not, the admins are told, with a link, so it is never forgotten. */
  private async leave(userId: string) {
    try {
      const { StaffService } = await import("@smw/feature-staff/service");
      await new StaffService(this.ctx).deactivate(userId);
    } catch (e) {
      console.error(JSON.stringify({ level: "warn", msg: "could not mark staff as left after the final payment", userId, err: String(e) }));
    }
    await this.write("read", async (tx) => {
      const who = (await this.people(tx, [userId])).get(userId);
      if (!who || who.left) return;
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      await NotificationWriter.insert(tx, this.ctx.schoolId, admins.map((a) => ({ userId: a.id, topic: "work.update" as const, subject: { type: "staff", id: userId }, title: `Deactivate ${who.name}: the final pay is paid`, body: "Their login is still active. Open their staff record and deactivate them.", href: `/app/staff/${userId}` })));
    });
  }

  /** Who is paid, who is waiting, who failed. */
  async summary(runId: string): Promise<{ paid: number; pending: number; failed: number; paidPaise: number; pendingPaise: number }> {
    return this.read("read", async (tx) => {
      const rows = await tx.select().from(payItems).where(and(eq(payItems.runId, runId), sql`${payItems.skippedReason} is null`));
      const sum = (f: (i: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, i) => a + Number(i.netPaise), 0);
      return { paid: rows.filter((i) => i.payout === "paid").length, pending: rows.filter((i) => i.payout === "pending").length, failed: rows.filter((i) => i.payout === "failed").length, paidPaise: sum((i) => i.payout === "paid"), pendingPaise: sum((i) => i.payout !== "paid") };
    });
  }
}
