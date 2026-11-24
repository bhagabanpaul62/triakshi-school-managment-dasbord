import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import type { PostLine } from "@smw/feature-finance/posting";
import { FeesBase, type Head } from "./base";
import { ChangeService } from "./changes";
import { openOf } from "./calc";
import { noteInput } from "./inputs";
import { feeInvoiceLines, feeInvoices, feeNotes } from "./schema";

export type Note = typeof feeNotes.$inferSelect;
type NoteLine = { lineId: string; amountPaise: number; headId?: string | null; label?: string };
export interface NoteSpec { invoiceId: string; kind: "credit" | "debit"; reasonType: Note["reasonType"]; reason: string; lines: NoteLine[] }

/**
 * Credit and debit notes: the only way to change an issued bill. A credit is capped at what is open on each line; a
 * waiver, write-off or correction needs a second person unless it is under the school's limit.
 */
export class NoteService extends FeesBase {
  /** Ask for a note. Under the limit (concession, waiver, write-off) it is applied now; otherwise it waits for approval `fees.note`. */
  async propose(input: unknown): Promise<Note> {
    this.authorize("concede", "write");
    const data = this.parse(noteInput, input);
    return this.write("concede", async (tx) => {
      const spec: NoteSpec = { invoiceId: data.invoiceId, kind: data.kind, reasonType: data.reasonType, reason: data.reason, lines: data.kind === "credit" ? data.lines! : [{ lineId: "", ...data.add!, amountPaise: data.add!.amountPaise }] };
      const changes = new ChangeService(this.ctx);
      await changes.assertNoneWaitingIn(tx, { invoiceId: data.invoiceId });
      const note = await this.recordIn(tx, spec);
      // A note that takes money off what is owed needs a second person above the school's limit, counting what this student has already had off alone; a debit note adds, so it applies at once.
      const lowers = note.kind === "credit" ? note.amountPaise : 0;
      if (await changes.mayApplyAloneIn(tx, note.studentId, lowers)) {
        await changes.recordDirectIn(tx, { kind: "note", invoiceId: note.invoiceId, studentId: note.studentId, reason: data.reason, lowersPaise: lowers });
        return this.applyIn(tx, note.id);
      }
      const [inv] = await tx.select({ number: feeInvoices.number, label: feeInvoices.label }).from(feeInvoices).where(eq(feeInvoices.id, note.invoiceId));
      await this.askApproval(tx, { kind: "fees.note", refType: "fee_note", refId: note.id, title: `${data.kind === "credit" ? "Credit" : "Debit"} note ${rupees(note.amountPaise)} on ${inv?.number ?? inv?.label}`, amountPaise: note.amountPaise, reason: data.reason, href: `/app/fees/invoices/${note.invoiceId}` });
      return note;
    }, (n) => ({ action: "propose", entity: "Fee note", entityId: n.id, summary: `${n.kind} note of ${rupees(n.amountPaise)} (${n.reasonType})` }));
  }

  /** Take a waiting note back. It stays on file as not approved and can be sent again with `resubmit`. */
  async withdraw(id: string): Promise<Note> {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      await this.withdrawRequest(tx, "fees.note", id);
      const [n] = await tx.update(feeNotes).set({ status: "rejected" }).where(eq(feeNotes.id, id)).returning();
      return n!;
    }, (n) => ({ action: "withdraw", entity: "Fee note", entityId: n.id, summary: "Withdrew a note request" }));
  }

  /** Send a refused or withdrawn note again, edited. The old request stays on file. */
  async resubmit(id: string, input: unknown): Promise<Note> {
    this.authorize("concede", "write");
    const [old] = await this.read("concede", (tx) => tx.select({ status: feeNotes.status }).from(feeNotes).where(eq(feeNotes.id, id)));
    if (!old) throw new NotFoundError("Note");
    if (old.status !== "rejected") throw new ConflictError("Only a note that was not approved can be edited and sent again.");
    return this.propose(input);
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.viewer(async (tx, own) => {
      const where = and(own ? inArray(feeNotes.studentId, own.length ? own : ["00000000-0000-0000-0000-000000000000"]) : undefined, q.filters.invoiceId ? eq(feeNotes.invoiceId, q.filters.invoiceId) : undefined, q.filters.studentId ? eq(feeNotes.studentId, q.filters.studentId) : undefined, q.filters.status ? eq(feeNotes.status, q.filters.status as Note["status"]) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select().from(feeNotes).where(where).orderBy(desc(feeNotes.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeNotes).where(where),
      ]);
      return toPage(await this.withApproval(tx, ["fees.note"], rows), Number(n?.n ?? 0), q);
    });
  }

  /** Save the request (status pending) after checking it against the bill as it stands. No permission check: the caller did it. */
  async recordIn(tx: Tx, spec: NoteSpec): Promise<Note> {
    const [inv] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, spec.invoiceId));
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "issued") throw new ConflictError("Only an issued bill can have a note.");
    // Locked before the note is written, so two requests for one student wait for each other instead of deadlocking.
    await this.lockStudents(tx, [inv.studentId]);
    const lines = spec.kind === "credit" ? await tx.select().from(feeInvoiceLines).where(eq(feeInvoiceLines.invoiceId, inv.id)) : [];
    if (spec.kind === "credit") {
      const seen = new Set<string>();
      for (const l of spec.lines) {
        const line = lines.find((x) => x.id === l.lineId);
        if (!line || seen.has(l.lineId)) throw new NotFoundError("Bill line");
        seen.add(l.lineId);
        if (l.amountPaise > openOf(line)) throw new ConflictError(`${line.label} has only ${rupees(Math.max(0, openOf(line)))} open, so ${rupees(l.amountPaise)} cannot be taken off.`);
        if (spec.reasonType === "concession" && line.kind !== "fee") throw new ConflictError(`${line.label} cannot take a concession.`);
      }
    }
    const [row] = await tx.insert(feeNotes).values({
      schoolId: this.ctx.schoolId, invoiceId: inv.id, studentId: inv.studentId, kind: spec.kind, reasonType: spec.reasonType, reason: spec.reason,
      amountPaise: spec.lines.reduce((s, l) => s + l.amountPaise, 0), lines: spec.lines, createdBy: this.ctx.userId,
    }).returning();
    return row!;
  }

  /** Record and apply in one go (settlements, revisions, concession approvals). */
  async issueIn(tx: Tx, spec: NoteSpec): Promise<Note> {
    return this.applyIn(tx, (await this.recordIn(tx, spec)).id);
  }

  /** Make a pending note real: change the lines, number it, post it. Re-checks the caps, so a bill that moved since the request refuses. */
  async applyIn(tx: Tx, noteId: string): Promise<Note> {
    const [n] = await tx.select().from(feeNotes).where(eq(feeNotes.id, noteId));
    if (!n) throw new NotFoundError("Note");
    if (n.status !== "pending") throw new ConflictError("This note was already decided.");
    await this.lockStudents(tx, [n.studentId]);
    const [inv] = await this.invoicesById(tx, [n.invoiceId], true);
    if (inv!.status !== "issued") throw new ConflictError("This bill is no longer open for a note.");
    const specLines = n.lines as NoteLine[];
    const date = todayIST();
    const heads = await this.headMap(tx, [...inv!.lines.map((l) => l.headId), ...specLines.map((l) => l.headId ?? null)]);
    const key = (lineKind: string, lineId: string) => (lineKind === "late" ? `fees:late:${lineId}` : `fees:invoice:${inv!.id}`);
    const out: PostLine[] = [];

    if (n.kind === "credit") {
      const posted = await this.posted(tx, inv!.lines.map((l) => key(l.kind, l.id)));
      for (const sl of specLines) {
        const line = inv!.lines.find((l) => l.id === sl.lineId);
        if (!line) throw new NotFoundError("Bill line");
        if (sl.amountPaise > openOf(line)) throw new ConflictError(`${line.label} has only ${rupees(Math.max(0, openOf(line)))} open now, so this note cannot be applied.`);
        if (!posted.has(key(line.kind, line.id))) continue;
        { const account = this.creditSide(n.reasonType, line, heads); out.push({ account, debit: sl.amountPaise, memo: line.label, ...this.party(account, n.studentId) }); }
      }
      await this.bump(tx, "credited_paise", specLines);
      const total = out.reduce((s, l) => s + (l.debit ?? 0), 0);
      if (total) out.push({ account: "student_dues", credit: total, party: { type: "student", id: n.studentId } });
    } else {
      const add = specLines[0]!;
      const head = add.headId ? heads.get(add.headId) : undefined;
      if (add.headId && !head) throw new NotFoundError("Fee head");
      const kind = head?.type === "deposit" ? "deposit" : "fee";
      const sort = inv!.lines.reduce((m, l) => Math.max(m, l.sort), 0) + 1;
      const [line] = await tx.insert(feeInvoiceLines).values({ schoolId: this.ctx.schoolId, invoiceId: inv!.id, headId: add.headId ?? null, kind, label: add.label ?? n.reason, amountPaise: add.amountPaise, sort }).returning();
      await this.refreshInvoiceTotals(tx, [inv!.id]);
      specLines[0] = { ...add, lineId: line!.id };
      if ((await this.posted(tx, [key("fee", line!.id)])).size) {
        out.push({ account: "student_dues", debit: add.amountPaise, party: { type: "student", id: n.studentId } }, { account: this.lineAccount({ kind, headId: add.headId ?? null }, heads), credit: add.amountPaise, memo: line!.label, ...this.party(this.lineAccount({ kind, headId: add.headId ?? null }, heads), n.studentId) });
      }
    }
    const number = await this.number(tx, "credit_note", date);
    const [row] = await tx.update(feeNotes).set({ status: "approved", number, issuedOn: date, lines: specLines }).where(eq(feeNotes.id, n.id)).returning();
    await this.post(tx, { date, sourceKey: `fees:note:${n.id}`, sourceType: "fee_note", sourceId: n.invoiceId, memo: `${n.kind === "credit" ? "Credit" : "Debit"} note ${number}: ${n.reason}`, lines: out });
    return row!;
  }

  /** Where the other side of a credit note lands. */
  private creditSide(reason: Note["reasonType"], line: { kind: string; headId: string | null }, heads: Map<string, Head>): PostLine["account"] {
    if (reason === "write_off") return "bad_debts";
    if (reason === "correction") return this.lineAccount(line, heads);
    return line.kind === "late" && reason === "waiver" ? "late_fee" : "concessions";
  }

  /** The approval handler's refusal: the note stays on file as rejected. */
  async rejectIn(tx: Tx, noteId: string) {
    await tx.update(feeNotes).set({ status: "rejected" }).where(and(eq(feeNotes.id, noteId), eq(feeNotes.status, "pending")));
  }
}

