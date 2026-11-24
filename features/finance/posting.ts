// The API every money module posts through. It runs inside the caller's transaction and checks no permission: the
// calling service already did. Finance imports none of those modules; they import this.
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { nextSequence, type Tx } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { addMonths, fyOf, monthStart } from "@smw/feature-kit/money";
import { systemAccounts, type SystemAccount } from "./chart";
import { finAccounts, finBankLines, finBankMatches, finCashAccounts, finJournalLines, finJournals, finPeriods, finSeries, type JOURNAL_KINDS, type PARTY_TYPES } from "./schema";

export interface PostLine {
  /** A system account by key, or any account of this school by id. */
  account: SystemAccount | { id: string };
  debit?: number;
  credit?: number;
  party?: { type: (typeof PARTY_TYPES)[number]; id: string };
  costCentreId?: string | null;
  memo?: string;
}
export interface PostInput {
  date: string;
  /** Unique per school: posting the same key again does nothing. */
  sourceKey: string;
  sourceType: string;
  sourceId?: string | null;
  memo: string;
  lines: PostLine[];
  kind?: (typeof JOURNAL_KINDS)[number];
}
export interface Poster { schoolId: string; userId: string | null }

/** The day an entry may land on: its own, or the first day of the next open month when its month is locked. */
export async function postingDate(tx: Tx, day: string): Promise<string> {
  const locked = new Set((await tx.select({ m: finPeriods.month }).from(finPeriods).where(and(gte(finPeriods.month, monthStart(day)), inArray(finPeriods.status, ["soft", "closed"])))).map((r) => r.m));
  if (!locked.has(monthStart(day))) return day;
  let m = monthStart(day);
  while (locked.has(m)) m = addMonths(m, 1);
  return m;
}

/** Post one balanced entry once. Zero lines are dropped; an entry with nothing left is not posted (returns null). */
export async function postJournal(tx: Tx, by: Poster, input: PostInput): Promise<{ id: string; posted: boolean } | null> {
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  if (!lines.length) return null;
  let debit = 0, credit = 0;
  for (const l of lines) {
    const d = l.debit ?? 0, c = l.credit ?? 0;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0 || (d > 0) === (c > 0)) throw new Error(`Bad journal line in ${input.sourceKey}`);
    debit += d; credit += c;
  }
  if (debit !== credit) throw new Error(`Journal ${input.sourceKey} does not balance: ${debit} against ${credit}`);

  const [have] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.sourceKey, input.sourceKey)).limit(1);
  if (have) return { id: have.id, posted: false };

  const system = await systemAccounts(tx, by.schoolId);
  const own = [...new Set(lines.flatMap((l) => (typeof l.account === "object" ? [l.account.id] : [])))];
  // Foreign keys ignore RLS, so confirm every account belongs to this school.
  if (own.length && (await tx.select({ id: finAccounts.id }).from(finAccounts).where(inArray(finAccounts.id, own))).length !== own.length) throw new ConflictError("An account in this entry does not exist.");

  const date = await postingDate(tx, input.date);
  const number = await nextNumber(tx, by.schoolId, "journal", date);
  const [j] = await tx.insert(finJournals).values({
    schoolId: by.schoolId, number, date, originalDate: date === input.date ? null : input.date, kind: input.kind ?? "auto",
    sourceKey: input.sourceKey, sourceType: input.sourceType, sourceId: input.sourceId ?? null, memo: input.memo, createdBy: by.userId,
  }).returning({ id: finJournals.id });
  await tx.insert(finJournalLines).values(lines.map((l) => ({
    schoolId: by.schoolId, journalId: j!.id, accountId: typeof l.account === "object" ? l.account.id : system[l.account],
    debitPaise: l.debit ?? 0, creditPaise: l.credit ?? 0, partyType: l.party?.type, partyId: l.party?.id, costCentreId: l.costCentreId ?? null, memo: l.memo,
  })));
  return { id: j!.id, posted: true };
}

/** Undo an entry with its mirror image. Null when nothing was posted under that key; a reconciled entry is refused. */
export async function reverseJournal(tx: Tx, by: Poster, sourceKey: string, opts: { date: string; memo: string }): Promise<{ id: string } | null> {
  const [j] = await tx.select().from(finJournals).where(eq(finJournals.sourceKey, sourceKey)).for("update");
  if (!j) return null;
  const [done] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.reversesId, j.id)).limit(1);
  if (done) return done;
  const lines = await tx.select().from(finJournalLines).where(eq(finJournalLines.journalId, j.id));
  const [matched] = await tx.select({ id: finBankLines.id }).from(finBankLines).where(inArray(finBankLines.journalLineId, lines.map((l) => l.id))).limit(1);
  const [split] = await tx.select({ id: finBankMatches.id }).from(finBankMatches).where(inArray(finBankMatches.journalLineId, lines.map((l) => l.id))).limit(1);
  if (matched || split) throw new ConflictError("This is matched to a bank statement line. Undo the match first.");
  const date = await postingDate(tx, opts.date);
  const [r] = await tx.insert(finJournals).values({
    schoolId: by.schoolId, number: await nextNumber(tx, by.schoolId, "journal", date), date, originalDate: date === opts.date ? null : opts.date, kind: "reversal",
    sourceKey: `${sourceKey}:reversal`, sourceType: j.sourceType, sourceId: j.sourceId, memo: opts.memo, reversesId: j.id, createdBy: by.userId,
  }).returning({ id: finJournals.id });
  await tx.insert(finJournalLines).values(lines.map(({ id: _id, createdAt: _c, updatedAt: _u, journalId: _j, debitPaise, creditPaise, ...l }) => ({ ...l, journalId: r!.id, debitPaise: creditPaise, creditPaise: debitPaise })));
  return r!;
}

/** Default prefix and width per document. A school may change them in fin_series until the first number is used. */
export const SERIES_DEFAULTS: Record<string, { label: string; prefix: string; width: number }> = {
  receipt: { label: "Fee receipts", prefix: "RCPT", width: 6 },
  invoice: { label: "Fee invoices", prefix: "INV", width: 6 },
  credit_note: { label: "Credit and debit notes", prefix: "NOTE", width: 6 },
  voucher: { label: "Payment vouchers", prefix: "PV", width: 6 },
  other_receipt: { label: "Other receipts", prefix: "OR", width: 6 },
  payslip: { label: "Payslips", prefix: "PAY", width: 6 },
  journal: { label: "Journal entries", prefix: "JV", width: 6 },
};

/** Next gap-free number, "RCPT/2026-27/000001", restarting each financial year. Call it inside the writing transaction. */
export async function nextNumber(tx: Tx, schoolId: string, key: string, day: string): Promise<string> {
  const [s] = await tx.select().from(finSeries).where(eq(finSeries.key, key)).limit(1);
  const d = SERIES_DEFAULTS[key];
  if (!s && !d) throw new Error(`Unknown number series ${key}`);
  const fy = fyOf(day);
  const n = await nextSequence(tx, schoolId, `${key}:${fy}`);
  if (s && !s.locked) await tx.update(finSeries).set({ locked: true }).where(eq(finSeries.id, s.id));
  return `${s?.prefix ?? d!.prefix}/${fy}/${String(n + (s?.startAt ?? 1) - 1).padStart(s?.width ?? d!.width, "0")}`;
}

/** The ledger account of a cash or bank account, checking it is this school's and active. No id = the default of that kind (made on first use). */
export async function cashAccount(tx: Tx, schoolId: string, pick: { id?: string | null; kind: "cash" | "bank" }) {
  const [row] = pick.id
    ? await tx.select().from(finCashAccounts).where(and(eq(finCashAccounts.id, pick.id), eq(finCashAccounts.isActive, true))).limit(1)
    : await tx.select().from(finCashAccounts).where(and(eq(finCashAccounts.kind, pick.kind), eq(finCashAccounts.isActive, true))).orderBy(sql`${finCashAccounts.isDefault} desc`, asc(finCashAccounts.createdAt)).limit(1);
  if (row) return row;
  if (pick.id) throw new ConflictError("That cash or bank account is not in use.");
  const system = await systemAccounts(tx, schoolId);
  const [made] = await tx.insert(finCashAccounts).values({ schoolId, name: pick.kind === "cash" ? "Cash box" : "Main bank account", kind: pick.kind, accountId: system[pick.kind], isDefault: true }).onConflictDoNothing().returning();
  return made ?? (await tx.select().from(finCashAccounts).where(eq(finCashAccounts.accountId, system[pick.kind])).limit(1))[0]!;
}

/** Balance of accounts up to a day (debit minus credit), optionally for one party. */
export async function balanceOf(tx: Tx, accountIds: string[], opts: { upTo?: string; party?: { type: (typeof PARTY_TYPES)[number]; id: string } } = {}): Promise<number> {
  if (!accountIds.length) return 0;
  const [r] = await tx.select({ v: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` })
    .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId))
    .where(and(inArray(finJournalLines.accountId, accountIds), opts.upTo ? sql`${finJournals.date} <= ${opts.upTo}` : undefined,
      opts.party ? and(eq(finJournalLines.partyType, opts.party.type), eq(finJournalLines.partyId, opts.party.id)) : undefined));
  return Number(r?.v ?? 0);
}
