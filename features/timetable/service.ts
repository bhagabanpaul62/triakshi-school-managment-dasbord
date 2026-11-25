import { and, asc, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { CrudService, ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { academicYears, classSubjects, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { DAYS, cellKey, dayName, istDate, presetPeriods, schoolDay, timeRange } from "./bell";
import timetableFeature from "./feature";
import { teacherUse } from "./block-service";
import { blockCellInput, cellInput, copyWeekInput, periodInput, sectionInput, slotInput } from "./inputs";
import { periods, substitutions, timetableSlots as slots, ttBlockOptions, ttBlockSlots as bslots, ttBlocks, ttDayOverrides, ttRooms, ttTeacherRules, ttVersions } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;
type PeriodRow = typeof periods.$inferSelect;

/** A period as the screens need it: plain data, safe to hand to a client component. */
export interface PeriodView { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean }
/** One class in the week. In a section grid `teacher` is who teaches it; in a teacher grid `section` is where they teach it. */
export interface GridCell {
  slotId: string; subjectId: string; subject: string; teacherId: string | null; teacher: string | null;
  sectionId: string; section: string; room: string | null; locked: boolean;
  /** Set when the cell is an elective block (slotId is then the block slot's id). */
  blockId?: string; blockName?: string;
  /** The alternatives of a block, shown whole to staff. A teacher or student sees only their own, so there is one. */
  options?: { optionId: string; subjectId: string; subject: string; teacherId: string; teacher: string | null; room: string | null }[];
}
export interface Timetable { title: string; periods: PeriodView[]; cells: Record<string, GridCell> }
export interface SectionOption { id: string; label: string }
export interface SlotOptions {
  classId: string;
  /** Teachers already teaching another section at a given cell (key `day:periodId`), with that section's name. */
  busy: Record<string, Record<string, string>>;
  subjects: { id: string; name: string }[];
  /** Teachers who teach each subject; the section's own teacher comes first. */
  teachers: Record<string, { id: string; name: string }[]>;
  /** The section's own teacher of each subject, pre-selected in the editor. */
  defaults: Record<string, string>;
  /** Elective blocks of the section's class, placeable at a cell. */
  blocks: { id: string; name: string; options: string }[];
  /** Teachers with a max per day or week: their limits and how many periods they already have in this version. */
  limits: Record<string, { maxPerDay: number | null; maxPerWeek: number | null; week: number; day: Record<number, number> }>;
}
/** Periods a week each teacher of a section carries, here and across the school, out of `max` teaching periods in a week. */
export interface TeacherLoad { max: number; teachers: { id: string; name: string; here: number; total: number }[] }
/** `cover`: "covering" = a cover period the teacher takes today; "away" = the teacher's own period, taken by someone else today (`teacher` is then the cover). */
/** `slotId` is the ordinary period; a block period has `blockSlotId` and `optionId` (the option the viewer teaches or studies) instead. */
export interface TodayRow { slotId: string | null; blockSlotId?: string | null; optionId?: string | null; periodId: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; subject: string | null; teacher: string | null; section: string | null; room: string | null; cover?: "covering" | "away" | null }
export interface CopyWeekResult { copied: number; skipped: { day: number; period: string; reason: string }[] }

/** Matches no row: reads of a school that has no live version yet. */
const NO_VERSION = "00000000-0000-0000-0000-000000000000";

export { cellKey };

const toView = (p: PeriodRow): PeriodView => ({ id: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak });
const orderedPeriods = (tx: Tx) => tx.select().from(periods).orderBy(asc(periods.sortOrder), asc(periods.startsAt));
const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** The bell schedule: periods and breaks of the school day. */
export class PeriodService extends CrudService<typeof periods, Perm> {
  protected feature = timetableFeature;
  protected table = periods;
  protected entityName = "Period";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = periodInput;
  protected updateSchema = periodInput;
  protected defaultSort = "sortOrder";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [periods.name]; }
  protected sortColumns() { return { sortOrder: periods.sortOrder, startsAt: periods.startsAt }; }
  protected describe(r: PeriodRow) { return r.name; }

  /** No two periods may share time. */
  private async assertNoOverlap(tx: Tx, data: Record<string, unknown>, selfId?: string) {
    const mine = data as { startsAt: string; endsAt: string };
    const clash = (await orderedPeriods(tx)).find((p) => p.id !== selfId && overlaps(p, mine));
    if (clash) throw new ConflictError(`Overlaps ${clash.name} (${timeRange(clash.startsAt, clash.endsAt)}).`);
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { await this.assertNoOverlap(tx, data); return data; }
  protected async beforeUpdate(tx: Tx, existing: PeriodRow, data: Record<string, unknown>) { await this.assertNoOverlap(tx, data, existing.id); return data; }

  /** Every period in order, for pages and pickers. */
  async all(): Promise<PeriodView[]> {
    return this.read("read", async (tx) => (await orderedPeriods(tx)).map(toView));
  }

  /** Create the standard day (8 periods of 40 minutes from 8:00, a 20-minute break after period 4). Refuses when a schedule exists, so no timetable is lost. */
  async applyPreset(): Promise<{ count: number }> {
    return this.write("manage", async (tx) => {
      if ((await orderedPeriods(tx)).length) throw new ConflictError("A bell schedule already exists. Delete its periods first to start again.");
      const drafts = presetPeriods();
      await tx.insert(periods).values(drafts.map((d) => ({ ...d, schoolId: this.ctx.schoolId })));
      return { count: drafts.length };
    }, (r) => ({ action: "preset", entity: "Period", summary: `Created the standard bell schedule (${r.count} periods)` }));
  }
}

/** Everything about who teaches what and when. */
export class TimetableService extends SchoolService<Perm> {
  protected feature = timetableFeature;

  constructor(ctx: Ctx) { super(ctx); }

  private get isLearner() { return this.ctx.role === "student"; }

  // ---------- versions ----------

  /** The live version's id, or null when the school has none yet (then nothing is planned). */
  async liveId(tx: Tx): Promise<string | null> {
    const [v] = await tx.select({ id: ttVersions.id }).from(ttVersions).where(eq(ttVersions.status, "live")).limit(1);
    return v?.id ?? null;
  }

  /** The live version, created on first write. */
  async ensureLive(tx: Tx): Promise<string> {
    const have = await this.liveId(tx);
    if (have) return have;
    await tx.insert(ttVersions).values({ schoolId: this.ctx.schoolId, name: "Live timetable", status: "live", createdBy: this.ctx.userId, publishedAt: new Date() }).onConflictDoNothing();
    return (await this.liveId(tx))!;
  }

  /** The version a call works on: the live one, or a draft/archived one that only a manager may open. */
  private async versionFor(tx: Tx, versionId: string | undefined, write: boolean): Promise<string> {
    if (!versionId) return write ? this.ensureLive(tx) : ((await this.liveId(tx)) ?? NO_VERSION);
    if (!this.can("manage") || this.isLearner) throw new ForbiddenError();
    const [v] = /^[0-9a-f-]{36}$/i.test(versionId) ? await tx.select().from(ttVersions).where(eq(ttVersions.id, versionId)).limit(1) : [];
    if (!v) throw new NotFoundError("Timetable version");
    if (write && v.status === "archived") throw new ConflictError("An archived timetable cannot be changed.");
    return v.id;
  }

  // ---------- lookups shared by every operation ----------

  /** Sections the caller is tied to: a student's own. null = not restricted (staff). Needs the students module. */
  private async learnerSectionIds(tx: Tx): Promise<string[] | null> {
    if (!this.isLearner) return null;
    if (!this.ctx.features.has("students")) return [];
    const rows = await tx.execute(sql`select distinct section_id from students where user_id = ${this.ctx.userId} and status = 'active' and section_id is not null`);
    return [...rows].map((r) => String((r as { section_id: string }).section_id));
  }

  /** Sections, "Class 5-A", newest academic year first. */
  private async sectionRows(tx: Tx, where?: SQL) {
    const rows = await tx.select({ id: sections.id, yearId: sections.yearId, className: classes.name, grade: classes.grade, name: sections.name, room: sections.room, classId: sections.classId, current: academicYears.isCurrent })
      .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId))
      .where(where).orderBy(asc(classes.grade), asc(sections.name));
    return rows.map((r) => ({ ...r, label: `${r.className}-${r.name}` }));
  }

  /** One section the caller may see, or NotFoundError (learners get the same answer for other people's sections). */
  private async sectionOrThrow(tx: Tx, sectionId: string) {
    const mine = await this.learnerSectionIds(tx);
    if (mine && !mine.includes(sectionId)) throw new NotFoundError("Section");
    const [row] = /^[0-9a-f-]{36}$/i.test(sectionId) ? await this.sectionRows(tx, eq(sections.id, sectionId)) : [];
    if (!row) throw new NotFoundError("Section");
    return row;
  }

  private async teacherOrThrow(tx: Tx, teacherId: string) {
    const [t] = /^[0-9a-f-]{36}$/i.test(teacherId)
      ? await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, teacherId), eq(users.role, "teacher"))).limit(1)
      : [];
    if (!t) throw new NotFoundError("Teacher");
    return t;
  }

  /** Slots joined with subject, section, class and teacher name. The one query behind every grid. */
  private async slotRows(tx: Tx, versionId: string, where?: SQL) {
    const rows = await tx.select({
      slotId: slots.id, locked: slots.locked, dayOfWeek: slots.dayOfWeek, periodId: slots.periodId, subjectId: slots.subjectId, subject: subjects.name,
      teacherId: slots.teacherId, teacher: users.name, sectionId: slots.sectionId, className: classes.name, sectionName: sections.name, room: slots.room,
    }).from(slots)
      .innerJoin(subjects, eq(subjects.id, slots.subjectId))
      .innerJoin(sections, eq(sections.id, slots.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(users, eq(users.id, slots.teacherId))
      .where(and(eq(slots.versionId, versionId), where));
    return rows.map(({ className, sectionName, ...r }) => ({ ...r, section: `${className}-${sectionName}` }));
  }

  /** Placed blocks, one row per option (so a block cell with three alternatives is three rows). */
  private async blockRows(tx: Tx, versionId: string, where?: SQL) {
    return tx.select({
      blockSlotId: bslots.id, locked: bslots.locked, dayOfWeek: bslots.dayOfWeek, periodId: bslots.periodId, blockId: ttBlocks.id, blockName: ttBlocks.name, classId: ttBlocks.classId, className: classes.name,
      optionId: ttBlockOptions.id, subjectId: ttBlockOptions.subjectId, subject: subjects.name, teacherId: ttBlockOptions.teacherId, teacher: users.name, room: ttRooms.name,
    }).from(bslots)
      .innerJoin(ttBlocks, eq(ttBlocks.id, bslots.blockId)).innerJoin(classes, eq(classes.id, ttBlocks.classId))
      .innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlocks.id)).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId))
      .leftJoin(users, eq(users.id, ttBlockOptions.teacherId)).leftJoin(ttRooms, eq(ttRooms.id, ttBlockOptions.roomId))
      .where(and(eq(bslots.versionId, versionId), where)).orderBy(asc(subjects.name));
  }

  /** The subjects the signed-in student studies this year (their elective choices), or null for anyone who is not a student. */
  private async chosenSubjects(tx: Tx): Promise<Set<string> | null> {
    if (!this.isLearner) return null;
    if (!this.ctx.features.has("students")) return new Set();
    const rows = await tx.execute(sql`select distinct ss.subject_id from student_subjects ss
      join students st on st.id = ss.student_id join academic_years y on y.id = ss.year_id and y.is_current
      where st.user_id = ${this.ctx.userId} and st.status = 'active'`);
    return new Set([...rows].map((r) => String((r as { subject_id: string }).subject_id)));
  }

  /**
   * Grid cells for placed blocks. `staff` sees every alternative; a teacher (`teacherId`) only their own; a student only the one they chose.
   * A student who chose none of the alternatives sees the block's name with no teacher.
   */
  private blockCells(rows: Awaited<ReturnType<TimetableService["blockRows"]>>, view: { sectionId?: string; sectionLabel?: string; teacherId?: string; chosen?: Set<string> | null }): Record<string, GridCell> {
    const bySlot = new Map<string, typeof rows>();
    for (const r of rows) (bySlot.get(r.blockSlotId) ?? bySlot.set(r.blockSlotId, []).get(r.blockSlotId)!).push(r);
    const cells: Record<string, GridCell> = {};
    for (const group of bySlot.values()) {
      const first = group[0]!;
      const opts = group.map((r) => ({ optionId: r.optionId, subjectId: r.subjectId, subject: r.subject, teacherId: r.teacherId, teacher: r.teacher, room: r.room }));
      const base = { slotId: first.blockSlotId, blockId: first.blockId, blockName: first.blockName, locked: first.locked, sectionId: view.sectionId ?? "", section: view.sectionLabel ?? `${first.className} (all sections)` };
      const own = view.teacherId ? opts.find((o) => o.teacherId === view.teacherId) : view.chosen ? opts.find((o) => view.chosen!.has(o.subjectId)) : undefined;
      let cell: GridCell;
      if (own) cell = { ...base, subjectId: own.subjectId, subject: own.subject, teacherId: own.teacherId, teacher: own.teacher, room: own.room, options: [own] };
      else if (view.teacherId) continue;
      else if (view.chosen) cell = { ...base, subjectId: "", subject: first.blockName, teacherId: null, teacher: null, room: null, options: [] };
      else cell = { ...base, subjectId: "", subject: `${first.blockName}: ${opts.map((o) => `${o.subject}${o.teacher ? ` (${o.teacher})` : ""}`).join(" / ")}`, teacherId: null, teacher: null, room: null, options: opts };
      cells[cellKey(first.dayOfWeek, first.periodId)] = cell;
    }
    return cells;
  }

  /** Sections of a class for the year in use (the current year's, else all). A block fills each of them. */
  private async classSections(tx: Tx, classId: string) {
    const rows = await this.sectionRows(tx, eq(sections.classId, classId));
    const cur = rows.filter((r) => r.current);
    return cur.length ? cur : rows;
  }

  private async grid(tx: Tx, title: string, versionId: string, where: SQL, extra: Record<string, GridCell> = {}): Promise<Timetable> {
    const [ps, rows] = await Promise.all([orderedPeriods(tx), this.slotRows(tx, versionId, where)]);
    const cells: Record<string, GridCell> = {};
    for (const { dayOfWeek, periodId, ...cell } of rows) cells[cellKey(dayOfWeek, periodId)] = cell;
    return { title, periods: ps.map(toView), cells: { ...cells, ...extra } };
  }

  // ---------- reading ----------

  /** Sections for the picker: staff see every section of the current year, learners only their own. */
  async sections(): Promise<SectionOption[]> {
    return this.read("read", async (tx) => {
      const mine = await this.learnerSectionIds(tx);
      if (mine && !mine.length) return [];
      const rows = await this.sectionRows(tx, mine ? inArray(sections.id, mine) : undefined);
      const currentOnly = rows.some((r) => r.current) ? rows.filter((r) => r.current) : rows;
      return currentOnly.map((r) => ({ id: r.id, label: r.label }));
    });
  }

  /** Teachers for the picker. Staff only. */
  async teachers(): Promise<{ id: string; name: string }[]> {
    return this.read("read", async (tx) => {
      if (this.isLearner) throw new ForbiddenError();
      return tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), ne(users.status, "disabled"))).orderBy(asc(users.name));
    });
  }

  /** The week of one section: days x periods. */
  async sectionGrid(sectionId: string, versionId?: string): Promise<Timetable> {
    return this.read("read", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
      const vid = await this.versionFor(tx, versionId, false);
      const blocks = this.blockCells(await this.blockRows(tx, vid, eq(ttBlocks.classId, s.classId)), { sectionId: s.id, sectionLabel: s.label, chosen: await this.chosenSubjects(tx) });
      return this.grid(tx, s.label, vid, eq(slots.sectionId, s.id), blocks);
    });
  }

  /** The week of one teacher, with the section they teach in each period. Staff only; teachers pass their own id for "My timetable". */
  async teacherGrid(teacherId: string, versionId?: string): Promise<Timetable> {
    return this.read("read", async (tx) => {
      if (this.isLearner) throw new ForbiddenError();
      const t = await this.teacherOrThrow(tx, teacherId);
      const vid = await this.versionFor(tx, versionId, false);
      const blocks = this.blockCells(await this.blockRows(tx, vid, eq(ttBlockOptions.teacherId, t.id)), { teacherId: t.id });
      return this.grid(tx, t.name, vid, eq(slots.teacherId, t.id), blocks);
    });
  }

  /**
   * Today's periods for dashboards: a teacher's own classes plus the covers they take, or the section of a student.
   * A date with a day override shows only its periods. Empty on Sunday and for other roles.
   */
  async today(now: Date = new Date()): Promise<{ day: number | null; rows: TodayRow[]; override: string | null }> {
    return this.read("read", async (tx) => {
      const day = schoolDay(now);
      if (!day) return { day, rows: [], override: null };
      const mine = this.ctx.role === "teacher" ? undefined : await this.learnerSectionIds(tx);
      if (this.ctx.role !== "teacher" && !mine?.length) return { day, rows: [], override: null };
      const date = istDate(now);
      const vid = (await this.liveId(tx)) ?? NO_VERSION;
      const [allPeriods, [override]] = await Promise.all([orderedPeriods(tx), tx.select().from(ttDayOverrides).where(eq(ttDayOverrides.date, date)).limit(1)]);
      const ps = override ? allPeriods.filter((p) => override.periodIds.includes(p.id)) : allPeriods;
      const who = this.ctx.role === "teacher" ? eq(slots.teacherId, this.ctx.userId) : inArray(slots.sectionId, mine!);
      type Found = Awaited<ReturnType<TimetableService["slotRows"]>>[number] & { cover?: "covering" | "away"; blockSlotId?: string; optionId?: string };
      const found: Found[] = await this.slotRows(tx, vid, and(who, eq(slots.dayOfWeek, day)));
      // Blocks: a teacher's own option, or the option a student chose. Each becomes a row like an ordinary period.
      const chosen = await this.chosenSubjects(tx);
      const blockRows = this.ctx.role === "teacher"
        ? await this.blockRows(tx, vid, and(eq(ttBlockOptions.teacherId, this.ctx.userId), eq(bslots.dayOfWeek, day)))
        : await this.blockRows(tx, vid, and(inArray(ttBlocks.classId, (await this.sectionRows(tx, inArray(sections.id, mine!))).map((r) => r.classId)), eq(bslots.dayOfWeek, day)));
      const sectionLabels = this.ctx.role === "teacher" ? [] : await this.sectionRows(tx, inArray(sections.id, mine!));
      const blockFound = (rows: typeof blockRows): Found[] => {
        const bySlot = new Map<string, typeof rows>();
        for (const r of rows) (bySlot.get(r.blockSlotId) ?? bySlot.set(r.blockSlotId, []).get(r.blockSlotId)!).push(r);
        return [...bySlot.values()].map((g) => {
          const r = chosen ? g.find((o) => chosen.has(o.subjectId)) ?? g[0]! : g[0]!;
          const own = !chosen || chosen.has(r.subjectId);
          return { slotId: r.blockSlotId, blockSlotId: r.blockSlotId, optionId: own ? r.optionId : undefined, locked: r.locked, dayOfWeek: r.dayOfWeek, periodId: r.periodId, subjectId: own ? r.subjectId : "",
            subject: own ? r.subject : r.blockName, teacherId: own ? r.teacherId : null, teacher: own ? r.teacher : null, sectionId: "",
            section: this.ctx.role === "teacher" ? `${r.className} (all sections)` : sectionLabels.find((l) => l.classId === r.classId)?.label ?? r.className, room: own ? r.room : null };
        });
      };
      found.push(...blockFound(blockRows));
      const covers = await tx.select({ slotId: substitutions.slotId, blockSlotId: substitutions.blockSlotId, optionId: substitutions.optionId, coverId: substitutions.coverTeacherId, coverName: users.name }).from(substitutions)
        .innerJoin(users, eq(users.id, substitutions.coverTeacherId)).where(eq(substitutions.date, date));
      const coverKey = (c: { slotId: string | null; blockSlotId: string | null; optionId: string | null }) => (c.blockSlotId ? `${c.blockSlotId}:${c.optionId}` : c.slotId!);
      const byCover = new Map(covers.map((c) => [coverKey(c), c]));
      for (const r of found) {
        const c = byCover.get(r.optionId ? `${r.blockSlotId}:${r.optionId}` : r.slotId);
        if (!c) continue;
        r.teacher = c.coverName;
        if (this.ctx.role === "teacher") r.cover = "away";
      }
      if (this.ctx.role === "teacher") {
        const mineCovers = covers.filter((c) => c.coverId === this.ctx.userId);
        const takes = mineCovers.flatMap((c) => (c.slotId ? [c.slotId] : []));
        if (takes.length) for (const r of await this.slotRows(tx, vid, and(inArray(slots.id, takes), eq(slots.dayOfWeek, day)))) found.push({ ...r, cover: "covering" });
        for (const c of mineCovers.filter((x) => x.blockSlotId)) {
          for (const r of blockFound((await this.blockRows(tx, vid, and(eq(bslots.id, c.blockSlotId!), eq(ttBlockOptions.id, c.optionId!), eq(bslots.dayOfWeek, day)))))) found.push({ ...r, cover: "covering" });
        }
      }
      const rows: TodayRow[] = [];
      for (const p of ps) {
        const here = found.filter((s) => s.periodId === p.id);
        const base = { periodId: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak };
        if (here.length) for (const s of here) rows.push({ ...base, slotId: s.blockSlotId ? null : s.slotId, blockSlotId: s.blockSlotId ?? null, optionId: s.optionId ?? null, subject: s.subject, teacher: s.teacher, section: s.section, room: s.room, cover: s.cover ?? null });
        else if (p.isBreak && this.ctx.role !== "teacher") rows.push({ ...base, slotId: null, subject: null, teacher: null, section: null, room: null });
      }
      return { day, rows, override: override?.label ?? null };
    });
  }

  /** What the cell editor offers: subjects of the section's class, and for each subject the teachers who teach it (the section's own first). */
  async slotOptions(sectionId: string, versionId?: string): Promise<SlotOptions> {
    return this.read("manage", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
      const vid = await this.versionFor(tx, versionId, false);
      const [own, ofClass, allSubjects, allTeachers, teaching] = await Promise.all([
        tx.select({ subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers).where(eq(sectionTeachers.sectionId, s.id)),
        tx.select({ subjectId: classSubjects.subjectId }).from(classSubjects).where(eq(classSubjects.classId, s.classId)),
        tx.select({ id: subjects.id, name: subjects.name }).from(subjects).orderBy(asc(subjects.name)),
        tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), ne(users.status, "disabled"))).orderBy(asc(users.name)),
        tx.select({ subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers),
      ]);
      const wanted = new Set([...ofClass.map((r) => r.subjectId), ...own.map((r) => r.subjectId)]);
      const offered = wanted.size ? allSubjects.filter((x) => wanted.has(x.id)) : allSubjects;
      const defaults = Object.fromEntries(own.map((r) => [r.subjectId, r.teacherId]));
      const teachers: SlotOptions["teachers"] = {};
      for (const sub of offered) {
        const ids = new Set(teaching.filter((t) => t.subjectId === sub.id).map((t) => t.teacherId));
        const pool = allTeachers.filter((t) => ids.has(t.id));
        const list = pool.length ? pool : allTeachers; // nobody assigned yet: any teacher
        teachers[sub.id] = [...list].sort((a, b) => Number(b.id === defaults[sub.id]) - Number(a.id === defaults[sub.id]));
      }
      const busy: SlotOptions["busy"] = {};
      const [allSlots, allBlocks, rules] = await Promise.all([
        this.slotRows(tx, vid, sql`${slots.teacherId} is not null`), this.blockRows(tx, vid),
        tx.select({ teacherId: ttTeacherRules.teacherId, maxPerDay: ttTeacherRules.maxPerDay, maxPerWeek: ttTeacherRules.maxPerWeek }).from(ttTeacherRules),
      ]);
      for (const o of allSlots) if (o.sectionId !== s.id) (busy[cellKey(o.dayOfWeek, o.periodId)] ??= {})[o.teacherId!] = o.section;
      // Teachers in a block are busy too (blocks of this class are not "another section": they replace this cell, so they are left to the block check).
      for (const o of allBlocks) if (o.classId !== s.classId) (busy[cellKey(o.dayOfWeek, o.periodId)] ??= {})[o.teacherId] = `${o.className} ${o.blockName}`;
      // Load against the limits, across every section and block of the version: one count per teacher per cell.
      const limits: SlotOptions["limits"] = {};
      for (const r of rules) if (r.maxPerDay || r.maxPerWeek) limits[r.teacherId] = { maxPerDay: r.maxPerDay, maxPerWeek: r.maxPerWeek, week: 0, day: {} };
      const counted = new Set<string>();
      for (const o of [...allSlots, ...allBlocks]) {
        const l = o.teacherId ? limits[o.teacherId] : undefined;
        const key = `${o.teacherId}:${o.dayOfWeek}:${o.periodId}`;
        if (!l || counted.has(key)) continue;
        counted.add(key); l.week++; l.day[o.dayOfWeek] = (l.day[o.dayOfWeek] ?? 0) + 1;
      }
      const blockList = await tx.select({ id: ttBlocks.id, name: ttBlocks.name, subject: subjects.name }).from(ttBlocks)
        .innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlocks.id)).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId)).where(eq(ttBlocks.classId, s.classId)).orderBy(asc(ttBlocks.name), asc(subjects.name));
      const blocks: SlotOptions["blocks"] = [];
      for (const b of blockList) { const have = blocks.find((x) => x.id === b.id); if (have) have.options += ` / ${b.subject}`; else blocks.push({ id: b.id, name: b.name, options: b.subject }); }
      return { classId: s.classId, busy, subjects: offered, teachers, defaults, blocks, limits };
    });
  }

  /** Who carries this section's week and how full their own week is, so the admin can spot an overloaded teacher. */
  async teacherLoad(sectionId: string, versionId?: string): Promise<TeacherLoad> {
    return this.read("manage", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
      const vid = await this.versionFor(tx, versionId, false);
      const [ps, own, mine] = await Promise.all([
        orderedPeriods(tx),
        tx.select({ teacherId: sectionTeachers.teacherId }).from(sectionTeachers).where(eq(sectionTeachers.sectionId, s.id)),
        tx.select({ teacherId: slots.teacherId, n: count() }).from(slots).where(and(eq(slots.versionId, vid), eq(slots.sectionId, s.id))).groupBy(slots.teacherId),
      ]);
      const here = new Map(mine.filter((r) => r.teacherId).map((r) => [r.teacherId!, Number(r.n)]));
      const inBlocks = await this.blockRows(tx, vid);
      for (const r of inBlocks) if (r.classId === s.classId) here.set(r.teacherId, (here.get(r.teacherId) ?? 0) + 1);
      const ids = [...new Set([...own.map((r) => r.teacherId), ...here.keys()])];
      const max = ps.filter((p) => !p.isBreak).length * DAYS.length;
      if (!ids.length) return { max, teachers: [] };
      const [names, totals] = await Promise.all([
        tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)),
        tx.select({ teacherId: slots.teacherId, n: count() }).from(slots).where(and(eq(slots.versionId, vid), inArray(slots.teacherId, ids))).groupBy(slots.teacherId),
      ]);
      const total = new Map(totals.map((r) => [r.teacherId!, Number(r.n)]));
      for (const r of inBlocks) if (ids.includes(r.teacherId)) total.set(r.teacherId, (total.get(r.teacherId) ?? 0) + 1);
      return { max, teachers: names.map((n) => ({ ...n, here: here.get(n.id) ?? 0, total: total.get(n.id) ?? 0 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) };
    });
  }

  /**
   * The students who are in a live period, for taking period-wise attendance. Pass a `TodayRow`'s ids:
   * an ordinary period (`slotId`) lists the active students of its section; a block period (`blockSlotId` + `optionId`) lists the active students
   * of every section of the class who chose that option's subject (student_subjects, current year of each section).
   * Staff only; a teacher only for their own period or one they cover. Needs the students module (else empty).
   */
  async slotStudents(ref: { slotId?: string | null; blockSlotId?: string | null; optionId?: string | null }): Promise<{ id: string; name: string; rollNo: number | null; sectionId: string; section: string }[]> {
    return this.read("read", async (tx) => {
      if (this.isLearner) throw new ForbiddenError();
      const ok = (teacherId: string | null | undefined, covered: boolean) => { if (this.ctx.role === "teacher" && teacherId !== this.ctx.userId && !covered) throw new ForbiddenError(); };
      let secIds: string[];
      let subjectId: string | null = null;
      if (ref.blockSlotId && ref.optionId) {
        const [r] = await this.blockRows(tx, (await this.liveId(tx)) ?? NO_VERSION, and(eq(bslots.id, ref.blockSlotId), eq(ttBlockOptions.id, ref.optionId)));
        if (!r) throw new NotFoundError("Period");
        const [cover] = await tx.select({ id: substitutions.id }).from(substitutions).where(and(eq(substitutions.blockSlotId, r.blockSlotId), eq(substitutions.optionId, r.optionId), eq(substitutions.coverTeacherId, this.ctx.userId))).limit(1);
        ok(r.teacherId, !!cover);
        secIds = (await this.classSections(tx, r.classId)).map((x) => x.id);
        subjectId = r.subjectId;
      } else if (ref.slotId && /^[0-9a-f-]{36}$/i.test(ref.slotId)) {
        const [r] = await tx.select({ sectionId: slots.sectionId, teacherId: slots.teacherId }).from(slots).where(and(eq(slots.id, ref.slotId), eq(slots.versionId, (await this.liveId(tx)) ?? NO_VERSION))).limit(1);
        if (!r) throw new NotFoundError("Period");
        const [cover] = await tx.select({ id: substitutions.id }).from(substitutions).where(and(eq(substitutions.slotId, ref.slotId), eq(substitutions.coverTeacherId, this.ctx.userId))).limit(1);
        ok(r.teacherId, !!cover);
        secIds = [r.sectionId];
      } else throw new NotFoundError("Period");
      if (!this.ctx.features.has("students") || !secIds.length) return [];
      const ids = sql.join(secIds.map((i) => sql`${i}::uuid`), sql`, `);
      const rows = await tx.execute(sql`select st.id, st.name, st.roll_no, st.section_id, c.name || '-' || sc.name as section from students st
        join sections sc on sc.id = st.section_id join classes c on c.id = sc.class_id
        ${subjectId ? sql`join student_subjects ss on ss.student_id = st.id and ss.year_id = sc.year_id and ss.subject_id = ${subjectId}` : sql``}
        where st.section_id in (${ids}) and st.status = 'active' order by sc.name, st.roll_no nulls last, st.name`);
      return [...rows].map((r) => ({ id: String(r.id), name: String(r.name), rollNo: r.roll_no as number | null, sectionId: String(r.section_id), section: String(r.section) }));
    });
  }

  // ---------- changing ----------

  /** The teacher must not already be teaching another section in this period. */
  private async assertTeacherFree(tx: Tx, vid: string, teacher: { id: string; name: string }, day: number, period: { id: string; name: string }, sectionId: string) {
    const [other] = await this.slotRows(tx, vid, and(eq(slots.teacherId, teacher.id), eq(slots.dayOfWeek, day), eq(slots.periodId, period.id), ne(slots.sectionId, sectionId)));
    if (other) throw new ConflictError(`${teacher.name} is already teaching ${other.section} (${other.subject}) on ${dayName(day)}, ${period.name}.`);
    const inBlock = (await teacherUse(tx, vid, [teacher.id], day, period.id, undefined, sectionId)).get(teacher.id);
    if (inBlock) throw new ConflictError(`${teacher.name} is already ${inBlock} on ${dayName(day)}, ${period.name}.`);
  }

  /** One room cannot hold two sections in one period: a room from the list or one typed in, matched ignoring case and spaces at the ends. */
  private async assertRoomFree(tx: Tx, vid: string, room: string | undefined | null, day: number, period: { id: string; name: string }, sectionId: string) {
    room = room?.trim();
    if (!room) return;
    const [other] = await this.slotRows(tx, vid, and(sql`lower(trim(${slots.room})) = lower(${room})`, eq(slots.dayOfWeek, day), eq(slots.periodId, period.id), ne(slots.sectionId, sectionId)));
    if (other) throw new ConflictError(`${room} is already used by ${other.section} (${other.subject}) on ${dayName(day)}, ${period.name}.`);
    const [inBlock] = await this.blockRows(tx, vid, and(sql`lower(${ttRooms.name}) = lower(${room})`, eq(bslots.dayOfWeek, day), eq(bslots.periodId, period.id)));
    if (inBlock) throw new ConflictError(`${room} is already used by ${inBlock.subject} in the ${inBlock.blockName} block on ${dayName(day)}, ${period.name}.`);
  }

  /** A block placed at a cell holds every section of its class: an ordinary class cannot go there. */
  private async assertNoBlock(tx: Tx, vid: string, classId: string, day: number, period: { id: string; name: string }) {
    const [b] = await this.blockRows(tx, vid, and(eq(ttBlocks.classId, classId), eq(bslots.dayOfWeek, day), eq(bslots.periodId, period.id)));
    if (b) throw new ConflictError(`The ${b.blockName} block holds the whole class on ${dayName(day)}, ${period.name}. Clear it first.`);
  }

  /** Put a subject and teacher into a cell, replacing what was there. */
  async setSlot(input: unknown): Promise<GridCell> {
    this.authorize("manage", "write");
    const d = this.parse(slotInput, input);
    return this.write("manage", async (tx) => {
      const section = await this.sectionOrThrow(tx, d.sectionId);
      const [period] = await tx.select().from(periods).where(eq(periods.id, d.periodId)).limit(1);
      if (!period) throw new NotFoundError("Period");
      if (period.isBreak) throw new ValidationError({ periodId: "A break cannot hold a class" });
      const [subject] = await tx.select().from(subjects).where(eq(subjects.id, d.subjectId)).limit(1);
      if (!subject) throw new NotFoundError("Subject");
      const teacher = await this.teacherOrThrow(tx, d.teacherId);
      const vid = await this.versionFor(tx, d.versionId, true);
      await this.assertNoBlock(tx, vid, section.classId, d.dayOfWeek, period);
      await this.assertTeacherFree(tx, vid, teacher, d.dayOfWeek, period, section.id);
      await this.assertRoomFree(tx, vid, d.room, d.dayOfWeek, period, section.id);
      const [kept] = await tx.select({ locked: slots.locked }).from(slots).where(and(eq(slots.versionId, vid), eq(slots.sectionId, section.id), eq(slots.dayOfWeek, d.dayOfWeek), eq(slots.periodId, period.id))).limit(1);
      try {
        const [row] = await tx.insert(slots).values({ schoolId: this.ctx.schoolId, versionId: vid, sectionId: section.id, dayOfWeek: d.dayOfWeek, periodId: period.id, subjectId: subject.id, teacherId: teacher.id, room: d.room ?? null })
          .onConflictDoUpdate({ target: [slots.versionId, slots.sectionId, slots.dayOfWeek, slots.periodId], set: { subjectId: subject.id, teacherId: teacher.id, room: d.room ?? null, updatedAt: new Date() } })
          .returning();
        return { slotId: row!.id, subjectId: subject.id, subject: subject.name, teacherId: teacher.id, teacher: teacher.name, sectionId: section.id, section: section.label, room: row!.room, locked: kept?.locked ?? false };
      } catch (err) {
        rethrowUnique(err, `${teacher.name} is already teaching another section in this period.`);
      }
    }, (c) => ({ action: "set_slot", entity: "Timetable", entityId: c.slotId, summary: `${c.section}: ${c.subject} with ${c.teacher}` }));
  }

  /** Empty a cell. Clearing an empty cell is fine. */
  async clearSlot(input: unknown): Promise<{ cleared: number }> {
    this.authorize("manage", "write");
    const d = this.parse(cellInput, input);
    return this.write("manage", async (tx) => {
      const section = await this.sectionOrThrow(tx, d.sectionId);
      const vid = await this.versionFor(tx, d.versionId, true);
      const gone = await tx.delete(slots).where(and(eq(slots.versionId, vid), eq(slots.sectionId, section.id), eq(slots.dayOfWeek, d.dayOfWeek), eq(slots.periodId, d.periodId))).returning({ id: slots.id });
      // A block in this cell belongs to the whole class: clearing it here removes it for every section.
      const blockIds = (await tx.select({ id: ttBlocks.id }).from(ttBlocks).where(eq(ttBlocks.classId, section.classId))).map((b) => b.id);
      const goneBlocks = blockIds.length ? await tx.delete(bslots).where(and(eq(bslots.versionId, vid), inArray(bslots.blockId, blockIds), eq(bslots.dayOfWeek, d.dayOfWeek), eq(bslots.periodId, d.periodId))).returning({ id: bslots.id }) : [];
      return { cleared: gone.length + goneBlocks.length, section: section.label };
    }, (r) => ({ action: "clear_slot", entity: "Timetable", summary: `Cleared a period of ${r.section}` }));
  }

  /**
   * Put an elective block at a cell for the WHOLE class. Refused when any section of the class already has a class there, when another block of the class
   * is there, or when any option teacher or fixed room is already busy then. Returns the cell as the editing section sees it.
   */
  async setBlock(input: unknown): Promise<GridCell> {
    this.authorize("manage", "write");
    const d = this.parse(blockCellInput, input);
    return this.write("manage", async (tx) => {
      const section = await this.sectionOrThrow(tx, d.sectionId);
      const [period] = await tx.select().from(periods).where(eq(periods.id, d.periodId)).limit(1);
      if (!period) throw new NotFoundError("Period");
      if (period.isBreak) throw new ValidationError({ periodId: "A break cannot hold a class" });
      const [block] = await tx.select().from(ttBlocks).where(eq(ttBlocks.id, d.blockId)).limit(1);
      if (!block) throw new NotFoundError("Block");
      if (block.classId !== section.classId) throw new ValidationError({ blockId: "That block belongs to another class" });
      const vid = await this.versionFor(tx, d.versionId, true);
      const there = await this.blockRows(tx, vid, and(eq(ttBlocks.id, block.id), eq(bslots.dayOfWeek, d.dayOfWeek), eq(bslots.periodId, period.id)));
      if (there.length) return Object.values(this.blockCells(there, { sectionId: section.id, sectionLabel: section.label, chosen: await this.chosenSubjects(tx) }))[0]!;
      const [options, secs] = await Promise.all([
        tx.select({ teacherId: ttBlockOptions.teacherId, teacher: users.name, room: ttRooms.name }).from(ttBlockOptions).innerJoin(users, eq(users.id, ttBlockOptions.teacherId)).leftJoin(ttRooms, eq(ttRooms.id, ttBlockOptions.roomId)).where(eq(ttBlockOptions.blockId, block.id)),
        this.classSections(tx, block.classId),
      ]);
      const at = `${dayName(d.dayOfWeek)}, ${period.name}`;
      const taken = await this.slotRows(tx, vid, and(inArray(slots.sectionId, secs.map((x) => x.id)), eq(slots.dayOfWeek, d.dayOfWeek), eq(slots.periodId, period.id)));
      if (taken.length) throw new ConflictError(`${taken.map((t) => t.section).join(", ")} already ${taken.length === 1 ? "has" : "have"} a class on ${at}. Clear ${taken.length === 1 ? "it" : "them"} first.`);
      const [other] = await this.blockRows(tx, vid, and(eq(ttBlocks.classId, block.classId), ne(ttBlocks.id, block.id), eq(bslots.dayOfWeek, d.dayOfWeek), eq(bslots.periodId, period.id)));
      if (other) throw new ConflictError(`The ${other.blockName} block already runs on ${at}.`);
      const use = await teacherUse(tx, vid, options.map((o) => o.teacherId), d.dayOfWeek, period.id, block.id);
      for (const o of options) if (use.has(o.teacherId)) throw new ConflictError(`${o.teacher} is already ${use.get(o.teacherId)} on ${at}.`);
      for (const o of options) if (o.room) await this.assertRoomFree(tx, vid, o.room, d.dayOfWeek, period, NO_VERSION);
      await tx.insert(bslots).values({ schoolId: this.ctx.schoolId, versionId: vid, blockId: block.id, dayOfWeek: d.dayOfWeek, periodId: period.id }).onConflictDoNothing();
      const rows = await this.blockRows(tx, vid, and(eq(ttBlocks.id, block.id), eq(bslots.dayOfWeek, d.dayOfWeek), eq(bslots.periodId, period.id)));
      return Object.values(this.blockCells(rows, { sectionId: section.id, sectionLabel: section.label, chosen: await this.chosenSubjects(tx) }))[0]!;
    }, (c) => ({ action: "set_block", entity: "Timetable", entityId: c.slotId, summary: `${c.section}: ${c.blockName} block for the whole class` }));
  }

  /**
   * Fill the empty cells of a section from its subject teachers, round-robin, never double-booking a teacher.
   * Prefers a subject that is not yet taught that day. Cells already set are kept.
   */
  async autoFill(sectionId: string): Promise<{ filled: number; empty: number }> {
    this.authorize("manage", "write");
    const { sectionId: id } = this.parse(sectionInput, { sectionId });
    return this.write("manage", async (tx) => {
      const section = await this.sectionOrThrow(tx, id);
      const teaching = await tx.select({ subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers)
        .innerJoin(subjects, eq(subjects.id, sectionTeachers.subjectId)).where(eq(sectionTeachers.sectionId, section.id)).orderBy(asc(subjects.name));
      if (!teaching.length) throw new ConflictError("Assign subject teachers to this section first (Academic setup).");
      const teachable = (await orderedPeriods(tx)).filter((p) => !p.isBreak);
      if (!teachable.length) throw new ConflictError("Set up the bell schedule first.");

      const vid = await this.ensureLive(tx);
      const mine = await this.slotRows(tx, vid, eq(slots.sectionId, section.id));
      const classBlocks = await this.blockRows(tx, vid, eq(ttBlocks.classId, section.classId));
      const taken = new Set([...mine, ...classBlocks].map((s) => cellKey(s.dayOfWeek, s.periodId)));
      const teacherIds = teaching.map((t) => t.teacherId);
      const busy = new Set([
        ...(await this.slotRows(tx, vid, inArray(slots.teacherId, teacherIds))).map((s) => `${s.teacherId}:${cellKey(s.dayOfWeek, s.periodId)}`),
        ...(await this.blockRows(tx, vid, inArray(ttBlockOptions.teacherId, teacherIds))).map((s) => `${s.teacherId}:${cellKey(s.dayOfWeek, s.periodId)}`),
      ]);
      const subjectsToday = new Map<number, Set<string>>(DAYS.map((d) => [d.n, new Set(mine.filter((s) => s.dayOfWeek === d.n).map((s) => s.subjectId))]));

      const values: (typeof slots.$inferInsert)[] = [];
      let cursor = 0;
      for (const day of DAYS) for (const p of teachable) {
        if (taken.has(cellKey(day.n, p.id))) continue;
        const order = teaching.map((_, i) => (cursor + i) % teaching.length);
        const free = order.filter((i) => !busy.has(`${teaching[i]!.teacherId}:${cellKey(day.n, p.id)}`));
        const pick = free.find((i) => !subjectsToday.get(day.n)!.has(teaching[i]!.subjectId)) ?? free[0];
        if (pick === undefined) continue;
        const { subjectId, teacherId } = teaching[pick]!;
        values.push({ schoolId: this.ctx.schoolId, versionId: vid, sectionId: section.id, dayOfWeek: day.n, periodId: p.id, subjectId, teacherId, room: section.room });
        busy.add(`${teacherId}:${cellKey(day.n, p.id)}`);
        subjectsToday.get(day.n)!.add(subjectId);
        cursor = pick + 1;
      }
      if (values.length) await tx.insert(slots).values(values);
      return { filled: values.length, empty: DAYS.length * teachable.length - taken.size - values.length, section: section.label };
    }, (r) => ({ action: "auto_fill", entity: "Timetable", summary: `Auto-filled ${r.filled} periods of ${r.section}` }));
  }

  /**
   * Copy one section's week to another section of the same class. The target keeps its own teacher of a subject when it has one,
   * otherwise the source's. Cells that would clash (a busy teacher or room) or are already taken are skipped and reported.
   */
  async copyWeek(input: unknown): Promise<CopyWeekResult> {
    this.authorize("manage", "write");
    const d = this.parse(copyWeekInput, input);
    if (d.fromSectionId === d.toSectionId) throw new ValidationError({ toSectionId: "Pick a different section" });
    return this.write("manage", async (tx) => {
      const from = await this.sectionOrThrow(tx, d.fromSectionId);
      const to = await this.sectionOrThrow(tx, d.toSectionId);
      if (from.classId !== to.classId) throw new ConflictError("Only sections of the same class can copy a week.");
      const vid = await this.versionFor(tx, d.versionId, true);
      const [ps, source, own] = await Promise.all([
        orderedPeriods(tx), this.slotRows(tx, vid, eq(slots.sectionId, from.id)),
        tx.select({ subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers).where(eq(sectionTeachers.sectionId, to.id)),
      ]);
      if (d.replace) await tx.delete(slots).where(and(eq(slots.versionId, vid), eq(slots.sectionId, to.id), eq(slots.locked, false)));
      // Blocks belong to the whole class, so they are never copied; their cells stay theirs and their teachers stay busy.
      const blocked = await this.blockRows(tx, vid);
      const mine = new Set([...(await this.slotRows(tx, vid, eq(slots.sectionId, to.id))), ...blocked.filter((b) => b.classId === to.classId)].map((s) => cellKey(s.dayOfWeek, s.periodId)));
      const teacherOf = new Map(own.map((r) => [r.subjectId, r.teacherId]));
      const periodName = new Map(ps.map((p) => [p.id, p.name]));
      const busyRows = await this.slotRows(tx, vid, and(ne(slots.sectionId, to.id), sql`${slots.teacherId} is not null`));
      const busy = new Set([...busyRows, ...blocked].map((s) => `${s.teacherId}:${cellKey(s.dayOfWeek, s.periodId)}`));
      const rooms = new Set([...busyRows, ...blocked].filter((s) => s.room).map((s) => `${s.room!.toLowerCase()}:${cellKey(s.dayOfWeek, s.periodId)}`));
      const known = new Set((await tx.select({ name: ttRooms.name }).from(ttRooms)).map((r) => r.name.toLowerCase()));
      const out: CopyWeekResult = { copied: 0, skipped: [] };
      const values: (typeof slots.$inferInsert)[] = [];
      for (const s of source) {
        const key = cellKey(s.dayOfWeek, s.periodId);
        const skip = (reason: string) => out.skipped.push({ day: s.dayOfWeek, period: periodName.get(s.periodId) ?? "", reason });
        if (mine.has(key)) { skip("Already has a class"); continue; }
        const teacherId = teacherOf.get(s.subjectId) ?? s.teacherId;
        if (teacherId && busy.has(`${teacherId}:${key}`)) { skip("Teacher is busy in another section"); continue; }
        // The source's own free-text room belongs to the source; only the target's room is kept, unless it is a shared school room that is free.
        const room = to.room ?? null;
        if (room && known.has(room.toLowerCase()) && rooms.has(`${room.toLowerCase()}:${key}`)) { skip(`${room} is used by another section`); continue; }
        values.push({ schoolId: this.ctx.schoolId, versionId: vid, sectionId: to.id, dayOfWeek: s.dayOfWeek, periodId: s.periodId, subjectId: s.subjectId, teacherId, room });
        if (teacherId) busy.add(`${teacherId}:${key}`);
        out.copied++;
      }
      if (values.length) await tx.insert(slots).values(values);
      return { ...out, from: from.label, to: to.label };
    }, (r) => ({ action: "copy_week", entity: "Timetable", summary: `Copied the week of ${(r as { from: string }).from} to ${(r as { to: string }).to}: ${r.copied} copied, ${r.skipped.length} skipped` }));
  }
}
