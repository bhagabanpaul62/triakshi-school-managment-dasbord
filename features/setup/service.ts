import { and, count, eq, inArray, isNull, ne, schools, sql, users, withSchool, type Tx } from "@smw/db";
import { AppError, ConflictError, ForbiddenError, LimitError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import {
  AcademicYearService, ClassService, ClassSubjectService, SectionService, SubjectService, TermService,
  type AcademicYear,
} from "@smw/feature-academics/service";
import { CLASS_PRESETS, SUBJECT_PRESETS, type Board } from "@smw/feature-academics/presets";
import { academicYears, classSubjects, classes, sections, subjects } from "@smw/feature-academics/schema";
import { SchoolProfileService, UserAdminService, type UploadFile } from "@smw/feature-settings/service";
import { StaffService } from "@smw/feature-staff/service";
import { staffProfiles } from "@smw/feature-staff/schema";
import { students } from "@smw/feature-students/schema";
import { StudentService } from "@smw/feature-students/service";
import { SupportService } from "@smw/feature-support/service";
import { SiteService, ThemeService } from "@smw/feature-website/service";
import { schoolSites } from "@smw/feature-website/schema";
import { communicationSteps, type CommStep } from "./communication";
import setupFeature from "./feature";
import { askUsInput, classTeachersInput, classesStepInput, profileStepInput, skipStepInput, studentsByHandInput, subjectsStepInput, teachersStepInput, teamStepInput, websiteStepInput, yearStepInput } from "./inputs";
import { setupTasks } from "./schema";
import { BANDS, aprilToMarch, bandOf, boardPreset, sectionNames, splitTerms, yearNameOn, type BandKey } from "./presets";
import { STEPS, stepMeta, type StepKey, type StepMeta } from "./steps";

type Perm = keyof typeof setupFeature.permissions;

export interface StepState extends StepMeta {
  /** The step's feature is on for this school. Steps that are not available are left out of the rail. */
  available: boolean;
  done: boolean;
  /** The admin chose "do later". Only optional steps can be skipped; a step that is done is never shown as skipped. */
  skipped: boolean;
  /** What is saved so far, in words ("12 classes, 24 sections"), or null. */
  summary: string | null;
}

export interface SetupFacts {
  schoolName: string; board: string | null; city: string | null; state: string | null;
  year: { name: string; startsOn: string; endsOn: string } | null;
  classes: number; sections: number; subjects: number; assignments: number; students: number; teachers: number;
  sitePublishedAt: Date | null; completedAt: Date | null;
  /** Sections of the current year that have a class teacher. */
  classTeacherSections: number;
  /** Admin and accountant logins that are active (they have signed in). */
  team: number;
  /** Invited, waiting for them to set a password. */
  teamInvited: number;
  skipped: StepKey[];
}

export interface SetupProgress {
  steps: StepState[];
  /** Keys of the steps this school can do, in order. */
  available: StepKey[];
  doneCount: number;
  total: number;
  /** Year and classes exist: the school can finish setup. */
  ready: boolean;
  completedAt: Date | null;
  /** The first step still to do (required ones come first), or null when every available step is done. */
  next: StepKey | null;
  facts: SetupFacts;
  /** The school has support, so every step can offer "Ask us". */
  canAsk: boolean;
  /** The school is read-only: nothing can be changed, only exports and Billing work. */
  readOnly: boolean;
}

export interface TeacherResult { added: { name: string; email: string; emailed: boolean }[]; failed: { line: number; name: string; error: string }[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = async (q: PromiseLike<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

/**
 * The first-run wizard. Every step saves through the owning feature's own service, so the rules (caps, duplicates,
 * invites) stay in one place. `progress()` is derived from the data, never stored, so the admin resumes where they left off.
 */
export class SetupService extends SchoolService<Perm> {
  protected feature = setupFeature;

  constructor(ctx: Ctx) { super(ctx); }

  private on(key: string) { return this.ctx.features.has(key); }

  /** Admin-only write, and never for a school the platform has not approved (the pages redirect them, this stops direct action calls). */
  private async gate() {
    this.authorize("run", "write");
    const status = await this.read("run", async (tx) => (await tx.select({ s: schools.status }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1))[0]?.s);
    if (status === "pending" || status === "rejected") throw new ForbiddenError("Your school has not been approved yet.");
  }

  // ---------- progress ----------

  async progress(): Promise<SetupProgress> {
    const facts = await this.read("run", (tx) => this.collect(tx));
    const done: Record<StepKey, boolean> = {
      profile: !!(facts.board && facts.city && facts.state),
      year: !!facts.year,
      classes: facts.classes > 0 && facts.sections > 0,
      subjects: facts.assignments > 0,
      students: facts.students > 0,
      staff: facts.teachers > 0,
      website: !!facts.sitePublishedAt,
      classteachers: facts.sections > 0 && facts.classTeacherSections >= facts.sections,
      team: facts.team >= 2,
    };
    const summary: Record<StepKey, string | null> = {
      profile: done.profile ? [facts.board, [facts.city, facts.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : null,
      year: facts.year?.name ?? null,
      classes: done.classes ? `${plural(facts.classes, "class", "classes")}, ${plural(facts.sections, "section")}` : null,
      subjects: done.subjects ? `${plural(facts.subjects, "subject")} in ${plural(facts.assignments, "class assignment")}` : null,
      students: done.students ? plural(facts.students, "student") : null,
      staff: done.staff ? plural(facts.teachers, "teacher") : null,
      website: done.website ? "Published" : null,
      classteachers: done.classteachers ? `${plural(facts.classTeacherSections, "section")} with a class teacher` : facts.classTeacherSections ? `${facts.classTeacherSections} of ${plural(facts.sections, "section")}` : null,
      team: done.team ? `${plural(facts.team, "login")} for the office${facts.teamInvited ? `, ${facts.teamInvited} invited, waiting` : ""}` : facts.teamInvited ? `${plural(facts.teamInvited, "person", "people")} invited, waiting for them to sign in` : null,
    };
    const steps = STEPS.map((s): StepState => ({ ...s, available: !s.feature || this.on(s.feature), done: done[s.key], skipped: !done[s.key] && !s.required && facts.skipped.includes(s.key), summary: summary[s.key] }));
    const shown = steps.filter((s) => s.available);
    // "Do later" steps stay in the list but are not the next step, so resuming does not bring the admin back to them.
    const todo = shown.filter((s) => !s.done && !s.skipped);
    return {
      steps, available: shown.map((s) => s.key), doneCount: shown.length - todo.length, total: shown.length,
      ready: done.year && done.classes, completedAt: facts.completedAt, next: (todo.find((s) => s.required) ?? todo[0])?.key ?? null, facts, canAsk: this.on("support") && this.can("run") && !this.ctx.readOnly, readOnly: this.ctx.readOnly,
    };
  }

  private async collect(tx: Tx): Promise<SetupFacts> {
    const [school] = await tx.select({ name: schools.name, board: schools.board, city: schools.city, state: schools.state, completedAt: schools.setupCompletedAt }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    const [classCount, sectionCount, subjectCount, assignmentCount] = await Promise.all([
      num(tx.select({ n: count() }).from(classes)),
      year ? num(tx.select({ n: count() }).from(sections).where(eq(sections.yearId, year.id))) : 0,
      num(tx.select({ n: count() }).from(subjects)),
      num(tx.select({ n: count() }).from(classSubjects)),
    ]);
    // Teachers are staff records (an invited teacher counts), not bare logins.
    const teacherCount = this.on("staff")
      ? await num(tx.select({ n: count() }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId))
        .where(and(eq(users.role, "teacher"), ne(users.status, "disabled"), ne(staffProfiles.status, "left"))))
      : 0;
    const studentCount = this.on("students") ? await num(tx.select({ n: count() }).from(students).where(eq(students.status, "active"))) : 0;
    const [site] = this.on("website") ? await tx.select({ at: schoolSites.publishedAt }).from(schoolSites).limit(1) : [];
    const classTeacherSections = year ? await num(tx.select({ n: count() }).from(sections).where(and(eq(sections.yearId, year.id), sql`${sections.classTeacherId} is not null`))) : 0;
    const team = await num(tx.select({ n: count() }).from(users).where(and(inArray(users.role, ["admin", "accountant"]), eq(users.status, "active"))));
    const teamInvited = await num(tx.select({ n: count() }).from(users).where(and(inArray(users.role, ["admin", "accountant"]), eq(users.status, "invited"))));
    const skippedRows = await tx.select({ key: setupTasks.key }).from(setupTasks).where(and(sql`${setupTasks.key} like 'step:%'`, sql`${setupTasks.skippedAt} is not null`));
    return {
      schoolName: school?.name ?? "", board: school?.board ?? null, city: school?.city ?? null, state: school?.state ?? null,
      year: year ? { name: year.name, startsOn: year.startsOn, endsOn: year.endsOn } : null,
      classes: classCount, sections: sectionCount, subjects: subjectCount, assignments: assignmentCount, students: studentCount,
      teachers: teacherCount, sitePublishedAt: site?.at ?? null, completedAt: school?.completedAt ?? null,
      classTeacherSections, team, teamInvited, skipped: skippedRows.map((r) => r.key.slice(5)).filter((k): k is StepKey => STEPS.some((st) => st.key === k)),
    };
  }

  /** The first-day communication steps, each ticked from the data. */
  async communication(): Promise<CommStep[]> {
    return this.read("run", (tx) => communicationSteps(tx, (f) => this.on(f)));
  }

  /** Finish setup: stamps `setup_completed_at` once. Needs the academic year and classes (steps 2 and 3). Calling it again changes nothing. */
  async markComplete(): Promise<{ completedAt: Date }> {
    await this.gate();
    const p = await this.progress();
    if (p.completedAt) return { completedAt: p.completedAt };
    if (!p.ready) throw new ConflictError("Add your academic year and classes first, then finish setup.");
    return this.write("run", async (tx) => {
      const at = new Date();
      const [row] = await tx.update(schools).set({ setupCompletedAt: at }).where(and(eq(schools.id, this.ctx.schoolId), isNull(schools.setupCompletedAt))).returning({ at: schools.setupCompletedAt });
      return { completedAt: row?.at ?? at };
    }, () => ({ action: "complete", entity: "Setup", summary: "Finished the setup wizard" }));
  }

  // ---------- 1. profile ----------

  /** Save the school details (and an optional logo). GSTIN, UDISE and the timezone keep their saved values. */
  async saveProfile(input: unknown, logo?: UploadFile) {
    await this.gate();
    const d = this.parse(profileStepInput, input);
    const profiles = new SchoolProfileService(this.ctx);
    const cur = await profiles.get();
    const saved = await profiles.update({
      ...d, gstin: cur.gstin ?? undefined, udiseCode: cur.udiseCode ?? undefined, timezone: cur.timezone, academicYearStartMonth: cur.academicYearStartMonth,
    });
    if (logo) await profiles.setLogo(logo);
    return saved;
  }

  async profile() { return new SchoolProfileService(this.ctx).get(); }

  // ---------- 2. academic year ----------

  /** The current year (if any) and the one to suggest: the April-March year that today falls in. */
  async yearState() {
    const current = await new AcademicYearService(this.ctx).current();
    const termCount = current ? (await new TermService(this.ctx).list({ pageSize: 1, filters: { yearId: current.id } })).total : 0;
    const name = yearNameOn(new Date());
    return { current, termCount, suggested: { name, ...aprilToMarch(name) } };
  }

  /** Create the first academic year (or edit the current one) and give it terms when it has none. */
  async saveYear(input: unknown): Promise<{ year: AcademicYear; termsAdded: number }> {
    await this.gate();
    const d = this.parse(yearStepInput, input);
    const years = new AcademicYearService(this.ctx);
    const dates: { startsOn?: string; endsOn?: string } = /^\d{4}-\d{2}$/.test(d.name) ? aprilToMarch(d.name) : {};
    const body = { name: d.name, startsOn: d.startsOn ?? dates.startsOn, endsOn: d.endsOn ?? dates.endsOn, isCurrent: true };
    const cur = await years.current();
    let year: AcademicYear;
    if (cur) year = await years.update(cur.id, body);
    else {
      // Two admins saving at once: the one who loses the race finds the year already there and updates it.
      try { year = await years.create(body); } catch (e) {
        const now = e instanceof ConflictError ? await years.current() : null;
        if (!now) throw e;
        year = await years.update(now.id, body);
      }
    }
    let termsAdded = 0;
    const n = Number(d.terms);
    const terms = new TermService(this.ctx);
    // One admin at a time from the check to the last term, or two of them both see none and each add a set.
    if (n > 0) await withSchool(this.ctx.schoolId, async (lock) => {
      await lock.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`setup-terms:${year.id}`}, 0))`);
      if ((await terms.list({ pageSize: 1, filters: { yearId: year.id } })).total > 0) return;
      for (const t of splitTerms(year.startsOn, year.endsOn, n)) {
        try { await terms.create({ ...t, yearId: year.id }); termsAdded++; } catch (e) { if (!(e instanceof ConflictError)) throw e; }
      }
    });
    return { year, termsAdded };
  }

  // ---------- 3. classes and sections ----------

  /** Section count per class grade in the current year, so the picker shows what is already there. */
  async classesState(): Promise<{ hasYear: boolean; existing: Record<number, number> }> {
    const hasYear = !!(await new AcademicYearService(this.ctx).current());
    const rows = (await new ClassService(this.ctx).list({ pageSize: 100 })).rows;
    const stats = await new ClassService(this.ctx).stats(rows.map((r) => r.id));
    return { hasYear, existing: Object.fromEntries(rows.map((r) => [r.grade, stats[r.id]?.sections ?? 0])) };
  }

  /** Create the picked classes and their sections A, B, C... Classes and sections that already exist are kept as they are. */
  async saveClasses(input: unknown): Promise<{ classes: number; sections: number }> {
    await this.gate();
    const { picks } = this.parse(classesStepInput, input);
    if (!(await new AcademicYearService(this.ctx).current())) throw new ConflictError("Set your academic year first.");
    const classSvc = new ClassService(this.ctx), sectionSvc = new SectionService(this.ctx);
    const existing = (await classSvc.list({ pageSize: 100 })).rows;
    let madeClasses = 0, madeSections = 0;
    for (const pick of [...picks].sort((a, b) => a.grade - b.grade)) {
      const preset = CLASS_PRESETS.find((c) => c.grade === pick.grade);
      if (!preset) throw new ValidationError({ picks: "Pick classes from the list" });
      let row = existing.find((c) => c.grade === pick.grade);
      // Two admins saving at once: the one who loses the race finds the row already there and carries on.
      if (!row) {
        try { row = await classSvc.create(preset); madeClasses++; } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          row = (await classSvc.list({ pageSize: 100 })).rows.find((c) => c.grade === pick.grade);
          if (!row) throw e;
        }
      }
      const have = new Set((await sectionSvc.forClass(row.id)).map((s) => s.name));
      for (const name of sectionNames(pick.sections)) {
        if (have.has(name)) continue;
        try { await sectionSvc.create({ classId: row.id, name }); madeSections++; } catch (e) { if (!(e instanceof ConflictError)) throw e; }
      }
    }
    return { classes: madeClasses, sections: madeSections };
  }

  // ---------- 4. subjects ----------

  /** The board to start from, how many classes each stage has, and the stages every subject is already assigned to. */
  async subjectsState(): Promise<{ board: Board; bandCounts: Record<BandKey, number>; assigned: Record<string, BandKey[]> }> {
    const profile = await this.read("run", async (tx) => (await tx.select({ board: schools.board }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1))[0]);
    const { bandCounts, assigned } = await this.read("run", async (tx) => {
      const cls = await tx.select({ id: classes.id, grade: classes.grade }).from(classes);
      const links = await tx.select({ classId: classSubjects.classId, name: subjects.name }).from(classSubjects).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId));
      const counts = Object.fromEntries(BANDS.map((b) => [b.key, 0])) as Record<BandKey, number>;
      const gradeOf = new Map(cls.map((c) => [c.id, c.grade]));
      for (const c of cls) counts[bandOf(c.grade)]++;
      const perSubject = new Map<string, Map<BandKey, number>>();
      for (const l of links) {
        const g = gradeOf.get(l.classId);
        if (g === undefined) continue;
        const m = perSubject.get(l.name) ?? new Map<BandKey, number>();
        m.set(bandOf(g), (m.get(bandOf(g)) ?? 0) + 1);
        perSubject.set(l.name, m);
      }
      // A stage counts as assigned only when every class in it has the subject.
      const out: Record<string, BandKey[]> = {};
      for (const [name, m] of perSubject) out[name] = BANDS.filter((b) => counts[b.key] > 0 && (m.get(b.key) ?? 0) >= counts[b.key]).map((b) => b.key);
      return { bandCounts: counts, assigned: out };
    });
    return { board: boardPreset(profile?.board), bandCounts, assigned };
  }

  /** Add the picked board subjects and assign each to every class of the stages it runs in. Nothing is removed. */
  async saveSubjects(input: unknown): Promise<{ subjectsAdded: number; assigned: number }> {
    await this.gate();
    const { board, picks } = this.parse(subjectsStepInput, input);
    const preset = new Map(SUBJECT_PRESETS[board].map((s) => [s.name.toLowerCase(), s]));
    const unknown = picks.find((p) => !preset.has(p.name.toLowerCase()));
    if (unknown) throw new ValidationError({ picks: `${unknown.name} is not in the ${board} list` });
    const subjectSvc = new SubjectService(this.ctx);
    const existing = new Map((await subjectSvc.list({ pageSize: 100 })).rows.map((s) => [s.name.toLowerCase(), s.id]));
    const classRows = (await new ClassService(this.ctx).list({ pageSize: 100 })).rows;
    if (!classRows.length) throw new ConflictError("Add your classes first.");
    let subjectsAdded = 0, assigned = 0;
    const ids = new Map<string, string>();
    for (const p of picks) {
      const key = p.name.toLowerCase();
      let id = existing.get(key);
      if (!id) {
        // Two admins saving at once: the one who loses the race finds the subject already there.
        try { id = (await subjectSvc.create(preset.get(key)!)).id; subjectsAdded++; } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          id = (await subjectSvc.list({ pageSize: 100 })).rows.find((r) => r.name.toLowerCase() === key)?.id;
          if (!id) throw e;
        }
      }
      ids.set(key, id);
    }
    const link = new ClassSubjectService(this.ctx);
    for (const cls of classRows) {
      const subjectIds = picks.filter((p) => p.bands.includes(bandOf(cls.grade))).map((p) => ids.get(p.name.toLowerCase())!);
      if (subjectIds.length) assigned += (await link.assign({ classId: cls.id, subjectIds })).added;
    }
    return { subjectsAdded, assigned };
  }

  // ---------- 6. teachers ----------

  /** Invite teachers (a login in "invited" state plus an email with a set-password link). A bad row never stops the good ones. */
  async inviteTeachers(input: unknown): Promise<TeacherResult> {
    await this.gate();
    const { rows } = this.parse(teachersStepInput, input);
    const filled = rows.map((r, i) => ({ ...r, line: i + 1 })).filter((r) => r.name || r.email);
    if (!filled.length) throw new ValidationError({ rows: "Add at least one teacher" }, "Add at least one teacher, or skip this step.");
    const staff = new StaffService(this.ctx);
    const taken = new Set(await this.read("run", async (tx) => (await tx.select({ id: staffProfiles.employeeId }).from(staffProfiles)).map((r) => r.id)));
    let seq = taken.size;
    const nextId = () => { do { seq++; } while (taken.has(`T${String(seq).padStart(3, "0")}`)); const id = `T${String(seq).padStart(3, "0")}`; taken.add(id); return id; };
    const result: TeacherResult = { added: [], failed: [] };
    const seen = new Set<string>();
    for (const r of filled) {
      const fail = (error: string) => result.failed.push({ line: r.line, name: r.name, error });
      if (!r.email) { fail("Add an email so we can send the invite"); continue; }
      if (seen.has(r.email.toLowerCase())) { fail("This email is already in the list"); continue; }
      seen.add(r.email.toLowerCase());
      try {
        const made = await staff.create({ role: "teacher", name: r.name, email: r.email, employeeId: nextId() });
        result.added.push({ name: made.name, email: r.email, emailed: made.emailed });
      } catch (e) {
        if (e instanceof AppError) fail(Object.values(e.fieldErrors ?? {})[0] ?? e.message); else throw e;
      }
    }
    return result;
  }

  // ---------- 7. website ----------

  async websiteState() {
    const site = await new SiteService(this.ctx).get();
    const { theme } = await new ThemeService(this.ctx).get();
    return { template: site.templateKey, preset: theme.preset, publishedAt: site.publishedAt };
  }

  /** Choose the template and colours, then publish. A plan that limits theme editing still gets the template published. */
  async publishWebsite(input: unknown): Promise<{ paths: string[]; themeApplied: boolean }> {
    await this.gate();
    const d = this.parse(websiteStepInput, input);
    const site = new SiteService(this.ctx);
    // A school that has not edited its pages yet gets the long sample site written for the design it picked.
    await site.setTemplate(d.template, { starter: "untouched" });
    let themeApplied = true;
    try { await new ThemeService(this.ctx).applyPreset(d.preset); } catch (e) {
      if (!(e instanceof LimitError)) throw e;
      themeApplied = false;
    }
    const { paths } = await site.publish();
    return { paths, themeApplied };
  }

  // ---------- staff by sheet ----------

  /** Check a pasted or uploaded staff sheet (nothing is saved). The staff feature's own import reports every problem by line and column. */
  async checkStaffSheet(file: { name: string; bytes: Uint8Array }) {
    await this.gate();
    return new StaffService(this.ctx).importCheck(file);
  }

  /** Create everyone in the sheet (all or nothing) and send the invites. */
  async importStaffSheet(file: { name: string; bytes: Uint8Array }) {
    await this.gate();
    return new StaffService(this.ctx).importCommit(file);
  }

  // ---------- students by hand ----------

  /** Sections of the current year for the "add five by hand" rows: "Class 4 A". */
  async sectionOptions(): Promise<{ id: string; classId: string; label: string }[]> {
    return this.read("run", async (tx) => {
      const year = (await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1))[0];
      if (!year) return [];
      const rows = await tx.select({ id: sections.id, classId: sections.classId, name: sections.name, className: classes.name, grade: classes.grade })
        .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.yearId, year.id));
      return rows.sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)).map((r) => ({ id: r.id, classId: r.classId, label: `${r.className} ${r.name}` }));
    });
  }

  /** Admit up to ten students typed in by hand. A bad row stays on screen with its reason; the good ones are saved. */
  async addStudents(input: unknown): Promise<{ added: number; failed: { line: number; name: string; error: string }[] }> {
    await this.gate();
    const { rows } = this.parse(studentsByHandInput, input);
    const filled = rows.map((r, i) => ({ ...r, line: i + 1 })).filter((r) => r.name || r.sectionId || r.guardianName || r.guardianPhone);
    if (!filled.length) throw new ValidationError({ rows: "Add at least one student" }, "Add at least one student, or skip this step.");
    const opts = new Map((await this.sectionOptions()).map((o) => [o.id, o]));
    const svc = new StudentService(this.ctx);
    const out = { added: 0, failed: [] as { line: number; name: string; error: string }[] };
    for (const r of filled) {
      const fail = (error: string) => out.failed.push({ line: r.line, name: r.name, error });
      const sec = opts.get(r.sectionId);
      if (!sec) { fail("Pick the class and section"); continue; }
      try {
        await svc.create({ name: r.name, classId: sec.classId, sectionId: sec.id, guardianName: r.guardianName, guardianPhone: r.guardianPhone });
        out.added++;
      } catch (e) {
        if (e instanceof AppError) fail(Object.values(e.fieldErrors ?? {})[0] ?? e.message); else throw e;
      }
    }
    return out;
  }

  // ---------- class teachers ----------

  /** Every section of the current year with its class teacher, and the teachers to pick from (invited ones too, so a teacher just invited can be chosen). */
  async classTeacherState(): Promise<{ sections: { id: string; label: string; teacherId: string | null }[]; teachers: { id: string; name: string; invited: boolean }[] }> {
    return this.read("run", async (tx) => {
      const year = (await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1))[0];
      const secs = year ? await tx.select({ id: sections.id, name: sections.name, className: classes.name, grade: classes.grade, teacherId: sections.classTeacherId })
        .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.yearId, year.id)) : [];
      const teachers = await tx.select({ id: users.id, name: users.name, status: users.status }).from(users).where(and(eq(users.role, "teacher"), ne(users.status, "disabled"))).orderBy(users.name);
      return {
        sections: secs.sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)).map((s) => ({ id: s.id, label: `${s.className} ${s.name}`, teacherId: s.teacherId })),
        teachers: teachers.map((t) => ({ id: t.id, name: t.name, invited: t.status === "invited" })),
      };
    });
  }

  /** Save a teacher per section through the section service, in one transaction. Each row answers for itself: a bad one is listed with its reason and the rest are saved. */
  async saveClassTeachers(input: unknown): Promise<{ changed: number; failed: { sectionId: string; error: string }[] }> {
    await this.gate();
    const { picks } = this.parse(classTeachersInput, input);
    return new SectionService(this.ctx).assignClassTeachers({ picks: picks.map((p) => ({ sectionId: p.sectionId, teacherId: p.teacherId || undefined })) });
  }

  // ---------- team ----------

  /** The admin and office logins, so the step shows who is already there. */
  async team(): Promise<{ id: string; name: string; email: string | null; role: string; state: "active" | "invited" }[]> {
    return this.read("run", async (tx) => (await tx.select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status }).from(users)
      .where(and(inArray(users.role, ["admin", "accountant"]), ne(users.status, "disabled"))).orderBy(users.createdAt))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, state: u.status === "invited" ? "invited" as const : "active" as const })));
  }

  /** A second admin or an office login: Settings' own add-a-login, which sends the set-password link. */
  async addTeam(input: unknown): Promise<{ name: string; email: string; emailed: boolean }> {
    await this.gate();
    const d = this.parse(teamStepInput, input);
    const made = await new UserAdminService(this.ctx).createLogin({ name: d.name, email: d.email, role: d.role, send: "email" });
    return { name: made.user.name, email: d.email, emailed: made.emailed };
  }

  // ---------- do later, ask us ----------

  /** "Do later": remembered for the school, so the other admin and the next visit do not bring this step back as the next one. */
  async skipStep(input: unknown): Promise<{ step: StepKey }> {
    await this.gate();
    const { step } = this.parse(skipStepInput, input);
    if (stepMeta(step).required) throw new ConflictError("This step is needed. Nothing else works without it.");
    return this.write("run", async (tx) => {
      const now = new Date();
      await tx.insert(setupTasks).values({ schoolId: this.ctx.schoolId, key: `step:${step}`, skippedAt: now, skippedBy: this.ctx.userId, skipReason: "do later" })
        .onConflictDoUpdate({ target: [setupTasks.schoolId, setupTasks.key], set: { skippedAt: now, skippedBy: this.ctx.userId, updatedAt: now } });
      return { step };
    }, ({ step }) => ({ action: "skip", entity: "Setup", summary: `Left the setup step "${stepMeta(step).label}" for later` }));
  }

  /** "Ask us": a support ticket of kind onboarding with the step filled in. Raised by the person asking, so the reply comes to them. */
  async askUs(input: unknown): Promise<{ ticketId: string; number: number | null }> {
    this.authorize("run", "write");
    const d = this.parse(askUsInput, input);
    if (!this.on("support")) throw new ConflictError("Support is not part of your plan. Write to your Triakshi contact.");
    const t = await new SupportService(this.ctx).create({
      subject: `Setup help: ${stepMeta(d.step).label}`, body: d.body, category: "onboarding", priority: "normal", context: { page: `/app/setup/${d.step}` },
    });
    return { ticketId: t.id, number: (t as { number?: number }).number ?? null };
  }
}
