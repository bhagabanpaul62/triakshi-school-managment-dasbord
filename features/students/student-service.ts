import { and, asc, count, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { Passwords } from "@smw/auth";
import { nextSequence, schools, sessions, users, uuidv7, type Tx } from "@smw/db";
import { ConflictError, CrudService, by, countIn, ForbiddenError, LimitError, NotFoundError, ValidationError, refuseSupport, rethrowUnique, type Ctx, type ListQuery } from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import studentsFeature from "./feature";
import { StudentAccess, type Perm } from "./access";
import { capacityOf, currentYearSection, nextRollIn, type StudentCapacity } from "./capacity";
import { studentInput, studentUpdateInput, type StudentInput } from "./inputs";
import { ParentAccounts, type GuardianDetails } from "./parent-accounts";
import { GENDERS, guardianConsents, guardians, studentDocuments, studentEnrollments, studentGuardians, students, STUDENT_STATUSES } from "./schema";
import { addDays, ageOn, classAgeWarning, firstPassword, leftReasonText, normalizePhone, sectionLabel, today } from "./util";

export type { StudentCapacity };
export type Student = typeof students.$inferSelect;
export type StudentListRow = Student & { classSection: string | null; guardianName: string | null; guardianPhone: string | null };
type SectionRow = typeof sections.$inferSelect;
/** Someone already in the school with the same name and birth date. */
export interface DuplicateOf { id: string; name: string; admissionNo: string; status: Student["status"] }

/** Age at joining must be sensible for any class (2 to 25 years). The class-by-class age is only a hint. */
const MIN_AGE = 2, MAX_AGE = 25;
/** Fields a blank edit-form value should clear instead of keeping the old value. */
const CLEARABLE = [
  "dob", "gender", "bloodGroup", "address", "apaarId", "pen", "category", "admissionDate", "phone", "altPhone", "motherTongue", "religion",
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
  private readonly pendingGuardians = new Map<string, GuardianDetails[]>();

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
      // A child who left keeps their last section, so a section is read as "who studies there": active, unless a status is asked for.
      isId(f.sectionId) ? and(eq(students.sectionId, f.sectionId), f.status ? undefined : eq(students.status, "active")) : undefined,
      f.status && (STUDENT_STATUSES as readonly string[]).includes(f.status) ? eq(students.status, f.status as Student["status"]) : undefined,
      f.gender && (GENDERS as readonly string[]).includes(f.gender) ? eq(students.gender, f.gender as NonNullable<Student["gender"]>) : undefined,
    ];
  }
  protected describe(r: Student) { return `${r.name} (${r.admissionNo})`; }
  // Caste category, religion and the APAAR id are personal enough that the log says only "changed".
  protected auditHidden() { return ["category", "religion", "apaarId", "pen", "emergencyName", "emergencyPhone"] as const; }
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

  /** The list the pages show: each student with class-section and the primary guardian's phone. A joining child shows the class and the planned section. */
  async listView(query: ListQuery = {}) {
    const page = await this.list(query);
    if (page.rows.length === 0) return { ...page, rows: [] as StudentListRow[] };
    const extra = await this.read("read", async (tx) => {
      const sectionIds = [...new Set(page.rows.flatMap((r) => [r.sectionId, r.joinsSectionId]).filter((x): x is string => !!x))];
      const classIds = [...new Set(page.rows.filter((r) => r.status === "joining" && !r.joinsSectionId).map((r) => r.classId).filter((x): x is string => !!x))];
      const labels = new Map<string, string>();
      if (sectionIds.length) {
        const secs = await tx.select({ id: sections.id, name: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).where(inArray(sections.id, sectionIds));
        for (const s of secs) labels.set(s.id, sectionLabel(s.className, s.name));
      }
      const classNames = new Map(classIds.length ? (await tx.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds))).map((c) => [c.id, c.name]) : []);
      const links = await tx.select({ studentId: studentGuardians.studentId, name: guardians.name, phone: guardians.phone }).from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(inArray(studentGuardians.studentId, page.rows.map((r) => r.id)))
        .orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));
      const primary = new Map<string, { name: string; phone: string | null }>();
      for (const l of links) if (!primary.has(l.studentId)) primary.set(l.studentId, l);
      return { labels, classNames, primary };
    });
    const place = (r: Student) => r.status === "joining"
      ? (r.joinsSectionId ? extra.labels.get(r.joinsSectionId) : r.classId ? extra.classNames.get(r.classId) : null) ?? null
      : r.sectionId ? (extra.labels.get(r.sectionId) ?? null) : null;
    const rows = page.rows.map((r): StudentListRow => ({
      ...r,
      classSection: place(r),
      guardianName: extra.primary.get(r.id)?.name ?? null,
      guardianPhone: extra.primary.get(r.id)?.phone ?? null,
    }));
    return { ...page, rows };
  }

  /** Everything the record page header and Overview tab need. */
  async overview(id: string) {
    return this.read("read", async (tx) => {
      const student = await this.findOrThrow(tx, id);
      // A joining child has no section yet: show the class, and the planned section on its own. A child who left keeps their last section.
      const [place] = student.sectionId
        ? await tx.select({ section: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, student.sectionId)).limit(1)
        : [];
      const [klass] = !place && student.classId ? await tx.select({ name: classes.name }).from(classes).where(eq(classes.id, student.classId)).limit(1) : [];
      const [planned] = student.joinsSectionId
        ? await tx.select({ section: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, student.joinsSectionId)).limit(1)
        : [];
      const [joinYear] = student.joinsYearId ? await tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, student.joinsYearId)).limit(1) : [];
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
        className: place?.className ?? klass?.name ?? null,
        age: ageOn(student.dob),
        leftReason: leftReasonText(student.leftReason),
        joining: student.status === "joining"
          ? { on: student.joinsOn, yearName: joinYear?.name ?? null, plannedSection: planned ? sectionLabel(planned.className, planned.section) : null }
          : null,
        enrollments: history.map((h) => ({ ...h, classSection: h.className && h.section ? sectionLabel(h.className, h.section) : null })),
        counts: { guardians: await n(studentGuardians), documents: await n(studentDocuments), consents: await n(guardianConsents) },
      };
    });
  }

  /**
   * Classes and sections of the current year, for forms and filters. `joining` is for a child who starts later: the years that exist and are
   * current or later, their sections, and a plain sentence (or null) when the next year is not ready to place anyone.
   */
  async lookups() {
    return this.read("read", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      const rows = await tx.select({ id: sections.id, classId: sections.classId, name: sections.name, className: classes.name })
        .from(sections).innerJoin(classes, eq(classes.id, sections.classId))
        .where(year ? eq(sections.yearId, year.id) : undefined).orderBy(asc(classes.grade), asc(sections.name));
      const classOptions = [...new Map(rows.map((r) => [r.classId, { id: r.classId, name: r.className }])).values()];
      const allClasses = (await tx.select({ id: classes.id, name: classes.name, grade: classes.grade }).from(classes).orderBy(asc(classes.grade)));
      const years = (await tx.select().from(academicYears).where(year ? gte(academicYears.startsOn, year.startsOn) : undefined).orderBy(asc(academicYears.startsOn)));
      const later = await tx.select({ id: sections.id, yearId: sections.yearId, classId: sections.classId, name: sections.name, className: classes.name }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).where(years.length ? inArray(sections.yearId, years.map((y) => y.id)) : undefined)
        .orderBy(asc(classes.grade), asc(sections.name));
      const gap = years.filter((y) => !y.isCurrent && !later.some((s) => s.yearId === y.id)).map((y) => y.name);
      const next = years.filter((y) => !y.isCurrent);
      return {
        classes: classOptions,
        sections: rows.map((r) => ({ id: r.id, classId: r.classId, label: sectionLabel(r.className, r.name) })),
        joining: {
          classes: allClasses,
          years: years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent, startsOn: y.startsOn })),
          sections: later.map((s) => ({ id: s.id, yearId: s.yearId, classId: s.classId, label: `${sectionLabel(s.className, s.name)} (${years.find((y) => y.id === s.yearId)?.name})` })),
          notice: next.length === 0 ? "There is no next academic year yet, so a child cannot be placed in it."
            : gap.length ? `${gap.join(" and ")} ${gap.length > 1 ? "have" : "has"} no sections yet, so a child cannot be given a planned section.` : null,
        },
      };
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
      return { alumni: get("alumni"), left: get("left"), joining: get("joining"), capacity: await this.capacityIn(tx) };
    });
  }

  // ---------- plan cap ----------

  async capacity(): Promise<StudentCapacity> {
    return this.read("write", (tx) => this.capacityIn(tx));
  }

  private capacityIn(tx: Tx): Promise<StudentCapacity> {
    return capacityOf(tx, this.ctx.schoolId);
  }

  /** A message when admitting `n` more students would pass the hard limit, otherwise null (for the import check). */
  async roomWithin(tx: Tx, n: number): Promise<string | null> {
    this.authorize("write", "read");
    const cap = await this.capacityIn(tx);
    return cap.active + n > cap.hardLimit ? `Importing ${n} students would pass the plan limit (${cap.active} now, admissions stop at ${cap.hardLimit}).` : null;
  }

  // ---------- admission ----------

  /** Admit a student and report the plan usage afterwards, so the UI can show the 90% warning. `warnings` are hints (class age), never refusals. */
  async admit(input: unknown) {
    const student = await this.create(input);
    const warnings = await this.read("write", async (tx) => {
      const [c] = student.classId ? await tx.select({ name: classes.name, grade: classes.grade }).from(classes).where(eq(classes.id, student.classId)).limit(1) : [];
      return [c ? classAgeWarning(student.dob, c.grade, c.name, student.joinsOn ?? today()) : null].filter((w): w is string => !!w);
    });
    return { student, capacity: await this.capacity(), warnings };
  }

  /** Admit inside a transaction the caller already holds (the CSV import writes many students in one). */
  async admitWithin(tx: Tx, data: StudentInput): Promise<Student> {
    this.authorize("write", "write");
    const values = await this.beforeCreate(tx, data);
    const [row] = await tx.insert(students).values({ ...values, schoolId: this.ctx.schoolId } as typeof students.$inferInsert).returning();
    await this.afterCreate(tx, row!);
    return row!;
  }

  private guardiansOf(d: StudentInput): GuardianDetails[] {
    const one: GuardianDetails | null = d.guardianName && d.guardianPhone ? { name: d.guardianName, phone: d.guardianPhone, relation: d.guardianRelation ?? "guardian", email: d.guardianEmail } : null;
    const two: GuardianDetails | null = d.guardian2Name && d.guardian2Phone ? { name: d.guardian2Name, phone: d.guardian2Phone, relation: d.guardian2Relation ?? "guardian", email: d.guardian2Email } : null;
    // One phone for both is one guardian, linked once.
    return [one, two && one && normalizePhone(two.phone) === normalizePhone(one.phone) ? null : two].filter((g): g is GuardianDetails => !!g);
  }

  /**
   * Where the new child goes. Starting later (a joining day after today, or a year that is not the current one) makes them "joining":
   * the class is set, the section stays empty and the planned section waits in `joinsSectionId`. Otherwise it is a normal admission.
   */
  private async placeOf(tx: Tx, d: StudentInput) {
    const todayIso = today();
    const [current] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    const sec = d.sectionId ? await this.findSection(tx, d.sectionId, "sectionId") : null;
    const plan = d.joinsSectionId ? await this.findSection(tx, d.joinsSectionId, "joinsSectionId") : null;
    const pickedYear = d.joinsYearId ?? plan?.yearId ?? (sec && current && sec.yearId !== current.id ? sec.yearId : undefined);
    const joining = (!!d.joinsOn && d.joinsOn > todayIso) || (!!pickedYear && pickedYear !== current?.id);
    if (!joining) {
      const section = sec ?? plan;
      return { joining: false as const, section, classId: section?.classId ?? await this.classOrThrow(tx, d.classId), year: null, joinsOn: null };
    }
    const yearId = pickedYear ?? current?.id;
    const [year] = yearId ? await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1) : [];
    if (!year) throw new ValidationError({ joinsYearId: yearId ? "Choose a year that exists" : "Choose the academic year they join" });
    if (current && !year.isCurrent && year.startsOn < current.startsOn) throw new ValidationError({ joinsYearId: "Choose the current year or a later one" });
    if (sec && !plan && sec.yearId !== year.id) throw new ValidationError({ sectionId: `This section is not in ${year.name}. Choose the planned section in the joining part.` });
    if (plan && plan.yearId !== year.id) throw new ValidationError({ joinsSectionId: `This section is not in ${year.name}` });
    const planned = plan ?? sec;
    if (planned && d.classId && planned.classId !== d.classId) throw new ValidationError({ joinsSectionId: "This section belongs to another class" });
    const classId = planned?.classId ?? await this.classOrThrow(tx, d.classId, "Choose the class they will join");
    if (!classId) throw new ValidationError({ classId: "Choose the class they will join" });
    return { joining: true as const, section: planned, classId, year, joinsOn: d.joinsOn ?? (year.startsOn > todayIso ? year.startsOn : addDays(todayIso, 1)) };
  }

  protected async beforeCreate(tx: Tx, input: Record<string, unknown>) {
    const d = input as StudentInput;
    const place = await this.placeOf(tx, d);
    this.checkBirth(d.dob, place.joinsOn ?? d.admissionDate ?? today());
    // A child who has not started yet is not counted against the plan: the limit is checked on their day.
    if (!place.joining) {
      const cap = await this.capacityIn(tx);
      if (cap.active + 1 > cap.hardLimit) throw new LimitError(`Your plan allows ${cap.cap} students and admissions stop at ${cap.hardLimit}. Upgrade the plan to admit more.`);
    }
    const id = uuidv7();
    await this.refuseDuplicate(tx, { id, name: d.name, dob: d.dob, allow: d.allowDuplicate });
    const admissionNo = d.admissionNo ?? await this.nextAdmissionNo(tx);
    const [taken] = await tx.select({ id: students.id }).from(students).where(eq(students.admissionNo, admissionNo)).limit(1);
    if (taken) throw new ConflictError(`Admission number ${admissionNo} is already used.`);

    let login;
    try {
      [login] = await tx.insert(users).values({
        schoolId: this.ctx.schoolId, role: "student", loginId: admissionNo, name: d.name,
        // Off until their day: join-due switches it on.
        passwordHash: await Passwords.hash(firstPassword(d.dob, admissionNo)), status: place.joining ? "disabled" : "active", mustChangePassword: true,
      }).returning();
    } catch (err) { rethrowUnique(err, `${admissionNo} is already used as a login.`); }

    const guardiansOf = this.guardiansOf(d);
    if (guardiansOf.length) this.pendingGuardians.set(id, guardiansOf);
    const section = place.joining ? null : place.section;
    return {
      ...withPhones({
        phone: d.phone, altPhone: d.altPhone, emergencyPhone: d.emergencyPhone, motherTongue: d.motherTongue, religion: d.religion,
        nationality: d.nationality, previousSchool: d.previousSchool, medicalNotes: d.medicalNotes, emergencyName: d.emergencyName,
      }),
      id, admissionNo, name: d.name, dob: d.dob, gender: d.gender, bloodGroup: d.bloodGroup, address: d.address, apaarId: d.apaarId, pen: d.pen, rteQuota: d.rteQuota ?? false, category: d.category,
      classId: place.classId, sectionId: section?.id, rollNo: section ? (d.rollNo ?? await nextRollIn(tx, section.id)) : undefined,
      admissionDate: d.admissionDate ?? today(), status: place.joining ? "joining" : "active", userId: login!.id,
      ...(place.joining ? { joinsOn: place.joinsOn, joinsYearId: place.year.id, joinsSectionId: place.section?.id } : {}),
    };
  }

  protected async afterCreate(tx: Tx, row: Student) {
    const [current] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    // A joining child is enrolled in the year they join, with no section until their day.
    const yearId = row.status === "joining" ? row.joinsYearId : current?.id ?? (row.sectionId ? (await this.findSection(tx, row.sectionId, "sectionId")).yearId : null);
    if (yearId) {
      await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: row.id, yearId, classId: row.classId, sectionId: row.sectionId, rollNo: row.rollNo, outcome: "studying" });
    }
    const guardiansOf = this.pendingGuardians.get(row.id) ?? [];
    this.pendingGuardians.delete(row.id);
    for (const g of guardiansOf) await this.parents.link(tx, row.id, g);
  }

  // ---------- rules shared by admission, edit and import ----------

  /** A birth date in the future, or an age outside 2 to 25 on the day they join, is refused. The class-by-class age is only a warning (see `admit`). */
  checkBirth(dob: string | undefined | null, on: string) {
    if (!dob) return;
    if (dob > today()) throw new ValidationError({ dob: "The birth date cannot be in the future" });
    const age = ageOn(dob, on)!;
    if (age < MIN_AGE || age > MAX_AGE) throw new ValidationError({ dob: `A child must be ${MIN_AGE} to ${MAX_AGE} years old when they join. Check the birth date.` });
  }

  /** Joining, active or left students with this name (case and spaces ignored) and birth date, apart from `exceptId`. Takes a lock per child so two admissions at once cannot both pass. */
  async findDuplicate(tx: Tx, name: string, dob: string, exceptId?: string): Promise<DuplicateOf | undefined> {
    const norm = name.toLowerCase().replace(/\s+/g, "");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.ctx.schoolId}|${norm}|${dob}`}, 0))`);
    const [dup] = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, status: students.status }).from(students)
      .where(and(eq(students.dob, dob), inArray(students.status, ["joining", "active", "left"]), sql`lower(regexp_replace(${students.name}, '\\s+', '', 'g')) = ${norm}`, exceptId ? ne(students.id, exceptId) : undefined))
      .orderBy(asc(students.createdAt)).limit(1);
    return dup;
  }

  /** Refuse a second record of the same child, naming the first, unless the office ticked "different child" (that is written to the audit log). */
  protected async refuseDuplicate(tx: Tx, c: { id: string; name: string; dob: string | undefined | null; allow?: boolean; exceptId?: string }) {
    if (!c.dob) return;
    const dup = await this.findDuplicate(tx, c.name, c.dob, c.exceptId);
    if (!dup) return;
    if (c.allow) {
      await this.audit(tx, { action: "allow_duplicate", entity: "Student", entityId: c.id, summary: `${c.name} was saved although ${dup.name} (${dup.admissionNo}) has the same name and birth date` });
      return;
    }
    const message = `${dup.name} (${dup.admissionNo}) ${dup.status === "left" ? "left the school and" : "is already in the school and"} has the same name and birth date. If this is a different child, tick "This is a different child".`;
    throw new ValidationError({ allowDuplicate: message, _open: `/app/students/${dup.id}` }, message);
  }

  private async classOrThrow(tx: Tx, id: string | undefined, message = "Choose a class"): Promise<string | undefined> {
    if (!id) return undefined;
    const [c] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, id)).limit(1);
    if (!c) throw new ValidationError({ classId: message });
    return c.id;
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

  private async findSection(tx: Tx, id: string, field: string): Promise<SectionRow> {
    const [s] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1);
    if (!s) throw new ValidationError({ [field]: "Choose a section" });
    return s;
  }

  /** A section of the current year: edits place students in this year; moving up a year is promotion, and starting later is joining. */
  protected sectionOrThrow(tx: Tx, id: string) {
    return currentYearSection(tx, id);
  }

  // ---------- edit and delete ----------

  protected async beforeUpdate(tx: Tx, existing: Student, data: Record<string, unknown>) {
    const next: Record<string, unknown> = withPhones(data);
    delete next.allowDuplicate;
    for (const key of CLEARABLE) if (key in data && data[key] === undefined) next[key] = null;
    const sectionId = data.sectionId as string | undefined;
    const planned = data.joinsSectionId as string | undefined;
    if (existing.status === "joining") {
      // Placed on their day, not by an edit: the section field means the planned one.
      delete next.sectionId; delete next.rollNo;
      if (planned && planned !== existing.joinsSectionId) {
        const section = await this.findSection(tx, planned, "joinsSectionId");
        if (section.yearId !== existing.joinsYearId) throw new ValidationError({ joinsSectionId: "Choose a section of the year they join" });
        next.classId = section.classId;
        await tx.update(studentEnrollments).set({ classId: section.classId }).where(and(eq(studentEnrollments.studentId, existing.id), eq(studentEnrollments.yearId, section.yearId)));
      } else if (!planned && "joinsSectionId" in data) next.joinsSectionId = null;
    } else {
      delete next.joinsSectionId;
      if (sectionId && sectionId !== existing.sectionId) {
        if (existing.status !== "active") throw new ValidationError({ sectionId: "Use Bring back to place a student who left" });
        const section = await this.sectionOrThrow(tx, sectionId);
        next.classId = section.classId;
        next.rollNo = (data.rollNo as number | undefined) ?? await nextRollIn(tx, section.id);
        await tx.update(studentEnrollments).set({ classId: section.classId, sectionId: section.id, rollNo: next.rollNo as number })
          .where(and(eq(studentEnrollments.studentId, existing.id), eq(studentEnrollments.yearId, section.yearId)));
      }
    }
    const name = (data.name as string | undefined) ?? existing.name;
    const dob = "dob" in data ? (data.dob as string | undefined) ?? null : existing.dob;
    const dobChanged = "dob" in data && dob !== existing.dob;
    if (dobChanged) this.checkBirth(dob, existing.joinsOn ?? existing.admissionDate ?? today());
    // Only a change of name or birth date can create a duplicate, and the child is never a duplicate of themselves.
    if ((dobChanged || name !== existing.name) && dob) await this.refuseDuplicate(tx, { id: existing.id, exceptId: existing.id, name, dob, allow: data.allowDuplicate as boolean | undefined });
    return next;
  }

  /** Money records outlive the student's page: a student with bills, receipts, advances or UPI slips is never deleted (mark them left instead). */
  protected async usage(tx: Tx, s: Student): Promise<[string, number][]> {
    const n = (table: string) => countIn(tx, table, by("student_id", s.id));
    // Old receipts stay until a school is moved, and they cascade on delete: count them too.
    const [bills, receipts, advances, slips, old] = await Promise.all([n("fee_invoices"), n("fee_receipts"), n("fee_advances"), n("fee_upi_slips"), n("fee_payments")]);
    return [["fee bills", bills], ["fee receipts", receipts + old], ["advances or deposits", advances], ["UPI slips", slips]];
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

  // ---------- erasure (DPDP) ----------

  /** What blanking a left student's optional data does, shown before the admin types the confirmation. Lists everything that will go. */
  async erasePreview(id: string): Promise<ErasePreview> {
    refuseSupport(this.ctx, "erase");
    return this.read("read", async (tx) => {
      this.adminOnly();
      const s = await super.findOrThrow(tx, id);
      const guardiansOf = await this.eraseGuardians(tx, s.id);
      const docs = await countIn(tx, "student_documents", by("student_id", s.id));
      const gone = guardiansOf.filter((g) => !g.otherActive);
      const logins = [s.userId, ...gone.map((g) => g.userId)].filter((x): x is string => !!x);
      const enquiries = await this.linkedEnquiries(tx, s.id);
      const scrub = await this.auditScrubCount(tx, [s.id, ...gone.map((g) => g.id), ...logins, ...enquiries]);
      const set = (label: string, value: unknown) => ({ label, filled: value !== null && value !== undefined && value !== "" });
      return {
        id: s.id, name: s.name, admissionNo: s.admissionNo, status: s.status,
        refusal: s.status === "active" || s.status === "joining" ? "A student who is studying here, or about to join, cannot be erased. Mark the student as left first (withdraw them if they have not started)." : null,
        blank: [
          set("Phone numbers", s.phone ?? s.altPhone), set("Home address", s.address), set("Photo", s.photoKey), set("Medical notes", s.medicalNotes),
          set("Emergency contact", s.emergencyName ?? s.emergencyPhone), set("Blood group", s.bloodGroup), set("APAAR ID", s.apaarId), set("PEN", s.pen), set("Reason for leaving", s.leftReason),
          set("Student login (turned off, its email and phone removed)", s.userId), { label: "Phone push and calendar links of those logins", filled: logins.length > 0 },
          { label: `Website enquiry contact details (${enquiries.length} ${enquiries.length === 1 ? "enquiry" : "enquiries"})`, filled: enquiries.length > 0 },
          { label: `Phone numbers and addresses written in the audit log (${scrub} ${scrub === 1 ? "entry" : "entries"}); the entries stay, those values read "(erased)"`, filled: scrub > 0 },
        ],
        guardians: guardiansOf.map((g) => ({ name: g.name, blanked: !g.otherActive, why: g.otherActive ? "Has another child studying here, so the contact stays" : "No other child here, so phone, email and login are blanked" })),
        keep: ["Name and admission number", "Class history and marks", "Fee bills, receipts and refunds", "Transfer certificate details", `Uploaded documents (${docs}): delete them from the student's page if they must go too`, "Date of birth, gender and category (needed for school returns)"],
      };
    });
  }

  /** Blank the optional personal data of a student who left. Refuses an active student. Safe to run again. Audited with the reason. */
  async eraseOptional(id: string, reason: string): Promise<{ blanked: string[]; guardians: number }> {
    refuseSupport(this.ctx, "erase");
    const why = String(reason ?? "").trim();
    if (why.length < 10) throw new ValidationError({ reason: "Write why (at least 10 characters). It goes in the audit log." });
    let photo: string | null = null;
    const out = await this.write("write", async (tx) => {
      this.adminOnly();
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s) throw new NotFoundError("Student");
      if (s.status === "active" || s.status === "joining") throw new ConflictError("A student who is studying here, or about to join, cannot be erased. Mark the student as left first.");
      photo = s.photoKey;
      await tx.update(students).set({ phone: null, altPhone: null, address: null, photoKey: null, medicalNotes: null, emergencyName: null, emergencyPhone: null, bloodGroup: null, apaarId: null, pen: null, leftReason: null }).where(eq(students.id, id));
      const blankGuardians = (await this.eraseGuardians(tx, id)).filter((g) => !g.otherActive);
      if (blankGuardians.length) await tx.update(guardians).set({ phone: null, email: null, occupation: null }).where(inArray(guardians.id, blankGuardians.map((g) => g.id)));
      const logins = [s.userId, ...blankGuardians.map((g) => g.userId)].filter((x): x is string => !!x);
      if (logins.length) {
        // Turned off, no way to reach the person, and marked: Settings refuses to switch an erased login back on.
        await Promise.all(logins.map((u) => tx.update(users).set({ status: "disabled", email: null, phone: null, loginId: `erased-${u}`, passwordHash: null }).where(eq(users.id, u))));
        await tx.delete(sessions).where(inArray(sessions.userId, logins));
        for (const table of ["push_subscriptions", "calendar_feeds"]) {
          if (await this.hasTable(tx, table)) await tx.execute(sql`delete from ${sql.identifier(table)} where user_id in (${sql.join(logins.map((u) => sql`${u}::uuid`), sql`, `)})`);
        }
      }
      const enquiries = await this.linkedEnquiries(tx, id);
      if (enquiries.length) {
        const list = sql.join(enquiries.map((e) => sql`${e}::uuid`), sql`, `);
        await tx.execute(sql`update enquiries set parent_name = '(erased)', phone = '', phone_key = '', alt_phone = null, email = null, address = null, message = null, notes = null where id in (${list})`);
        if (await this.hasTable(tx, "enquiry_events")) await tx.execute(sql`update enquiry_events set body = null where enquiry_id in (${list})`);
      }
      const scrubbed = await this.scrubAudit(tx, [id, ...blankGuardians.map((g) => g.id), ...logins, ...enquiries]);
      return { blanked: ["phone numbers", "address", "photo", "medical notes", "emergency contact", "blood group", "APAAR ID", "PEN", "reason for leaving", ...(s.userId ? ["login"] : []), ...(enquiries.length ? ["enquiry contact"] : []), ...(scrubbed ? ["contact values in the audit log"] : [])], guardians: blankGuardians.length, name: s.name, scrubbed };
    }, (r) => ({ action: "erase", entity: "Student", entityId: id, summary: `Erased optional data of ${r.name}`, meta: { reason: why, blanked: r.blanked, guardiansBlanked: r.guardians, auditEntriesScrubbed: r.scrubbed } }));
    if (photo) await services().storage.delete(photo).catch(() => undefined);
    return { blanked: out.blanked, guardians: out.guardians };
  }

  private async hasTable(tx: Tx, name: string) {
    const [r] = await tx.execute<{ t: string | null }>(sql`select to_regclass(${`public.${name}`})::text as t`);
    return !!r?.t;
  }

  /** Website enquiries that became this student. The table exists only when the website module was ever on. */
  private async linkedEnquiries(tx: Tx, studentId: string): Promise<string[]> {
    if (!(await this.hasTable(tx, "enquiries"))) return [];
    return (await tx.execute<{ id: string }>(sql`select id from enquiries where converted_student_id = ${studentId}`)).map((r) => r.id);
  }

  /** Settings owns the one door into the audit log (erase_audit_contacts); without it nothing is scrubbed. */
  private async hasScrubber(tx: Tx) {
    const [r] = await tx.execute<{ f: string | null }>(sql`select to_regprocedure('erase_audit_contacts(text[])')::text as f`);
    return !!r?.f;
  }

  private async scrubAudit(tx: Tx, ids: string[]): Promise<number> {
    if (!(await this.hasScrubber(tx))) return 0;
    const [r] = await tx.execute<{ n: number }>(sql`select erase_audit_contacts(${sql.raw("ARRAY[")}${sql.join(ids.map((i) => sql`${i}::text`), sql`, `)}]) as n`);
    return Number(r?.n ?? 0);
  }

  private async auditScrubCount(tx: Tx, ids: string[]): Promise<number> {
    const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where entity_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      and jsonb_typeof(meta -> 'changes') = 'object' and exists (select 1 from jsonb_object_keys(meta -> 'changes') k where k in ('phone', 'altPhone', 'emergencyPhone', 'emergencyName', 'address', 'email', 'parentName', 'message', 'notes', 'occupation')
        and (meta -> 'changes' -> k) <> '["(erased)", "(erased)"]'::jsonb)`);
    return Number(r?.n ?? 0);
  }

  /** The student's guardians and whether each also has another active child here. */
  private async eraseGuardians(tx: Tx, studentId: string) {
    const links = await tx.select({ id: guardians.id, name: guardians.name, userId: guardians.userId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(eq(studentGuardians.studentId, studentId));
    return Promise.all(links.map(async (g) => {
      const [other] = await tx.select({ n: count() }).from(studentGuardians).innerJoin(students, eq(students.id, studentGuardians.studentId))
        .where(and(eq(studentGuardians.guardianId, g.id), ne(studentGuardians.studentId, studentId), inArray(students.status, ["active", "joining"])));
      return { ...g, otherActive: Number(other?.n) > 0 };
    }));
  }

  private adminOnly() {
    if (this.ctx.role !== "admin") throw new ForbiddenError("Only a school admin can erase a student's data.");
  }
}

export interface ErasePreview {
  id: string; name: string; admissionNo: string; status: Student["status"]; refusal: string | null;
  blank: { label: string; filled: boolean }[];
  guardians: { name: string; blanked: boolean; why: string }[];
  keep: string[];
}
