import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { PdfBuilder } from "@smw/integrations";
import { cashAccount, type PostLine } from "@smw/feature-finance/posting";
import { finJournals, finPrints, finTemplates } from "@smw/feature-finance/schema";
import { schools, users } from "@smw/db";
import { FeesBase, calcOf, newToken, type InvoiceFull } from "./base";
import { allocatePlan, invoiceLateFee, openOf } from "./calc";
import { METHOD_LABEL } from "./constants";
import { collectInput, reversalInput } from "./inputs";
import { feeAdvances, feeAllocations, feeCheques, feeCounters, feeInvoiceLines, feeInvoices, feeReceiptMethods, feeReceipts } from "./schema";

export type Receipt = typeof feeReceipts.$inferSelect;
type Collect = ReturnType<typeof collectInput.parse>;
const LIVE = ["valid", "clearing"] as const;

/** Money received: one receipt with any number of methods, over the bills of one student and their brothers and sisters. */
export class ReceiptService extends FeesBase {
  /** Take money. The receipt, its allocations, advances and posting are one transaction, so a failed collect leaves nothing, not even a gap in the numbers. */
  async collect(input: unknown) {
    this.authorize("collect", "write");
    const data = this.parse(collectInput, input);
    return this.write("collect", (tx) => this.collectIn(tx, data), (r) => ({ action: "collect", entity: "Receipt", entityId: r.id, summary: `Receipt ${r.number} for ${rupees(r.amountPaise)}`, meta: { studentId: r.studentId, advancePaise: r.advancePaise } }));
  }

  /** collect() inside the caller's transaction (UPI slips). No permission check: the caller did it. */
  async collectIn(tx: Tx, data: Collect) {
    const date = await this.moneyDate(tx, data.date);
    const settings = await this.settings(tx);
    const total = data.methods.reduce((s, m) => s + m.amountPaise, 0);
    const advanceAsked = data.methods.filter((m) => m.method === "advance").reduce((s, m) => s + m.amountPaise, 0);
    const hasCheque = data.methods.some((m) => m.method === "cheque");
    if (hasCheque && data.methods.length > 1) throw new ValidationError({ methods: "Take a cheque in its own receipt. If it bounces, only its money comes back." });
    for (const m of data.methods) if (m.method === "cheque" && !m.cheque) throw new ValidationError({ methods: "Enter the cheque number, bank and date." });
    if (data.methods.filter((m) => m.method === "advance").length > 1) throw new ValidationError({ methods: "Use the advance once." });

    const payer = await this.oneStudent(tx, data.studentId);
    const family = new Set(await this.familyOf(tx, payer.id));
    let wanted = [...new Set([...(data.invoiceIds ?? []), ...(data.parts ?? []).map((p) => p.invoiceId)])];
    if (!wanted.length) wanted = (await tx.select({ id: feeInvoices.id }).from(feeInvoices).where(and(eq(feeInvoices.studentId, payer.id), eq(feeInvoices.status, "issued")))).map((r) => r.id);
    const owners = wanted.length ? await tx.select({ id: feeInvoices.id, s: feeInvoices.studentId }).from(feeInvoices).where(inArray(feeInvoices.id, wanted)) : [];
    if (owners.length !== wanted.length) throw new NotFoundError("Invoice");
    if (owners.some((o) => !family.has(o.s))) throw new ConflictError("A bill in this list belongs to a student who is not in this family. Collect it from that student's page.");
    await this.lockStudents(tx, [payer.id, ...owners.map((o) => o.s)]);

    const counter = await this.counterFor(tx, date, data.methods.some((m) => m.method === "cash"));
    let invoices = wanted.length ? await this.invoicesById(tx, wanted, true) : [];
    const notIssued = invoices.find((i) => i.status !== "issued");
    if (notIssued) throw new ConflictError(`${notIssued.number ?? notIssued.label} is ${notIssued.status === "cancelled" ? "cancelled" : "not issued yet"}, so it cannot be paid.`);

    if (await this.fixLateFees(tx, invoices, date, settings.basis)) invoices = await this.invoicesById(tx, wanted, true);
    const limits = new Map((data.parts ?? []).map((p) => [p.invoiceId, p.amountPaise]));
    const plan = allocatePlan(invoices.filter((i) => openOf(i) > 0).map((i) => calcOf(i, limits.get(i.id))), total, { lateFirst: settings.lateFeeFirst });
    const allocated = total - plan.leftover;
    if (advanceAsked) {
      const have = await this.advanceOf(tx, payer.id);
      if (advanceAsked > have) throw new ConflictError(`The advance is only ${rupees(have)}. Use less, or take the rest in cash or UPI.`);
      if (plan.leftover > total - advanceAsked) throw new ConflictError("The advance is more than what is due. Use less of it; an advance is not turned back into an advance.");
    }

    const [tpl] = await tx.select({ v: finTemplates.version }).from(finTemplates).where(and(eq(finTemplates.kind, "receipt"), eq(finTemplates.isCurrent, true))).limit(1);
    const [receipt] = await tx.insert(feeReceipts).values({
      schoolId: this.ctx.schoolId, number: await this.number(tx, "receipt", date), studentId: payer.id, date, amountPaise: total, advancePaise: plan.leftover,
      status: hasCheque ? "clearing" : "valid", counterId: counter?.id ?? null, payerName: data.payerName ?? null, note: data.note ?? null,
      snapshot: await this.snapshot(tx, payer), templateVersion: tpl?.v ?? null, verifyToken: newToken(), collectedBy: this.ctx.userId,
    }).returning();
    const id = receipt!.id;

    const debits: PostLine[] = [];
    for (const m of data.methods) {
      const acct = m.method === "advance" || m.method === "cheque" ? null : await cashAccount(tx, this.ctx.schoolId, { id: m.method === "cash" && counter ? counter.cashAccountId : m.cashAccountId, kind: m.method === "cash" ? "cash" : "bank" });
      await tx.insert(feeReceiptMethods).values({ schoolId: this.ctx.schoolId, receiptId: id, method: m.method, amountPaise: m.amountPaise, cashAccountId: acct?.id ?? null, reference: m.reference ?? null });
      if (m.cheque) await tx.insert(feeCheques).values({ schoolId: this.ctx.schoolId, receiptId: id, chequeNo: m.cheque.chequeNo, bank: m.cheque.bank, chequeDate: m.cheque.chequeDate, amountPaise: m.amountPaise });
      debits.push(m.method === "advance" ? { account: "student_advances", debit: m.amountPaise, party: { type: "student", id: payer.id } } : { account: m.method === "cheque" ? "cheques" : { id: acct!.accountId }, debit: m.amountPaise, memo: METHOD_LABEL[m.method] });
    }
    const slices = await this.applyParts(tx, plan.parts, { receiptId: id, date });
    const rows = [
      ...(plan.leftover ? [{ kind: "receipt" as const, amountPaise: plan.leftover }] : []),
      ...(advanceAsked ? [{ kind: "used" as const, amountPaise: -advanceAsked }] : []),
    ];
    if (rows.length) await tx.insert(feeAdvances).values(rows.map((r) => ({ schoolId: this.ctx.schoolId, studentId: payer.id, ...r, refId: id, date, note: `Receipt ${receipt!.number}` })));
    const credits = await this.creditLines(tx, slices);
    if (plan.leftover) credits.push({ account: "student_advances", credit: plan.leftover, party: { type: "student", id: payer.id }, memo: "Advance" });
    await this.post(tx, { date, sourceKey: `fees:receipt:${id}`, sourceType: "fee_receipt", sourceId: id, memo: `Receipt ${receipt!.number}`, lines: [...debits, ...credits] });

    const warnings = await this.cashWarning(tx, payer.id, date, settings.cashLimitPaise);
    await this.tell(tx, [...new Set([payer.id, ...slices.map((s) => s.studentId)])], "Payment received", `Receipt ${receipt!.number} for ${rupees(total)}.`, `/app/fees/receipts/${id}`);
    return { ...receipt!, allocatedPaise: allocated, allocations: slices, warnings };
  }

  /** The open counter of this person (cash needs one once the school uses counters); a closed day takes no more. */
  private async counterFor(tx: Tx, date: string, cash: boolean) {
    const mine = await tx.select().from(feeCounters).where(eq(feeCounters.userId, this.ctx.userId));
    if (mine.some((c) => c.day === date && c.closedAt)) throw new ConflictError(`Your counter for ${date} is closed, so it takes no more money. Open a counter on a later day, or ask an admin.`);
    const open = mine.find((c) => !c.closedAt) ?? null;
    if (cash && !open) {
      const [any] = await tx.select({ id: feeCounters.id }).from(feeCounters).limit(1);
      if (any) throw new ConflictError("Open your counter before taking cash (Counter, Open). Cheque, UPI and bank transfer do not need it.");
    }
    return open;
  }

  /** Turn the late fee that has built up into a bill line, so it can be paid, waived or reminded about. On the accrual basis it posts. */
  private async fixLateFees(tx: Tx, invoices: InvoiceFull[], date: string, basis: "accrual" | "cash") {
    let any = false;
    for (const inv of invoices) {
      const fee = invoiceLateFee(inv.lateRule, calcOf(inv), date);
      if (fee <= 0) continue;
      any = true;
      const sort = inv.lines.reduce((m, l) => Math.max(m, l.sort), 0) + 1;
      const [line] = await tx.insert(feeInvoiceLines).values({ schoolId: this.ctx.schoolId, invoiceId: inv.id, kind: "late", label: "Late fee", amountPaise: fee, sort }).returning({ id: feeInvoiceLines.id });
      await this.refreshInvoiceTotals(tx, [inv.id]);
      if (basis === "accrual") {
        await this.post(tx, { date, sourceKey: `fees:late:${line!.id}`, sourceType: "fee_invoice", sourceId: inv.id, memo: `Late fee on ${inv.number}`, lines: [{ account: "student_dues", debit: fee, party: { type: "student", id: inv.studentId } }, { account: "late_fee", credit: fee }] });
      }
    }
    return any;
  }

  private async cashWarning(tx: Tx, studentId: string, date: string, limit: number): Promise<string[]> {
    if (!limit) return [];
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(${feeReceiptMethods.amountPaise}), 0)` }).from(feeReceiptMethods).innerJoin(feeReceipts, eq(feeReceipts.id, feeReceiptMethods.receiptId))
      .where(and(eq(feeReceipts.studentId, studentId), eq(feeReceipts.date, date), eq(feeReceiptMethods.method, "cash"), inArray(feeReceipts.status, [...LIVE])));
    return Number(r?.v) >= limit ? [`This family has paid ${rupees(Number(r!.v))} in cash today. The school's warning limit is ${rupees(limit)}.`] : [];
  }

  // ---------- reversal ----------

  /** Ask to reverse a receipt. Nothing changes until someone else approves (`fees.reversal`). */
  async requestReversal(id: string, reason: string) {
    this.authorize("collect", "write");
    const d = this.parse(reversalInput, { id, reason });
    return this.write("collect", async (tx) => {
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, d.id));
      if (!r) throw new NotFoundError("Receipt");
      if (!LIVE.includes(r.status as never)) throw new ConflictError(`This receipt is already ${r.status}.`);
      return this.askApproval(tx, { kind: "fees.reversal", refType: "fee_receipt", refId: r.id, title: `Reverse receipt ${r.number} (${rupees(r.amountPaise)})`, amountPaise: r.amountPaise, reason: d.reason, href: `/app/fees/receipts/${r.id}` });
    }, (a) => ({ action: "request_reversal", entity: "Receipt", entityId: a.refId, summary: `Asked to reverse a receipt: ${d.reason}` }));
  }

  async withdrawReversal(receiptId: string) {
    this.authorize("collect", "write");
    return this.write("collect", async (tx) => { await this.withdrawRequest(tx, "fees.reversal", receiptId); return { id: receiptId }; }, () => ({ action: "withdraw_reversal", entity: "Receipt", entityId: receiptId, summary: "Withdrew a reversal request" }));
  }

  /** The approved reversal: allocations, advances and postings undone; the receipt keeps its number. */
  async reverseIn(tx: Tx, receiptId: string, reason: string, date = todayIST()) {
    const [pre] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, receiptId));
    if (!pre) throw new NotFoundError("Receipt");
    const hit = await tx.select({ s: feeAllocations.studentId }).from(feeAllocations).where(and(eq(feeAllocations.receiptId, receiptId), isNull(feeAllocations.undoneAt)));
    await this.lockStudents(tx, [pre.studentId, ...hit.map((h) => h.s)]);
    const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, receiptId)).for("update");
    if (!LIVE.includes(r!.status as never)) throw new ConflictError(`This receipt is already ${r!.status}.`);
    if (r!.advancePaise > 0 && (await this.advanceOf(tx, r!.studentId)) < r!.advancePaise) {
      throw new ConflictError(`The ${rupees(r!.advancePaise)} advance from this receipt has already been used on other bills. Reverse or refund what used it first, then reverse this receipt.`);
    }
    const [cheque] = await tx.select().from(feeCheques).where(eq(feeCheques.receiptId, receiptId));
    if (cheque?.status === "cleared") await this.reverse(tx, `fees:cheque-clear:${cheque.id}`, `Receipt ${r!.number} reversed`, date);
    await this.takeBack(tx, r!, date, `Receipt ${r!.number} reversed: ${reason}`);
    await tx.update(feeReceipts).set({ status: "reversed", reverseReason: reason, reversedAt: new Date() }).where(eq(feeReceipts.id, receiptId));
    await this.tell(tx, [r!.studentId], "Receipt reversed", `Receipt ${r!.number} was reversed: ${reason}`, `/app/fees/receipts/${r!.id}`);
    await this.audit(tx, { action: "reverse", entity: "Receipt", entityId: r!.id, summary: `Reversed receipt ${r!.number}: ${reason}` });
  }

  /** Undo what a receipt did (shared by a reversal and a bounced cheque): bills reopen, advances go back, the posting is mirrored. */
  async takeBack(tx: Tx, r: Receipt, date: string, memo: string) {
    await this.undoAllocations(tx, eq(feeAllocations.receiptId, r.id));
    const rows = await tx.select().from(feeAdvances).where(and(eq(feeAdvances.refId, r.id), inArray(feeAdvances.kind, ["receipt", "used"])));
    if (rows.length) await tx.insert(feeAdvances).values(rows.map((a) => ({ schoolId: this.ctx.schoolId, studentId: a.studentId, kind: "undo" as const, amountPaise: -a.amountPaise, refId: r.id, note: memo, date })));
    await this.reverse(tx, `fees:receipt:${r.id}`, memo, date);
  }

  // ---------- reading ----------

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.viewer(async (tx, own) => {
      const f = q.filters;
      const where = and(
        own ? inArray(feeReceipts.studentId, own.length ? own : ["00000000-0000-0000-0000-000000000000"]) : undefined,
        f.studentId ? eq(feeReceipts.studentId, f.studentId) : undefined, f.status ? eq(feeReceipts.status, f.status as Receipt["status"]) : undefined,
        f.from ? sql`${feeReceipts.date} >= ${f.from}` : undefined, f.to ? sql`${feeReceipts.date} <= ${f.to}` : undefined, f.cashier ? eq(feeReceipts.collectedBy, f.cashier) : undefined,
        f.method ? sql`exists (select 1 from fee_receipt_methods m where m.receipt_id = ${feeReceipts.id} and m.method = ${f.method})` : undefined,
        q.q ? or(ilike(feeReceipts.number, `%${q.q}%`), sql`${feeReceipts.snapshot}->>'studentName' ilike ${`%${q.q}%`}`, sql`${feeReceipts.snapshot}->>'admissionNo' ilike ${`%${q.q}%`}`) : undefined,
      );
      const [rows, [n]] = await Promise.all([
        tx.select().from(feeReceipts).where(where).orderBy(desc(feeReceipts.date), desc(feeReceipts.number)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeReceipts).where(where),
      ]);
      const methods = rows.length ? await tx.select().from(feeReceiptMethods).where(inArray(feeReceiptMethods.receiptId, rows.map((r) => r.id))) : [];
      return toPage(rows.map((r) => ({ ...r, studentName: r.snapshot.studentName, methods: methods.filter((m) => m.receiptId === r.id).map((m) => ({ method: m.method, amountPaise: m.amountPaise })) })), Number(n?.n ?? 0), q);
    });
  }

  /** One receipt with where each rupee went, its cheque, advances and the ledger entry it posted. */
  async get(id: string) {
    return this.viewer(async (tx, own) => {
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, id));
      if (!r) throw new NotFoundError("Receipt");
      this.assertVisible(own, r.studentId, "Receipt");
      const [methods, cheque, allocations, journal, by] = await Promise.all([
        tx.select().from(feeReceiptMethods).where(eq(feeReceiptMethods.receiptId, id)),
        tx.select().from(feeCheques).where(eq(feeCheques.receiptId, id)),
        tx.select({ id: feeAllocations.id, invoiceId: feeInvoices.id, invoiceNumber: feeInvoices.number, invoiceLabel: feeInvoices.label, line: feeInvoiceLines.label, studentId: feeAllocations.studentId, amountPaise: feeAllocations.amountPaise, undoneAt: feeAllocations.undoneAt })
          .from(feeAllocations).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId)).innerJoin(feeInvoices, eq(feeInvoices.id, feeInvoiceLines.invoiceId)).where(eq(feeAllocations.receiptId, id)).orderBy(asc(feeInvoices.dueDate), asc(feeInvoiceLines.sort)),
        tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.sourceKey, `fees:receipt:${id}`)),
        r.collectedBy ? tx.select({ name: users.name }).from(users).where(eq(users.id, r.collectedBy)) : [],
      ]);
      return { receipt: r, methods, cheque: cheque[0] ?? null, allocations: own ? allocations.filter((a) => own.includes(a.studentId)) : allocations, journalId: own ? null : journal[0]?.id ?? null, collectedByName: by[0]?.name ?? null };
    });
  }

  /** A cashier's day: what they took, by method, and the receipts. Staff with read access may look at anyone's. */
  async cashierDay(o: { date?: string; userId?: string } = {}) {
    const userId = o.userId && o.userId !== this.ctx.userId ? o.userId : this.ctx.userId;
    return this.read(userId === this.ctx.userId ? "collect" : "read", async (tx) => {
      const date = o.date ?? todayIST();
      const receipts = await tx.select().from(feeReceipts).where(and(eq(feeReceipts.collectedBy, userId), eq(feeReceipts.date, date))).orderBy(asc(feeReceipts.number));
      const methods = receipts.length ? await tx.select().from(feeReceiptMethods).where(inArray(feeReceiptMethods.receiptId, receipts.map((r) => r.id))) : [];
      const live = new Set(receipts.filter((r) => LIVE.includes(r.status as never)).map((r) => r.id));
      const byMethod: Record<string, number> = {};
      for (const m of methods.filter((x) => live.has(x.receiptId) && x.method !== "advance")) byMethod[m.method] = (byMethod[m.method] ?? 0) + m.amountPaise;
      return { date, receipts, byMethod, totalPaise: Object.values(byMethod).reduce((s, v) => s + v, 0) };
    });
  }

  /** The receipt as a plain PDF (a template can replace the layout later). Every print is logged; the second one onwards says DUPLICATE. */
  async receiptFile(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    return this.viewer(async (tx, own) => {
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, id));
      if (!r) throw new NotFoundError("Receipt");
      this.assertVisible(own, r.studentId, "Receipt");
      const [[school], methods, allocs, [last]] = await Promise.all([
        tx.select().from(schools).limit(1),
        tx.select().from(feeReceiptMethods).where(eq(feeReceiptMethods.receiptId, id)),
        tx.select({ label: feeInvoices.label, line: feeInvoiceLines.label, amountPaise: feeAllocations.amountPaise }).from(feeAllocations).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId)).innerJoin(feeInvoices, eq(feeInvoices.id, feeInvoiceLines.invoiceId)).where(and(eq(feeAllocations.receiptId, id), isNull(feeAllocations.undoneAt))).orderBy(asc(feeInvoices.dueDate), asc(feeInvoiceLines.sort)),
        tx.select({ n: sql<number>`coalesce(max(${finPrints.copyNo}), 0)::int` }).from(finPrints).where(and(eq(finPrints.docType, "fee_receipt"), eq(finPrints.docId, id))),
      ]);
      const copyNo = (last?.n ?? 0) + 1;
      await tx.insert(finPrints).values({ schoolId: this.ctx.schoolId, docType: "fee_receipt", docId: id, copyNo, printedBy: this.ctx.userId });
      const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const money = PdfBuilder.money;
      const pdf = await PdfBuilder.create();
      pdf.header({
        title: r.status === "reversed" ? "FEE RECEIPT (REVERSED)" : r.status === "bounced" ? "FEE RECEIPT (CHEQUE BOUNCED)" : "FEE RECEIPT", orgName: school?.name ?? "School",
        orgLines: [school?.address, school?.city, school?.phone ? `Phone: ${school.phone}` : null].filter((x): x is string => !!x),
        rightLines: [`Receipt no: ${r.number}`, `Date: ${day(r.date)}`, ...(copyNo > 1 ? ["DUPLICATE"] : [])],
      });
      pdf.facts([["Student", r.snapshot.studentName], ["Admission no", r.snapshot.admissionNo], ["Class", r.snapshot.classLabel], ["Received from", r.payerName ?? r.snapshot.guardian ?? "-"]]);
      pdf.table({ columns: [{ label: "Bill", width: 200 }, { label: "For", width: 150 }, { label: "Amount", width: 99, align: "right" }], rows: [...allocs.map((a) => [a.label, a.line, money(a.amountPaise)]), ...(r.advancePaise ? [["Kept as advance", "", money(r.advancePaise)]] : [])] });
      pdf.totals([...methods.map((m): [string, string] => [`${METHOD_LABEL[m.method]}${m.reference ? ` (${m.reference})` : ""}`, money(m.amountPaise)]), ["Total received", money(r.amountPaise), true]]);
      if (r.status === "reversed") pdf.space(8).text(`Reversed: ${r.reverseReason ?? ""}`, { bold: true });
      pdf.space(16).text("Computer generated receipt. No signature required.", { size: 8, color: [0.4, 0.4, 0.45] });
      return { filename: `${r.number.replace(/\//g, "-")}${copyNo > 1 ? "-duplicate" : ""}.pdf`, bytes: await pdf.save() };
    });
  }
}
