import { z } from "zod";
import { and, asc, count, creditNotes, desc, eq, ilike, invoices, isNull, or, schools, sql, subscriptions, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { services, trySend } from "@smw/integrations";
import { creditableOf, refundableOf, splitCredit } from "./amounts";
import { schoolContact } from "./contact";
import { AccountCredits } from "./credits";
import { CreditNotePdf } from "./credit-note-pdf";
import { cancelInvoiceInput, creditNoteInput, refundInput } from "./inputs";
import { CreditNoteNumberer } from "./invoice-number";
import { Settlement } from "./settlement";

export type CreditNoteRow = typeof creditNotes.$inferSelect;
export interface ConsoleCreditNoteRow extends CreditNoteRow { schoolName: string; invoiceNumber: string }
type CreditNoteInput = z.infer<typeof creditNoteInput>;

/** Issues credit notes and moves their money. One transaction: the note, the invoice, the account credit and the audit line. */
class CreditNoteIssuer {
  private static readonly numberer = new CreditNoteNumberer();

  static async issue(tx: Tx, staffId: string | null, input: CreditNoteInput, now: Date) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "issued" && inv.status !== "paid") throw new ConflictError("This invoice was cancelled, so there is nothing left to credit.");
    const creditable = creditableOf(inv);
    if (input.amountPaise > creditable) {
      throw new ValidationError({ amountPaise: creditable > 0 ? `Only ${rupees(creditable)} of this invoice is left to credit.` : "This invoice has already been credited in full." });
    }

    const settlement = this.settlementFor(inv.status, input);
    if (settlement === "refund" && input.amountPaise > refundableOf(inv)) {
      throw new ValidationError({ settle: `Only ${rupees(Math.max(0, refundableOf(inv)))} was paid in cash on this invoice. Keep the credit on the account instead.` });
    }

    const [prior] = await tx.select({
      taxable: sql<number>`coalesce(sum(${creditNotes.taxablePaise}), 0)::bigint`, cgst: sql<number>`coalesce(sum(${creditNotes.cgstPaise}), 0)::bigint`,
      sgst: sql<number>`coalesce(sum(${creditNotes.sgstPaise}), 0)::bigint`, igst: sql<number>`coalesce(sum(${creditNotes.igstPaise}), 0)::bigint`,
    }).from(creditNotes).where(eq(creditNotes.invoiceId, inv.id));
    const split = splitCredit({
      taxablePaise: inv.taxablePaise - Number(prior!.taxable), cgstPaise: inv.cgstPaise - Number(prior!.cgst),
      sgstPaise: inv.sgstPaise - Number(prior!.sgst), igstPaise: inv.igstPaise - Number(prior!.igst), totalPaise: creditable,
    }, input.amountPaise);

    const { number, financialYear } = await this.numberer.next(tx, now);
    const recorded = settlement === "refund" && input.refundMethod;
    const [note] = await tx.insert(creditNotes).values({
      schoolId: inv.schoolId, invoiceId: inv.id, number, financialYear, kind: input.kind, reason: input.reason, ...split, settlement, issuedBy: staffId,
      ...(recorded ? { refundMethod: input.refundMethod, refundReference: input.refundReference ?? null, refundedOn: input.refundedOn ?? todayIST(now), refundedAt: now, refundedBy: staffId } : {}),
    }).returning();
    await tx.update(invoices).set({ creditedPaise: inv.creditedPaise + input.amountPaise }).where(eq(invoices.id, inv.id));

    if (settlement === "credit") {
      await AccountCredits.add(tx, { schoolId: inv.schoolId, amountPaise: input.amountPaise, kind: "credit_note", sourceKey: `note:${note!.id}`, invoiceId: inv.id, creditNoteId: note!.id });
    } else if (settlement === "adjusted") {
      await this.adjustUnpaid(tx, { ...inv, creditedPaise: inv.creditedPaise + input.amountPaise }, note!.id, now);
    }
    return { note: note!, invoice: inv };
  }

  /** Unpaid invoice: it owes less. Credit already spent on it that no longer fits goes back to the account. */
  private static async adjustUnpaid(tx: Tx, inv: typeof invoices.$inferSelect, noteId: string, now: Date) {
    const left = inv.totalPaise - inv.creditedPaise;
    const applied = Math.min(inv.creditAppliedPaise, left);
    if (applied < inv.creditAppliedPaise) {
      await AccountCredits.add(tx, { schoolId: inv.schoolId, amountPaise: inv.creditAppliedPaise - applied, kind: "released", sourceKey: `release:${noteId}`, invoiceId: inv.id, creditNoteId: noteId });
      await tx.update(invoices).set({ creditAppliedPaise: applied }).where(eq(invoices.id, inv.id));
    }
    if (left === 0) {
      await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, inv.id));
      if (inv.subscriptionId) await tx.update(subscriptions).set({ status: "cancelled" }).where(and(eq(subscriptions.id, inv.subscriptionId), eq(subscriptions.status, "pending")));
    } else if (left - applied === 0) {
      await Settlement.markPaid(tx, inv, now); // account credit already covers what is left
    }
  }

  private static settlementFor(status: "issued" | "paid", input: CreditNoteInput): "adjusted" | "refund" | "credit" {
    if (status === "issued") return "adjusted";
    if (input.kind === "goodwill") return "credit";
    if (input.kind === "refund") return "refund";
    if (!input.settle) throw new ValidationError({ settle: "Choose whether the money goes back or stays as credit." });
    return input.settle;
  }
}

/** Console: credit notes, cancelling an unpaid invoice, and recording refunds paid by hand (no gateway refund call). */
export class CreditNoteService extends PlatformService {
  async issue(input: unknown, now = new Date()) {
    this.require("owner", "support");
    const data = this.parse(creditNoteInput, input);
    const r = await this.tx(async (tx) => {
      const out = await CreditNoteIssuer.issue(tx, this.ctx.staffId, data, now);
      await this.audit(tx, "billing.credit_note_issued", `Credit note ${out.note.number} for invoice ${out.invoice.number} (${rupees(out.note.totalPaise)})`, out.note.schoolId, { creditNoteId: out.note.id, settlement: out.note.settlement });
      return out;
    });
    await this.email(r.note.id);
    return r.note;
  }

  /** An unpaid invoice raised by mistake: a credit note for all of it, and the invoice becomes void. */
  async cancelInvoice(input: unknown, now = new Date()) {
    this.require("owner", "support");
    const data = this.parse(cancelInvoiceInput, input);
    const r = await this.tx(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, data.invoiceId)).for("update");
      if (!inv) throw new NotFoundError("Invoice");
      if (inv.status === "paid") throw new ConflictError("A paid invoice cannot be cancelled. Issue a credit note for the part to correct.");
      if (inv.status !== "issued") throw new ConflictError("This invoice is already cancelled.");
      const out = await CreditNoteIssuer.issue(tx, this.ctx.staffId, { invoiceId: inv.id, amountPaise: creditableOf(inv), kind: "correction", reason: data.reason }, now);
      await this.audit(tx, "billing.invoice_cancelled", `Invoice ${inv.number} cancelled by credit note ${out.note.number}`, inv.schoolId, { creditNoteId: out.note.id, invoiceId: inv.id });
      return out;
    });
    await this.email(r.note.id);
    return r.note;
  }

  /** The money has gone back to the school; write down how, once. */
  async recordRefund(input: unknown, now = new Date()) {
    this.require("owner");
    const data = this.parse(refundInput, input);
    return this.tx(async (tx) => {
      const [note] = await tx.select().from(creditNotes).where(eq(creditNotes.id, data.creditNoteId)).for("update");
      if (!note) throw new NotFoundError("Credit note");
      if (note.settlement !== "refund") throw new ConflictError("This credit note is not a refund.");
      if (note.refundedAt) throw new ConflictError("This refund is already recorded.");
      await tx.update(creditNotes).set({ refundMethod: data.method, refundReference: data.reference ?? null, refundedOn: data.paidOn ?? todayIST(now), refundedAt: now, refundedBy: this.ctx.staffId }).where(eq(creditNotes.id, note.id));
      await this.audit(tx, "billing.refund_recorded", `Refund of ${rupees(note.totalPaise)} for ${note.number} recorded (${data.method.replace("_", " ")})`, note.schoolId, { creditNoteId: note.id, reference: data.reference ?? null });
      return { id: note.id };
    });
  }

  async list(query: ListQuery = {}): Promise<Page<ConsoleCreditNoteRow>> {
    const q = listQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const f = q.filters;
      const where = and(
        f.schoolId && z.uuid().safeParse(f.schoolId).success ? eq(creditNotes.schoolId, f.schoolId) : undefined,
        f.invoiceId && z.uuid().safeParse(f.invoiceId).success ? eq(creditNotes.invoiceId, f.invoiceId) : undefined,
        f.settlement === "refund" || f.settlement === "credit" || f.settlement === "adjusted" ? eq(creditNotes.settlement, f.settlement) : undefined,
        f.refund === "due" ? and(eq(creditNotes.settlement, "refund"), isNull(creditNotes.refundedAt)) : undefined,
        f.refund === "paid" ? and(eq(creditNotes.settlement, "refund"), sql`${creditNotes.refundedAt} is not null`) : undefined,
        q.q ? or(ilike(creditNotes.number, `%${q.q}%`), ilike(schools.name, `%${q.q}%`), ilike(invoices.number, `%${q.q}%`)) : undefined,
      );
      const from = () => tx.select({ n: count() }).from(creditNotes).innerJoin(schools, eq(schools.id, creditNotes.schoolId)).innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId));
      const [rows, total] = await Promise.all([
        tx.select({ note: creditNotes, schoolName: schools.name, invoiceNumber: invoices.number }).from(creditNotes)
          .innerJoin(schools, eq(schools.id, creditNotes.schoolId)).innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
          .where(where).orderBy(desc(creditNotes.createdAt), asc(creditNotes.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        from().where(where),
      ]);
      return toPage(rows.map((r) => ({ ...r.note, schoolName: r.schoolName, invoiceNumber: r.invoiceNumber })), Number(total[0]?.n ?? 0), q);
    });
  }

  async pdf(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Credit note");
    return this.tx((tx) => CreditNotes.pdf(tx, id));
  }

  /** Mail the note to the school. A mail failure must not undo the note, so it is only logged and the page can resend. */
  async email(id: string): Promise<boolean> {
    const sent = await this.tx(async (tx) => {
      const [note] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id)).limit(1);
      if (!note) throw new NotFoundError("Credit note");
      const c = await schoolContact(tx, note.schoolId);
      if (!c) return false;
      const pdf = await CreditNotes.pdf(tx, id);
      const subject = `Credit note ${note.number} from Triakshi`;
      const body = `We have issued credit note ${note.number} for ${rupees(note.totalPaise)} against your invoice. It is attached, and you can also download it from Billing.`;
      const ok = await trySend(services().email, { to: c.to, subject, text: body, attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }] });
      if (ok) await tx.update(creditNotes).set({ emailedAt: new Date() }).where(eq(creditNotes.id, id));
      return ok;
    });
    return sent;
  }
}

/** Reads shared by the console and the school (the caller supplies a transaction already scoped as it should be). */
export class CreditNotes {
  static async pdf(tx: Tx, id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const [note] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id)).limit(1);
    if (!note) throw new NotFoundError("Credit note");
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, note.invoiceId)).limit(1);
    const [school] = await tx.select().from(schools).where(eq(schools.id, note.schoolId)).limit(1);
    if (!inv || !school) throw new NotFoundError("Credit note");
    return { filename: `${note.number.replace(/\//g, "-")}.pdf`, bytes: await CreditNotePdf.render(note, inv, school) };
  }
}
