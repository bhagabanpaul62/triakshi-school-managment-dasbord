import { and, asc, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { CrudService, ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { academicYears, classSubjects, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { DAYS, cellKey, dayName, presetPeriods, schoolDay, timeRange } from "./bell";
import timetableFeature from "./feature";
import { cellInput, periodInput, sectionInput, slotInput } from "./inputs";
import { periods, timetableSlots as slots } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;
type PeriodRow = typeof periods.$inferSelect;

/** A period as the screens need it: plain data, safe to hand to a client component. */
export interface PeriodView { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean }
/** One class in the week. In a section grid `teacher` is who teaches it; in a teacher grid `section` is where they teach it. */
export interface GridCell {
  slotId: string; subjectId: string; subject: string; teacherId: string | null; teacher: string | null;
  sectionId: string; section: string; room: string | null;
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
}
/** Periods a week each teacher of a section carries, here and across the school, out of `max` teaching periods in a week. */
export interface TeacherLoad { max: number; teachers: { id: string; name: string; here: number; total: number }[] }
export interface TodayRow { periodId: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; subject: string | null; teacher: string | null; section: string | null; room: string | null }

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

  private get isLearner() { return this.ctx.role === "student" || this.ctx.role === "parent"; }

  // ---------- lookups shared by every operation ----------

  /** Sections the caller is tied to: a student's own, a parent's children's. null = not restricted (staff). Needs the students module. */
  private async learnerSectionIds(tx: Tx): Promise<string[] | null> {
    if (!this.isLearner) return null;
    if (!this.ctx.features.has("students")) return [];
    const rows = this.ctx.role === "student"
      ? await tx.execute(sql`select distinct section_id from students where user_id = ${this.ctx.userId} and section_id is not null`)
      : await tx.execute(sql`select distinct s.section_id from guardians g
          join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id
          where g.user_id = ${this.ctx.userId} and s.section_id is not null`);
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
  private async slotRows(tx: Tx, where?: SQL) {
    const rows = await tx.select({
      slotId: slots.id, dayOfWeek: slots.dayOfWeek, periodId: slots.periodId, subjectId: slots.subjectId, subject: subjects.name,
      teacherId: slots.teacherId, teacher: users.name, sectionId: slots.sectionId, className: classes.name, sectionName: sections.name, room: slots.room,
    }).from(slots)
      .innerJoin(subjects, eq(subjects.id, slots.subjectId))
      .innerJoin(sections, eq(sections.id, slots.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(users, eq(users.id, slots.teacherId))
      .where(where);
    return rows.map(({ className, sectionName, ...r }) => ({ ...r, section: `${className}-${sectionName}` }));
  }

  private async grid(tx: Tx, title: string, where: SQL): Promise<Timetable> {
    const [ps, rows] = await Promise.all([orderedPeriods(tx), this.slotRows(tx, where)]);
    const cells: Record<string, GridCell> = {};
    for (const { dayOfWeek, periodId, ...cell } of rows) cells[cellKey(dayOfWeek, periodId)] = cell;
    return { title, periods: ps.map(toView), cells };
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
  async sectionGrid(sectionId: string): Promise<Timetable> {
    return this.read("read", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
      return this.grid(tx, s.label, eq(slots.sectionId, s.id));
    });
  }

  /** The week of one teacher, with the section they teach in each period. Staff only; teachers pass their own id for "My timetable". */
  async teacherGrid(teacherId: string): Promise<Timetable> {
    return this.read("read", async (tx) => {
      if (this.isLearner) throw new ForbiddenError();
      const t = await this.teacherOrThrow(tx, teacherId);
      return this.grid(tx, t.name, eq(slots.teacherId, t.id));
    });
  }

  /** Today's periods for dashboards: a teacher's own classes, or the section of a student (or of a parent's children). Empty on Sunday and for other roles. */
  async today(now: Date = new Date()): Promise<{ day: number | null; rows: TodayRow[] }> {
    return this.read("read", async (tx) => {
      const day = schoolDay(now);
      if (!day) return { day, rows: [] };
      const mine = this.ctx.role === "teacher" ? undefined : await this.learnerSectionIds(tx);
      if (this.ctx.role !== "teacher" && !mine?.length) return { day, rows: [] };
      const who = this.ctx.role === "teacher" ? eq(slots.teacherId, this.ctx.userId) : inArray(slots.sectionId, mine!);
      const [ps, found] = await Promise.all([orderedPeriods(tx), this.slotRows(tx, and(who, eq(slots.dayOfWeek, day)))]);
      const rows: TodayRow[] = [];
      for (const p of ps) {
        const here = found.filter((s) => s.periodId === p.id);
        const base = { periodId: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak };
        if (here.length) for (const s of here) rows.push({ ...base, subject: s.subject, teacher: s.teacher, section: s.section, room: s.room });
        else if (p.isBreak && this.ctx.role !== "teacher") rows.push({ ...base, subject: null, teacher: null, section: null, room: null });
      }
      return { day, rows };
    });
  }

  /** What the cell editor offers: subjects of the section's class, and for each subject the teachers who teach it (the section's own first). */
  async slotOptions(sectionId: string): Promise<SlotOptions> {
    return this.read("manage", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
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
      for (const o of await this.slotRows(tx, and(ne(slots.sectionId, s.id), sql`${slots.teacherId} is not null`))) {
        (busy[cellKey(o.dayOfWeek, o.periodId)] ??= {})[o.teacherId!] = o.section;
      }
      return { classId: s.classId, busy, subjects: offered, teachers, defaults };
    });
  }

  /** Who carries this section's week and how full their own week is, so the admin can spot an overloaded teacher. */
  async teacherLoad(sectionId: string): Promise<TeacherLoad> {
    return this.read("manage", async (tx) => {
      const s = await this.sectionOrThrow(tx, sectionId);
      const [ps, own, mine] = await Promise.all([
        orderedPeriods(tx),
        tx.select({ teacherId: sectionTeachers.teacherId }).from(sectionTeachers).where(eq(sectionTeachers.sectionId, s.id)),
        tx.select({ teacherId: slots.teacherId, n: count() }).from(slots).where(eq(slots.sectionId, s.id)).groupBy(slots.teacherId),
      ]);
      const here = new Map(mine.filter((r) => r.teacherId).map((r) => [r.teacherId!, Number(r.n)]));
      const ids = [...new Set([...own.map((r) => r.teacherId), ...here.keys()])];
      const max = ps.filter((p) => !p.isBreak).length * DAYS.length;
      if (!ids.length) return { max, teachers: [] };
      const [names, totals] = await Promise.all([
        tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)),
        tx.select({ teacherId: slots.teacherId, n: count() }).from(slots).where(inArray(slots.teacherId, ids)).groupBy(slots.teacherId),
      ]);
      const total = new Map(totals.map((r) => [r.teacherId!, Number(r.n)]));
      return { max, teachers: names.map((n) => ({ ...n, here: here.get(n.id) ?? 0, total: total.get(n.id) ?? 0 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) };
    });
  }

  // ---------- changing ----------

  /** The teacher must not already be teaching another section in this period. */
  private async assertTeacherFree(tx: Tx, teacher: { id: string; name: string }, day: number, period: { id: string; name: string }, sectionId: string) {
    const [other] = await this.slotRows(tx, and(eq(slots.teacherId, teacher.id), eq(slots.dayOfWeek, day), eq(slots.periodId, period.id), ne(slots.sectionId, sectionId)));
    if (other) throw new ConflictError(`${teacher.name} is already teaching ${other.section} (${other.subject}) on ${dayName(day)}, ${period.name}.`);
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
      await this.assertTeacherFree(tx, teacher, d.dayOfWeek, period, section.id);
      try {
        const [row] = await tx.insert(slots).values({ schoolId: this.ctx.schoolId, sectionId: section.id, dayOfWeek: d.dayOfWeek, periodId: period.id, subjectId: subject.id, teacherId: teacher.id, room: d.room ?? null })
          .onConflictDoUpdate({ target: [slots.sectionId, slots.dayOfWeek, slots.periodId], set: { subjectId: subject.id, teacherId: teacher.id, room: d.room ?? null, updatedAt: new Date() } })
          .returning();
        return { slotId: row!.id, subjectId: subject.id, subject: subject.name, teacherId: teacher.id, teacher: teacher.name, sectionId: section.id, section: section.label, room: row!.room };
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
      const gone = await tx.delete(slots).where(and(eq(slots.sectionId, section.id), eq(slots.dayOfWeek, d.dayOfWeek), eq(slots.periodId, d.periodId))).returning({ id: slots.id });
      return { cleared: gone.length, section: section.label };
    }, (r) => ({ action: "clear_slot", entity: "Timetable", summary: `Cleared a period of ${r.section}` }));
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

      const mine = await this.slotRows(tx, eq(slots.sectionId, section.id));
      const taken = new Set(mine.map((s) => cellKey(s.dayOfWeek, s.periodId)));
      const busy = new Set((await this.slotRows(tx, inArray(slots.teacherId, teaching.map((t) => t.teacherId)))).map((s) => `${s.teacherId}:${cellKey(s.dayOfWeek, s.periodId)}`));
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
        values.push({ schoolId: this.ctx.schoolId, sectionId: section.id, dayOfWeek: day.n, periodId: p.id, subjectId, teacherId, room: section.room });
        busy.add(`${teacherId}:${cellKey(day.n, p.id)}`);
        subjectsToday.get(day.n)!.add(subjectId);
        cursor = pick + 1;
      }
      if (values.length) await tx.insert(slots).values(values);
      return { filled: values.length, empty: DAYS.length * teachable.length - taken.size - values.length, section: section.label };
    }, (r) => ({ action: "auto_fill", entity: "Timetable", summary: `Auto-filled ${r.filled} periods of ${r.section}` }));
  }
}
