// A spreadsheet from a fair or a school visit: check every row first, then all of it goes in or none of it.
import { and, isNull, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { parseSheet, SheetError, csvText } from "@smw/integrations";
import { ValidationError, type Ctx } from "@smw/feature-kit";
import { DAY_MS, EnquiryBase, istDay, istStart, loadEnquirySettings, phoneKeyOf } from "./enquiry-core";
import { importRowInput } from "./enquiry-inputs";
import { enquiries } from "./schema";

export const IMPORT_COLUMNS = ["child_name", "parent_name", "phone", "class", "email", "date_of_birth", "source", "message"] as const;
const REQUIRED = ["child_name", "parent_name", "phone"] as const;
const MAX_ROWS = 1000;
const COLUMN_OF: Record<string, string> = { studentName: "child_name", parentName: "parent_name", phone: "phone", classApplying: "class", email: "email", dob: "date_of_birth", source: "source", message: "message" };
export type ImportFile = { name: string; bytes: Uint8Array };

export interface ImportRowReport { line: number; child: string | null; phone: string | null; errors: string[]; duplicateOf: string | null }
export interface ImportReport { total: number; ready: number; failed: number; duplicates: number; rows: ImportRowReport[] }

/** "09-03-2018" and "09/03/2018" become "2018-03-09"; anything else is left for the check. */
const isoDate = (v: string) => v.replace(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, (_, d: string, m: string, y: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);

export class EnquiryImportService extends EnquiryBase {
  constructor(ctx: Ctx) { super(ctx); }

  static templateCsv() {
    return csvText([[...IMPORT_COLUMNS], ["Aarav Sharma", "Rajesh Sharma", "9876543210", "Class 1", "rajesh@example.com", "2019-06-14", "fair", "Met at the school fair"]]);
  }

  async dryRun(file: ImportFile): Promise<ImportReport> {
    this.authorize("pipeline", "read");
    return this.read("pipeline", async (tx) => this.report(await this.analyse(tx, file)));
  }

  /** Errors stop everything. Rows that are already enquiries (same phone and child) are skipped and counted. */
  async commit(file: ImportFile): Promise<{ imported: number; skipped: number }> {
    this.authorize("pipeline", "write");
    return this.write("pipeline", async (tx) => {
      const rows = await this.analyse(tx, file);
      const failed = rows.filter((r) => r.errors.length);
      if (failed.length) throw new ValidationError({ file: `${failed.length} of ${rows.length} rows have problems. Run the check, fix the file and try again.` });
      const s = await loadEnquirySettings(tx);
      const fresh = rows.filter((r) => !r.duplicateOf);
      const due = new Date(istStart(istDay(new Date(Date.now() + DAY_MS))).getTime() + 10 * 3_600_000);
      for (const r of fresh) await this.insertNew(tx, s, { ...r.input!, source: r.input!.source ?? "fair" }, { by: this.me, event: "imported", first: { kind: "call", dueAt: due } });
      return { imported: fresh.length, skipped: rows.length - fresh.length };
    }, (r) => ({ action: "import", entity: "Enquiry", summary: `Imported ${r.imported} enquiries from a spreadsheet (${r.skipped} already known)` }));
  }

  private report(rows: Analysed[]): ImportReport {
    const failed = rows.filter((r) => r.errors.length).length, duplicates = rows.filter((r) => r.duplicateOf && !r.errors.length).length;
    return { total: rows.length, ready: rows.length - failed - duplicates, failed, duplicates, rows: rows.map(({ input: _i, ...r }) => r) };
  }

  private async analyse(tx: Tx, file: ImportFile): Promise<Analysed[]> {
    let parsed;
    try { parsed = await parseSheet(file); } catch (err) { if (err instanceof SheetError) throw new ValidationError({ file: err.message }); throw err; }
    const missing = REQUIRED.filter((c) => !parsed.columns.includes(c));
    if (missing.length) throw new ValidationError({ file: `The file is missing the column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the right headers.` });
    if (!parsed.rows.length) throw new ValidationError({ file: "The file has no enquiries in it." });
    if (parsed.rows.length > MAX_ROWS) throw new ValidationError({ file: `Import up to ${MAX_ROWS} enquiries at a time.` });

    const known = new Map<string, string>();
    for (const e of await tx.select({ ref: enquiries.ref, key: enquiries.phoneKey, name: enquiries.studentName }).from(enquiries).where(and(isNull(enquiries.mergedInto), sql`${enquiries.phoneKey} <> ''`))) known.set(`${e.key}|${e.name.trim().toLowerCase()}`, e.ref ?? "an earlier enquiry");
    const seen = new Set<string>();
    return parsed.rows.map((row, i): Analysed => {
      const cell = (k: string) => row[k] || undefined;
      const candidate = { studentName: cell("child_name"), parentName: cell("parent_name"), phone: cell("phone")?.replace(/[\s-]/g, ""), classApplying: cell("class"), email: cell("email"), dob: cell("date_of_birth") && isoDate(cell("date_of_birth")!), source: cell("source"), message: cell("message") };
      const check = importRowInput.safeParse(candidate);
      const errors = check.success ? [] : check.error.issues.map((x) => `${COLUMN_OF[String(x.path[0])] ?? x.path.join(".")}: ${x.message}`);
      const key = check.success ? `${phoneKeyOf(check.data.phone)}|${check.data.studentName.trim().toLowerCase()}` : null;
      let duplicateOf: string | null = null;
      if (key) { duplicateOf = known.get(key) ?? (seen.has(key) ? "an earlier row of this file" : null); seen.add(key); }
      return { line: parsed.lines[i]!, child: candidate.studentName ?? null, phone: candidate.phone ?? null, errors, duplicateOf, input: check.success ? check.data : null };
    });
  }
}

type Analysed = ImportRowReport & { input: ReturnType<typeof importRowInput.parse> | null };
