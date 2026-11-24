import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, pgErrorCode, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { percentOf, rupees, todayIST } from "@smw/feature-kit/money";
import type { PgColumn } from "drizzle-orm/pg-core";
import { users, type Tx } from "@smw/db";
import { postJournal, type PostLine, type Poster } from "@smw/feature-finance/posting";
import { finAccounts, finApprovals, finCostCentres } from "@smw/feature-finance/schema";
import { ExpenseService, checkAccount, checkCentre, checkVehicle, journalIdOf, journalIdSql, need } from "./base";
import { budgetCheck } from "./budgets";
import { ExpenseFiles, type UploadedFile } from "./files";
import { day, optionalId, paiseAmount } from "./inputs";
import { expBillLines, expBills, expPaymentBills, expPayments, expVendors } from "./schema";

export type Bill = typeof expBills.$inferSelect;
export type BillLine = typeof expBillLines.$inferSelect;
export type BillState = "draft" | "pending" | "rejected" | "cancelled" | "due" | "overdue" | "part_paid" | "paid";

export const netOf = (b: Pick<Bill, "grossPaise" | "tdsPaise">) => b.grossPaise - b.tdsPaise;
export const openOf = (b: Pick<Bill, "grossPaise" | "tdsPaise" | "paidPaise">) => netOf(b) - b.paidPaise;
/** What a person sees: `overdue` is worked out, never stored. */
export function billState(b: Pick<Bill, "status" | "grossPaise" | "tdsPaise" | "paidPaise" | "dueDate">, today = todayIST()): BillState {
  if (b.status !== "approved") return b.status as BillState;
  if (openOf(b) <= 0) return "paid";
  if (b.dueDate < today) return "overdue";
  return b.paidPaise > 0 ? "part_paid" : "due";
}

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const billShape = z.object({
  id: z.uuid().optional(),
  vendorId: z.uuid("Choose a vendor."),
  billNo: z.string().trim().min(1, "Enter the number printed on the bill.").max(60),
  billDate: day,
  dueDate: day,
  note: z.string().trim().max(500).optional(),
  tdsBasisPoints: z.coerce.number().int().min(0).max(3000).optional(),
  lines: z.preprocess(json, z.array(z.object({
    accountId: z.uuid("Choose an account."), costCentreId: optionalId, vehicleId: optionalId,
    label: z.string().trim().min(1, "Describe the line.").max(160), amountPaise: paiseAmount, gstPaise: z.coerce.number().int().min(0).default(0),
  })).min(1, "Add at least one line.").max(50)),
  removeFile: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).optional(),
});
export const billInput = billShape.refine((v) => v.dueDate >= v.billDate, { path: ["dueDate"], message: "The due date cannot be before the bill date." });

export interface BillRow {
  id: string; billNo: string; vendorId: string; vendorName: string; billDate: string; dueDate: string; status: Bill["status"]; state: BillState;
  grossPaise: number; tdsPaise: number; netPaise: number; paidPaise: number; openPaise: number; hasFile: boolean; journalId: string | null;
}

/** Accrual: the bill is a debt on the day it is approved. On the cash basis nothing posts until a payment. */
export async function postBill(tx: Tx, by: Poster, bill: Bill, lines: BillLine[]) {
  const party = { type: "vendor" as const, id: bill.vendorId };
  const out: PostLine[] = lines.map((l) => ({ account: { id: l.accountId }, debit: l.amountPaise, costCentreId: l.costCentreId, memo: l.label }));
  out.push({ account: "vendor_dues", credit: netOf(bill), party }, { account: "tds_payable", credit: bill.tdsPaise, party });
  return postJournal(tx, by, { date: bill.billDate, sourceKey: `expenses:bill:${bill.id}`, sourceType: "exp_bill", sourceId: bill.id, memo: `Bill ${bill.billNo}`, lines: out });
}

/** Move a draft or pending bill to approved and post it. Used by a direct approval and by the approval handler. */
export async function approveBill(tx: Tx, by: Poster, billId: string, basis: "accrual" | "cash") {
  const [b] = await tx.select().from(expBills).where(eq(expBills.id, billId)).for("update");
  if (!b) throw new NotFoundError("Bill");
  if (b.status !== "pending" && b.status !== "draft") throw new ConflictError(`This bill is already ${b.status}.`);
  const [row] = await tx.update(expBills).set({ status: "approved" }).where(eq(expBills.id, billId)).returning();
  if (basis === "accrual") await postBill(tx, by, row!, await tx.select().from(expBillLines).where(eq(expBillLines.billId, billId)));
  return row!;
}

export class BillService extends ExpenseService {
  private get files() { return new ExpenseFiles(this.ctx.schoolId); }

  async list(query: ListQuery = {}): Promise<Page<BillRow>> {
    const q = listQuerySchema.parse(query);
    const today = todayIST(), f = q.filters;
    const net = sql`(${expBills.grossPaise} - ${expBills.tdsPaise})`;
    const status = f.status;
    const where = and(
      q.q ? or(ilike(expBills.billNo, `%${q.q}%`), ilike(expVendors.name, `%${q.q}%`)) : undefined,
      f.vendorId ? eq(expBills.vendorId, f.vendorId) : undefined,
      f.from ? sql`${expBills.billDate} >= ${f.from}` : undefined, f.to ? sql`${expBills.billDate} <= ${f.to}` : undefined,
      ["draft", "pending", "approved", "rejected", "cancelled"].includes(status ?? "") ? eq(expBills.status, status as Bill["status"]) : undefined,
      status === "unpaid" ? and(eq(expBills.status, "approved"), sql`${expBills.paidPaise} < ${net}`) : undefined,
      status === "overdue" ? and(eq(expBills.status, "approved"), sql`${expBills.paidPaise} < ${net}`, sql`${expBills.dueDate} < ${today}`) : undefined,
      status === "paid" ? and(eq(expBills.status, "approved"), sql`${expBills.paidPaise} >= ${net}`) : undefined,
    );
    const dir = q.dir === "asc" ? asc : desc;
    const sorts: Record<string, SQL | PgColumn> = { dueDate: expBills.dueDate, billDate: expBills.billDate, gross: expBills.grossPaise };
    const sort = sorts[q.sort ?? ""] ?? expBills.billDate;
    return this.read("read", async (tx) => {
      const base = tx.select({ b: expBills, vendorName: expVendors.name, journalId: journalIdSql("expenses:bill:", expBills.id) }).from(expBills).innerJoin(expVendors, eq(expVendors.id, expBills.vendorId)).where(where);
      const [rows, [n]] = await Promise.all([
        base.orderBy(dir(sort as PgColumn), asc(expBills.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(expBills).innerJoin(expVendors, eq(expVendors.id, expBills.vendorId)).where(where),
      ]);
      return toPage(rows.map(({ b, vendorName, journalId }) => ({
        id: b.id, billNo: b.billNo, vendorId: b.vendorId, vendorName, billDate: b.billDate, dueDate: b.dueDate, status: b.status, state: billState(b, today),
        grossPaise: b.grossPaise, tdsPaise: b.tdsPaise, netPaise: netOf(b), paidPaise: b.paidPaise, openPaise: b.status === "approved" ? openOf(b) : 0, hasFile: !!b.fileKey, journalId,
      })), Number(n?.n ?? 0), q);
    });
  }

  /** One bill with everything a screen needs to say where it stands and what to do next. */
  async get(id: string) {
    return this.read("read", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Bill");
      const bill = need((await tx.select().from(expBills).where(eq(expBills.id, id)).limit(1))[0], "Bill");
      const lines = await tx.select({ l: expBillLines, accountName: finAccounts.name, centreName: finCostCentres.name }).from(expBillLines)
        .innerJoin(finAccounts, eq(finAccounts.id, expBillLines.accountId)).leftJoin(finCostCentres, eq(finCostCentres.id, expBillLines.costCentreId))
        .where(eq(expBillLines.billId, id)).orderBy(asc(expBillLines.sort));
      const [vendor] = await tx.select({ id: expVendors.id, name: expVendors.name, hasBank: sql<boolean>`(${expVendors.bankLast4} is not null and ${expVendors.ifsc} is not null) or ${expVendors.upiId} is not null`, tdsBasisPoints: expVendors.tdsBasisPoints }).from(expVendors).where(eq(expVendors.id, bill.vendorId));
      const payments = await tx.select({ id: expPayments.id, number: expPayments.number, date: expPayments.date, method: expPayments.method, status: expPayments.status, amountPaise: expPaymentBills.amountPaise, journalId: journalIdSql("expenses:payment:", expPayments.id) })
        .from(expPaymentBills).innerJoin(expPayments, eq(expPayments.id, expPaymentBills.paymentId)).where(eq(expPaymentBills.billId, id)).orderBy(asc(expPayments.date));
      const [ap] = await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "expenses.bill"), eq(finApprovals.refId, id))).orderBy(desc(finApprovals.createdAt)).limit(1);
      const names = ap ? new Map((await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [ap.requestedBy, ...(ap.decidedBy ? [ap.decidedBy] : [])]))).map((u) => [u.id, u.name])) : new Map<string, string>();
      const approvers = ap?.status === "pending" ? (await tx.select({ name: users.name }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.name) : [];
      return {
        bill, state: billState(bill), netPaise: netOf(bill), openPaise: bill.status === "approved" ? openOf(bill) : 0,
        lines: lines.map(({ l, accountName, centreName }) => ({ ...l, accountName, centreName })), vendor: vendor!, payments,
        approval: ap ? { id: ap.id, status: ap.status, reason: ap.reason, note: ap.note, requestedByName: names.get(ap.requestedBy) ?? null, decidedByName: ap.decidedBy ? names.get(ap.decidedBy) ?? null : null, waitingFor: approvers } : null,
        journalId: await journalIdOf(tx, `expenses:bill:${id}`),
        fileUrl: await this.files.url(bill.fileKey),
      };
    });
  }

  /** Approved bills of one vendor that still owe something, oldest due first: what the payment screen offers. */
  async openFor(vendorId: string) {
    return this.read("manage", async (tx) => (await tx.select().from(expBills).where(and(eq(expBills.vendorId, vendorId), eq(expBills.status, "approved"), sql`${expBills.paidPaise} < ${expBills.grossPaise} - ${expBills.tdsPaise}`)).orderBy(asc(expBills.dueDate)))
      .map((b) => ({ id: b.id, billNo: b.billNo, dueDate: b.dueDate, netPaise: netOf(b), openPaise: openOf(b), state: billState(b) })));
  }

  /** Create a draft, or change a draft or rejected bill (a rejected one goes back to draft). Totals are worked out here, not trusted from the form. */
  async save(input: unknown, file?: UploadedFile): Promise<Bill> {
    this.authorize("manage", "write");
    const d = this.parse(billInput, input);
    const stored = file ? await this.files.put(file) : null;
    try {
      const result = await this.write("manage", async (tx) => {
        const [vendor] = await tx.select().from(expVendors).where(eq(expVendors.id, d.vendorId)).limit(1);
        if (!vendor) throw new ValidationError({ vendorId: "Choose a vendor from the list." });
        if (!vendor.isActive) throw new ValidationError({ vendorId: `${vendor.name} is switched off. Switch it on from the vendor page first.` });
        for (const l of d.lines) {
          await checkAccount(tx, l.accountId, "expense", "lines");
          await checkCentre(tx, l.costCentreId, "lines"); await checkVehicle(tx, l.vehicleId);
        }
        const gross = d.lines.reduce((s, l) => s + l.amountPaise, 0);
        const tds = percentOf(gross, d.tdsBasisPoints ?? vendor.tdsBasisPoints);
        if (tds >= gross) throw new ValidationError({ tdsBasisPoints: "The tax withheld must be less than the bill." });
        const values = { vendorId: d.vendorId, billNo: d.billNo, billDate: d.billDate, dueDate: d.dueDate, note: d.note ?? null, grossPaise: gross, tdsPaise: tds, status: "draft" as const };
        let bill: Bill | undefined, old: string | null = null;
        try {
          if (d.id) {
            const [cur] = await tx.select().from(expBills).where(eq(expBills.id, d.id)).for("update");
            if (!cur) throw new NotFoundError("Bill");
            if (cur.status !== "draft" && cur.status !== "rejected") throw new ConflictError(cur.status === "pending" ? "This bill is waiting for approval. Withdraw it first to change it." : "An approved bill cannot be edited. Cancel it and enter it again.");
            old = stored || d.removeFile ? cur.fileKey : null;
            [bill] = await tx.update(expBills).set({ ...values, ...(stored ? stored : d.removeFile ? { fileKey: null, fileName: null } : {}) }).where(eq(expBills.id, d.id)).returning();
            await tx.delete(expBillLines).where(eq(expBillLines.billId, d.id));
          } else {
            [bill] = await tx.insert(expBills).values({ ...values, schoolId: this.ctx.schoolId, createdBy: this.ctx.userId, ...(stored ?? {}) }).returning();
          }
        } catch (e) {
          if (pgErrorCode(e) === "23505") throw new ConflictError(`${vendor.name} already has a bill numbered ${d.billNo}. Open that one, or use a different number.`);
          throw e;
        }
        await tx.insert(expBillLines).values(d.lines.map((l, i) => ({ schoolId: this.ctx.schoolId, billId: bill!.id, accountId: l.accountId, costCentreId: l.costCentreId ?? null, vehicleId: l.vehicleId ?? null, label: l.label, amountPaise: l.amountPaise, gstPaise: l.gstPaise, sort: i })));
        return { bill: bill!, old };
      }, ({ bill }) => ({ action: "save", entity: "Bill", entityId: bill.id, summary: `Saved draft bill ${bill.billNo} of ${rupees(bill.grossPaise)}` }));
      await this.files.remove([result.old]);
      return result.bill;
    } catch (e) { await this.files.remove([stored?.fileKey ?? null]); throw e; }
  }

  /** What saving would do, before it is saved: totals, the entry that will post, budget effects and whether an approver is needed. */
  async preview(input: unknown) {
    const d = this.parse(billShape.partial({ id: true, billNo: true, dueDate: true, billDate: true }), input);
    return this.read("manage", async (tx) => {
      const [vendor] = await tx.select().from(expVendors).where(eq(expVendors.id, d.vendorId));
      const gross = d.lines.reduce((s, l) => s + l.amountPaise, 0), tds = percentOf(gross, d.tdsBasisPoints ?? vendor?.tdsBasisPoints ?? 0), net = gross - tds;
      const names = new Map((await tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts)).map((a) => [a.id, a.name]));
      const settings = await this.settings(tx);
      const budget = await budgetCheck(tx, { date: d.billDate ?? todayIST(), lines: d.lines.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId ?? null, amountPaise: l.amountPaise })), excludeBillId: d.id });
      const postings = settings.basis === "cash"
        ? []
        : [...d.lines.map((l) => ({ side: "Dr" as const, label: names.get(l.accountId) ?? "Expense", paise: l.amountPaise })), { side: "Cr" as const, label: "Vendor dues", paise: net }, ...(tds ? [{ side: "Cr" as const, label: "TDS payable", paise: tds }] : [])];
      const needsApproval = gross > settings.billLimitPaise || budget.blocks.length > 0;
      return { grossPaise: gross, tdsPaise: tds, netPaise: net, basis: settings.basis, postings, warnings: budget.warnings, blocks: budget.blocks, needsApproval, limitPaise: settings.billLimitPaise };
    });
  }

  /** Send for approval, or approve straight away when it is under the limit and inside budget. */
  async submit(id: string) {
    return this.write("manage", async (tx) => {
      const [b] = await tx.select().from(expBills).where(eq(expBills.id, id)).for("update");
      if (!b) throw new NotFoundError("Bill");
      if (b.status !== "draft") throw new ConflictError(b.status === "pending" ? "This bill is already waiting for approval." : `This bill is ${b.status}. Edit it first if it was rejected.`);
      const lines = await tx.select().from(expBillLines).where(eq(expBillLines.billId, id));
      if (!lines.length) throw new ValidationError({ lines: "Add at least one line." });
      const [vendor] = await tx.select().from(expVendors).where(eq(expVendors.id, b.vendorId));
      const settings = await this.settings(tx);
      const budget = await budgetCheck(tx, { date: b.billDate, lines, excludeBillId: b.id });
      const reasons: string[] = [];
      if (b.grossPaise > settings.billLimitPaise) reasons.push(settings.billLimitPaise === 0 ? "Every bill needs approval until a limit is set in Finance setup." : `Above the bill limit of ${rupees(settings.billLimitPaise)}.`);
      reasons.push(...budget.blocks);
      if (reasons.length) {
        await tx.update(expBills).set({ status: "pending" }).where(eq(expBills.id, id));
        const approval = await this.askApproval(tx, { kind: "expenses.bill", refType: "exp_bill", refId: id, title: `Bill ${b.billNo} from ${vendor!.name}`, amountPaise: b.grossPaise, reason: reasons.join(" "), href: `/app/expenses/bills?bill=${id}` });
        return { outcome: "pending" as const, bill: { ...b, status: "pending" as const }, warnings: budget.warnings, approvalId: approval.id };
      }
      const bill = await approveBill(tx, this.poster, id, settings.basis);
      return { outcome: "approved" as const, bill, warnings: budget.warnings, approvalId: null };
    }, (r) => ({ action: r.outcome === "approved" ? "approve" : "submit", entity: "Bill", entityId: r.bill.id, summary: `${r.outcome === "approved" ? "Approved" : "Sent for approval"}: bill ${r.bill.billNo} of ${rupees(r.bill.grossPaise)}`, meta: { warnings: r.warnings } }));
  }

  /** Several drafts at once; each answers for itself so one problem stops nothing else. */
  async submitMany(ids: string[]) {
    const out: { id: string; ok: boolean; message: string }[] = [];
    for (const id of ids) {
      try { const r = await this.submit(id); out.push({ id, ok: true, message: r.outcome === "approved" ? `${r.bill.billNo} approved` : `${r.bill.billNo} sent for approval` }); }
      catch (e) { out.push({ id, ok: false, message: e instanceof Error ? e.message : "Failed" }); }
    }
    return out;
  }

  /** Take a pending bill back to draft, closing its approval request. */
  async withdraw(id: string) {
    return this.write("manage", async (tx) => {
      const [b] = await tx.select().from(expBills).where(eq(expBills.id, id)).for("update");
      if (!b) throw new NotFoundError("Bill");
      if (b.status !== "pending") throw new ConflictError("Only a bill waiting for approval can be withdrawn.");
      await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(and(eq(finApprovals.kind, "expenses.bill"), eq(finApprovals.refId, id), eq(finApprovals.status, "pending")));
      const [r] = await tx.update(expBills).set({ status: "draft" }).where(eq(expBills.id, id)).returning();
      return r!;
    }, (r) => ({ action: "withdraw", entity: "Bill", entityId: r.id, summary: `Withdrew bill ${r.billNo} from approval` }));
  }

  /** Cancel while nothing is paid. An approved bill is undone in the ledger with a mirror entry. */
  async cancel(id: string, reason: string) {
    const why = this.parse(z.string().trim().min(3, "Say why.").max(300), reason);
    return this.write("manage", async (tx) => {
      const [b] = await tx.select().from(expBills).where(eq(expBills.id, id)).for("update");
      if (!b) throw new NotFoundError("Bill");
      if (b.status === "cancelled") throw new ConflictError("This bill is already cancelled.");
      if (b.paidPaise > 0) throw new ConflictError("This bill has payments. Reverse them from the payments list first, then cancel it.");
      if (b.status === "pending") await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(and(eq(finApprovals.kind, "expenses.bill"), eq(finApprovals.refId, id), eq(finApprovals.status, "pending")));
      if (b.status === "approved") await this.reverse(tx, `expenses:bill:${id}`, `Cancelled bill ${b.billNo}: ${why}`);
      const [r] = await tx.update(expBills).set({ status: "cancelled", note: [b.note, `Cancelled: ${why}`].filter(Boolean).join("\n") }).where(eq(expBills.id, id)).returning();
      return r!;
    }, (r) => ({ action: "cancel", entity: "Bill", entityId: r.id, summary: `Cancelled bill ${r.billNo}` }));
  }
}
