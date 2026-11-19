// Pure library rules: no database, no framework. Unit-tested in rules.test.ts.

export const LOAN_DAYS = 14;
/** Late fine per day, in paise (Rs. 2). Change here to change it everywhere. */
export const FINE_PER_DAY_PAISE = 200;
export const LOAN_LIMITS = { student: 2, staff: 5 } as const;

const DAY = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Today in India as "YYYY-MM-DD". */
export const todayIST = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** "2026-11-18" + 14 -> "2026-12-02". */
export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY);

/** Days a book is late on `on` (0 when on time or early). */
export const daysLate = (dueOn: string, on: string) => Math.max(0, daysBetween(dueOn, on));

/** The fine for a book due on `dueOn` and brought back on `on`, in paise. Waived fines are still computed, so history shows what was forgiven; use `payable`. */
export const fineFor = (dueOn: string, on: string) => daysLate(dueOn, on) * FINE_PER_DAY_PAISE;

export interface LoanLike { dueOn: string; returnedOn: string | null; finePaise: number; fineWaived: boolean }

/** What the borrower owes for this loan: the stored fine once returned, the running fine while open, nothing when waived. */
export function payable(loan: LoanLike, today: string): number {
  if (loan.fineWaived) return 0;
  return loan.returnedOn ? loan.finePaise : fineFor(loan.dueOn, today);
}

export type LoanStatus = "open" | "overdue" | "returned";
export function loanStatus(loan: Pick<LoanLike, "dueOn" | "returnedOn">, today: string): LoanStatus {
  if (loan.returnedOn) return "returned";
  return loan.dueOn < today ? "overdue" : "open";
}

export const accession = (n: number) => `ACC-${String(n).padStart(5, "0")}`;
