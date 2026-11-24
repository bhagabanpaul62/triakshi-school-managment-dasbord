import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { students } from "@smw/feature-students/schema";
import { FeesBase, calcOf, invalid, type InvoiceFull } from "./base";
import { allocatePlan, openOf } from "./calc";
import { settlementInput } from "./inputs";
import { NoteService } from "./notes";
import { RefundService } from "./refunds";
import { feeDueParts, feeInvoices, feeSettlements } from "./schema";

export type Settlement = typeof feeSettlements.$inferSelect;
type Plan = ReturnType<typeof settlementInput.parse>;
/** Thrown to roll a preview back: the run is the real one, so the preview is exactly what approval would do. */
class Rolled { constructor(readonly result: SettlementResult) {} }
export interface SettlementResult { openBeforePaise: number; waivedLatePaise: number; advancePaise: number; depositPaise: number; writtenOffPaise: number; remainingPaise: number; parts: { invoiceId: string; dueOn: string; amountPaise: number }[] }

/** The figures of a result as one string, so two results compare whatever order jsonb stored their keys in. */
const figures = (r: SettlementResult) => [r.openBeforePaise, r.waivedLatePaise, r.advancePaise, r.depositPaise, r.writtenOffPaise, r.remainingPaise, ...r.parts.flatMap((p) => [p.invoiceId, p.dueOn, p.amountPaise])].join("|");

/**
 * One approved deal on a student's dues: waive the late fee, use the advance or deposit, write off, and split what is
 * left into dated parts. The parts drive the due state, the late fee and the reminders from then on.
 */
export class SettlementService extends FeesBase {
  /** What approval would do, worked out by doing it and rolling back. */
  async preview(input: unknown): Promise<SettlementResult> {
    this.authorize("concede", "write");
    const d = this.parse(settlementInput, input);
    try {
      await this.read("concede", async (tx) => { throw new Rolled(await this.runIn(tx, d)); });
    } catch (e) {
      if (e instanceof Rolled) return e.result;
      throw e;
    }
    throw new Error("unreachable");
  }

  async propose(input: unknown): Promise<Settlement> {
    this.authorize("concede", "write");
    const d = this.parse(settlementInput, input);
    const result = await this.preview(d);
    return this.write("concede", (tx) => this.requestIn(tx, d, result), (s) => ({ action: "propose", entity: "Settlement", entityId: s.id, summary: `Settlement proposed: ${s.reason}` }));
  }

  private async requestIn(tx: Tx, d: Plan, r: SettlementResult, id?: string): Promise<Settlement> {
    const [s] = await tx.select({ id: students.id, name: students.name }).from(students).where(eq(students.id, d.studentId));
    if (!s) throw new NotFoundError("Student");
    // What the person saw is kept with the deal, so approval can tell when the dues moved since.
    const values = { studentId: d.studentId, reason: d.reason, plan: { ...d, requested: r } as unknown as Record<string, unknown>, status: "pending" as const, createdBy: this.ctx.userId };
    const [row] = id ? await tx.update(feeSettlements).set(values).where(eq(feeSettlements.id, id)).returning() : await tx.insert(feeSettlements).values({ schoolId: this.ctx.schoolId, ...values }).returning();
    await this.askApproval(tx, { kind: "fees.settlement", refType: "fee_settlement", refId: row!.id, title: `Settlement for ${s.name}: ${rupees(r.openBeforePaise)} open, ${rupees(r.remainingPaise)} to pay`, amountPaise: r.openBeforePaise - r.remainingPaise, reason: d.reason, href: `/app/fees/students/${d.studentId}` });
    return row!;
  }

  async withdraw(id: string) {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      await this.withdrawRequest(tx, "fees.settlement", id);
      const [s] = await tx.update(feeSettlements).set({ status: "rejected" }).where(eq(feeSettlements.id, id)).returning();
      return s!;
    }, (s) => ({ action: "withdraw", entity: "Settlement", entityId: s.id, summary: "Withdrew a settlement" }));
  }

  async resubmit(id: string, input: unknown): Promise<Settlement> {
    this.authorize("concede", "write");
    const d = this.parse(settlementInput, input);
    const [old] = await this.read("concede", (tx) => tx.select({ studentId: feeSettlements.studentId }).from(feeSettlements).where(eq(feeSettlements.id, id)));
    if (!old) throw new NotFoundError("Settlement");
    // The preview is of the settlement's own student, whatever the form says.
    const plan = { ...d, studentId: old.studentId };
    const result = await this.preview(plan);
    return this.write("concede", async (tx) => {
      const [cur] = await tx.select().from(feeSettlements).where(eq(feeSettlements.id, id)).for("update");
      if (!cur) throw new NotFoundError("Settlement");
      if (cur.status !== "rejected") throw new ConflictError("Only a settlement that was not approved can be edited and sent again.");
      return this.requestIn(tx, plan, result, id);
    }, (s) => ({ action: "resubmit", entity: "Settlement", entityId: s.id, summary: "Sent a settlement again" }));
  }

  /** The dues moved after this was asked: take the waiting request back and send the same deal again with today's numbers. */
  async resend(id: string): Promise<Settlement> {
    this.authorize("concede", "write");
    const [old] = await this.read("concede", (tx) => tx.select().from(feeSettlements).where(eq(feeSettlements.id, id)));
    if (!old) throw new NotFoundError("Settlement");
    const { requested: _old, ...plan } = old.plan as unknown as Plan & { requested?: unknown };
    const result = await this.preview(plan);
    return this.write("concede", async (tx) => {
      await this.withdrawRequest(tx, "fees.settlement", id);
      return this.requestIn(tx, plan, result, id);
    }, (s) => ({ action: "resend", entity: "Settlement", entityId: s.id, summary: "Sent a settlement again with the dues as they are now" }));
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = and(q.filters.studentId ? eq(feeSettlements.studentId, q.filters.studentId) : undefined, q.filters.status ? eq(feeSettlements.status, q.filters.status as Settlement["status"]) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select({ s: feeSettlements, studentName: students.name }).from(feeSettlements).innerJoin(students, eq(students.id, feeSettlements.studentId)).where(where).orderBy(desc(feeSettlements.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeSettlements).where(where),
      ]);
      return toPage(await this.withApproval(tx, ["fees.settlement"], rows.map((r) => ({ ...r.s, studentName: r.studentName }))), Number(n?.n ?? 0), q);
    });
  }

  async approveIn(tx: Tx, id: string): Promise<Settlement> {
    const [s] = await tx.select().from(feeSettlements).where(eq(feeSettlements.id, id)).for("update");
    if (!s) throw new NotFoundError("Settlement");
    if (s.status !== "pending") throw new ConflictError("This settlement was already decided.");
    const { requested, ...plan } = s.plan as unknown as Plan & { requested?: SettlementResult };
    const result = await this.runIn(tx, plan);
    if (requested && figures(result) !== figures(requested)) throw new ConflictError("The dues changed since this was asked. Send it again.");
    const [row] = await tx.update(feeSettlements).set({ status: "approved" }).where(eq(feeSettlements.id, id)).returning();
    await this.tell(tx, [s.studentId], "Fee settlement agreed", "The school has agreed new terms for your dues. Open your fees to see the dates.");
    return row!;
  }

  async rejectIn(tx: Tx, id: string) {
    await tx.update(feeSettlements).set({ status: "rejected" }).where(and(eq(feeSettlements.id, id), eq(feeSettlements.status, "pending")));
  }

  private open = (invs: InvoiceFull[]) => invs.reduce((s, i) => s + i.lines.reduce((a, l) => a + openOf(l), 0), 0);

  /** Do the whole deal in the caller's transaction: waive, use advance and deposit, write off, split. */
  async runIn(tx: Tx, d: Plan): Promise<SettlementResult> {
    const date = todayIST();
    await this.lockStudents(tx, [d.studentId]);
    const settings = await this.settings(tx);
    const load = () => this.loadInvoices(tx, and(eq(feeInvoices.studentId, d.studentId), eq(feeInvoices.status, "issued"), d.invoiceIds?.length ? inArray(feeInvoices.id, d.invoiceIds) : undefined), true)
      .then((all) => all.filter((i) => d.invoiceIds?.length || i.lines.some((l) => openOf(l) > 0)));
    let invs = await load();
    if (d.invoiceIds?.length && invs.length !== new Set(d.invoiceIds).size) throw new ConflictError("A bill in this list is not an issued bill of this student.");
    const openBeforePaise = this.open(invs);
    if (openBeforePaise <= 0) throw new ConflictError("This student has nothing open, so there is nothing to settle.");
    const notes = new NoteService(this.ctx);
    const noteFor = async (reasonType: "waiver" | "write_off", reason: string, parts: { invoiceId: string; lineId: string; amountPaise: number }[]) => {
      for (const id of [...new Set(parts.map((p) => p.invoiceId))]) await notes.issueIn(tx, { invoiceId: id, kind: "credit", reasonType, reason, lines: parts.filter((p) => p.invoiceId === id).map((p) => ({ lineId: p.lineId, amountPaise: p.amountPaise })) });
    };

    let waivedLatePaise = 0;
    if (d.waiveLate) {
      const late = invs.flatMap((i) => i.lines.filter((l) => l.kind === "late" && openOf(l) > 0).map((l) => ({ invoiceId: i.id, lineId: l.id, amountPaise: openOf(l) })));
      waivedLatePaise = late.reduce((s, l) => s + l.amountPaise, 0);
      await noteFor("waiver", `Late fee waived: ${d.reason}`, late);
      // Nothing builds up on these bills any more.
      await tx.update(feeInvoices).set({ lateRule: null }).where(inArray(feeInvoices.id, invs.map((i) => i.id)));
      invs = await load();
    }
    const spendFrom = async (from: "advance" | "deposit", want: number) => {
      if (!want) return 0;
      const have = from === "advance" ? await this.advanceOf(tx, d.studentId) : await this.depositHeld(tx, d.studentId);
      if (want > have) throw new ConflictError(`The ${from} is only ${rupees(have)}, so ${rupees(want)} cannot be used.`);
      const plan = allocatePlan(invs.map((i) => calcOf(i)), want, { lateFirst: settings.lateFeeFirst });
      const used = plan.parts.reduce((s, p) => s + p.amountPaise, 0);
      if (plan.leftover) throw new ConflictError(`${rupees(want)} of ${from} is more than the ${rupees(used)} that is open.`);
      await this.spend(tx, d.studentId, from, plan.parts, date, `Settlement: ${d.reason}`);
      invs = await load();
      return used;
    };
    const advancePaise = await spendFrom("advance", d.useAdvancePaise);
    const depositPaise = await spendFrom("deposit", d.useDepositPaise);

    const left = this.open(invs);
    if (d.finalPaise !== undefined && d.writeOffPaise) throw invalid("writeOffPaise", "Give the amount to write off or the final amount, not both.");
    if (d.finalPaise !== undefined && d.finalPaise > left) throw invalid("finalPaise", `The final amount ${rupees(d.finalPaise)} is more than the ${rupees(left)} that is open.`);
    const writtenOffPaise = d.finalPaise !== undefined ? left - d.finalPaise : d.writeOffPaise;
    if (writtenOffPaise > left) throw invalid("writeOffPaise", `Only ${rupees(left)} is open, so ${rupees(writtenOffPaise)} cannot be written off.`);
    if (writtenOffPaise) {
      await noteFor("write_off", d.reason, allocatePlan(invs.map((i) => calcOf(i)), writtenOffPaise, { lateFirst: true }).parts);
      invs = await load();
    }

    const remainingPaise = this.open(invs);
    const out: SettlementResult["parts"] = [];
    if (d.parts.length) {
      const total = d.parts.reduce((s, p) => s + p.amountPaise, 0);
      if (total !== remainingPaise) throw invalid("parts", `The dates add up to ${rupees(total)} but ${rupees(remainingPaise)} is left to pay after the waiver, advance and write-off.`);
      await tx.delete(feeDueParts).where(inArray(feeDueParts.invoiceId, invs.map((i) => i.id)));
      const todo = [...d.parts].sort((a, b) => a.dueOn.localeCompare(b.dueOn)).map((p) => ({ ...p }));
      for (const inv of [...invs].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))) {
        let room = inv.lines.reduce((s, l) => s + openOf(l), 0);
        for (const p of todo) {
          if (room <= 0) break;
          const take = Math.min(room, p.amountPaise);
          if (take <= 0) continue;
          p.amountPaise -= take; room -= take;
          const same = out.find((o) => o.invoiceId === inv.id && o.dueOn === p.dueOn);
          if (same) same.amountPaise += take; else out.push({ invoiceId: inv.id, dueOn: p.dueOn, amountPaise: take });
        }
      }
      await tx.insert(feeDueParts).values(out.map((o) => ({ schoolId: this.ctx.schoolId, ...o })));
    }
    return { openBeforePaise, waivedLatePaise, advancePaise, depositPaise, writtenOffPaise, remainingPaise, parts: out };
  }

  /**
   * A student is leaving: put their advance and then their deposit against what they owe, and ask for a refund of what
   * is left of each (approval `fees.refund`). Nothing is lost: what cannot be used is requested back.
   */
  async settleUp(input: { studentId: string; reason: string; method: "cash" | "cheque" | "upi" | "bank_transfer"; cashAccountId?: string; reference?: string }) {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      const { studentId } = input;
      await this.lockStudents(tx, [studentId]);
      const settings = await this.settings(tx);
      const date = todayIST();
      const used = { advancePaise: 0, depositPaise: 0 };
      for (const from of ["advance", "deposit"] as const) {
        const invs = (await this.loadInvoices(tx, and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.status, "issued")), true)).filter((i) => i.lines.some((l) => openOf(l) > 0));
        const have = from === "advance" ? await this.advanceOf(tx, studentId) : await this.depositHeld(tx, studentId);
        const plan = allocatePlan(invs.map((i) => calcOf(i)), Math.max(0, have), { lateFirst: settings.lateFeeFirst });
        const amount = plan.parts.reduce((s, p) => s + p.amountPaise, 0);
        if (amount > 0) await this.spend(tx, studentId, from, plan.parts, date, `Leaving: ${input.reason}`);
        used[from === "advance" ? "advancePaise" : "depositPaise"] = amount;
      }
      const refunds = new RefundService(this.ctx);
      const asked: Awaited<ReturnType<RefundService["requestIn"]>>[] = [];
      for (const source of ["advance", "deposit"] as const) {
        const left = await refunds.availableIn(tx, studentId, source);
        if (left > 0) asked.push(await refunds.requestIn(tx, { studentId, source, amountPaise: left, method: input.method, cashAccountId: input.cashAccountId, reference: input.reference, reason: `Leaving: ${input.reason}` }));
      }
      const owing = (await this.loadInvoices(tx, and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.status, "issued")))).reduce((s, i) => s + i.lines.reduce((a, l) => a + openOf(l), 0), 0);
      return { ...used, refunds: asked, stillOwedPaise: owing };
    }, (r) => ({ action: "settle_up", entity: "Student", entityId: input.studentId, summary: `Settled up a leaving student: ${rupees(r.advancePaise + r.depositPaise)} used, ${r.refunds.length} refund request${r.refunds.length === 1 ? "" : "s"}` }));
  }
}
