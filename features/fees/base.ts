import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql, sum, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { MoneyService } from "@smw/feature-finance/base";
import type { PostLine } from "@smw/feature-finance/posting";
import { finApprovals, finJournals } from "@smw/feature-finance/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import feesFeature from "./feature";
import { allocatePlan, openOf, type CalcInvoice } from "./calc";
import { feeAdvances, feeAllocations, feeDueParts, feeHeads, feeInvoiceLines, feeInvoices } from "./schema";

export type Perm = keyof typeof feesFeature.permissions;
export type Invoice = typeof feeInvoices.$inferSelect;
export type InvoiceLine = typeof feeInvoiceLines.$inferSelect;
export type Head = typeof feeHeads.$inferSelect;
export interface Snapshot { studentName: string; admissionNo: string; classLabel: string; guardian: string | null }
export interface StudentLine { id: string; name: string; admissionNo: string; classId: string | null; sectionId: string | null; status: string; leftOn: string | null; classLabel: string }
/** An invoice with its lines and settlement parts, ready for the arithmetic in calc.ts. */
export interface InvoiceFull extends Invoice { lines: InvoiceLine[]; parts: { dueOn: string; amountPaise: number }[] }
/** Money that landed on one bill line. */
export interface Slice { invoiceId: string; lineId: string; lineKind: string; headId: string | null; studentId: string; amountPaise: number }

/** An id from a URL: anything that is not a uuid is simply not found (never a database error). */
export const asId = (v: string, what: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new NotFoundError(what); return v; };

/** A refusal on one field whose message already says what to do next (the form shows it by the field, the API returns it as the message). */
export const invalid = (field: string, message: string) => new ValidationError({ [field]: message }, message);

export const newToken = () => randomBytes(16).toString("hex");
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);
export const calcOf = (i: InvoiceFull, limit?: number): CalcInvoice => ({ id: i.id, dueDate: i.dueDate, parts: i.parts, lines: i.lines, limit });

/**
 * What every fee service shares: who may see which student, the current year, locking, the books of one bill, and the
 * single place that writes cached invoice totals and spreads money over bill lines.
 */
export abstract class FeesBase extends MoneyService<Perm> {
  protected readonly feature = feesFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Run a read as staff (all students) or as a student login (`own` = their student ids). */
  protected viewer<T>(fn: (tx: Tx, own: string[] | null) => Promise<T>): Promise<T> {
    const staff = this.can("read");
    return this.read(staff ? "read" : "self", async (tx) => fn(tx, staff ? null : await this.ownStudentIds(tx)));
  }

  protected async ownStudentIds(tx: Tx): Promise<string[]> {
    return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
  }

  protected assertVisible(own: string[] | null, studentId: string, what = "Student") {
    if (own && !own.includes(studentId)) throw new NotFoundError(what);
  }

  /** The login of each of these students. The student login is the family login, so notices go there. */
  protected async studentUsers(tx: Tx, studentIds: string[]): Promise<Map<string, string>> {
    if (!studentIds.length) return new Map();
    const rows = await tx.select({ id: students.id, userId: students.userId }).from(students).where(inArray(students.id, studentIds));
    return new Map(rows.flatMap((r) => (r.userId ? [[r.id, r.userId] as const] : [])));
  }

  protected async tell(tx: Tx, studentIds: string[], title: string, body: string, href = "/app/fees") {
    const logins = await this.studentUsers(tx, studentIds);
    return NotificationWriter.insert(tx, this.ctx.schoolId, [...logins.values()].map((userId) => ({ userId, kind: "fee_due" as const, title, body, href })));
  }

  protected async currentYear(tx: Tx) {
    const [year] = await tx.select().from(academicYears).orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)).limit(1);
    if (!year) throw new ConflictError("Set up the academic year first.");
    return year;
  }

  /** A year of this school (RLS hides others), or the current one. */
  protected async yearOr(tx: Tx, yearId?: string) {
    if (!yearId) return this.currentYear(tx);
    const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
    if (!year) throw new NotFoundError("Academic year");
    return year;
  }

  protected studentLines(tx: Tx, where?: SQL): Promise<StudentLine[]> {
    return tx.select({
      id: students.id, name: students.name, admissionNo: students.admissionNo, classId: students.classId, sectionId: students.sectionId, status: students.status, leftOn: students.leftOn,
      classLabel: sql<string>`coalesce(${classes.name} || coalesce('-' || ${sections.name}, ''), '-')`,
    }).from(students).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
      .where(where).orderBy(asc(classes.grade), asc(sections.name), asc(students.name));
  }

  protected async oneStudent(tx: Tx, id: string): Promise<StudentLine> {
    const [row] = await this.studentLines(tx, eq(students.id, id));
    if (!row) throw new NotFoundError("Student");
    return row;
  }

  /** Who a document was for, as they are today. */
  protected async snapshot(tx: Tx, s: StudentLine): Promise<Snapshot> {
    const [g] = await tx.select({ name: guardians.name }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(eq(studentGuardians.studentId, s.id)).orderBy(desc(studentGuardians.isPrimary), asc(guardians.name)).limit(1);
    return { studentName: s.name, admissionNo: s.admissionNo, classLabel: s.classLabel, guardian: g?.name ?? null };
  }

  /** Brothers and sisters: students who share a guardian (the student first). */
  protected async familyOf(tx: Tx, studentId: string): Promise<string[]> {
    const mine = tx.select({ g: studentGuardians.guardianId }).from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    const rows = await tx.selectDistinct({ id: studentGuardians.studentId }).from(studentGuardians).where(inArray(studentGuardians.guardianId, mine));
    return [studentId, ...rows.map((r) => r.id).filter((id) => id !== studentId)];
  }

  /** Lock students, always in id order, so two cashiers can never wait on each other. */
  protected async lockStudents(tx: Tx, studentIds: string[]) {
    const want = [...new Set(studentIds)];
    const got = want.length ? await tx.select({ id: students.id }).from(students).where(inArray(students.id, want)).orderBy(asc(students.id)).for("update") : [];
    if (got.length !== want.length) throw new NotFoundError("Student");
  }

  /** Bills with their lines and parts. `lock` takes row locks in id order (students first, by the caller). */
  protected async loadInvoices(tx: Tx, where: SQL | undefined, lock = false): Promise<InvoiceFull[]> {
    const q = tx.select().from(feeInvoices).where(where).orderBy(asc(feeInvoices.id));
    const rows = lock ? await q.for("update") : await q;
    if (!rows.length) return [];
    const idList = rows.map((r) => r.id);
    const [lines, parts] = await Promise.all([
      tx.select().from(feeInvoiceLines).where(inArray(feeInvoiceLines.invoiceId, idList)).orderBy(asc(feeInvoiceLines.sort), asc(feeInvoiceLines.id)),
      tx.select().from(feeDueParts).where(inArray(feeDueParts.invoiceId, idList)).orderBy(asc(feeDueParts.dueOn)),
    ]);
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.invoiceId === r.id), parts: parts.filter((p) => p.invoiceId === r.id) }));
  }

  protected async invoicesById(tx: Tx, invoiceIds: string[], lock = false): Promise<InvoiceFull[]> {
    const rows = await this.loadInvoices(tx, inArray(feeInvoices.id, invoiceIds), lock);
    if (rows.length !== new Set(invoiceIds).size) throw new NotFoundError("Invoice");
    return rows;
  }

  /** The ONLY writer of an invoice's cached totals: every change to lines ends here, in the same transaction. */
  protected async refreshInvoiceTotals(tx: Tx, invoiceIds: string[]) {
    if (!invoiceIds.length) return;
    await tx.execute(sql`
      update fee_invoices i set gross_paise = s.gross, late_paise = s.late, concession_paise = s.conc, credited_paise = s.cred, paid_paise = s.paid, updated_at = now()
      from (select invoice_id, coalesce(sum(amount_paise) filter (where kind <> 'late'), 0) gross, coalesce(sum(amount_paise) filter (where kind = 'late'), 0) late,
                   coalesce(sum(concession_paise), 0) conc, coalesce(sum(credited_paise), 0) cred, coalesce(sum(paid_paise), 0) paid
            from fee_invoice_lines where invoice_id in (${ids([...new Set(invoiceIds)])}) group by invoice_id) s
      where i.id = s.invoice_id`);
  }

  /** Add to the paid (or credited) column of lines, then refresh the bills' totals. The line check refuses overpaying. */
  protected async bump(tx: Tx, column: "paid_paise" | "credited_paise", amounts: { lineId: string; amountPaise: number }[]) {
    if (!amounts.length) return;
    const merged = new Map<string, number>();
    for (const a of amounts) merged.set(a.lineId, (merged.get(a.lineId) ?? 0) + a.amountPaise);
    const values = sql.join([...merged].map(([id, n]) => sql`(${id}::uuid, ${n}::bigint)`), sql`, `);
    const rows = await tx.execute<{ invoice_id: string }>(sql`update fee_invoice_lines l set ${sql.raw(column)} = l.${sql.raw(column)} + v.n, updated_at = now() from (values ${values}) v(id, n) where l.id = v.id returning l.invoice_id`);
    await this.refreshInvoiceTotals(tx, [...rows].map((r) => r.invoice_id));
  }

  /** Put money on bill lines and record where each rupee went. `receiptId` null = an advance or deposit was used. */
  protected async applyParts(tx: Tx, parts: { lineId: string; amountPaise: number }[], o: { receiptId: string | null; date: string }): Promise<Slice[]> {
    if (!parts.length) return [];
    const info = await tx.select({ lineId: feeInvoiceLines.id, invoiceId: feeInvoiceLines.invoiceId, lineKind: feeInvoiceLines.kind, headId: feeInvoiceLines.headId, studentId: feeInvoices.studentId })
      .from(feeInvoiceLines).innerJoin(feeInvoices, eq(feeInvoices.id, feeInvoiceLines.invoiceId)).where(inArray(feeInvoiceLines.id, parts.map((p) => p.lineId)));
    const by = new Map(info.map((i) => [i.lineId, i]));
    const slices = parts.map((p) => ({ ...by.get(p.lineId)!, amountPaise: p.amountPaise }));
    await this.bump(tx, "paid_paise", parts);
    await tx.insert(feeAllocations).values(slices.map((s) => ({ schoolId: this.ctx.schoolId, receiptId: o.receiptId, invoiceLineId: s.lineId, studentId: s.studentId, amountPaise: s.amountPaise, date: o.date })));
    return slices;
  }

  /** Take back the allocations of a receipt (or all that used an advance on given lines). Returns what was undone. */
  protected async undoAllocations(tx: Tx, where: SQL): Promise<Slice[]> {
    const rows = await tx.select({ id: feeAllocations.id, lineId: feeAllocations.invoiceLineId, amountPaise: feeAllocations.amountPaise, studentId: feeAllocations.studentId, invoiceId: feeInvoiceLines.invoiceId, lineKind: feeInvoiceLines.kind, headId: feeInvoiceLines.headId })
      .from(feeAllocations).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId)).where(and(isNull(feeAllocations.undoneAt), where));
    if (!rows.length) return [];
    await tx.update(feeAllocations).set({ undoneAt: new Date() }).where(inArray(feeAllocations.id, rows.map((r) => r.id)));
    await this.bump(tx, "paid_paise", rows.map((r) => ({ lineId: r.lineId, amountPaise: -r.amountPaise })));
    return rows.map(({ id: _id, lineId, ...s }) => ({ ...s, lineId }));
  }

  /** Take back a request that waits for approval. Only who asked (or an admin) may; the request stays on file as withdrawn. */
  protected async withdrawRequest(tx: Tx, kind: string, refId: string) {
    const [a] = await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, kind), eq(finApprovals.refId, refId), eq(finApprovals.status, "pending"))).for("update");
    if (!a) throw new ConflictError("This is not waiting for approval any more, so there is nothing to withdraw. Open the request to see what happened.");
    if (a.requestedBy !== this.ctx.userId && this.ctx.role !== "admin") throw new ForbiddenError("Only the person who asked can withdraw this.");
    await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(eq(finApprovals.id, a.id));
  }

  // ---------- posting ----------

  protected async headMap(tx: Tx, headIds: (string | null)[]) {
    const want = [...new Set(headIds.filter((h): h is string => !!h))];
    return new Map((want.length ? await tx.select().from(feeHeads).where(inArray(feeHeads.id, want)) : []).map((h) => [h.id, h]));
  }

  /** A line on a student's own list (deposits) carries the student, so the list can be checked against the ledger. */
  protected party(account: PostLine["account"], studentId: string): Pick<PostLine, "party"> {
    return account === "deposits_payable" ? { party: { type: "student", id: studentId } } : {};
  }

  /** The ledger account a bill line is income (or liability) in. */
  protected lineAccount(l: { kind: string; headId: string | null }, heads: Map<string, Head>): PostLine["account"] {
    if (l.kind === "late") return "late_fee";
    if (l.kind === "bounce") return "other_income";
    if (l.kind === "opening") return "opening";
    const head = l.headId ? heads.get(l.headId) : undefined;
    if (l.kind === "deposit" || head?.type === "deposit") return "deposits_payable";
    return head?.accountId ? { id: head.accountId } : "fee_income";
  }

  /** Which of these source keys have a journal already (a bill that was posted at issue is paid against Student dues, one that was not is paid against income). */
  protected async posted(tx: Tx, keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    return new Set((await tx.select({ k: finJournals.sourceKey }).from(finJournals).where(inArray(finJournals.sourceKey, keys))).map((r) => r.k));
  }

  /**
   * The credit side of money applied to bill lines: Student dues (per student) where the bill was posted at issue,
   * the income account where it was not (cash basis).
   */
  protected async creditLines(tx: Tx, slices: Slice[], memo?: string): Promise<PostLine[]> {
    if (!slices.length) return [];
    const key = (s: Slice) => (s.lineKind === "late" ? `fees:late:${s.lineId}` : `fees:invoice:${s.invoiceId}`);
    const [booked, heads] = await Promise.all([this.posted(tx, [...new Set(slices.map(key))]), this.headMap(tx, slices.map((s) => s.headId))]);
    const dues = new Map<string, number>(), other = new Map<string, PostLine & { credit: number }>();
    for (const s of slices) {
      if (booked.has(key(s))) { dues.set(s.studentId, (dues.get(s.studentId) ?? 0) + s.amountPaise); continue; }
      const account = this.lineAccount({ kind: s.lineKind, headId: s.headId }, heads);
      const k = typeof account === "string" ? account : account.id;
      other.set(`${k}:${account === "deposits_payable" ? s.studentId : ""}`, { account, credit: (other.get(`${k}:${account === "deposits_payable" ? s.studentId : ""}`)?.credit ?? 0) + s.amountPaise, ...this.party(account, s.studentId) });
    }
    return [
      ...[...dues].map(([id, credit]): PostLine => ({ account: "student_dues", credit, party: { type: "student", id }, memo })),
      ...[...other.values()].map((o): PostLine => ({ ...o, memo })),
    ];
  }

  // ---------- advances and deposits ----------

  /** The advance a student holds: the sum of their list (deposit rows are a different list). */
  protected async advanceOf(tx: Tx, studentId: string): Promise<number> {
    const [r] = await tx.select({ v: sum(feeAdvances.amountPaise) }).from(feeAdvances).where(and(eq(feeAdvances.studentId, studentId), ne(feeAdvances.kind, "deposit")));
    return Number(r?.v ?? 0);
  }

  /** Deposit the school holds for a student: what was paid on deposit lines plus its own list (opening, refunds, uses). */
  protected async depositHeld(tx: Tx, studentId: string): Promise<number> {
    const [[paid], [list]] = await Promise.all([
      tx.select({ v: sum(feeAllocations.amountPaise) }).from(feeAllocations).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId))
        .where(and(eq(feeAllocations.studentId, studentId), isNull(feeAllocations.undoneAt), eq(feeInvoiceLines.kind, "deposit"))),
      tx.select({ v: sum(feeAdvances.amountPaise) }).from(feeAdvances).where(and(eq(feeAdvances.studentId, studentId), eq(feeAdvances.kind, "deposit"))),
    ]);
    return Number(paid?.v ?? 0) + Number(list?.v ?? 0);
  }

  /** Put a student's advance on their open bills, oldest first (a school setting; on by default). Students must already be locked. */
  protected async autoUseAdvance(tx: Tx, studentIds: string[], date = todayIST()) {
    const settings = await this.settings(tx);
    if (!settings.autoUseAdvance) return;
    for (const studentId of [...new Set(studentIds)].sort()) {
      const balance = await this.advanceOf(tx, studentId);
      if (balance <= 0) continue;
      const open = await this.loadInvoices(tx, and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.status, "issued")), true);
      const plan = allocatePlan(open.filter((i) => openOf(i) > 0).map((i) => calcOf(i)), balance, { lateFirst: settings.lateFeeFirst });
      const used = plan.parts.reduce((s, p) => s + p.amountPaise, 0);
      if (used > 0) await this.spend(tx, studentId, "advance", plan.parts, date, "Advance used on open bills");
    }
  }

  /** Pay bill lines from a student's advance or deposit: list row, allocations, and the posting. */
  protected async spend(tx: Tx, studentId: string, from: "advance" | "deposit", parts: { lineId: string; amountPaise: number }[], date: string, note: string) {
    const amount = parts.reduce((s, p) => s + p.amountPaise, 0);
    const [row] = await tx.insert(feeAdvances).values({ schoolId: this.ctx.schoolId, studentId, kind: from === "advance" ? "used" : "deposit", amountPaise: -amount, note, date }).returning({ id: feeAdvances.id });
    const slices = await this.applyParts(tx, parts, { receiptId: null, date });
    await this.post(tx, {
      date, sourceKey: `fees:${from}-used:${row!.id}`, sourceType: "fee_student", sourceId: studentId, memo: note,
      lines: [{ account: from === "advance" ? "student_advances" : "deposits_payable", debit: amount, party: { type: "student", id: studentId } }, ...(await this.creditLines(tx, slices))],
    });
    return amount;
  }
}
