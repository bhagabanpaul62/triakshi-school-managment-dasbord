import { accountCredits, and, creditNotes, eq, invoices, ne, payments, type Tx } from "@smw/db";
import { rupees, todayIST } from "@smw/feature-kit/money";

/** One thing that moved what the school owes. Positive = owes more, negative = owes less. */
export interface StatementEvent {
  at: Date; kind: "invoice" | "payment" | "tds" | "credit_note" | "refund" | "credit_used";
  ref: string; text: string; amountPaise: number; invoiceId?: string | null; creditNoteId?: string | null;
}
export interface StatementRow extends StatementEvent { debitPaise: number; creditPaise: number; balancePaise: number }
export interface Statement { from: string; to: string; openingPaise: number; closingPaise: number; debitPaise: number; creditPaise: number; rows: StatementRow[] }

/**
 * Running balance of what a school owes Triakshi, oldest first. Negative means Triakshi holds credit for the school.
 * Pure: give it every event and the period, and it works out the opening balance itself.
 */
export function buildStatement(events: StatementEvent[], from: string, to: string): Statement {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.getTime() - b.e.at.getTime() || a.i - b.i).map((x) => x.e);
  let balance = 0, opening = 0, debit = 0, credit = 0;
  const rows: StatementRow[] = [];
  for (const e of sorted) {
    const day = todayIST(e.at);
    if (day > to) break;
    balance += e.amountPaise;
    if (day < from) { opening = balance; continue; }
    const d = Math.max(0, e.amountPaise), c = Math.max(0, -e.amountPaise);
    debit += d; credit += c;
    rows.push({ ...e, debitPaise: d, creditPaise: c, balancePaise: balance });
  }
  return { from, to, openingPaise: opening, closingPaise: balance, debitPaise: debit, creditPaise: credit, rows };
}

/** Everything that moved one school's balance, read inside whatever transaction (school or console) the caller holds. */
export async function statementEvents(tx: Tx, schoolId: string): Promise<StatementEvent[]> {
  const [inv, pay, notes, used] = await Promise.all([
    tx.select().from(invoices).where(and(eq(invoices.schoolId, schoolId), ne(invoices.status, "draft"))),
    tx.select({ p: payments, number: invoices.number }).from(payments).leftJoin(invoices, eq(invoices.id, payments.invoiceId)).where(and(eq(payments.schoolId, schoolId), eq(payments.status, "success"))),
    tx.select({ n: creditNotes, number: invoices.number }).from(creditNotes).innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId)).where(eq(creditNotes.schoolId, schoolId)),
    tx.select({ c: accountCredits, number: invoices.number }).from(accountCredits).innerJoin(invoices, eq(invoices.id, accountCredits.invoiceId)).where(and(eq(accountCredits.schoolId, schoolId), eq(accountCredits.kind, "used"))),
  ]);
  const out: StatementEvent[] = [];
  for (const i of inv) out.push({ at: i.createdAt, kind: "invoice", ref: i.number, text: i.description, amountPaise: i.totalPaise, invoiceId: i.id });
  for (const { p, number } of pay) {
    const at = p.paidAt ?? p.createdAt;
    out.push({ at, kind: "payment", ref: number ?? "-", text: `Payment received (${p.method.replace("_", " ")})${p.reference ? `, ${p.reference}` : ""}`, amountPaise: -p.amountPaise, invoiceId: p.invoiceId });
    if (p.tdsPaise > 0) out.push({ at, kind: "tds", ref: number ?? "-", text: "Tax withheld by you (TDS)", amountPaise: -p.tdsPaise, invoiceId: p.invoiceId });
  }
  for (const { n, number } of notes) {
    out.push({ at: n.createdAt, kind: "credit_note", ref: n.number, text: `Credit note against ${number}: ${n.reason}`, amountPaise: -n.totalPaise, invoiceId: n.invoiceId, creditNoteId: n.id });
    if (n.refundedAt && n.settlement === "refund") out.push({ at: n.refundedAt, kind: "refund", ref: n.number, text: `Refund paid back${n.refundReference ? `, ${n.refundReference}` : ""}`, amountPaise: n.totalPaise, invoiceId: n.invoiceId, creditNoteId: n.id });
  }
  for (const { c, number } of used) out.push({ at: c.createdAt, kind: "credit_used", ref: number, text: `Account credit of ${rupees(-c.amountPaise)} used (no payment needed for this part)`, amountPaise: 0, invoiceId: c.invoiceId });
  return out;
}

export const loadStatement = async (tx: Tx, schoolId: string, from: string, to: string) => buildStatement(await statementEvents(tx, schoolId), from, to);
