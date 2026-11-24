import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { addMonths, monthStart } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { day, paiseAmount } from "@smw/feature-finance/services/common";
import { repaid } from "../compute";
import { PayrollService } from "../base";
import { payLoanRepayments, payLoans } from "../schema";

export type Loan = typeof payLoans.$inferSelect;
export type LoanRow = Loan & { name: string; employeeId: string; balancePaise: number; recoveredPaise: number };
const requestInput = z.object({ userId: z.uuid().optional(), amountPaise: paiseAmount, emiPaise: paiseAmount, startsOn: day, reason: z.string().trim().min(3, "Say what the loan is for.").max(200) })
  .refine((v) => v.emiPaise <= v.amountPaise, { path: ["emiPaise"], message: "The monthly instalment cannot be more than the loan." });
const giveInput = z.object({ cashAccountId: z.uuid().optional(), date: day.optional() });

/** The months a loan will still be recovered in: from the month after the last recovery (or the start), at most the EMI each. */
export function schedule(balancePaise: number, emiPaise: number, from: string): { month: string; paise: number; left: number }[] {
  const out: { month: string; paise: number; left: number }[] = [];
  let left = balancePaise, m = monthStart(from);
  while (left > 0 && out.length < 600) { const paise = Math.min(emiPaise, left); left -= paise; out.push({ month: m, paise, left }); m = addMonths(m, 1); }
  return out;
}

export class LoanService extends PayrollService {
  async list(query: ListQuery = {}): Promise<Page<LoanRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("self", async (tx) => {
      const all = !!this.can("read");
      const rows = await tx.select().from(payLoans).where(and(all ? undefined : eq(payLoans.userId, this.ctx.userId), q.filters.status ? eq(payLoans.status, q.filters.status as Loan["status"]) : undefined)).orderBy(desc(payLoans.createdAt));
      const people = await this.people(tx, [...new Set(rows.map((r) => r.userId))]);
      const paid = await repaid(tx, rows.map((r) => r.id));
      const needle = q.q?.toLowerCase();
      const full = rows.map((r): LoanRow => ({ ...r, name: people.get(r.userId)?.name ?? "", employeeId: people.get(r.userId)?.employeeId ?? "", recoveredPaise: paid.get(r.id) ?? 0, balancePaise: Number(r.amountPaise) - (paid.get(r.id) ?? 0) }))
        .filter((r) => !needle || `${r.name} ${r.employeeId}`.toLowerCase().includes(needle));
      return toPage(full.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), full.length, q);
    });
  }

  async get(id: string) {
    return this.read("self", async (tx) => {
      const [loan] = await tx.select().from(payLoans).where(eq(payLoans.id, id));
      if (!loan) throw new NotFoundError("Loan");
      this.assertCanSee(loan.userId);
      const [repayments, person] = await Promise.all([tx.select().from(payLoanRepayments).where(eq(payLoanRepayments.loanId, id)).orderBy(payLoanRepayments.date, payLoanRepayments.createdAt), this.people(tx, [loan.userId])]);
      const recovered = repayments.reduce((a, r) => a + Number(r.amountPaise), 0), balance = Number(loan.amountPaise) - recovered;
      const next = loan.status === "active" && loan.givenOn ? schedule(balance, Number(loan.emiPaise), repayments.length ? addMonths(repayments.at(-1)!.date, 1) : loan.startsOn) : [];
      return { loan, person: person.get(loan.userId)!, repayments, balancePaise: balance, recoveredPaise: recovered, schedule: next };
    });
  }

  /** Ask for a loan. A person may ask for their own; payroll staff may ask for anyone. Either way an admin approves before any money moves. */
  async request(input: unknown) {
    const d = this.parse(requestInput, input);
    const userId = d.userId ?? this.ctx.userId;
    if (userId !== this.ctx.userId) this.authorize("manage", "write"); else this.authorize("self", "write");
    return this.write(userId === this.ctx.userId ? "self" : "manage", async (tx) => {
      if (!(await this.people(tx, [userId])).has(userId)) throw new NotFoundError("Person");
      const [loan] = await tx.insert(payLoans).values({ schoolId: this.ctx.schoolId, userId, amountPaise: d.amountPaise, emiPaise: d.emiPaise, startsOn: d.startsOn, reason: d.reason, createdBy: this.ctx.userId }).returning();
      const name = (await this.people(tx, [userId])).get(userId)!.name;
      const approval = await this.askApproval(tx, { kind: "payroll.loan", refType: "pay_loan", refId: loan!.id, title: `Loan for ${name}`, amountPaise: d.amountPaise, reason: d.reason, href: `/app/payroll/loans` });
      return { loan: loan!, approvalId: approval.id };
    }, (r) => ({ action: "request", entity: "PayLoan", entityId: r.loan.id, summary: "Asked for a staff loan", meta: { amountPaise: r.loan.amountPaise } }));
  }

  /** Hand over the money of an approved loan: staff loans up, cash or bank down. */
  async give(id: string, input: unknown = {}) {
    this.authorize("manage", "write");
    const d = this.parse(giveInput, input);
    return this.write("manage", async (tx) => {
      const [loan] = await tx.select().from(payLoans).where(eq(payLoans.id, id)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.status === "pending") throw new ConflictError("This loan is waiting for approval.");
      if (loan.status !== "active" || loan.givenOn) throw new ConflictError(loan.givenOn ? "The money for this loan was already given." : "This loan cannot be given.");
      const date = await this.moneyDate(tx, d.date);
      const acc = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: "bank" });
      await this.post(tx, { date, sourceKey: `payroll:loan:${id}`, sourceType: "payroll_loan", sourceId: id, memo: "Staff loan given", lines: [{ account: "staff_loans", debit: Number(loan.amountPaise), party: { type: "staff", id: loan.userId } }, { account: { id: acc.accountId }, credit: Number(loan.amountPaise) }] });
      return (await tx.update(payLoans).set({ givenOn: date, cashAccountId: acc.id }).where(eq(payLoans.id, id)).returning())[0]!;
    }, (l) => ({ action: "give", entity: "PayLoan", entityId: l.id, summary: "Gave a staff loan", meta: { amountPaise: l.amountPaise } }));
  }

  async pause(id: string, input: unknown) {
    const until = this.parse(z.object({ until: day }), input).until;
    return this.write("manage", async (tx) => {
      const [loan] = await tx.select().from(payLoans).where(eq(payLoans.id, id)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.status !== "active") throw new ConflictError("Only a running loan can be paused.");
      return (await tx.update(payLoans).set({ status: "paused", pausedUntil: until }).where(eq(payLoans.id, id)).returning())[0]!;
    }, (l) => ({ action: "pause", entity: "PayLoan", entityId: l.id, summary: `Paused a loan until ${until}` }));
  }

  async resume(id: string) {
    return this.write("manage", async (tx) => {
      const [loan] = await tx.select().from(payLoans).where(eq(payLoans.id, id)).for("update");
      if (!loan || loan.status !== "paused") throw new ConflictError("This loan is not paused.");
      return (await tx.update(payLoans).set({ status: "active", pausedUntil: null }).where(eq(payLoans.id, id)).returning())[0]!;
    }, (l) => ({ action: "resume", entity: "PayLoan", entityId: l.id, summary: "Resumed a loan" }));
  }

  /** The person pays back some or all of what is left, in cash or by bank, outside salary. */
  async payBack(id: string, input: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(z.object({ amountPaise: paiseAmount.optional(), cashAccountId: z.uuid().optional(), date: day.optional() }), input);
    return this.write("manage", async (tx) => {
      const [loan] = await tx.select().from(payLoans).where(eq(payLoans.id, id)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (!loan.givenOn || loan.status === "closed") throw new ConflictError("There is nothing to pay back on this loan.");
      const balance = Number(loan.amountPaise) - (await repaid(tx, [id])).get(id)!;
      const amount = d.amountPaise ?? balance;
      if (amount > balance) throw new ValidationError({ amountPaise: `Only ${balance / 100} rupees are left on this loan.` });
      const date = await this.moneyDate(tx, d.date);
      const acc = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: "bank" });
      const [r] = await tx.insert(payLoanRepayments).values({ schoolId: this.ctx.schoolId, loanId: id, date, amountPaise: amount }).returning();
      await this.post(tx, { date, sourceKey: `payroll:loan-payback:${r!.id}`, sourceType: "payroll_loan", sourceId: id, memo: "Staff loan paid back", lines: [{ account: { id: acc.accountId }, debit: amount }, { account: "staff_loans", credit: amount, party: { type: "staff", id: loan.userId } }] });
      if (amount === balance) await tx.update(payLoans).set({ status: "closed" }).where(eq(payLoans.id, id));
      return { paidPaise: amount, closed: amount === balance };
    }, (r) => ({ action: "pay_back", entity: "PayLoan", entityId: id, summary: r.closed ? "Loan closed early" : "Part of a loan paid back", meta: { amountPaise: r.paidPaise } }));
  }

  /** Open balances of staff loans for the ledger check. */
  async outstanding(): Promise<number> {
    return this.read("read", async (tx) => {
      const ids = (await tx.select({ id: payLoans.id }).from(payLoans).where(sql`${payLoans.givenOn} is not null`)).map((r) => r.id);
      const [given] = await tx.select({ v: sql<string>`coalesce(sum(${payLoans.amountPaise}), 0)` }).from(payLoans).where(inArray(payLoans.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]));
      return Number(given?.v ?? 0) - [...(await repaid(tx, ids)).values()].reduce((a, b) => a + b, 0);
    });
  }
}
