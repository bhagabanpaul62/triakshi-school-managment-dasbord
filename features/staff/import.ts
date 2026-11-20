import { EMPLOYMENT_TYPES, STAFF_GENDERS } from "./schema";

/** Pure helpers of the staff spreadsheet import (no database): the template, date and enum cleaning, report shapes. */
export const IMPORT_COLUMNS = [
  "name", "email", "phone", "role", "employee_id", "designation", "department", "qualification", "joining_date", "gender", "dob", "employment_type",
] as const;
export const IMPORT_MAX_ROWS = 500;

/** Input field name (staffInput) to the spreadsheet column, for error messages. */
export const FIELD_COLUMN: Record<string, string> = {
  employeeId: "employee_id", joiningDate: "joining_date", employmentType: "employment_type",
};

export interface ImportError { column: string; message: string }
export interface ImportRow { line: number; name: string; role: string; employeeId: string; errors: ImportError[] }
export interface ImportReport { total: number; valid: number; failed: number; rows: ImportRow[] }
export interface ImportedPerson { name: string; role: string; loginId: string; email: string | null; emailed: boolean; accessLink: string | null }
export interface ImportResult { imported: number; people: ImportedPerson[] }

export const templateCsv = () => [
  IMPORT_COLUMNS.join(","),
  "Priya Sharma,priya@school.example,9876543210,Teacher,,PGT,Mathematics,M.Sc. B.Ed.,01-06-2024,female,15-08-1988,permanent",
  "Ramesh Kumar,,9876543211,Accountant,,Accountant,Accounts,B.Com,2024-06-01,male,,contract",
].join("\r\n") + "\r\n";

/** DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD as YYYY-MM-DD; null when it is not a real date. */
export function normDate(s: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) ?? ((x) => (x ? [x[0], x[3], x[2], x[1]] : null))(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** One sheet row as staffInput-shaped data (role and employeeId are filled in by the caller), plus the cleaning errors. */
export function rowInput(raw: Record<string, string>): { input: Record<string, unknown>; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const v = (k: string) => raw[k]?.trim() ?? "";
  const date = (col: string) => {
    if (!v(col)) return "";
    const d = normDate(v(col));
    if (!d) errors.push({ column: col, message: "Use DD-MM-YYYY or YYYY-MM-DD" });
    return d ?? "";
  };
  const pick = <T extends readonly string[]>(col: string, allowed: T, fix: (s: string) => string) => {
    const x = fix(v(col));
    if (x && !allowed.includes(x)) errors.push({ column: col, message: `Use one of: ${allowed.join(", ")}` });
    return allowed.includes(x) ? x : "";
  };
  const input = {
    name: v("name"), email: v("email"), phone: v("phone"), designation: v("designation"), department: v("department"),
    qualification: v("qualification"), joiningDate: date("joining_date"), dob: date("dob"),
    gender: pick("gender", STAFF_GENDERS, (s) => s.toLowerCase()),
    employmentType: pick("employment_type", EMPLOYMENT_TYPES, (s) => s.toLowerCase().replace(/[\s-]+/g, "_")),
  };
  return { input, errors };
}

/** "T009" to "T010": the next ID in the same style. */
export function bumpId(id: string): string {
  const m = /^(\D*)(\d+)$/.exec(id);
  return m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2]!.length, "0")}` : `${id}1`;
}
