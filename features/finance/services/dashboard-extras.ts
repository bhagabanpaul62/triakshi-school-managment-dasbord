// The numbers on the owner's dashboard that come from the ledger plus, when those modules are on, from fees, expenses and students.
// Other modules' tables are read with plain SQL after checking they exist, so finance imports none of them.
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { addDays, addMonths, fyOf, fyRange, monthStart, todayIST } from "@smw/feature-kit/money";
import type { SystemAccount } from "../chart";
import { MODULE_LINKS, ledgerLink } from "../links";
import { loadFinanceSettings } from "../settings";
import { unmatchedBankLines } from "./bank";
import { YEAR_CLOSE_TYPE } from "./statements";
import type { DashboardExtras, SetupStep } from "./dashboard";

type Rows = Record<string, unknown>[];
const run = async (tx: Tx, q: ReturnType<typeof sql>): Promise<Rows> => [...(await tx.execute(q))] as Rows;
const num = (v: unknown) => Number(v ?? 0);
const exists = async (tx: Tx, table: string) => !!(await run(tx, sql`select to_regclass(${table}) as t`))[0]?.t;
/** Open amount of one issued bill: what is billed less what was conceded, credited and paid. */
const OPEN = sql`(gross_paise - concession_paise - credited_paise + late_paise - paid_paise)`;
const FREQUENCY_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

interface Args { system: Record<SystemAccount, string>; cashTotalPaise: number; duesPaise: number; hasBank: boolean; hasCash: boolean; hasUpi: boolean; openingSet: boolean }

export async function dashboardExtras(tx: Tx, a: Args): Promise<DashboardExtras> {
  const today = todayIST(), fy = fyOf(today), [from] = fyRange(fy);
  const [{ basis }, fees, ageing, perStudent, forecast, setup, unmatched] = await Promise.all([
    loadFinanceSettings(tx), feeFigures(tx, a, from, today), ageingBuckets(tx, today), activeStudents(tx), forecastNinety(tx, a, today), setupSteps(tx, a), unmatchedBankLines(tx),
  ]);
  const [budget, pnl] = await Promise.all([budgetFigures(tx, fy, from, today), yearPnl(tx, from, today)]);
  const byKey = (k: SystemAccount) => pnl.get(a.system[k]) ?? { debit: 0, credit: 0 };
  const income = [...pnl.values()].filter((x) => x.type === "income").reduce((s, x) => s + x.credit - x.debit, 0);
  const expense = [...pnl.values()].filter((x) => x.type === "expense").reduce((s, x) => s + x.debit - x.credit, 0);
  const salary = [byKey("salaries"), byKey("employer_contrib")].reduce((s, x) => s + x.debit - x.credit, 0);
  return {
    fy, from, to: today, basis, fees: fees.withBasis(basis), budget, ageing,
    salary: { salaryPaise: salary, incomePaise: income, shareBp: income > 0 ? Math.round((salary * 10_000) / income) : null, href: "/app/finance/statements/income-expenditure" },
    perStudent: perStudent ? { students: perStudent, expensePaise: expense, perStudentPaise: Math.round(expense / perStudent), href: "/app/finance/statements/income-expenditure" } : null,
    forecast, setup, unmatchedBankLines: unmatched,
  };
}

/** Per account: what moved this financial year so far (the closing entry of a year is not income or spending). */
async function yearPnl(tx: Tx, from: string, to: string) {
  const res = await run(tx, sql`
    select a.id, a.type, coalesce(sum(l.debit_paise), 0) as debit, coalesce(sum(l.credit_paise), 0) as credit
    from fin_accounts a join fin_journal_lines l on l.account_id = a.id join fin_journals j on j.id = l.journal_id
    where j.date between ${from} and ${to} and j.source_type <> ${YEAR_CLOSE_TYPE} and (a.type in ('income', 'expense') or a.system_key = 'student_dues')
    group by a.id`);
  return new Map(res.map((r) => [String(r.id), { type: String(r.type), debit: num(r.debit), credit: num(r.credit) }]));
}

async function feeFigures(tx: Tx, a: Args, from: string, to: string) {
  const pnl = await yearPnl(tx, from, to), at = (k: SystemAccount) => pnl.get(a.system[k]) ?? { debit: 0, credit: 0 };
  const [income, late, conc, bad, dues] = [at("fee_income"), at("late_fee"), at("concessions"), at("bad_debts"), at("student_dues")];
  const billed = income.credit - income.debit + late.credit - late.debit;
  const range = { from, to };
  return {
    withBasis: (basis: "accrual" | "cash") => ({
      // On the cash basis nothing posts when a bill is issued, so what was billed is what was received.
      billedPaise: billed, concessionsPaise: basis === "cash" ? 0 : conc.debit - conc.credit + bad.debit - bad.credit,
      collectedPaise: basis === "cash" ? billed : dues.credit - conc.debit - bad.debit - income.debit,
      duePaise: a.duesPaise,
      links: { billed: ledgerLink(a.system.fee_income, range), concessions: ledgerLink(a.system.concessions, range), collected: MODULE_LINKS.receipts, due: MODULE_LINKS.dues },
    }),
  };
}

async function ageingBuckets(tx: Tx, today: string): Promise<DashboardExtras["ageing"]> {
  if (!(await exists(tx, "fee_invoices"))) return null;
  const [r] = await run(tx, sql`
    select coalesce(sum(case when due_date >= ${today}::date then op end), 0) as not_due,
           coalesce(sum(case when ${today}::date - due_date between 1 and 30 then op end), 0) as d30,
           coalesce(sum(case when ${today}::date - due_date between 31 and 60 then op end), 0) as d60,
           coalesce(sum(case when ${today}::date - due_date between 61 and 90 then op end), 0) as d90,
           coalesce(sum(case when ${today}::date - due_date > 90 then op end), 0) as d90p
    from (select due_date, ${OPEN} as op from fee_invoices where status = 'issued') x where op > 0`);
  const buckets = [["Not due yet", "not_due", "upcoming"], ["1 to 30 days late", "d30", "30"], ["31 to 60 days late", "d60", "60"], ["61 to 90 days late", "d90", "90"], ["Over 90 days late", "d90p", "90plus"]]
    .map(([label, key, bucket]) => ({ label: label!, paise: num(r?.[key!]), href: `${MODULE_LINKS.dues}?bucket=${bucket}` }));
  return { buckets, totalPaise: buckets.reduce((s, b) => s + b.paise, 0) };
}

async function activeStudents(tx: Tx): Promise<number> {
  if (!(await exists(tx, "students"))) return 0;
  return num((await run(tx, sql`select count(*)::int as n from students where status = 'active'`))[0]?.n);
}

/** Budget to date against what was spent on the same accounts, from exp_budgets (12 monthly amounts, April first). */
async function budgetFigures(tx: Tx, fy: string, from: string, today: string): Promise<DashboardExtras["budget"]> {
  if (!(await exists(tx, "exp_budgets"))) return null;
  const rows = await run(tx, sql`select b.account_id, a.name, b.months from exp_budgets b join fin_accounts a on a.id = b.account_id where b.fy = ${fy}`);
  if (!rows.length) return null;
  const elapsed = (Number(today.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  const budget = new Map<string, { name: string; year: number; toDate: number }>();
  for (const r of rows) {
    const months = (Array.isArray(r.months) ? r.months : []).map(num), id = String(r.account_id), prev = budget.get(id);
    budget.set(id, { name: String(r.name), year: (prev?.year ?? 0) + months.reduce((s, m) => s + m, 0), toDate: (prev?.toDate ?? 0) + months.slice(0, elapsed).reduce((s, m) => s + m, 0) });
  }
  const spent = await run(tx, sql`
    select l.account_id, coalesce(sum(l.debit_paise - l.credit_paise), 0) as net from fin_journal_lines l join fin_journals j on j.id = l.journal_id
    where j.date between ${from} and ${today} and j.source_type <> ${YEAR_CLOSE_TYPE} and l.account_id in (select account_id from exp_budgets where fy = ${fy}) group by l.account_id`);
  const actual = new Map(spent.map((r) => [String(r.account_id), num(r.net)]));
  const list = [...budget].map(([accountId, b]) => ({ accountId, name: b.name, budgetPaise: b.toDate, actualPaise: actual.get(accountId) ?? 0, year: b.year, href: ledgerLink(accountId, { from, to: today }) }));
  return {
    rows: list.sort((x, y) => y.year - x.year).slice(0, 6).map(({ year: _y, ...r }) => r),
    yearBudgetPaise: list.reduce((s, b) => s + b.year, 0), toDateBudgetPaise: list.reduce((s, b) => s + b.budgetPaise, 0), toDateActualPaise: list.reduce((s, b) => s + b.actualPaise, 0), href: MODULE_LINKS.budgets,
  };
}

/** Cash now plus what is due in, minus what is due out, per 30 days for 90 days. Open bills are taken on their due date; late ones are left out, because nobody can say when they will pay. */
async function forecastNinety(tx: Tx, a: Args, today: string): Promise<DashboardExtras["forecast"]> {
  const end = addDays(today, 89);
  const bucket = (day: string) => Math.min(2, Math.max(0, Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 / 30)));
  const inflow = [0, 0, 0], outflow = [0, 0, 0], notes: string[] = [];
  if (await exists(tx, "fee_invoices")) {
    for (const r of await run(tx, sql`select least(2, (due_date - ${today}::date) / 30) as b, sum(op) as s from (select due_date, ${OPEN} as op from fee_invoices where status = 'issued') x where op > 0 and due_date between ${today} and ${end} group by 1`)) inflow[num(r.b)]! += num(r.s);
    notes.push("Fees still open are counted on their due date; overdue fees are not counted.");
  }
  if (await exists(tx, "exp_bills")) {
    for (const r of await run(tx, sql`select case when due_date < ${today}::date then 0 else least(2, (due_date - ${today}::date) / 30) end as b, sum(gross_paise - tds_paise - paid_paise) as s from exp_bills where status = 'approved' and gross_paise - tds_paise - paid_paise > 0 and due_date <= ${end} group by 1`)) outflow[num(r.b)]! += num(r.s);
    notes.push("Approved bills are counted on their due date.");
  }
  if (await exists(tx, "exp_recurring")) {
    for (const r of await run(tx, sql`select frequency, next_on, ends_on, due_days, lines from exp_recurring where is_active and next_on <= ${end}`)) {
      const lines = Array.isArray(r.lines) ? (r.lines as { amountPaise?: number }[]) : [], amount = lines.reduce((s, l) => s + num(l.amountPaise), 0), step = FREQUENCY_MONTHS[String(r.frequency)] ?? 1;
      for (let d = String(r.next_on); d <= end && (!r.ends_on || d <= String(r.ends_on)); d = addDays(d, 30 * step)) outflow[bucket(addDays(d, num(r.due_days)))]! += amount;
    }
    notes.push("Recurring costs are counted on each due date.");
  }
  // Salary is the biggest regular cost: the average of the last three full months, once in each 30 days.
  const monthFrom = addMonths(monthStart(today), -3), [sal] = await run(tx, sql`select coalesce(sum(debit_paise - credit_paise), 0) as s from fin_journal_lines l join fin_journals j on j.id = l.journal_id where l.account_id = ${a.system.salaries} and j.date >= ${monthFrom} and j.date < ${monthStart(today)}`);
  const salary = Math.round(num(sal?.s) / 3);
  if (salary) { for (let i = 0; i < 3; i++) outflow[i]! += salary; notes.push("Salary is the average of the last three months."); }
  let running = a.cashTotalPaise;
  return { openingPaise: a.cashTotalPaise, notes, months: ["Next 30 days", "31 to 60 days", "61 to 90 days"].map((label, i) => ({ label, inPaise: inflow[i]!, outPaise: outflow[i]!, closingPaise: (running += inflow[i]! - outflow[i]!) })) };
}

/** What the school still has to do before money can flow. A step of a module that is not switched on is left out. */
async function setupSteps(tx: Tx, a: Args): Promise<SetupStep[]> {
  const here = encodeURIComponent("/app/finance"), cash = `/app/finance/settings?tab=cash&next=${here}`;
  const steps: SetupStep[] = [
    { key: "cash", text: "Add the cash box.", done: a.hasCash, href: cash, needs: "settings" },
    { key: "bank", text: "Add the school bank account.", done: a.hasBank, href: cash, needs: "settings" },
    { key: "upi", text: "Add the school UPI ID so families can pay by QR.", done: a.hasUpi || !a.hasBank, href: cash, needs: "settings" },
    { key: "opening", text: "Set what each account held when you started.", done: a.openingSet, href: "/app/finance/banking", needs: "settings" },
  ];
  const count = async (table: string, where: ReturnType<typeof sql>) => ((await exists(tx, table)) ? num((await run(tx, sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`))[0]?.n) : null);
  const heads = await count("fee_heads", sql`is_active`), plans = await count("fee_plans", sql`status = 'published'`), issued = await count("fee_invoices", sql`status = 'issued'`), counters = await count("fee_counters", sql`true`);
  const back = (href: string) => `${href}?next=${here}`;
  if (heads !== null) steps.push({ key: "heads", text: "Add the fee heads (tuition, transport and so on).", done: heads > 0, href: back(MODULE_LINKS.feeSetup), needs: "fees-setup" });
  if (plans !== null) steps.push({ key: "plan", text: "Make a fee plan and publish it.", done: plans > 0, href: back(MODULE_LINKS.plans), needs: "fees-setup" });
  if (issued !== null) steps.push({ key: "issued", text: "Issue the first bills.", done: issued > 0, href: back(MODULE_LINKS.invoices), needs: "fees-setup" });
  if (counters !== null) steps.push({ key: "counter", text: "Open the cash counter to take the first receipt.", done: counters > 0, href: back(MODULE_LINKS.counter), needs: "fees-collect" });
  return steps;
}
