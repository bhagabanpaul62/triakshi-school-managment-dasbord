import { eq } from "drizzle-orm";
import Papa from "papaparse";
import { parseSheet, SheetError } from "@smw/integrations";
import type { Tx } from "@smw/db";
import { ValidationError, type Ctx } from "@smw/feature-kit";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { studentInput, type StudentInput } from "./inputs";
import { students } from "./schema";
import { StudentService } from "./student-service";
import { sectionLabel } from "./util";

/** Column names of the CSV, in template order. */
export const IMPORT_COLUMNS = ["admission_no", "name", "dob", "gender", "class", "section", "guardian_name", "guardian_phone", "guardian_relation",
  "guardian_email", "phone", "alt_phone", "mother_tongue", "religion", "nationality", "previous_school", "medical_notes", "emergency_name", "emergency_phone"] as const;
const REQUIRED = ["name", "class", "section"] as const;
const MAX_ROWS = 1000;
/** Which CSV column a validation error on an input field belongs to. */
const COLUMN_OF: Record<string, string> = {
  admissionNo: "admission_no", name: "name", dob: "dob", gender: "gender", sectionId: "section",
  guardianName: "guardian_name", guardianPhone: "guardian_phone", guardianRelation: "guardian_relation", guardianEmail: "guardian_email",
  phone: "phone", altPhone: "alt_phone", motherTongue: "mother_tongue", religion: "religion", nationality: "nationality", previousSchool: "previous_school",
  medicalNotes: "medical_notes", emergencyName: "emergency_name", emergencyPhone: "emergency_phone",
};
/** An uploaded .xlsx or .csv. A plain string is read as CSV text. */
export type ImportFile = string | { name: string; bytes: Uint8Array };

export interface ImportRowReport { line: number; admissionNo: string | null; name: string | null; classSection: string | null; errors: string[] }
export interface ImportReport { total: number; valid: number; failed: number; rows: ImportRowReport[]; limitMessage: string | null }
interface Analysed extends ImportRowReport { input: StudentInput | null }

/** "09-03-2014" or "09/03/2014" -> "2014-03-09"; anything else is left for the validator. */
const isoDate = (v: string) => v.replace(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, (_, d: string, m: string, y: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
const GENDER_WORDS: Record<string, string> = { m: "male", boy: "male", f: "female", girl: "female" };

/**
 * Bulk admission from a CSV. `dryRun` checks every row and writes nothing; `commit` runs the same checks and then
 * admits every student in one transaction, so a bad file never leaves half the students in.
 */
export class ImportService extends StudentRecordService {
  private readonly admissions: StudentService;

  constructor(ctx: Ctx) {
    super(ctx);
    this.admissions = new StudentService(ctx);
  }

  static templateCsv() {
    return Papa.unparse({
      fields: [...IMPORT_COLUMNS],
      data: [
        ["", "Aarav Sharma", "2015-06-14", "male", "Class 4", "A", "Rajesh Sharma", "9876543210", "father", "rajesh@example.com", "", "", "Hindi", "", "Indian", "Sunrise Public School", "Peanut allergy", "Rajesh Sharma", "9876543210"],
      ],
    }, { newline: "\n" }) + "\n";
  }

  async dryRun(file: ImportFile): Promise<ImportReport> {
    return this.read("write", async (tx) => {
      const rows = await this.analyse(tx, file);
      return this.report(rows, await this.admissions.roomWithin(tx, rows.filter((r) => !r.errors.length).length));
    });
  }

  /** All-or-nothing: any problem row stops the whole import before anything is written. */
  async commit(file: ImportFile) {
    return this.write("write", async (tx) => {
      const rows = await this.analyse(tx, file);
      const failed = rows.filter((r) => r.errors.length);
      if (failed.length) throw new ValidationError({ file: `${failed.length} of ${rows.length} rows have problems. Run the check, fix the file and try again.` });
      const classIds = new Set<string>();
      for (const r of rows) { const st = await this.admissions.admitWithin(tx, r.input!); if (st.classId) classIds.add(st.classId); }
      // Where to print the login slips: one entry per class that received students.
      const slipClasses = classIds.size ? (await tx.select({ id: classes.id, name: classes.name }).from(classes)).filter((c) => classIds.has(c.id)) : [];
      return { imported: rows.length, slipClasses };
    }, (r) => ({ action: "import", entity: "Student", summary: `Imported ${r.imported} students from a spreadsheet` }));
  }

  // ---------- checks (shared by dryRun and commit) ----------

  private report(rows: Analysed[], limitMessage: string | null): ImportReport {
    const failed = rows.filter((r) => r.errors.length).length;
    return { total: rows.length, valid: rows.length - failed, failed, rows: rows.map(({ input: _input, ...r }) => r), limitMessage };
  }

  private async analyse(tx: Tx, file: ImportFile): Promise<Analysed[]> {
    let parsed;
    try {
      parsed = await parseSheet(typeof file === "string" ? { name: "import.csv", bytes: new TextEncoder().encode(file) } : file);
    } catch (err) {
      if (err instanceof SheetError) throw new ValidationError({ file: err.message });
      throw err;
    }
    const missing = REQUIRED.filter((c) => !parsed.columns.includes(c));
    if (missing.length) throw new ValidationError({ file: `The file is missing the column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the right headers.` });
    if (parsed.rows.length === 0) throw new ValidationError({ file: "The file has no students in it." });
    if (parsed.rows.length > MAX_ROWS) throw new ValidationError({ file: `Import up to ${MAX_ROWS} students at a time.` });

    const places = await this.places(tx);
    const used = new Set((await tx.select({ no: students.admissionNo }).from(students)).map((r) => r.no.toLowerCase()));
    const seen = new Set<string>();

    return parsed.rows.map((row, i): Analysed => {
      const errors: string[] = [];
      const cell = (k: string) => row[k] || undefined;
      const className = cell("class"), sectionName = cell("section");
      const place = className && sectionName ? places.get(`${className.toLowerCase()}|${sectionName.toLowerCase()}`) ?? places.get(`class ${className.toLowerCase()}|${sectionName.toLowerCase()}`) : undefined;
      if (!className) errors.push("class: Required");
      else if (!sectionName) errors.push("section: Required");
      else if (!place) errors.push(`class/section: ${className} ${sectionName} does not exist this year`);

      const gender = cell("gender")?.toLowerCase();
      const candidate = {
        admissionNo: cell("admission_no"), name: cell("name"), dob: cell("dob") && isoDate(cell("dob")!), gender: gender && (GENDER_WORDS[gender] ?? gender),
        sectionId: place?.id, guardianName: cell("guardian_name"), guardianPhone: cell("guardian_phone"), guardianRelation: cell("guardian_relation")?.toLowerCase(),
        guardianEmail: cell("guardian_email"), phone: cell("phone"), altPhone: cell("alt_phone"), motherTongue: cell("mother_tongue"), religion: cell("religion"),
        nationality: cell("nationality"), previousSchool: cell("previous_school"), medicalNotes: cell("medical_notes"), emergencyName: cell("emergency_name"),
        emergencyPhone: cell("emergency_phone"),
      };
      const check = studentInput.safeParse(candidate);
      if (!check.success) for (const issue of check.error.issues) errors.push(`${COLUMN_OF[String(issue.path[0])] ?? issue.path.join(".")}: ${issue.message}`);

      const no = candidate.admissionNo?.toLowerCase();
      if (no && used.has(no)) errors.push(`admission_no: ${candidate.admissionNo} is already used`);
      else if (no && seen.has(no)) errors.push(`admission_no: ${candidate.admissionNo} appears twice in the file`);
      if (no) seen.add(no);

      return {
        line: parsed.lines[i]!, admissionNo: candidate.admissionNo ?? null, name: candidate.name ?? null, classSection: place?.label ?? null,
        errors,
        input: errors.length === 0 && check.success ? check.data : null,
      };
    });
  }

  /** `class|section` (lower-case) -> section of the current year. */
  private async places(tx: Tx) {
    const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    const rows = await tx.select({ id: sections.id, name: sections.name, className: classes.name }).from(sections)
      .innerJoin(classes, eq(classes.id, sections.classId)).where(year ? eq(sections.yearId, year.id) : undefined);
    return new Map(rows.map((r) => [`${r.className.toLowerCase()}|${r.name.toLowerCase()}`, { id: r.id, label: sectionLabel(r.className, r.name) }]));
  }
}
