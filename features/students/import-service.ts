import { eq, inArray } from "drizzle-orm";
import Papa from "papaparse";
import { parseSheet, SheetError } from "@smw/integrations";
import type { Tx } from "@smw/db";
import { LimitError, ValidationError, type Ctx } from "@smw/feature-kit";
import { StudentService } from "./student-service";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { lockSchool } from "./capacity";
import { studentInput, type StudentInput } from "./inputs";
import { students } from "./schema";
import { normalizePhone, planDay, sectionLabel, today } from "./util";

/** Column names of the CSV, in template order. */
export const IMPORT_COLUMNS = ["admission_no", "name", "dob", "gender", "class", "section", "guardian_name", "guardian_phone", "guardian_relation",
  "guardian_email", "phone", "alt_phone", "mother_tongue", "religion", "nationality", "previous_school", "medical_notes", "emergency_name", "emergency_phone",
  "pen", "joins_on", "joins_year", "guardian2_name", "guardian2_phone", "guardian2_relation", "allow_duplicate"] as const;
const REQUIRED = ["name", "class", "section"] as const;
const MAX_ROWS = 1000;
/** Which CSV column a validation error on an input field belongs to. */
const COLUMN_OF: Record<string, string> = {
  admissionNo: "admission_no", name: "name", dob: "dob", gender: "gender", sectionId: "section",
  guardianName: "guardian_name", guardianPhone: "guardian_phone", guardianRelation: "guardian_relation", guardianEmail: "guardian_email",
  phone: "phone", altPhone: "alt_phone", motherTongue: "mother_tongue", religion: "religion", nationality: "nationality", previousSchool: "previous_school",
  medicalNotes: "medical_notes", emergencyName: "emergency_name", emergencyPhone: "emergency_phone", pen: "pen", joinsOn: "joins_on", joinsYearId: "joins_year",
  joinsSectionId: "section", classId: "class", guardian2Name: "guardian2_name", guardian2Phone: "guardian2_phone", guardian2Relation: "guardian2_relation",
  guardian2Email: "guardian2_email", allowDuplicate: "allow_duplicate",
};
const YES = new Set(["yes", "y", "true", "1"]);
/** An uploaded .xlsx or .csv. A plain string is read as CSV text. */
export type ImportFile = string | { name: string; bytes: Uint8Array };

export interface ImportRowReport { line: number; admissionNo: string | null; name: string | null; classSection: string | null; errors: string[]; /** A child who starts on a later day: shown apart in the check. */ joining: boolean }
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
        ["", "Aarav Sharma", "2015-06-14", "male", "Class 4", "A", "Rajesh Sharma", "9876543210", "father", "rajesh@example.com", "", "", "Hindi", "", "Indian", "Sunrise Public School", "Peanut allergy", "Rajesh Sharma", "9876543210", "", "", "", "Sunita Sharma", "9876543211", "mother", ""],
      ],
    }, { newline: "\n" }) + "\n";
  }

  async dryRun(file: ImportFile): Promise<ImportReport> {
    return this.read("write", async (tx) => {
      const rows = await this.analyse(tx, file);
      // A child who starts later is not counted against the plan until their day.
      return this.report(rows, await this.admissions.roomWithin(tx, rows.filter((r) => !r.errors.length && !r.joining).length));
    });
  }

  /** All-or-nothing: any problem row stops the whole import before anything is written. */
  async commit(file: ImportFile) {
    return this.write("write", async (tx) => {
      // One lock for the whole import, taken before anything is counted or read: the plan count, the roll numbers and the duplicate check cannot change under it.
      await lockSchool(tx, this.ctx.schoolId);
      const rows = await this.analyse(tx, file);
      const failed = rows.filter((r) => r.errors.length);
      if (failed.length) throw new ValidationError({ file: `${failed.length} of ${rows.length} rows have problems. Run the check, fix the file and try again.` });
      // The same sentence the check shows: a file that passes the check is not refused later for something the check did not say.
      const limit = await this.admissions.roomWithin(tx, rows.filter((r) => !r.joining).length);
      if (limit) throw new LimitError(limit);
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

    const { years, current, classByName, places } = await this.places(tx);
    const used = new Set((await tx.select({ no: students.admissionNo }).from(students)).map((r) => r.no.toLowerCase()));
    const seen = new Set<string>();
    const people = new Map<string, number>();
    const todayIso = today();
    const out: Analysed[] = [];

    for (const [i, row] of parsed.rows.entries()) {
      const errors: string[] = [];
      const cell = (k: string) => row[k] || undefined;
      const className = cell("class"), sectionName = cell("section");
      const joinsOn = cell("joins_on") && isoDate(cell("joins_on")!), yearName = cell("joins_year");
      // A row with a joining day or year is for a child who starts later: the section (if any) is looked up in that year.
      const joiningRow = !!joinsOn || !!yearName;
      const year = yearName ? years.find((y) => y.name.toLowerCase() === yearName.toLowerCase()) : current;
      if (!yearName && !year) errors.push("class/section: Set the current academic year first");
      else if (yearName && !year) errors.push(`joins_year: ${yearName} is not an academic year of this school`);
      else if (year && current && !year.isCurrent && year.startsOn < current.startsOn) errors.push(`joins_year: ${year.name} is in the past`);
      // The day must be inside its year, the same rule as the admission form.
      const when = year && joinsOn ? planDay(year, year.isCurrent, joinsOn, todayIso) : year && yearName ? planDay(year, year.isCurrent, undefined, todayIso) : null;
      if (when?.error) errors.push(`joins_on: ${when.error}`);
      const key = (c: string, s: string) => `${year?.id}|${c.toLowerCase()}|${s.toLowerCase()}`;
      const place = className && sectionName && year ? places.get(key(className, sectionName)) ?? places.get(key(`class ${className}`, sectionName)) : undefined;
      const klass = className ? classByName.get(className.toLowerCase()) ?? classByName.get(`class ${className.toLowerCase()}`) : undefined;
      if (!className) errors.push("class: Required");
      else if (!klass) errors.push(`class: ${className} does not exist`);
      else if (!sectionName && !joiningRow) errors.push("section: Required");
      else if (sectionName && !place && year) errors.push(`class/section: ${className} ${sectionName} does not exist ${year.isCurrent ? "this year" : `in ${year.name}`}`);

      const gender = cell("gender")?.toLowerCase();
      const candidate = {
        admissionNo: cell("admission_no"), name: cell("name"), dob: cell("dob") && isoDate(cell("dob")!), gender: gender && (GENDER_WORDS[gender] ?? gender),
        sectionId: joiningRow ? undefined : place?.id, classId: klass, joinsOn, joinsYearId: joiningRow ? year?.id : undefined, joinsSectionId: joiningRow ? place?.id : undefined,
        pen: cell("pen"), allowDuplicate: YES.has((cell("allow_duplicate") ?? "").toLowerCase()),
        guardianName: cell("guardian_name"), guardianPhone: cell("guardian_phone"), guardianRelation: cell("guardian_relation")?.toLowerCase(),
        guardianEmail: cell("guardian_email"), guardian2Name: cell("guardian2_name"), guardian2Phone: cell("guardian2_phone"), guardian2Relation: cell("guardian2_relation")?.toLowerCase(),
        phone: cell("phone"), altPhone: cell("alt_phone"), motherTongue: cell("mother_tongue"), religion: cell("religion"),
        nationality: cell("nationality"), previousSchool: cell("previous_school"), medicalNotes: cell("medical_notes"), emergencyName: cell("emergency_name"),
        emergencyPhone: cell("emergency_phone"),
      };
      const check = studentInput.safeParse(candidate);
      if (!check.success) for (const issue of check.error.issues) errors.push(`${COLUMN_OF[String(issue.path[0])] ?? issue.path.join(".")}: ${issue.message}`);

      const no = candidate.admissionNo?.toLowerCase();
      if (no && used.has(no)) errors.push(`admission_no: ${candidate.admissionNo} is already used`);
      else if (no && seen.has(no)) errors.push(`admission_no: ${candidate.admissionNo} appears twice in the file`);
      if (no) seen.add(no);

      // The same rules as the admission form: a sensible age, and the same child is not entered twice unless allow_duplicate says yes.
      if (check.success && candidate.dob) {
        try { this.admissions.checkBirth(candidate.dob, when?.day ?? todayIso); }
        catch (err) { if (err instanceof ValidationError) errors.push(`dob: ${err.fieldErrors?.dob}`); else throw err; }
      }
      if (check.success && candidate.name) {
        // With no birth date the name and a guardian phone are matched. Every row goes in the file map, also one that allows a duplicate:
        // the next row is checked against it, because that is what the commit will find.
        const phones = [candidate.guardianPhone, candidate.guardian2Phone].filter((p): p is string => !!p).map(normalizePhone);
        const norm = candidate.name.toLowerCase().replace(/\s+/g, "");
        const keys = candidate.dob ? [`${norm}|${candidate.dob}`] : phones.map((p) => `${norm}|phone:${p}`);
        if (!candidate.allowDuplicate && keys.length) {
          const dup = await this.admissions.findDuplicate(tx, candidate.name, candidate.dob, undefined, phones);
          const same = candidate.dob ? "birth date" : "guardian phone";
          const earlier = keys.map((k) => people.get(k)).find((l) => l !== undefined);
          if (dup) errors.push(`name: ${dup.name} (${dup.admissionNo}) already has this name and ${same}. Write yes in allow_duplicate if it is a different child`);
          else if (earlier !== undefined) errors.push(`name: same name and ${same} as line ${earlier}. Write yes in allow_duplicate if it is a different child`);
        }
        for (const k of keys) if (!people.has(k)) people.set(k, parsed.lines[i]!);
      }

      const joining = !!when?.joining;
      out.push({
        line: parsed.lines[i]!, admissionNo: candidate.admissionNo ?? null, name: candidate.name ?? null,
        classSection: joiningRow ? `${place?.label ?? className ?? ""} (joins ${joinsOn ?? year?.startsOn ?? "later"}${year && !year.isCurrent ? `, ${year.name}` : ""})` : place?.label ?? null,
        errors, joining,
        input: errors.length === 0 && check.success ? check.data : null,
      });
    }
    return out;
  }

  /** Years that are current or later, every class by name, and their sections keyed `year|class|section` (lower-case). */
  private async places(tx: Tx) {
    const all = await tx.select().from(academicYears);
    const current = all.find((y) => y.isCurrent);
    const years = all.filter((y) => !current || y.startsOn >= current.startsOn);
    const rows = years.length ? await tx.select({ id: sections.id, name: sections.name, yearId: sections.yearId, className: classes.name }).from(sections)
      .innerJoin(classes, eq(classes.id, sections.classId)).where(inArray(sections.yearId, years.map((y) => y.id))) : [];
    const classByName = new Map((await tx.select({ id: classes.id, name: classes.name }).from(classes)).map((c) => [c.name.toLowerCase(), c.id]));
    return {
      years, current, classByName,
      places: new Map(rows.map((r) => [`${r.yearId}|${r.className.toLowerCase()}|${r.name.toLowerCase()}`, { id: r.id, label: sectionLabel(r.className, r.name) }])),
    };
  }
}
