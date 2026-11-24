// Reading a bank's statement sheet: which column is which, dates and amounts as banks write them, and the fingerprint that makes a re-import safe. Pure; no database.
import { createHash } from "node:crypto";
import type { SheetRows } from "@smw/integrations";

export interface BankMapping { date: string; description?: string; reference?: string; /** One signed column... */ amount?: string; /** ...or money out and money in in two columns. */ debit?: string; credit?: string }
export interface ParsedBankLine { line: number; date: string; description: string; reference: string | null; amountPaise: number; fingerprint: string }
export interface ParseResult { lines: ParsedBankLine[]; errors: { line: number; message: string }[] }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Which column is which, by the words banks use in their headings (keys come normalised from parseSheet). */
export function guessMapping(columns: string[]): Partial<BankMapping> {
  const find = (...res: RegExp[]) => { for (const r of res) { const hit = columns.find((c) => r.test(c)); if (hit) return hit; } return undefined; };
  const debit = find(/^(debit|withdraw|dr\b|paid_out|money_out)/, /withdrawal/), credit = find(/^(credit|deposit|cr\b|paid_in|money_in)/, /deposit/);
  return {
    date: find(/^(txn_|transaction_)?date$/, /^value_date$/, /^posting_date$/, /date/),
    description: find(/narration|particulars|description|details|remarks/),
    reference: find(/ref|cheque|chq|utr|instrument/),
    amount: debit && credit ? undefined : find(/^amount/, /^(txn_)?amt/),
    debit: debit && credit ? debit : undefined,
    credit: debit && credit ? credit : undefined,
  };
}

const real = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

/** DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, DD-MM-YY, YYYY-MM-DD, 5 Nov 2026 and 05-Nov-26; an optional time after the date is ignored. Day first, as Indian banks write it. */
export function parseBankDate(raw: string): string | null {
  const s = raw.trim().replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return real(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (m) return real(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2]!.toLowerCase());
    return mon < 0 ? null : real(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, mon + 1, +m[1]!);
  }
  return null;
}

/** Paise from "1,200.50", "(300)", "-45", "Rs. 99", "500 Cr" (money in) or "500 Dr" (money out). Null when it is not an amount. Blank is zero. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return 0;
  let sign = 1;
  const side = s.match(/\s*(cr|dr)\.?$/i);
  if (side) { sign = side[1]!.toLowerCase() === "dr" ? -1 : 1; s = s.slice(0, side.index); }
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1); }
  s = s.replace(/₹|rs\.?|inr|,|\s/gi, "");
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const paise = Math.round(Number(s) * 100);
  return Number.isSafeInteger(paise) ? sign * paise : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Same date, amount, words and reference count the same; the n-th of identical lines in one file is its own line, so two real identical charges both import and a repeat of the file adds nothing. */
export const fingerprint = (date: string, amountPaise: number, description: string, reference: string | null, occurrence: number) =>
  createHash("sha1").update([date, amountPaise, norm(description), norm(reference ?? ""), occurrence].join("|")).digest("hex");

/** Check every row against the mapping. Rows with no date and no amount (opening and closing balance lines, page footers) are skipped; any other bad row is an error. */
export function parseBankRows(sheet: SheetRows, m: BankMapping): ParseResult {
  const errors: ParseResult["errors"] = [], lines: ParsedBankLine[] = [], seen = new Map<string, number>();
  sheet.rows.forEach((r, i) => {
    const line = sheet.lines[i]!, err = (message: string) => errors.push({ line, message });
    const rawDate = r[m.date] ?? "";
    const cells = m.amount ? [r[m.amount] ?? ""] : [r[m.debit!] ?? "", r[m.credit!] ?? ""];
    if (!rawDate && cells.every((c) => !c || parseAmount(c) === 0)) return;
    const date = parseBankDate(rawDate);
    if (!date) return err(`The date "${rawDate}" is not one we can read. Use DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD.`);
    let amountPaise: number;
    if (m.amount) {
      const a = parseAmount(cells[0]!);
      if (a === null || a === 0) return err(`The amount "${cells[0]}" is not a number above zero.`);
      amountPaise = a;
    } else {
      const [out, inn] = [parseAmount(cells[0]!), parseAmount(cells[1]!)];
      if (out === null || inn === null) return err("The debit or credit is not a number.");
      if (out && inn) return err("This row has both a debit and a credit.");
      if (!out && !inn) return err("This row has no amount.");
      amountPaise = inn ? Math.abs(inn) : -Math.abs(out);
    }
    const description = (m.description ? r[m.description] : "") ?? "", reference = (m.reference ? r[m.reference] : "") || null;
    const key = [date, amountPaise, norm(description), norm(reference ?? "")].join("|"), n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    lines.push({ line, date, description: description.slice(0, 300), reference: reference ? reference.slice(0, 100) : null, amountPaise, fingerprint: fingerprint(date, amountPaise, description, reference, n) });
  });
  return { lines, errors };
}
