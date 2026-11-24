import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { addDays, addMonths, daysBetween, fyOf, fyRange, monthEnd, monthStart, rupees, todayIST } from "@smw/feature-kit/money";
import { finAccounts, finCashAccounts, finJournalLines, finJournals } from "../schema";
import { loadFinanceSettings } from "../settings";
import { FinanceService, day, schoolName } from "./common";
import { reportToCsv, reportToPdf, type Report, type ReportColumn, type ReportRow } from "./report";

/** The entry year close posts. Statements of income and spending leave it out so a closed year still shows its surplus. */
export const YEAR_CLOSE_TYPE = "year-close";

export const STATEMENTS = [
  { kind: "day-book", label: "Day book", hint: "Every entry of the period, in date order." },
  { kind: "cash-book", label: "Cash book", hint: "Cash received and paid, with the balance after each entry." },
  { kind: "bank-book", label: "Bank book", hint: "What went through the bank accounts, with the balance." },
  { kind: "ledger", label: "Account ledger", hint: "One account's entries with its running balance." },
  { kind: "trial-balance", label: "Trial balance", hint: "Every account: opening, movement and closing. Debits equal credits." },
  { kind: "income-expenditure", label: "Income and expenditure", hint: "What the school earned and spent, and the surplus." },
  { kind: "receipts-payments", label: "Receipts and payments", hint: "Cash and bank money in and out, by account." },
  { kind: "balance-sheet", label: "Balance sheet", hint: "What the school owns, owes and holds, as on a day." },
] as const;
export type StatementKind = (typeof STATEMENTS)[number]["kind"];
export const STATEMENT_KINDS = STATEMENTS.map((s) => s.kind) as StatementKind[];

export interface Range { from: string; to: string }
export type CompareMode = "previous" | "year";
export interface StatementQuery {
  kind: StatementKind;
  from: string;
  to: string;
  compare?: CompareMode;
  /** Account ledger: which account. */
  accountId?: string;
  /** Cash book or bank book: one account of that kind instead of all. */
  cashAccountId?: string;
  page?: number;
  /** Everything, for CSV and PDF. */
  all?: boolean;
}
export interface StatementResult { report: Report; balanced: boolean; page: { page: number; pageCount: number; total: number } | null; range: Range; comparing: Range | null }

const PAGE = 100, EXPORT_CAP = 50_000;

/** The same period one year earlier (29 February becomes 28). */
const lastYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4) === "-02-29" ? "-02-28" : d.slice(4)}`;

/** The period just before this one (whole months step back by as many months, anything else by as many days), or the same dates a year ago. */
export function comparePeriod(r: Range, mode: CompareMode): Range {
  if (mode === "year") return { from: lastYear(r.from), to: lastYear(r.to) };
  if (r.from === monthStart(r.from) && r.to === monthEnd(r.to)) {
    const n = (Number(r.to.slice(0, 4)) * 12 + Number(r.to.slice(5, 7))) - (Number(r.from.slice(0, 4)) * 12 + Number(r.from.slice(5, 7))) + 1;
    const from = addMonths(r.from, -n);
    return { from, to: addDays(r.from, -1) };
  }
  const len = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

type Acc = { id: string; code: string; name: string; type: (typeof finAccounts.$inferSelect)["type"]; group: string };
interface Movement extends Acc { opening: number; debit: number; credit: number }

const rows = <T>(r: Iterable<unknown>) => [...r] as T[];
const ledgerHref = (id: string, r: Range, upTo = false) => `/app/finance/accounts/${id}?${upTo ? "" : `from=${r.from}&`}to=${r.to}`;
const entryHref = (id: string) => `/app/finance/journals/${id}`;

/** Every account with what stood before `from` and what moved inside the range. One aggregate. The closing entry of a year is left out of the movement, never of the opening. */
async function movements(tx: Tx, r: Range): Promise<Movement[]> {
  const res = await tx.execute(sql`
    select a.id, a.code, a.name, a.type, a.group_name as "group",
      coalesce(sum(case when j.date < ${r.from} then l.debit_paise - l.credit_paise end), 0) as opening,
      coalesce(sum(case when j.date between ${r.from} and ${r.to} and j.source_type <> ${YEAR_CLOSE_TYPE} then l.debit_paise end), 0) as debit,
      coalesce(sum(case when j.date between ${r.from} and ${r.to} and j.source_type <> ${YEAR_CLOSE_TYPE} then l.credit_paise end), 0) as credit
    from fin_accounts a
    left join fin_journal_lines l on l.account_id = a.id
    left join fin_journals j on j.id = l.journal_id
    group by a.id order by a.code`);
  return rows<Record<string, unknown>>(res).map((x) => ({ id: String(x.id), code: String(x.code), name: String(x.name), type: x.type as Acc["type"], group: String(x.group), opening: Number(x.opening), debit: Number(x.debit), credit: Number(x.credit) }));
}

/** What stood on each account at the end of `asOn`, closing entries included. */
async function balancesAsOn(tx: Tx, asOn: string): Promise<(Acc & { net: number })[]> {
  const res = await tx.execute(sql`
    select a.id, a.code, a.name, a.type, a.group_name as "group", coalesce(sum(l.debit_paise - l.credit_paise), 0) as net
    from fin_accounts a
    left join fin_journal_lines l on l.account_id = a.id
    left join fin_journals j on j.id = l.journal_id and j.date <= ${asOn}
    where l.id is null or j.id is not null
    group by a.id order by a.code`);
  return rows<Record<string, unknown>>(res).map((x) => ({ id: String(x.id), code: String(x.code), name: String(x.name), type: x.type as Acc["type"], group: String(x.group), net: Number(x.net) }));
}

const label = (a: Acc) => `${a.code}  ${a.name}`;
const money = (key: string, labelText: string): ReportColumn => ({ key, label: labelText, kind: "money" });

export class StatementService extends FinanceService {
  /** Run one statement. Pure SQL aggregates; nothing is added up in memory except the lines of one page. */
  async run(q: StatementQuery): Promise<StatementResult> {
    const from = day.safeParse(q.from), to = day.safeParse(q.to);
    if (!from.success || !to.success || q.from > q.to) throw new ValidationError({ from: "Choose a start date that is not after the end date." });
    const range = { from: q.from, to: q.to };
    return this.read("read", async (tx) => {
      const basis = (await loadFinanceSettings(tx)).basis;
      const comparing = q.compare && ["income-expenditure", "receipts-payments", "balance-sheet"].includes(q.kind) ? comparePeriod(range, q.compare) : null;
      const subtitle = (asOn: boolean) => `${asOn ? `As on ${q.to}` : `${q.from} to ${q.to}`}${comparing ? `, compared with ${asOn ? comparing.to : `${comparing.from} to ${comparing.to}`}` : ""}. ${basis === "cash" ? "Cash basis" : "Accrual basis"}: entries are counted as the school posts them.`;
      const make = async (): Promise<Omit<StatementResult, "range" | "comparing">> => {
        switch (q.kind) {
          case "day-book": return this.dayBook(tx, range, q, subtitle(false));
          case "cash-book": case "bank-book": return this.moneyBook(tx, range, q, subtitle(false));
          case "ledger": return this.ledger(tx, range, q, subtitle(false));
          case "trial-balance": return this.trialBalance(tx, range, subtitle(false));
          case "income-expenditure": return this.incomeExpenditure(tx, range, comparing, subtitle(false));
          case "receipts-payments": return this.receiptsPayments(tx, range, comparing, subtitle(false));
          case "balance-sheet": return this.balanceSheet(tx, range, comparing, subtitle(true));
        }
      };
      return { ...(await make()), range, comparing };
    });
  }

  async csv(q: StatementQuery): Promise<string> { return reportToCsv((await this.run({ ...q, all: true })).report); }

  async pdf(q: StatementQuery): Promise<Uint8Array> {
    const { report } = await this.run({ ...q, all: true });
    return reportToPdf(report, await this.read("read", schoolName));
  }

  // ---------------------------------------------------------------- books with a running balance

  /** Lines of some ledger accounts with a running balance; the opening is everything before `from`. */
  private async ledgerRows(tx: Tx, ids: string[], r: Range, q: StatementQuery) {
    const lines = and(inArray(finJournalLines.accountId, ids), gte(finJournals.date, r.from), lte(finJournals.date, r.to));
    const page = q.all ? 1 : Math.max(1, q.page ?? 1), size = q.all ? EXPORT_CAP : PAGE;
    const [[open], [tot], list] = await Promise.all([
      tx.select({ net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId))
        .where(and(inArray(finJournalLines.accountId, ids), sql`${finJournals.date} < ${r.from}`)),
      tx.select({ n: sql<number>`count(*)::int`, debit: sql<string>`coalesce(sum(${finJournalLines.debitPaise}), 0)`, credit: sql<string>`coalesce(sum(${finJournalLines.creditPaise}), 0)` })
        .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(lines),
      tx.select({
        journalId: finJournals.id, date: finJournals.date, number: finJournals.number, memo: sql<string>`coalesce(${finJournalLines.memo}, ${finJournals.memo})`,
        account: finAccounts.name, debit: finJournalLines.debitPaise, credit: finJournalLines.creditPaise,
        counter: sql<string>`coalesce((select string_agg(distinct a2.name, ', ' order by a2.name) from fin_journal_lines l2 join fin_accounts a2 on a2.id = l2.account_id where l2.journal_id = ${finJournals.id} and l2.account_id <> ${finJournalLines.accountId}), '')`,
        running: sql<string>`sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}) over (order by ${finJournals.date}, ${finJournals.createdAt}, ${finJournalLines.id})`,
      }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId))
        .where(lines).orderBy(asc(finJournals.date), asc(finJournals.createdAt), asc(finJournalLines.id)).limit(size).offset((page - 1) * size),
    ]);
    const opening = Number(open?.net ?? 0), total = Number(tot?.n ?? 0);
    return { opening, closing: opening + Number(tot?.debit ?? 0) - Number(tot?.credit ?? 0), debit: Number(tot?.debit ?? 0), credit: Number(tot?.credit ?? 0), total, page, pageCount: Math.max(1, Math.ceil(total / size)), list };
  }

  private bookReport(title: string, subtitle: string, labels: [string, string], d: Awaited<ReturnType<StatementService["ledgerRows"]>>, withAccount: boolean, notes?: string[]): Omit<StatementResult, "range" | "comparing"> {
    const columns: ReportColumn[] = [
      { key: "date", label: "Date", kind: "date" }, { key: "number", label: "Entry", kind: "mono" }, { key: "memo", label: "Narration" },
      ...(withAccount ? [{ key: "account", label: "Account" }] : []), { key: "counter", label: "Against" },
      money("debit", labels[0]), money("credit", labels[1]), money("balance", "Balance"),
    ];
    const out: ReportRow[] = [];
    if (d.page === 1) out.push({ style: "head", cells: { memo: "Opening balance", balance: d.opening } });
    for (const l of d.list) {
      out.push({ cells: { date: l.date, number: l.number, memo: l.memo, account: l.account, counter: l.counter, debit: l.debit || null, credit: l.credit || null, balance: d.opening + Number(l.running) }, links: { number: entryHref(l.journalId), memo: entryHref(l.journalId) } });
    }
    if (d.page === d.pageCount) out.push({ style: "total", cells: { memo: "Totals and closing balance", debit: d.debit, credit: d.credit, balance: d.closing } });
    return { report: { title, subtitle, columns, rows: out, notes }, balanced: true, page: { page: d.page, pageCount: d.pageCount, total: d.total } };
  }

  private async ledger(tx: Tx, r: Range, q: StatementQuery, subtitle: string) {
    if (!q.accountId) throw new ValidationError({ accountId: "Choose an account." });
    const [acc] = await tx.select().from(finAccounts).where(eq(finAccounts.id, q.accountId)).limit(1);
    if (!acc) throw new ValidationError({ accountId: "That account does not exist." });
    const d = await this.ledgerRows(tx, [acc.id], r, q);
    const usual = acc.type === "asset" || acc.type === "expense" ? "a positive balance is normal here" : "a negative balance is normal here";
    return this.bookReport(`Ledger: ${acc.code} ${acc.name}`, subtitle, ["Debit", "Credit"], d, false, [`Balance is debits minus credits, so ${usual}.`]);
  }

  private async moneyBook(tx: Tx, r: Range, q: StatementQuery, subtitle: string) {
    const kind = q.kind === "cash-book" ? "cash" : "bank";
    const accounts = await tx.select().from(finCashAccounts).where(and(eq(finCashAccounts.kind, kind), q.cashAccountId ? eq(finCashAccounts.id, q.cashAccountId) : undefined));
    const d = await this.ledgerRows(tx, accounts.map((a) => a.accountId), r, q);
    return this.bookReport(kind === "cash" ? "Cash book" : "Bank book", subtitle, ["Received", "Paid"], d, accounts.length > 1, accounts.length ? undefined : [`There is no ${kind} account yet.`]);
  }

  private async dayBook(tx: Tx, r: Range, q: StatementQuery, subtitle: string) {
    const where = and(gte(finJournals.date, r.from), lte(finJournals.date, r.to));
    const page = q.all ? 1 : Math.max(1, q.page ?? 1), size = q.all ? EXPORT_CAP : PAGE;
    const [[tot], list] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int`, debit: sql<string>`coalesce(sum(${finJournalLines.debitPaise}), 0)`, credit: sql<string>`coalesce(sum(${finJournalLines.creditPaise}), 0)` })
        .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(where),
      tx.select({ journalId: finJournals.id, accountId: finAccounts.id, date: finJournals.date, number: finJournals.number, memo: finJournals.memo, account: finAccounts.name, code: finAccounts.code, debit: finJournalLines.debitPaise, credit: finJournalLines.creditPaise })
        .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId))
        .where(where).orderBy(asc(finJournals.date), asc(finJournals.createdAt), asc(finJournals.number), sql`${finJournalLines.debitPaise} desc`, asc(finAccounts.code)).limit(size).offset((page - 1) * size),
    ]);
    const total = Number(tot?.n ?? 0), pageCount = Math.max(1, Math.ceil(total / size));
    const columns: ReportColumn[] = [{ key: "date", label: "Date", kind: "date" }, { key: "number", label: "Entry", kind: "mono" }, { key: "memo", label: "Narration" }, { key: "account", label: "Account" }, money("debit", "Debit"), money("credit", "Credit")];
    const out: ReportRow[] = list.map((l) => ({ cells: { date: l.date, number: l.number, memo: l.memo, account: `${l.code}  ${l.account}`, debit: l.debit || null, credit: l.credit || null }, links: { number: entryHref(l.journalId), memo: entryHref(l.journalId), account: ledgerHref(l.accountId, r), debit: entryHref(l.journalId), credit: entryHref(l.journalId) } }));
    if (page === pageCount) out.push({ style: "total", cells: { memo: "Totals", debit: Number(tot?.debit ?? 0), credit: Number(tot?.credit ?? 0) } });
    return { report: { title: "Day book", subtitle, columns, rows: out }, balanced: Number(tot?.debit ?? 0) === Number(tot?.credit ?? 0), page: { page, pageCount, total } };
  }

  // ---------------------------------------------------------------- trial balance

  private async trialBalance(tx: Tx, r: Range, subtitle: string) {
    const all = await movements(tx, r);
    const [closing] = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from fin_journals where source_type = ${YEAR_CLOSE_TYPE} and date between ${r.from} and ${r.to}`));
    const dr = (n: number) => (n > 0 ? n : null), cr = (n: number) => (n < 0 ? -n : null);
    const live = all.filter((a) => a.opening || a.debit || a.credit);
    const sum = { open: 0, debit: 0, credit: 0, close: 0, openDr: 0, openCr: 0, closeDr: 0, closeCr: 0 };
    const out: ReportRow[] = live.map((a) => {
      const close = a.opening + a.debit - a.credit;
      sum.open += a.opening; sum.debit += a.debit; sum.credit += a.credit; sum.close += close;
      sum.openDr += dr(a.opening) ?? 0; sum.openCr += cr(a.opening) ?? 0; sum.closeDr += dr(close) ?? 0; sum.closeCr += cr(close) ?? 0;
      const link = ledgerHref(a.id, r);
      return { cells: { account: label(a), openDr: dr(a.opening), openCr: cr(a.opening), debit: a.debit || null, credit: a.credit || null, closeDr: dr(close), closeCr: cr(close) }, links: { account: link, debit: link, credit: link, closeDr: link, closeCr: link } };
    });
    out.push({ style: "total", cells: { account: "Total", openDr: sum.openDr, openCr: sum.openCr, debit: sum.debit, credit: sum.credit, closeDr: sum.closeDr, closeCr: sum.closeCr } });
    const balanced = sum.open === 0 && sum.debit === sum.credit && sum.close === 0;
    const columns: ReportColumn[] = [{ key: "account", label: "Account" }, money("openDr", "Opening Dr"), money("openCr", "Opening Cr"), money("debit", "Debit"), money("credit", "Credit"), money("closeDr", "Closing Dr"), money("closeCr", "Closing Cr")];
    return {
      report: { title: "Trial balance", subtitle, columns, rows: out, notes: closing?.n ? ["Before the year-end closing entry, which moves income and expenditure to the surplus."] : undefined,
        warning: balanced ? undefined : "The trial balance does not balance. Total debits and credits differ, so an entry was changed outside the product. Tell your auditor and support." },
      balanced, page: null,
    };
  }

  // ---------------------------------------------------------------- income and expenditure

  private async incomeExpenditure(tx: Tx, r: Range, cmp: Range | null, subtitle: string) {
    const cur = await movements(tx, r), prev = cmp ? new Map((await movements(tx, cmp)).map((a) => [a.id, a])) : null;
    const amount = (a: Movement | undefined) => (!a ? 0 : a.type === "income" ? a.credit - a.debit : a.debit - a.credit);
    const columns: ReportColumn[] = [{ key: "account", label: "Account" }, money("cur", "This period"), ...(cmp ? [money("prev", "Compared"), money("change", "Change")] : [])];
    const out: ReportRow[] = [];
    const totals: Record<"income" | "expense", [number, number]> = { income: [0, 0], expense: [0, 0] };
    for (const type of ["income", "expense"] as const) {
      const accs = cur.filter((a) => a.type === type && (amount(a) !== 0 || amount(prev?.get(a.id)) !== 0));
      out.push({ style: "head", cells: { account: type === "income" ? "Income" : "Expenditure" } });
      for (const a of accs) {
        const c = amount(a), p = amount(prev?.get(a.id));
        totals[type][0] += c; totals[type][1] += p;
        out.push({ cells: { account: label(a), cur: c, ...(cmp ? { prev: p, change: c - p } : {}) }, links: { account: ledgerHref(a.id, r), cur: ledgerHref(a.id, r), ...(cmp ? { prev: ledgerHref(a.id, cmp) } : {}) } });
      }
      const [c, p] = totals[type];
      out.push({ style: "sub", cells: { account: type === "income" ? "Total income" : "Total expenditure", cur: c, ...(cmp ? { prev: p, change: c - p } : {}) } });
    }
    const [sc, sp] = [totals.income[0] - totals.expense[0], totals.income[1] - totals.expense[1]];
    out.push({ style: "total", cells: { account: sc >= 0 ? "Surplus (income less expenditure)" : "Deficit (expenditure above income)", cur: sc, ...(cmp ? { prev: sp, change: sc - sp } : {}) } });
    return { report: { title: "Income and expenditure", subtitle, columns, rows: out }, balanced: true, page: null };
  }

  // ---------------------------------------------------------------- receipts and payments

  /** Cash and bank money in and out by the account on the other side. A journal that raised cash counts its other lines as receipts; one that lowered it, as payments. Moves between own cash accounts net to nothing and are left out. */
  private async flows(tx: Tx, r: Range) {
    const res = await tx.execute(sql`
      with cash_acc as (select account_id from fin_cash_accounts),
      jn as (
        select j.id, coalesce(sum(case when l.account_id in (select account_id from cash_acc) then l.debit_paise - l.credit_paise end), 0) as cash_net
        from fin_journals j join fin_journal_lines l on l.journal_id = j.id
        where j.date between ${r.from} and ${r.to} group by j.id
      )
      select a.id, a.code, a.name,
        coalesce(sum(case when jn.cash_net > 0 then l.credit_paise - l.debit_paise end), 0) as receipts,
        coalesce(sum(case when jn.cash_net < 0 then l.debit_paise - l.credit_paise end), 0) as payments
      from jn join fin_journal_lines l on l.journal_id = jn.id join fin_accounts a on a.id = l.account_id
      where jn.cash_net <> 0 and l.account_id not in (select account_id from cash_acc)
      group by a.id order by a.code`);
    const [balance] = rows<Record<string, unknown>>(await tx.execute(sql`
      select coalesce(sum(case when j.date < ${r.from} then l.debit_paise - l.credit_paise end), 0) as opening,
             coalesce(sum(case when j.date <= ${r.to} then l.debit_paise - l.credit_paise end), 0) as closing
      from fin_journal_lines l join fin_journals j on j.id = l.journal_id where l.account_id in (select account_id from fin_cash_accounts)`));
    return {
      lines: rows<Record<string, unknown>>(res).map((x) => ({ id: String(x.id), code: String(x.code), name: String(x.name), receipts: Number(x.receipts), payments: Number(x.payments) })),
      opening: Number(balance?.opening ?? 0), closing: Number(balance?.closing ?? 0),
    };
  }

  private async receiptsPayments(tx: Tx, r: Range, cmp: Range | null, subtitle: string) {
    const [cur, prev] = await Promise.all([this.flows(tx, r), cmp ? this.flows(tx, cmp) : null]);
    const columns: ReportColumn[] = [{ key: "account", label: "Account" }, money("cur", "This period"), ...(cmp ? [money("prev", "Compared"), money("change", "Change")] : [])];
    const both = (c: number, p: number) => ({ cur: c, ...(cmp ? { prev: p, change: c - p } : {}) });
    const out: ReportRow[] = [{ style: "head", cells: { account: "Opening cash and bank balance", ...both(cur.opening, prev?.opening ?? 0) } }];
    const side = (title: string, pick: "receipts" | "payments", totalLabel: string) => {
      out.push({ style: "head", cells: { account: title } });
      const ids = [...new Set([...cur.lines, ...(prev?.lines ?? [])].map((l) => l.id))];
      let c = 0, p = 0;
      for (const id of ids) {
        const a = cur.lines.find((l) => l.id === id), b = prev?.lines.find((l) => l.id === id);
        const x = a?.[pick] ?? 0, y = b?.[pick] ?? 0;
        if (!x && !y) continue;
        c += x; p += y;
        const named = a ?? b!;
        out.push({ cells: { account: `${named.code}  ${named.name}`, ...both(x, y) }, links: { account: ledgerHref(id, r), cur: ledgerHref(id, r), ...(cmp ? { prev: ledgerHref(id, cmp) } : {}) } });
      }
      out.push({ style: "sub", cells: { account: totalLabel, ...both(c, p) } });
      return [c, p] as const;
    };
    const [rc, rp] = side("Receipts", "receipts", "Total receipts");
    const [pc, pp] = side("Payments", "payments", "Total payments");
    out.push({ style: "total", cells: { account: "Closing cash and bank balance", ...both(cur.closing, prev?.closing ?? 0) } });
    // Opening + receipts - payments must equal the closing balance read straight from the ledger.
    const balanced = cur.opening + rc - pc === cur.closing && (!prev || prev.opening + rp - pp === prev.closing);
    return { report: { title: "Receipts and payments", subtitle, columns, rows: out, notes: ["Money moved between the school's own cash and bank accounts is not counted."], warning: balanced ? undefined : "Opening balance plus receipts less payments does not equal the closing balance. An entry was changed outside the product." }, balanced, page: null };
  }

  // ---------------------------------------------------------------- balance sheet

  private async balanceSheet(tx: Tx, r: Range, cmp: Range | null, subtitle: string) {
    const [cur, prev] = await Promise.all([balancesAsOn(tx, r.to), cmp ? balancesAsOn(tx, cmp.to) : null]);
    const pm = new Map((prev ?? []).map((a) => [a.id, a]));
    const columns: ReportColumn[] = [{ key: "account", label: "Account" }, money("cur", `As on ${r.to}`), ...(cmp ? [money("prev", `As on ${cmp.to}`), money("change", "Change")] : [])];
    const both = (c: number, p: number) => ({ cur: c, ...(cmp ? { prev: p, change: c - p } : {}) });
    const out: ReportRow[] = [];
    const totals: Record<string, [number, number]> = {};
    // Income and expense accounts hold the surplus until year close moves it to funds; their sum is shown on one line so the sheet balances before and after.
    const surplus: [number, number] = [-cur.filter((a) => a.type === "income" || a.type === "expense").reduce((s, a) => s + a.net, 0), -(prev ?? []).filter((a) => a.type === "income" || a.type === "expense").reduce((s, a) => s + a.net, 0)];
    for (const [type, title, sign] of [["asset", "What the school owns", 1], ["liability", "What the school owes", -1], ["equity", "Funds", -1]] as const) {
      out.push({ style: "head", cells: { account: title } });
      let c = 0, p = 0, group = "";
      for (const a of cur.filter((x) => x.type === type)) {
        const x = sign * a.net, y = sign * (pm.get(a.id)?.net ?? 0);
        if (!x && !y) continue;
        if (a.group !== group) { group = a.group; out.push({ cells: { account: a.group }, style: "sub" }); }
        c += x; p += y;
        out.push({ cells: { account: label(a), ...both(x, y) }, links: { account: ledgerHref(a.id, r, true), cur: ledgerHref(a.id, r, true) } });
      }
      if (type === "equity" && (surplus[0] || surplus[1])) {
        c += surplus[0]; p += surplus[1];
        out.push({ cells: { account: "Surplus of the year so far (not yet closed)", ...both(surplus[0], surplus[1]) } });
      }
      totals[type] = [c, p];
      out.push({ style: "sub", cells: { account: `Total ${type === "asset" ? "assets" : type === "liability" ? "liabilities" : "funds"}`, ...both(c, p) } });
    }
    const [la, lb] = [totals.liability![0] + totals.equity![0], totals.liability![1] + totals.equity![1]];
    out.push({ style: "total", cells: { account: "Total liabilities and funds", ...both(la, lb) } });
    const balanced = totals.asset![0] === la && (!prev || totals.asset![1] === lb);
    return {
      report: { title: "Balance sheet", subtitle, columns, rows: out, warning: balanced ? undefined : `The balance sheet does not balance: assets ${rupees(totals.asset![0])} against liabilities and funds ${rupees(la)}. An entry was changed outside the product.` },
      balanced, page: null,
    };
  }
}

/** This financial year so far, the default period of every statement. */
export function defaultRange(today = todayIST()): Range {
  const [from] = fyRange(fyOf(today));
  return { from, to: today };
}
