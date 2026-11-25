// Holidays from a spreadsheet and from last year. Pure: the service reads the sheet and the database and passes plain values in.
import type { SheetRows } from "@smw/integrations";
import { HOLIDAY_KINDS, type HolidayKind } from "./constants";
import { FIXED_NATIONAL_DAYS } from "./holidays";
import { holidayInput, type HolidayData } from "./holiday-inputs";
import { addDays, isDate } from "./stats";

export const IMPORT_COLUMNS = ["date", "from", "to", "name", "kind"] as const;
export const IMPORT_MAX_ROWS = 200;

export interface ImportError { column: string; message: string }
export interface ImportRow { line: number; name: string; errors: ImportError[] }
export interface ImportReport { total: number; valid: number; failed: number; rows: ImportRow[] }

export const templateCsv = () => [
  "date,to,name,kind",
  "26-01-2027,,Republic Day,national",
  "2026-11-08,2026-11-15,Diwali break,vacation",
].join("\r\n") + "\r\n";

/** DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD as YYYY-MM-DD; "" when it is not a real date. */
export function normDate(s: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) ?? ((x) => (x ? [x[0], x[3], x[2], x[1]] : null))(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s));
  if (!m) return "";
  const iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  return isDate(iso) ? iso : "";
}

const kindOf = (s: string): HolidayKind | "" | null => {
  const v = s.trim().toLowerCase();
  if (!v) return "";
  return (Object.entries(HOLIDAY_KINDS).find(([k, label]) => k === v || label.toLowerCase() === v)?.[0] as HolidayKind | undefined) ?? null;
};

/** The days a holiday covers. */
export function datesOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Check every row. `taken` holds the days that already have a holiday (date to its name); a day in the file twice is also refused.
 * Rows that pass are returned as `items`, in file order.
 */
export function checkSheet(sheet: SheetRows, taken: ReadonlyMap<string, string>): { report: ImportReport; items: { line: number; data: HolidayData }[]; sheetError: string | null } {
  const empty = { report: { total: 0, valid: 0, failed: 0, rows: [] }, items: [] };
  if (!sheet.columns.includes("name") || !(sheet.columns.includes("date") || sheet.columns.includes("from"))) return { ...empty, sheetError: 'The file needs a "name" column and a "date" (or "from") column. Use the template.' };
  if (!sheet.rows.length) return { ...empty, sheetError: "The file has no rows." };
  if (sheet.rows.length > IMPORT_MAX_ROWS) return { ...empty, sheetError: `The file has more than ${IMPORT_MAX_ROWS} rows. Split it.` };
  const seen = new Map<string, number>();
  const rows: ImportRow[] = [], items: { line: number; data: HolidayData }[] = [];
  sheet.rows.forEach((raw, i) => {
    const line = sheet.lines[i] ?? i + 2, errors: ImportError[] = [];
    const v = (k: string) => raw[k]?.trim() ?? "";
    const fromCol = v("from") ? "from" : "date";
    const from = normDate(v(fromCol)), to = normDate(v("to")), kind = kindOf(v("kind"));
    if (v(fromCol) && !from) errors.push({ column: fromCol, message: "Use DD-MM-YYYY or YYYY-MM-DD" });
    if (v("to") && !to) errors.push({ column: "to", message: "Use DD-MM-YYYY or YYYY-MM-DD" });
    if (kind === null) errors.push({ column: "kind", message: `Use one of: ${Object.keys(HOLIDAY_KINDS).join(", ")}` });
    const parsed = holidayInput.safeParse({ from, to: to || undefined, name: v("name"), kind: kind || undefined });
    if (!parsed.success) for (const e of parsed.error.issues) {
      const column = e.path[0] === "from" ? fromCol : String(e.path[0] ?? "name");
      if (!errors.some((x) => x.column === column)) errors.push({ column, message: e.message });
    }
    if (parsed.success && !errors.length) {
      for (const d of datesOf(parsed.data.from, parsed.data.to)) {
        const clash = taken.get(d) ?? (seen.has(d) ? `line ${seen.get(d)} of this file` : null);
        if (clash) { errors.push({ column: fromCol, message: `${d} is already a holiday (${clash})` }); break; }
      }
      if (!errors.length) { for (const d of datesOf(parsed.data.from, parsed.data.to)) seen.set(d, line); items.push({ line, data: parsed.data }); }
    }
    rows.push({ line, name: v("name"), errors });
  });
  const failed = rows.filter((r) => r.errors.length).length;
  return { report: { total: rows.length, valid: rows.length - failed, failed, rows }, items, sheetError: null };
}

// ---------- copy last year ----------

/** One proposed holiday from last year, moved a year on. `fixed` days fall on the same date each year; the rest move and need a look. */
export interface CopyProposal { data: HolidayData; fixed: boolean; clash: string | null }

type Old = { from: string; to: string; name: string; kind: HolidayKind; appliesTo: HolidayData["appliesTo"]; classIds: string[]; note: string | null };

/** The same date `n` years on (29 Feb becomes 28 Feb). */
export const shiftYear = (d: string, n: number) => { const moved = `${Number(d.slice(0, 4)) + n}${d.slice(4)}`; return isDate(moved) ? moved : `${moved.slice(0, 7)}-28`; };

const isFixed = (o: Old) => o.from === o.to && FIXED_NATIONAL_DAYS.some((n) => n.name.toLowerCase() === o.name.toLowerCase() && o.from.slice(5) === `${String(n.month).padStart(2, "0")}-${String(n.day).padStart(2, "0")}`);

/** Last year's holidays and breaks, the same names a year later. Working Sundays are one-off and are left out. */
export function copyProposals(old: Old[], taken: ReadonlyMap<string, string>): CopyProposal[] {
  return old.filter((o) => o.kind !== "working").map((o) => {
    const from = shiftYear(o.from, 1), to = shiftYear(o.to, 1);
    const clash = datesOf(from, to).map((d) => taken.get(d)).find(Boolean) ?? null;
    return { data: { from, to, name: o.name, kind: o.kind, appliesTo: o.appliesTo, classIds: o.classIds, note: o.note ?? undefined, notify: false }, fixed: isFixed(o), clash };
  });
}
