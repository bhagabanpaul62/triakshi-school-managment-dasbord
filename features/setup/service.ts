import { and, count, eq, isNull, ne, schools, users, type Tx } from "@smw/db";
import { AppError, ConflictError, ForbiddenError, LimitError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import {
  AcademicYearService, ClassService, ClassSubjectService, SectionService, SubjectService, TermService,
  type AcademicYear,
} from "@smw/feature-academics/service";
import { CLASS_PRESETS, SUBJECT_PRESETS, type Board } from "@smw/feature-academics/presets";
import { academicYears, classSubjects, classes, sections, subjects } from "@smw/feature-academics/schema";
import { SchoolProfileService, type UploadFile } from "@smw/feature-settings/service";
import { StaffService } from "@smw/feature-staff/service";
import { staffProfiles } from "@smw/feature-staff/schema";
import { students } from "@smw/feature-students/schema";
import { SiteService, ThemeService } from "@smw/feature-website/service";
import { schoolSites } from "@smw/feature-website/schema";
import { communicationSteps, type CommStep } from "./communication";
import setupFeature from "./feature";
import { classesStepInput, profileStepInput, subjectsStepInput, teachersStepInput, websiteStepInput, yearStepInput } from "./inputs";
import { BANDS, aprilToMarch, bandOf, boardPreset, sectionNames, splitTerms, yearNameOn, type BandKey } from "./presets";
import { STEPS, type StepKey, type StepMeta } from "./steps";

type Perm = keyof typeof setupFeature.permissions;

export interface StepState extends StepMeta {
  /** The step's feature is on for this school. Steps that are not available are left out of the rail. */
  available: boolean;
  done: boolean;
  /** What is saved so far, in words ("12 classes, 24 sections"), or null. */
  summary: string | null;
}

export interface SetupFacts {
  schoolName: string; board: string | null; city: string | null; state: string | null;
  year: { name: string; startsOn: string; endsOn: string } | null;
  classes: number; sections: number; subjects: number; assignments: number; students: number; teachers: number;
  sitePublishedAt: Date | null; completedAt: Date | null;
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
    };
    const summary: Record<StepKey, string | null> = {
      profile: done.profile ? [facts.board, [facts.city, facts.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : null,
      year: facts.year?.name ?? null,
      classes: done.classes ? `${plural(facts.classes, "class", "classes")}, ${plural(facts.sections, "section")}` : null,
      subjects: done.subjects ? `${plural(facts.subjects, "subject")} in ${plural(facts.assignments, "class assignment")}` : null,
      students: done.students ? plural(facts.students, "student") : null,
      staff: done.staff ? plural(facts.teachers, "teacher") : null,
      website: done.website ? "Published" : null,
    };
    const steps = STEPS.map((s): StepState => ({ ...s, available: !s.feature || this.on(s.feature), done: done[s.key], summary: summary[s.key] }));
    const shown = steps.filter((s) => s.available);
    const todo = shown.filter((s) => !s.done);
    return {
      steps, available: shown.map((s) => s.key), doneCount: shown.length - todo.length, total: shown.length,
      ready: done.year && done.classes, completedAt: facts.completedAt, next: (todo.find((s) => s.required) ?? todo[0])?.key ?? null, facts,
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
    return {
      schoolName: school?.name ?? "", board: school?.board ?? null, city: school?.city ?? null, state: school?.state ?? null,
      year: year ? { name: year.name, startsOn: year.startsOn, endsOn: year.endsOn } : null,
      classes: classCount, sections: sectionCount, subjects: subjectCount, assignments: assignmentCount, students: studentCount,
      teachers: teacherCount, sitePublishedAt: site?.at ?? null, completedAt: school?.completedAt ?? null,
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
    const year = cur ? await years.update(cur.id, body) : await years.create(body);
    let termsAdded = 0;
    const n = Number(d.terms);
    const terms = new TermService(this.ctx);
    if (n > 0 && (await terms.list({ pageSize: 1, filters: { yearId: year.id } })).total === 0) {
      for (const t of splitTerms(year.startsOn, year.endsOn, n)) { await terms.create({ ...t, yearId: year.id }); termsAdded++; }
    }
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
      if (!row) { row = await classSvc.create(preset); madeClasses++; }
      const have = new Set((await sectionSvc.forClass(row.id)).map((s) => s.name));
      for (const name of sectionNames(pick.sections)) {
        if (have.has(name)) continue;
        await sectionSvc.create({ classId: row.id, name });
        madeSections++;
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
      if (!id) { id = (await subjectSvc.create(preset.get(key)!)).id; subjectsAdded++; }
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
}
