import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { parseSheet, SheetError, type SheetRows } from "@smw/integrations";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type Page } from "@smw/feature-kit";
import { addDays, daysBetween, rupees, todayIST } from "@smw/feature-kit/money";
import type { PostLine } from "../posting";
import { finAccounts, finApprovals, finBankDrafts, finBankLines, finBankMatches, finBankStatements, finCashAccounts, finCostCentres, finJournalDrafts, finJournalLines, finJournals } from "../schema";
import { guessMapping, parseBankRows, type BankMapping, type ParsedBankLine } from "./bank-import";
import { FinanceService, day } from "./common";
import { OWNED_BY_MODULES } from "./journals";
import type { Report, ReportColumn, ReportRow } from "./report";

type CashAccount = typeof finCashAccounts.$inferSelect;
export interface BookLine { lineId: string; journalId: string; number: string; date: string; memo: string; sourceKey: string; /** Debit minus credit: money in is positive. */ amountPaise: number }
export interface Suggestion extends BookLine { score: number; why: string[] }
export interface BankLineRow {
  id: string; date: string; description: string; reference: string | null; amountPaise: number; matched: boolean;
  matchedTo: { lineId: string; journalId: string; number: string }[]; pendingApprovalId: string | null; suggestion: Suggestion | null; hint: string | null;
}
export interface BankSummary { account: CashAccount; bookPaise: number; unmatched: number; matched: number; lastLineOn: string | null; lastImportedAt: Date | null }
export interface ImportPreview {
  columns: string[]; guess: Partial<BankMapping>; mapping: BankMapping | null; sample: Record<string, string>[];
  ready: boolean; total: number; fresh: number; duplicates: number; errorCount: number; errors: { line: number; message: string }[];
  from: string | null; to: string | null; inPaise: number; outPaise: number;
}
export interface Reconciliation {
  account: CashAccount; asOn: string; bookPaise: number;
  /** Receipts in the books the bank has not credited yet. */
  uncredited: BookLine[];
  /** Payments in the books the bank has not paid yet (cheques not presented). */
  unpresented: BookLine[];
  /** On the bank statement, not in the books. */
  bankOnly: { id: string; date: string; description: string; reference: string | null; amountPaise: number }[];
  expectedBankPaise: number; enteredBankPaise: number | null; differencePaise: number | null;
}

const col = z.string().trim().optional().transform((v) => v || undefined);
const importInput = z.object({ cashAccountId: z.uuid("Choose the bank account."), dateCol: col, descriptionCol: col, referenceCol: col, amountCol: col, debitCol: col, creditCol: col });
const linesQuery = z.object({ status: z.enum(["open", "matched", "all"]).default("open"), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const entryInput = z.object({
  action: z.enum(["charge", "interest", "transfer", "other"]),
  toCashAccountId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  costCentreId: z.uuid().optional(),
  memo: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(500).optional(),
});
const recInput = z.object({ asOn: day.default(() => todayIST()), bankBalancePaise: z.coerce.number().int().optional() });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const CHEQUE = /\b(chq|cheque|clg|clearing|cts|inward)\b/i;
const MATCH_DAYS = 5;

/** The bank's reference sits inside the entry's number, narration or source, or the entry's number sits in the bank's words. */
export function referenceHit(bank: { reference: string | null; description: string }, book: { number: string; memo: string; sourceKey: string }): boolean {
  const ref = norm(bank.reference ?? ""), hay = norm(`${book.number} ${book.memo} ${book.sourceKey}`), num = norm(book.number);
  return (ref.length >= 4 && hay.includes(ref)) || (num.length >= 6 && norm(bank.description).includes(num));
}

const sameSide = (bank: number, book: number) => (bank > 0) === (book > 0);

/** What may be matched without asking: the amount and its sign agree, the dates are within 5 days, and nothing else fits as well. A reference decides between several; ties are left for a person. */
export function autoPairs(banks: { id: string; date: string; amountPaise: number; reference: string | null; description: string }[], books: BookLine[]): { bankId: string; lineId: string }[] {
  const picks = new Map<string, string>();
  for (const b of banks) {
    const fits = books.filter((k) => k.amountPaise === b.amountPaise && sameSide(b.amountPaise, k.amountPaise) && Math.abs(daysBetween(k.date, b.date)) <= MATCH_DAYS);
    const best = fits.length === 1 ? fits : fits.filter((k) => referenceHit(b, k));
    if (best.length === 1) picks.set(b.id, best[0]!.lineId);
  }
  const claims = new Map<string, number>();
  for (const l of picks.values()) claims.set(l, (claims.get(l) ?? 0) + 1);
  return [...picks].filter(([, l]) => claims.get(l) === 1).map(([bankId, lineId]) => ({ bankId, lineId }));
}

function score(bank: { date: string; amountPaise: number; reference: string | null; description: string }, k: BookLine): Suggestion | null {
  if (!sameSide(bank.amountPaise, k.amountPaise)) return null;
  const why: string[] = [];
  let s = 0;
  if (k.amountPaise === bank.amountPaise) { s += 100; why.push("same amount"); }
  const gap = Math.abs(daysBetween(k.date, bank.date));
  if (gap <= MATCH_DAYS) { s += 20 - gap * 2; why.push(gap === 0 ? "same day" : `${gap} day${gap === 1 ? "" : "s"} apart`); }
  if (referenceHit(bank, k)) { s += 50; why.push("reference found"); }
  return s >= 100 || why.includes("reference found") ? { ...k, score: s, why } : null;
}

export class BankService extends FinanceService {
  private async cashOf(tx: Tx, id: string, lock = false): Promise<CashAccount> {
    const q = tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, id)).limit(1);
    const [row] = await (lock ? q.for("update") : q);
    if (!row) throw new NotFoundError("Bank account");
    return row;
  }
  private async bankAccountOf(tx: Tx, id: string): Promise<CashAccount> {
    const acc = await this.cashOf(tx, id);
    if (acc.kind !== "bank") throw new ConflictError("Only a bank account has a statement. The cash box is checked by the cash counter.");
    return acc;
  }

  // ---------------------------------------------------------------- the accounts and what is left to do

  /** Every bank account in use with how much of its statement is still open. */
  async summary(): Promise<BankSummary[]> {
    return this.read("reconcile", async (tx) => {
      const accounts = await tx.select().from(finCashAccounts).where(and(eq(finCashAccounts.kind, "bank"), eq(finCashAccounts.isActive, true))).orderBy(asc(finCashAccounts.createdAt));
      const out: BankSummary[] = [];
      for (const a of accounts) {
        const [[c], [book], [last]] = await Promise.all([
          tx.select({ open: sql<number>`count(*) filter (where ${finBankLines.matchedAt} is null)::int`, done: sql<number>`count(*) filter (where ${finBankLines.matchedAt} is not null)::int`, lastLine: sql<string | null>`max(${finBankLines.date})` }).from(finBankLines).where(eq(finBankLines.cashAccountId, a.id)),
          tx.select({ net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` }).from(finJournalLines).where(eq(finJournalLines.accountId, a.accountId)),
          tx.select({ at: sql<Date | null>`max(${finBankStatements.createdAt})` }).from(finBankStatements).where(eq(finBankStatements.cashAccountId, a.id)),
        ]);
        out.push({ account: a, bookPaise: Number(book?.net ?? 0), unmatched: Number(c?.open ?? 0), matched: Number(c?.done ?? 0), lastLineOn: c?.lastLine ?? null, lastImportedAt: last?.at ?? null });
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- import

  private async sheetOf(file: { name: string; bytes: Uint8Array }): Promise<SheetRows> {
    try { return await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }); throw e; }
  }

  private resolveMapping(sheet: SheetRows, d: z.infer<typeof importInput>): { mapping: BankMapping | null; guess: Partial<BankMapping> } {
    const guess = guessMapping(sheet.columns);
    const chosen = d.dateCol || d.amountCol || d.debitCol || d.creditCol || d.descriptionCol ? { date: d.dateCol, description: d.descriptionCol, reference: d.referenceCol, amount: d.amountCol, debit: d.debitCol, credit: d.creditCol } : guess;
    const missing = [chosen.date, chosen.description, chosen.reference, chosen.amount, chosen.debit, chosen.credit].filter((c): c is string => !!c && !sheet.columns.includes(c));
    if (missing.length) throw new ValidationError({ file: `The sheet has no column called ${missing[0]}.` });
    const money = chosen.amount ? !chosen.debit && !chosen.credit : !!chosen.debit && !!chosen.credit;
    return { mapping: chosen.date && money ? { date: chosen.date, description: chosen.description, reference: chosen.reference, amount: chosen.amount, debit: chosen.debit, credit: chosen.credit } : null, guess };
  }

  private async knownFingerprints(tx: Tx, cashAccountId: string, lines: ParsedBankLine[]): Promise<Set<string>> {
    const known = new Set<string>();
    for (let i = 0; i < lines.length; i += 1000) {
      const part = lines.slice(i, i + 1000).map((l) => l.fingerprint);
      for (const r of await tx.select({ f: finBankLines.fingerprint }).from(finBankLines).where(and(eq(finBankLines.cashAccountId, cashAccountId), inArray(finBankLines.fingerprint, part)))) known.add(r.f);
    }
    return known;
  }

  /** Dry run: what the file holds, how its columns were read, what is new and what is already here. Nothing is saved. */
  async previewImport(file: { name: string; bytes: Uint8Array }, input: unknown): Promise<ImportPreview> {
    this.authorize("reconcile", "read");
    const d = this.parse(importInput, input);
    const sheet = await this.sheetOf(file);
    const { mapping, guess } = this.resolveMapping(sheet, d);
    const parsed = mapping ? parseBankRows(sheet, mapping) : { lines: [], errors: [] };
    return this.read("reconcile", async (tx) => {
      await this.bankAccountOf(tx, d.cashAccountId);
      const known = await this.knownFingerprints(tx, d.cashAccountId, parsed.lines);
      const dates = parsed.lines.map((l) => l.date).sort();
      return {
        columns: sheet.columns, guess, mapping, sample: sheet.rows.slice(0, 5),
        ready: !!mapping && parsed.errors.length === 0 && parsed.lines.length > 0,
        total: parsed.lines.length, fresh: parsed.lines.filter((l) => !known.has(l.fingerprint)).length, duplicates: parsed.lines.filter((l) => known.has(l.fingerprint)).length,
        errorCount: parsed.errors.length, errors: parsed.errors.slice(0, 50),
        from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
        inPaise: parsed.lines.filter((l) => l.amountPaise > 0).reduce((s, l) => s + l.amountPaise, 0), outPaise: -parsed.lines.filter((l) => l.amountPaise < 0).reduce((s, l) => s + l.amountPaise, 0),
      };
    });
  }

  /** Save the new lines (lines already imported are skipped, so overlapping files are safe), then match what is unambiguous. All or nothing: one bad row stops the import. */
  async commitImport(file: { name: string; bytes: Uint8Array }, input: unknown) {
    this.authorize("reconcile", "write");
    const d = this.parse(importInput, input);
    const sheet = await this.sheetOf(file);
    const { mapping } = this.resolveMapping(sheet, d);
    if (!mapping) throw new ValidationError({ file: "Tell us which columns hold the date and the amount." });
    const parsed = parseBankRows(sheet, mapping);
    if (parsed.errors.length) throw new ValidationError({ file: `Line ${parsed.errors[0]!.line}: ${parsed.errors[0]!.message} Nothing was imported.` });
    if (!parsed.lines.length) throw new ValidationError({ file: "The file has no transactions." });
    return this.write("reconcile", async (tx) => {
      const acc = await this.bankAccountOf(tx, d.cashAccountId);
      if (!acc.isActive) throw new ConflictError("That bank account is switched off.");
      const known = await this.knownFingerprints(tx, acc.id, parsed.lines);
      const fresh = parsed.lines.filter((l) => !known.has(l.fingerprint));
      let imported = 0, statementId: string | null = null;
      if (fresh.length) {
        const dates = parsed.lines.map((l) => l.date).sort();
        const [st] = await tx.insert(finBankStatements).values({ schoolId: this.ctx.schoolId, cashAccountId: acc.id, fileName: file.name.slice(0, 200), fromDate: dates[0]!, toDate: dates[dates.length - 1]!, importedBy: this.ctx.userId }).returning({ id: finBankStatements.id });
        statementId = st!.id;
        for (let i = 0; i < fresh.length; i += 500) {
          const made = await tx.insert(finBankLines).values(fresh.slice(i, i + 500).map((l) => ({ schoolId: this.ctx.schoolId, statementId: st!.id, cashAccountId: acc.id, date: l.date, description: l.description, reference: l.reference, amountPaise: l.amountPaise, fingerprint: l.fingerprint })))
            .onConflictDoNothing().returning({ id: finBankLines.id });
          imported += made.length;
        }
      }
      const autoMatched = imported ? await this.autoMatchIn(tx, acc) : 0;
      return { statementId, imported, duplicates: parsed.lines.length - imported, autoMatched, account: acc.name };
    }, (r) => ({ action: "import", entity: "Bank statement", entityId: r.statementId, summary: `Imported ${r.imported} bank lines into ${r.account} (${r.duplicates} already there, ${r.autoMatched} matched)`, meta: { file: file.name } }));
  }

  // ---------------------------------------------------------------- the books side of a match

  private async openBook(tx: Tx, ledgerId: string, o: { from?: string; to?: string; side?: "in" | "out"; q?: string; limit?: number; lock?: boolean } = {}): Promise<BookLine[]> {
    const where = and(
      eq(finJournalLines.accountId, ledgerId),
      notExists(tx.select({ x: sql`1` }).from(finBankLines).where(eq(finBankLines.journalLineId, finJournalLines.id))),
      notExists(tx.select({ x: sql`1` }).from(finBankMatches).where(eq(finBankMatches.journalLineId, finJournalLines.id))),
      o.from ? gte(finJournals.date, o.from) : undefined, o.to ? lte(finJournals.date, o.to) : undefined,
      o.side === "in" ? sql`${finJournalLines.debitPaise} > 0` : o.side === "out" ? sql`${finJournalLines.creditPaise} > 0` : undefined,
      o.q ? or(ilike(finJournals.number, `%${o.q}%`), ilike(finJournals.memo, `%${o.q}%`), ilike(finJournalLines.memo, `%${o.q}%`)) : undefined,
    );
    const base = tx.select({ lineId: finJournalLines.id, journalId: finJournals.id, number: finJournals.number, date: finJournals.date, memo: sql<string>`coalesce(${finJournalLines.memo}, ${finJournals.memo})`, sourceKey: finJournals.sourceKey, amount: sql<string>`${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}` })
      .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(where).orderBy(asc(finJournals.date), asc(finJournals.createdAt), asc(finJournalLines.id)).limit(o.limit ?? 500);
    const found = await (o.lock ? base.for("update", { of: finJournalLines }) : base);
    return found.map(({ amount, ...r }) => ({ ...r, amountPaise: Number(amount) }));
  }

  // ---------------------------------------------------------------- the statement lines

  /** One page of a bank account's statement lines, with what each is matched to (or what could match it). */
  async lines(cashAccountId: string, query: unknown = {}): Promise<Page<BankLineRow>> {
    const q = this.parse(linesQuery, query);
    return this.read("reconcile", async (tx) => {
      const acc = await this.bankAccountOf(tx, cashAccountId);
      const where = and(
        eq(finBankLines.cashAccountId, acc.id),
        q.status === "open" ? isNull(finBankLines.matchedAt) : q.status === "matched" ? sql`${finBankLines.matchedAt} is not null` : undefined,
        q.q ? or(ilike(finBankLines.description, `%${q.q}%`), ilike(finBankLines.reference, `%${q.q}%`)) : undefined,
      );
      const [list, [n]] = await Promise.all([
        tx.select().from(finBankLines).where(where).orderBy(desc(finBankLines.date), desc(finBankLines.createdAt), asc(finBankLines.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(finBankLines).where(where),
      ]);
      const ids = list.map((b) => b.id);
      const [one, many, pending] = ids.length ? await Promise.all([
        tx.select({ bankId: finBankLines.id, lineId: finJournalLines.id, journalId: finJournals.id, number: finJournals.number }).from(finBankLines).innerJoin(finJournalLines, eq(finJournalLines.id, finBankLines.journalLineId)).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(inArray(finBankLines.id, ids)),
        tx.select({ bankId: finBankMatches.bankLineId, lineId: finJournalLines.id, journalId: finJournals.id, number: finJournals.number }).from(finBankMatches).innerJoin(finJournalLines, eq(finJournalLines.id, finBankMatches.journalLineId)).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(inArray(finBankMatches.bankLineId, ids)),
        tx.select({ bankId: finBankDrafts.bankLineId, approvalId: finApprovals.id }).from(finBankDrafts).innerJoin(finApprovals, and(eq(finApprovals.refId, finBankDrafts.bankLineId), eq(finApprovals.kind, "finance.bank-entry"), eq(finApprovals.status, "pending"))).where(inArray(finBankDrafts.bankLineId, ids)),
      ]) : [[], [], []];
      const open = list.filter((b) => !b.matchedAt);
      const book = open.length ? await this.openBook(tx, acc.accountId, { from: addDays(open.map((b) => b.date).sort()[0]!, -31), to: addDays(open.map((b) => b.date).sort().at(-1)!, 31), limit: 1000 }) : [];
      return toPage(list.map((b) => {
        const best = open.includes(b) ? book.map((k) => score(b, k)).filter((s): s is Suggestion => !!s).sort((x, y) => y.score - x.score)[0] ?? null : null;
        return {
          id: b.id, date: b.date, description: b.description, reference: b.reference, amountPaise: b.amountPaise, matched: !!b.matchedAt,
          matchedTo: [...one, ...many].filter((m) => m.bankId === b.id).map(({ bankId: _b, ...m }) => m),
          pendingApprovalId: pending.find((p) => p.bankId === b.id)?.approvalId ?? null, suggestion: best,
          hint: !b.matchedAt && CHEQUE.test(`${b.description} ${b.reference ?? ""}`) ? "Looks like a cheque clearing. Match it to the entry made when the cheque was deposited." : null,
        };
      }), Number(n?.n ?? 0), listQuerySchema.parse({ page: q.page, pageSize: q.pageSize }));
    });
  }

  /** Entries in the books that could be the other half of one bank line, best first. `q` searches wider than the 31 days around it. */
  async candidates(bankLineId: string, query: { q?: string } = {}): Promise<{ line: typeof finBankLines.$inferSelect; suggestions: Suggestion[]; others: BookLine[] }> {
    return this.read("reconcile", async (tx) => {
      const b = await this.bankLineOf(tx, bankLineId);
      const acc = await this.cashOf(tx, b.cashAccountId);
      const side = b.amountPaise > 0 ? "in" : "out";
      const near = await this.openBook(tx, acc.accountId, { side, from: addDays(b.date, -31), to: addDays(b.date, 31), limit: 1000 });
      const suggestions = near.map((k) => score(b, k)).filter((s): s is Suggestion => !!s).sort((x, y) => y.score - x.score).slice(0, 10);
      const others = query.q?.trim() ? await this.openBook(tx, acc.accountId, { side, q: query.q.trim(), limit: 30 }) : near.filter((k) => !suggestions.some((s) => s.lineId === k.lineId)).slice(0, 30);
      return { line: b, suggestions, others };
    });
  }

  private async bankLineOf(tx: Tx, id: string, lock = false) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Bank line");
    const q = tx.select().from(finBankLines).where(eq(finBankLines.id, id)).limit(1);
    const [b] = await (lock ? q.for("update") : q);
    if (!b) throw new NotFoundError("Bank line");
    return b;
  }

  // ---------------------------------------------------------------- matching

  /** Match everything that is unambiguous. Returns how many lines were matched; the rest stay for a person. */
  async autoMatch(cashAccountId: string): Promise<{ matched: number; left: number }> {
    return this.write("reconcile", async (tx) => {
      const acc = await this.bankAccountOf(tx, cashAccountId);
      const matched = await this.autoMatchIn(tx, acc);
      const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(finBankLines).where(and(eq(finBankLines.cashAccountId, acc.id), isNull(finBankLines.matchedAt)));
      return { matched, left: Number(left?.n ?? 0) };
    }, (r) => ({ action: "auto-match", entity: "Bank line", summary: `Matched ${r.matched} bank lines automatically (${r.left} left)` }));
  }

  private async autoMatchIn(tx: Tx, acc: CashAccount): Promise<number> {
    const banks = await tx.select().from(finBankLines).where(and(eq(finBankLines.cashAccountId, acc.id), isNull(finBankLines.matchedAt))).orderBy(asc(finBankLines.id)).limit(2000).for("update");
    if (!banks.length) return 0;
    const dates = banks.map((b) => b.date).sort();
    const books = await this.openBook(tx, acc.accountId, { from: addDays(dates[0]!, -MATCH_DAYS), to: addDays(dates[dates.length - 1]!, MATCH_DAYS), limit: 4000, lock: true });
    const pairs = autoPairs(banks, books);
    for (const p of pairs) await tx.update(finBankLines).set({ journalLineId: p.lineId, matchedBy: this.ctx.userId, matchedAt: new Date() }).where(and(eq(finBankLines.id, p.bankId), isNull(finBankLines.matchedAt)));
    return pairs.length;
  }

  /** Match one bank line to one entry line of the same amount, or (split deposit) to several whose amounts add up to it. */
  async match(bankLineId: string, journalLineIds: string[]) {
    this.authorize("reconcile", "write");
    const ids = [...new Set(journalLineIds)];
    if (!ids.length || ids.length > 100 || ids.some((i) => !z.uuid().safeParse(i).success)) throw new ValidationError({ lines: "Choose the entry or entries it matches." });
    return this.write("reconcile", async (tx) => {
      const b = await this.bankLineOf(tx, bankLineId, true);
      if (b.matchedAt) throw new ConflictError("This line is already matched. Unmatch it first.");
      const acc = await this.cashOf(tx, b.cashAccountId);
      const lines = await tx.select({ id: finJournalLines.id, journalId: finJournalLines.journalId, accountId: finJournalLines.accountId, debit: finJournalLines.debitPaise, credit: finJournalLines.creditPaise }).from(finJournalLines).where(inArray(finJournalLines.id, ids));
      if (lines.length !== ids.length) throw new NotFoundError("Entry line");
      if (lines.some((l) => l.accountId !== acc.accountId)) throw new ConflictError(`Those entries are not on ${acc.name}.`);
      // Same order as reverseJournal (the entry first), so a match and an undo of the same entry take turns.
      await tx.select({ id: finJournals.id }).from(finJournals).where(inArray(finJournals.id, [...new Set(lines.map((l) => l.journalId))])).orderBy(asc(finJournals.id)).for("update");
      const [taken] = await tx.select({ id: finBankLines.id }).from(finBankLines).where(inArray(finBankLines.journalLineId, ids)).limit(1);
      const [takenSplit] = await tx.select({ id: finBankMatches.id }).from(finBankMatches).where(inArray(finBankMatches.journalLineId, ids)).limit(1);
      if (taken || takenSplit) throw new ConflictError("One of those entries is already matched to another bank line.");
      if (lines.some((l) => (l.debit - l.credit > 0) !== (b.amountPaise > 0))) throw new ConflictError(b.amountPaise > 0 ? "A bank credit matches a receipt, not a payment." : "A bank debit matches a payment, not a receipt.");
      const sum = lines.reduce((s, l) => s + l.debit - l.credit, 0);
      if (sum !== b.amountPaise) throw new ConflictError(`Those entries add up to ${rupees(Math.abs(sum))} but the bank line is ${rupees(Math.abs(b.amountPaise))}.`);
      const stamp = { matchedBy: this.ctx.userId, matchedAt: new Date() };
      if (ids.length === 1) await tx.update(finBankLines).set({ journalLineId: ids[0]!, ...stamp }).where(eq(finBankLines.id, b.id));
      else {
        await tx.update(finBankLines).set(stamp).where(eq(finBankLines.id, b.id));
        await tx.insert(finBankMatches).values(ids.map((journalLineId) => ({ schoolId: this.ctx.schoolId, bankLineId: b.id, journalLineId })));
      }
      return { bankLineId: b.id, entries: ids.length, amountPaise: b.amountPaise };
    }, (r) => ({ action: "match", entity: "Bank line", entityId: r.bankLineId, summary: `Matched a bank line of ${rupees(Math.abs(r.amountPaise))} to ${r.entries} entr${r.entries === 1 ? "y" : "ies"}` }));
  }

  /** Undo a match. The entry itself stays; it simply becomes open again. */
  async unmatch(bankLineId: string) {
    return this.write("reconcile", async (tx) => {
      const b = await this.bankLineOf(tx, bankLineId, true);
      if (!b.matchedAt) throw new ConflictError("This line is not matched.");
      await tx.delete(finBankMatches).where(eq(finBankMatches.bankLineId, b.id));
      await tx.update(finBankLines).set({ journalLineId: null, matchedBy: null, matchedAt: null }).where(eq(finBankLines.id, b.id));
      return { bankLineId: b.id, amountPaise: b.amountPaise };
    }, (r) => ({ action: "unmatch", entity: "Bank line", entityId: r.bankLineId, summary: `Unmatched a bank line of ${rupees(Math.abs(r.amountPaise))}` }));
  }

  // ---------------------------------------------------------------- making an entry from a bank line

  /**
   * Record what the bank did that the books do not know yet. Charges, interest and moves between own accounts post at
   * once; anything else is a manual entry that waits for a second person, and the line is matched when it is approved.
   */
  async createEntry(bankLineId: string, input: unknown) {
    this.authorize("reconcile", "write");
    const d = this.parse(entryInput, input);
    return this.write("reconcile", async (tx) => {
      const b = await this.bankLineOf(tx, bankLineId, true);
      if (b.matchedAt) throw new ConflictError("This line is already matched. Unmatch it first.");
      const acc = await this.cashOf(tx, b.cashAccountId), abs = Math.abs(b.amountPaise), money = { account: { id: acc.accountId } };
      if (b.date > todayIST()) throw new ConflictError("This line is dated in the future.");
      if (d.action === "other") return this.askOther(tx, b, acc, d);
      if (d.action === "charge" && b.amountPaise > 0) throw new ConflictError("A charge is money going out. This line is money coming in.");
      if (d.action === "interest" && b.amountPaise < 0) throw new ConflictError("Interest is money coming in. This line is money going out.");
      let lines: PostLine[], kind: "auto" | "transfer" = "auto", sourceType = "bank-line", memo: string;
      if (d.action === "transfer") {
        if (!d.toCashAccountId || d.toCashAccountId === acc.id) throw new ValidationError({ toCashAccountId: "Choose the other account." });
        const other = await this.cashOf(tx, d.toCashAccountId);
        if (!other.isActive) throw new ConflictError(`${other.name} is switched off.`);
        const there = { account: { id: other.accountId } };
        lines = b.amountPaise > 0 ? [{ ...money, debit: abs }, { ...there, credit: abs }] : [{ ...there, debit: abs }, { ...money, credit: abs }];
        kind = "transfer"; sourceType = "transfer"; memo = d.memo || `Transfer ${b.amountPaise > 0 ? "from" : "to"} ${other.name}`;
      } else if (d.action === "charge") {
        lines = [{ account: "bank_charges" as const, debit: abs }, { ...money, credit: abs }]; memo = d.memo || `Bank charge: ${b.description}`;
      } else {
        lines = [{ ...money, debit: abs }, { account: "other_income" as const, credit: abs }]; memo = d.memo || `Bank interest: ${b.description}`;
      }
      const key = `finance:bank-line:${b.id}`;
      const [old] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.sourceKey, key)).limit(1);
      if (old) {
        const [undone] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.reversesId, old.id)).limit(1);
        if (undone) throw new ConflictError("An entry made from this line was undone. Use Record as other entry instead.");
      }
      const posted = await this.post(tx, { date: b.date, sourceKey: key, sourceType, sourceId: b.id, kind, memo, lines });
      const [mine] = await tx.select({ id: finJournalLines.id }).from(finJournalLines).where(and(eq(finJournalLines.journalId, posted!.id), eq(finJournalLines.accountId, acc.accountId))).limit(1);
      await tx.update(finBankLines).set({ journalLineId: mine!.id, matchedBy: this.ctx.userId, matchedAt: new Date() }).where(eq(finBankLines.id, b.id));
      return { bankLineId: b.id, journalId: posted!.id, approvalId: null as string | null, action: d.action, amountPaise: b.amountPaise };
    }, (r) => ({ action: "bank-entry", entity: "Bank line", entityId: r.bankLineId, summary: r.approvalId ? `Asked to record a bank line of ${rupees(Math.abs(r.amountPaise))} as another entry` : `Recorded a bank ${r.action} of ${rupees(Math.abs(r.amountPaise))}`, meta: { journalId: r.journalId } }));
  }

  private async askOther(tx: Tx, b: typeof finBankLines.$inferSelect, acc: CashAccount, d: z.infer<typeof entryInput>) {
    if (!d.accountId) throw new ValidationError({ accountId: "Choose the account it belongs to." });
    if (!d.reason) throw new ValidationError({ reason: "Tell the approver what this is." });
    const [other] = await tx.select().from(finAccounts).where(eq(finAccounts.id, d.accountId)).limit(1);
    if (!other) throw new ConflictError("That account does not exist.");
    if (!other.isActive) throw new ConflictError(`${other.name} is switched off.`);
    if (other.id === acc.accountId) throw new ValidationError({ accountId: "Choose the account on the other side." });
    if (other.systemKey && OWNED_BY_MODULES.includes(other.systemKey)) throw new ConflictError(`${other.name} is kept by its own screens (fees, expenses or payroll). Post there so each person's balance stays right.`);
    if (d.costCentreId && !(await tx.select({ id: finCostCentres.id }).from(finCostCentres).where(eq(finCostCentres.id, d.costCentreId)).limit(1)).length) throw new ConflictError("That cost centre does not exist.");
    const abs = Math.abs(b.amountPaise), memo = d.memo || b.description || "Bank entry";
    const bankSide = b.amountPaise > 0 ? { debitPaise: abs, creditPaise: 0 } : { debitPaise: 0, creditPaise: abs };
    const otherSide = b.amountPaise > 0 ? { debitPaise: 0, creditPaise: abs } : { debitPaise: abs, creditPaise: 0 };
    const [draft] = await tx.insert(finJournalDrafts).values({ schoolId: this.ctx.schoolId, date: b.date, memo, lines: [{ accountId: acc.accountId, ...bankSide }, { accountId: other.id, ...otherSide, costCentreId: d.costCentreId ?? null }], createdBy: this.ctx.userId }).returning({ id: finJournalDrafts.id });
    await tx.insert(finBankDrafts).values({ schoolId: this.ctx.schoolId, bankLineId: b.id, draftId: draft!.id }).onConflictDoUpdate({ target: finBankDrafts.bankLineId, set: { draftId: draft!.id } });
    const a = await this.askApproval(tx, { kind: "finance.bank-entry", refType: "BankLine", refId: b.id, title: `Bank line: ${memo}`, amountPaise: abs, reason: d.reason, href: `/app/finance/banking/${acc.id}` });
    return { bankLineId: b.id, journalId: null as string | null, approvalId: a.id as string | null, action: "other" as const, amountPaise: b.amountPaise };
  }

  // ---------------------------------------------------------------- statement of reconciliation

  /** Book balance, what the bank has not caught up with, and the bank balance that should result. Compare it with the bank's own closing balance. */
  async reconciliation(cashAccountId: string, input: unknown = {}): Promise<Reconciliation> {
    const d = this.parse(recInput, input);
    // A report, so anyone who may read the books (an auditor) may open it.
    return this.read("read", async (tx) => {
      const acc = await this.bankAccountOf(tx, cashAccountId);
      const [[book], open, bankOnly] = await Promise.all([
        tx.select({ net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(and(eq(finJournalLines.accountId, acc.accountId), lte(finJournals.date, d.asOn))),
        tx.execute(sql`
          select jl.id as "lineId", j.id as "journalId", j.number, j.date, coalesce(jl.memo, j.memo) as memo, j.source_key as "sourceKey", jl.debit_paise - jl.credit_paise as amount
          from fin_journal_lines jl join fin_journals j on j.id = jl.journal_id
          left join fin_bank_lines b1 on b1.journal_line_id = jl.id
          left join fin_bank_matches m on m.journal_line_id = jl.id left join fin_bank_lines b2 on b2.id = m.bank_line_id
          where jl.account_id = ${acc.accountId} and j.date <= ${d.asOn} and (coalesce(b1.date, b2.date) is null or coalesce(b1.date, b2.date) > ${d.asOn})
          order by j.date, j.created_at, jl.id`),
        tx.execute(sql`
          select b.id, b.date, b.description, b.reference, b.amount_paise as "amountPaise" from fin_bank_lines b
          left join fin_journal_lines jl on jl.id = b.journal_line_id left join fin_journals j on j.id = jl.journal_id
          where b.cash_account_id = ${acc.id} and b.date <= ${d.asOn} and (
            (b.journal_line_id is null and not exists (select 1 from fin_bank_matches m where m.bank_line_id = b.id))
            or j.date > ${d.asOn}
            or exists (select 1 from fin_bank_matches m join fin_journal_lines jl2 on jl2.id = m.journal_line_id join fin_journals j2 on j2.id = jl2.journal_id where m.bank_line_id = b.id and j2.date > ${d.asOn}))
          order by b.date, b.id`),
      ]);
      const books = [...open].map((r) => { const x = r as Record<string, unknown>; return { lineId: String(x.lineId), journalId: String(x.journalId), number: String(x.number), date: String(x.date), memo: String(x.memo), sourceKey: String(x.sourceKey), amountPaise: Number(x.amount) }; });
      const only = [...bankOnly].map((r) => { const x = r as Record<string, unknown>; return { id: String(x.id), date: String(x.date), description: String(x.description), reference: (x.reference as string | null) ?? null, amountPaise: Number(x.amountPaise) }; });
      const uncredited = books.filter((k) => k.amountPaise > 0), unpresented = books.filter((k) => k.amountPaise < 0);
      const bookPaise = Number(book?.net ?? 0);
      const expectedBankPaise = bookPaise - uncredited.reduce((s, k) => s + k.amountPaise, 0) - unpresented.reduce((s, k) => s + k.amountPaise, 0) + only.reduce((s, k) => s + k.amountPaise, 0);
      const entered = d.bankBalancePaise ?? null;
      return { account: acc, asOn: d.asOn, bookPaise, uncredited, unpresented, bankOnly: only, expectedBankPaise, enteredBankPaise: entered, differencePaise: entered === null ? null : entered - expectedBankPaise };
    });
  }
}

/** The printable statement of reconciliation as a report, so the same figures go to screen, CSV and PDF. */
export function reconciliationReport(r: Reconciliation): Report {
  const columns: ReportColumn[] = [{ key: "item", label: "Item" }, { key: "date", label: "Date", kind: "date" }, { key: "ref", label: "Reference", kind: "mono" }, { key: "amount", label: "Amount", kind: "money" }];
  const out: ReportRow[] = [{ style: "head", cells: { item: `Balance as per books on ${r.asOn}`, amount: r.bookPaise }, links: { amount: `/app/finance/accounts/${r.account.accountId}?to=${r.asOn}` } }];
  const section = (title: string, items: { label: string; date: string; ref: string; amount: number; href?: string }[], totalLabel: string, shown: number) => {
    out.push({ style: "head", cells: { item: title } });
    if (!items.length) out.push({ cells: { item: "None" } });
    for (const i of items) out.push({ cells: { item: i.label, date: i.date, ref: i.ref, amount: i.amount }, links: i.href ? { item: i.href } : undefined });
    out.push({ style: "sub", cells: { item: totalLabel, amount: shown } });
  };
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  section("Less: receipts in the books the bank has not credited yet", r.uncredited.map((k) => ({ label: k.memo, date: k.date, ref: k.number, amount: -k.amountPaise, href: `/app/finance/journals/${k.journalId}` })), "Total not yet credited", -sum(r.uncredited, (k) => k.amountPaise));
  section("Add: payments in the books the bank has not paid yet", r.unpresented.map((k) => ({ label: k.memo, date: k.date, ref: k.number, amount: -k.amountPaise, href: `/app/finance/journals/${k.journalId}` })), "Total not yet presented", -sum(r.unpresented, (k) => k.amountPaise));
  section("Add or less: on the bank statement, not in the books", r.bankOnly.map((k) => ({ label: k.description || "Bank line", date: k.date, ref: k.reference ?? "", amount: k.amountPaise })), "Total on the bank only", sum(r.bankOnly, (k) => k.amountPaise));
  out.push({ style: "total", cells: { item: "Balance the bank statement should show", amount: r.expectedBankPaise } });
  if (r.enteredBankPaise !== null) {
    out.push({ cells: { item: "Closing balance on the bank's own statement", amount: r.enteredBankPaise } });
    out.push({ style: "total", cells: { item: r.differencePaise === 0 ? "Reconciled: no difference" : "Difference still to explain", amount: r.differencePaise } });
  }
  return { title: `Bank reconciliation: ${r.account.name}`, subtitle: `As on ${r.asOn}`, columns, rows: out, warning: r.differencePaise ? `The bank shows ${rupees(Math.abs(r.differencePaise))} ${r.differencePaise > 0 ? "more" : "less"} than the books explain.` : undefined };
}

/** Bank lines still unmatched, for the year-close checklist and the dashboard. */
export async function unmatchedBankLines(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(finBankLines).where(isNull(finBankLines.matchedAt));
  return Number(r?.n ?? 0);
}
