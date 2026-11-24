import { and, asc, count, desc, eq, max, type SQL } from "drizzle-orm";
import { z } from "zod";
import { Passwords } from "@smw/auth";
import { nextSequence, schools, users, uuidv7, type Tx } from "@smw/db";
import { ConflictError, CrudService, by, countIn, ForbiddenError, LimitError, ValidationError, rethrowUnique, type Ctx, type ListQuery } from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import studentsFeature from "./feature";
import { StudentAccess, type Perm } from "./access";
import { studentInput, studentUpdateInput, type StudentInput } from "./inputs";
import { ParentAccounts, type GuardianDetails } from "./parent-accounts";
import { GENDERS, guardianConsents, guardians, studentDocuments, studentEnrollments, studentGuardians, students, STUDENT_STATUSES } from "./schema";
import { ageOn, firstPassword, normalizePhone, sectionLabel, today } from "./util";

export type Student = typeof students.$inferSelect;
export type StudentListRow = Student & { classSection: string | null; guardianName: string | null; guardianPhone: string | null };

/** Student cap: the plan allows `cap`; warn from 90%, block past 110%. */
export interface StudentCapacity {
  active: number; cap: number; percent: number; hardLimit: number;
  warning: boolean; blocked: boolean; message: string | null;
}

const WARN_AT = 0.9;
const BLOCK_ABOVE = 1.1;
/** Fields a blank edit-form value should clear instead of keeping the old value. */
const CLEARABLE = [
  "dob", "gender", "bloodGroup", "address", "apaarId", "category", "admissionDate", "phone", "altPhone", "motherTongue", "religion",
  "nationality", "previousSchool", "medicalNotes", "emergencyName", "emergencyPhone",
] as const;
const PHONES = ["phone", "altPhone", "emergencyPhone"] as const;
/** Mobiles are stored as 10 digits, the way guardian phones are. */
const withPhones = <T extends Record<string, unknown>>(v: T): T => {
  const out: Record<string, unknown> = { ...v };
  for (const k of PHONES) if (typeof out[k] === "string") out[k] = normalizePhone(out[k] as string);
  return out as T;
};

const isId = (v: string | undefined): v is string => !!v && z.uuid().safeParse(v).success;

/**
 * Students: admission (login, roll number, enrolment, cap), the list and record views, and edits.
 * Students see only themselves (`scopeClause`).
 */
export class StudentService extends CrudService<typeof students, Perm> {
  protected feature = studentsFeature;
  protected table = students;
  protected entityName = "Student";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = studentInput;
  protected updateSchema = studentUpdateInput;
  protected defaultSort = "createdAt";

  private readonly access: StudentAccess;
  private readonly parents: ParentAccounts;
  /** The guardian typed on the admission form, kept until the student row exists (keyed by the new id). */
  private readonly pendingGuardian = new Map<string, GuardianDetails>();

  constructor(ctx: Ctx) {
    super(ctx);
    this.access = new StudentAccess(ctx);
    this.parents = new ParentAccounts(ctx.schoolId);
  }

  protected authorize(permission: Perm, mode: "read" | "write") {
    super.authorize(this.access.permission(permission, mode), mode);
  }

  protected searchColumns() { return [students.name, students.admissionNo]; }
  protected sortColumns() {
    return { createdAt: students.createdAt, name: students.name, admissionNo: students.admissionNo, rollNo: students.rollNo };
  }
  protected filterClauses(f: Record<string, string | undefined>): (SQL | undefined)[] {
    return [
      isId(f.classId) ? eq(students.classId, f.classId) : undefined,
      isId(f.sectionId) ? eq(students.sectionId, f.sectionId) : undefined,
      f.status && (STUDENT_STATUSES as readonly string[]).includes(f.status) ? eq(students.status, f.status as Student["status"]) : undefined,
      f.gender && (GENDERS as readonly string[]).includes(f.gender) ? eq(students.gender, f.gender as NonNullable<Student["gender"]>) : undefined,
    ];
  }
  protected describe(r: Student) { return `${r.name} (${r.admissionNo})`; }
  protected scopeClause(tx: Tx) { return this.access.scope(tx); }

  // Medical notes and the emergency contact: a teacher sees them only for their own sections (PRD P8).
  protected async findOrThrow(tx: Tx, id: string) {
    return StudentAccess.redact(await super.findOrThrow(tx, id), await this.access.sensitiveSections(tx));
  }
  async list(query: ListQuery = {}) {
    const page = await super.list(query);
    const allowed = await this.read("read", (tx) => this.access.sensitiveSections(tx));
    return allowed ? { ...page, rows: page.rows.map((r) => StudentAccess.redact(r, allowed)) } : page;
  }

  /** Medical notes and emergency contact of one student; a teacher outside that student's sections is refused. */
  async medical(id: string) {
    return this.read("read", async (tx) => {
      const row = await super.findOrThrow(tx, id);
      const allowed = await this.access.sensitiveSections(tx);
      if (allowed && !(row.sectionId && allowed.has(row.sectionId))) throw new ForbiddenError();
      return { medicalNotes: row.medicalNotes, emergencyName: row.emergencyName, emergencyPhone: row.emergencyPhone };
    });
  }

  // ---------- views ----------

  /** The list the pages show: each student with class-section and the primary guardian's phone. */
  async listView(query: ListQuery = {}) {
    const page = await this.list(query);
    if (page.rows.length === 0) return { ...page, rows: [] as StudentListRow[] };
    const extra = await this.read("read", async (tx) => {
      const sectionIds = [...new Set(page.rows.map((r) => r.sectionId).filter((x): x is string => !!x))];
      const labels = new Map<string, string>();
      if (sectionIds.length) {
        const secs = await tx.select({ id: sections.id, name: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId));
        for (const s of secs) labels.set(s.id, sectionLabel(s.className, s.name));
      }
      const links = await tx.select({ studentId: studentGuardians.studentId, name: guardians.name, phone: guardians.phone }).from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));
      const primary = new Map<string, { name: string; phone: string | null }>();
      for (const l of links) if (!primary.has(l.studentId)) primary.set(l.studentId, l);
      return { labels, primary };
    });
    const rows = page.rows.map((r): StudentListRow => ({
      ...r,
      classSection: r.sectionId ? (extra.labels.get(r.sectionId) ?? null) : null,
      guardianName: extra.primary.get(r.id)?.name ?? null,
      guardianPhone: extra.primary.get(r.id)?.phone ?? null,
    }));
    return { ...page, rows };
  }

  /** Everything the record page header and Overview tab need. */
  async overview(id: string) {
    return this.read("read", async (tx) => {
      const student = await this.findOrThrow(tx, id);
      const [place] = student.sectionId
        ? await tx.select({ section: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, student.sectionId)).limit(1)
        : [];
      const history = await tx.select({
        id: studentEnrollments.id, year: academicYears.name, rollNo: studentEnrollments.rollNo, outcome: studentEnrollments.outcome,
        className: classes.name, section: sections.name,
      }).from(studentEnrollments)
        .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.yearId))
        .leftJoin(classes, eq(classes.id, studentEnrollments.classId))
        .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
        .where(eq(studentEnrollments.studentId, id)).orderBy(desc(academicYears.startsOn));
      const n = async (t: typeof studentGuardians | typeof studentDocuments | typeof guardianConsents) =>
        Number((await tx.select({ n: count() }).from(t).where(eq(t.studentId, id)))[0]?.n ?? 0);
      return {
        student,
        classSection: place ? sectionLabel(place.className, place.section) : null,
        className: place?.className ?? null,
        age: ageOn(student.dob),
        enrollments: history.map((h) => ({ ...h, classSection: h.className && h.section ? sectionLabel(h.className, h.section) : null })),
        counts: { guardians: await n(studentGuardians), documents: await n(studentDocuments), consents: await n(guardianConsents) },
      };
    });
  }

  /** Classes and sections of the current year, for forms and filters. */
  async lookups() {
    return this.read("read", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      const rows = await tx.select({ id: sections.id, classId: sections.classId, name: sections.name, className: classes.name })
        .from(sections).innerJoin(classes, eq(classes.id, sections.classId))
        .where(year ? eq(sections.yearId, year.id) : undefined).orderBy(asc(classes.grade), asc(sections.name));
      const classOptions = [...new Map(rows.map((r) => [r.classId, { id: r.classId, name: r.className }])).values()];
      return { classes: classOptions, sections: rows.map((r) => ({ id: r.id, classId: r.classId, label: sectionLabel(r.className, r.name) })) };
    });
  }

  /** The school's short name (used by the seed to size the demo data). */
  async schoolSlug(): Promise<string> {
    return this.read("write", async (tx) => (await tx.select({ slug: schools.slug }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1))[0]?.slug ?? "");
  }

  /** Headline numbers for the list page (staff). */
  async stats() {
    return this.read("write", async (tx) => {
      const byStatus = await tx.select({ status: students.status, n: count() }).from(students).groupBy(students.status);
      const get = (s: Student["status"]) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);
      return { alumni: get("alumni"), left: get("left"), capacity: await this.capacityIn(tx) };
    });
  }

  // ---------- plan cap ----------

  async capacity(): Promise<StudentCapacity> {
    return this.read("write", (tx) => this.capacityIn(tx));
  }

  private async capacityIn(tx: Tx): Promise<StudentCapacity> {
    const [[row], [school]] = await Promise.all([
      tx.select({ n: count() }).from(students).where(eq(students.status, "active")),
      tx.select({ cap: schools.studentCap }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1),
    ]);
    const active = Number(row?.n ?? 0), cap = school?.cap ?? 0;
    const hardLimit = Math.floor(cap * BLOCK_ABOVE);
    const percent = cap > 0 ? Math.round((active / cap) * 100) : 0;
    const warning = cap > 0 && active >= cap * WARN_AT;
    const message = !warning ? null
      : active >= cap ? `You have ${active} students against a plan limit of ${cap}. New admissions stop at ${hardLimit}. Upgrade the plan to keep admitting.`
        : `You have used ${percent}% of your plan (${active} of ${cap} students).`;
    return { active, cap, percent, hardLimit, warning, blocked: active >= hardLimit, message };
  }

  /** A message when admitting `n` more students would pass the hard limit, otherwise null (for the import check). */
  async roomWithin(tx: Tx, n: number): Promise<string | null> {
    this.authorize("write", "read");
    const cap = await this.capacityIn(tx);
    return cap.active + n > cap.hardLimit ? `Importing ${n} students would pass the plan limit (${cap.active} now, admissions stop at ${cap.hardLimit}).` : null;
  }

  // ---------- admission ----------

  /** Admit a student and report the plan usage afterwards, so the UI can show the 90% warning. */
  async admit(input: unknown) {
    const student = await this.create(input);
    return { student, capacity: await this.capacity() };
  }

  /** Admit inside a transaction the caller already holds (the CSV import writes many students in one). */
  async admitWithin(tx: Tx, data: StudentInput): Promise<Student> {
    this.authorize("write", "write");
    const values = await this.beforeCreate(tx, data);
    const [row] = await tx.insert(students).values({ ...values, schoolId: this.ctx.schoolId } as typeof students.$inferInsert).returning();
    await this.afterCreate(tx, row!);
    return row!;
  }

  private guardianOf(d: StudentInput): GuardianDetails | null {
    return d.guardianName && d.guardianPhone ? { name: d.guardianName, phone: d.guardianPhone, relation: d.guardianRelation ?? "guardian", email: d.guardianEmail } : null;
  }

  protected async beforeCreate(tx: Tx, input: Record<string, unknown>) {
    const d = input as StudentInput;
    const cap = await this.capacityIn(tx);
    if (cap.active + 1 > cap.hardLimit) {
      throw new LimitError(`Your plan allows ${cap.cap} students and admissions stop at ${cap.hardLimit}. Upgrade the plan to admit more.`);
    }
    const section = d.sectionId ? await this.sectionOrThrow(tx, d.sectionId) : null;
    const admissionNo = d.admissionNo ?? await this.nextAdmissionNo(tx);
    const [taken] = await tx.select({ id: students.id }).from(students).where(eq(students.admissionNo, admissionNo)).limit(1);
    if (taken) throw new ConflictError(`Admission number ${admissionNo} is already used.`);

    let login;
    try {
      [login] = await tx.insert(users).values({
        schoolId: this.ctx.schoolId, role: "student", loginId: admissionNo, name: d.name,
        passwordHash: await Passwords.hash(firstPassword(d.dob, admissionNo)), status: "active", mustChangePassword: true,
      }).returning();
    } catch (err) { rethrowUnique(err, `${admissionNo} is already used as a login.`); }

    const id = uuidv7();
    const guardian = this.guardianOf(d);
    if (guardian) this.pendingGuardian.set(id, guardian);
    return {
      ...withPhones({
        phone: d.phone, altPhone: d.altPhone, emergencyPhone: d.emergencyPhone, motherTongue: d.motherTongue, religion: d.religion,
        nationality: d.nationality, previousSchool: d.previousSchool, medicalNotes: d.medicalNotes, emergencyName: d.emergencyName,
      }),
      id, admissionNo, name: d.name, dob: d.dob, gender: d.gender, bloodGroup: d.bloodGroup, address: d.address, apaarId: d.apaarId, rteQuota: d.rteQuota ?? false, category: d.category,
      classId: section?.classId ?? d.classId, sectionId: section?.id, rollNo: d.rollNo ?? (section ? await this.nextRoll(tx, section.id) : undefined),
      admissionDate: d.admissionDate ?? today(), status: "active", userId: login!.id,
    };
  }

  protected async afterCreate(tx: Tx, row: Student) {
    const [current] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    const yearId = current?.id ?? (row.sectionId ? (await this.sectionOrThrow(tx, row.sectionId)).yearId : null);
    if (yearId) {
      await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: row.id, yearId, classId: row.classId, sectionId: row.sectionId, rollNo: row.rollNo, outcome: "studying" });
    }
    const guardian = this.pendingGuardian.get(row.id);
    this.pendingGuardian.delete(row.id);
    if (guardian) await this.parents.link(tx, row.id, guardian);
  }

  /** "<first two letters of the school slug><4 digits>", gap-free, skipping numbers typed in by hand. */
  private async nextAdmissionNo(tx: Tx) {
    const [school] = await tx.select({ slug: schools.slug }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    const prefix = (school?.slug ?? "").replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() || "ST";
    for (;;) {
      const candidate = `${prefix}${String(await nextSequence(tx, this.ctx.schoolId, "admission")).padStart(4, "0")}`;
      const [used] = await tx.select({ id: students.id }).from(students).where(eq(students.admissionNo, candidate)).limit(1);
      if (!used) return candidate;
    }
  }

  private async nextRoll(tx: Tx, sectionId: string) {
    const [r] = await tx.select({ top: max(students.rollNo) }).from(students).where(and(eq(students.sectionId, sectionId), eq(students.status, "active")));
    return (r?.top ?? 0) + 1;
  }

  private async sectionOrThrow(tx: Tx, id: string) {
    const [s] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1);
    if (!s) throw new ValidationError({ sectionId: "Choose a section" });
    const [current] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    // Admission and edits place students in this year; moving up a year is the promotion service's job.
    if (current && s.yearId !== current.id) throw new ValidationError({ sectionId: "Choose a section of the current academic year" });
    return s;
  }

  // ---------- edit and delete ----------

  protected async beforeUpdate(tx: Tx, existing: Student, data: Record<string, unknown>) {
    const next: Record<string, unknown> = withPhones(data);
    for (const key of CLEARABLE) if (key in data && data[key] === undefined) next[key] = null;
    const sectionId = data.sectionId as string | undefined;
    if (sectionId && sectionId !== existing.sectionId) {
      const section = await this.sectionOrThrow(tx, sectionId);
      next.classId = section.classId;
      next.rollNo = (data.rollNo as number | undefined) ?? await this.nextRoll(tx, section.id);
      await tx.update(studentEnrollments).set({ classId: section.classId, sectionId: section.id, rollNo: next.rollNo as number })
        .where(and(eq(studentEnrollments.studentId, existing.id), eq(studentEnrollments.yearId, section.yearId)));
    }
    if (data.status && data.status !== existing.status) {
      // Bringing someone back to active counts against the plan like a new admission.
      if (data.status === "active") {
        const cap = await this.capacityIn(tx);
        if (cap.active + 1 > cap.hardLimit) throw new LimitError("Your plan is full. Upgrade the plan to make this student active again.");
      }
      next.leftOn = data.status === "left" ? today() : null;
    }
    return next;
  }

  /** Money records outlive the student's page: a student with bills, receipts, advances or UPI slips is never deleted (mark them left instead). */
  protected async usage(tx: Tx, s: Student): Promise<[string, number][]> {
    const n = (table: string) => countIn(tx, table, by("student_id", s.id));
    const [bills, receipts, advances, slips] = await Promise.all([n("fee_invoices"), n("fee_receipts"), n("fee_advances"), n("fee_upi_slips")]);
    return [["fee bills", bills], ["fee receipts", receipts], ["advances or deposits", advances], ["UPI slips", slips]];
  }

  protected async beforeRemove(tx: Tx, existing: Student) {
    // The base class checks `usage` after this hook, but this hook deletes files first, so check here as well.
    const used = (await this.usage(tx, existing)).filter(([, n]) => n > 0);
    if (used.length) throw this.inUse(`${used.map(([what, n]) => `${n} ${what}`).join(", ")}. Mark the student as left instead`);
    const files = await tx.select({ key: studentDocuments.fileKey }).from(studentDocuments).where(eq(studentDocuments.studentId, existing.id));
    const keys = [...files.map((f) => f.key), ...(existing.photoKey ? [existing.photoKey] : [])];
    // shortcut: files are removed before the row; a failed delete leaves an orphan object, never a broken record.
    await Promise.allSettled(keys.map((k) => services().storage.delete(k)));
    await this.parents.releaseAll(tx, existing.id);
    if (existing.userId) await tx.delete(users).where(eq(users.id, existing.userId));
  }
}
