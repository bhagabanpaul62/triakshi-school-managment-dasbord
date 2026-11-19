import { and, asc, count, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { CrudService, ForbiddenError, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { academicYears, classes, sectionTeachers, sections } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import attendanceFeature from "./feature";
import { DEFAULTER_BELOW } from "./constants";
import { holidayInput, markStaffInput, markStudentsInput, monthInput } from "./inputs";
import { attendanceHolidays, staffAttendance, studentAttendance } from "./schema";
import { addDays, attendancePercent, countsOf, groupBy, isDate, isSunday, monthDays, tally, todayIST, type Counts } from "./stats";

type Perm = keyof typeof attendanceFeature.permissions;
export type Holiday = typeof attendanceHolidays.$inferSelect;

const MIN_DAYS_FOR_DEFAULTER = 5;

/**
 * What student and staff attendance share: the "can this day be marked" rules (no future dates, no holidays)
 * and the bulk upsert. Subclasses add who may be marked and how it is read back.
 */
abstract class AttendanceBase extends SchoolService<Perm> {
  protected feature = attendanceFeature;

  constructor(ctx: Ctx) { super(ctx); }

  protected assertDate(date: string, field = "date") {
    if (!isDate(date)) throw new ValidationError({ [field]: "Pick a date" });
  }

  protected async holidayOn(tx: Tx, date: string): Promise<string | null> {
    const [h] = await tx.select({ name: attendanceHolidays.name }).from(attendanceHolidays).where(eq(attendanceHolidays.date, date)).limit(1);
    return h?.name ?? null;
  }

  /** A day can be marked when it is not in the future and not a holiday. */
  protected async assertOpenDay(tx: Tx, date: string) {
    this.assertDate(date);
    if (date > todayIST()) throw new ValidationError({ date: "You cannot mark a future date" });
    const holiday = await this.holidayOn(tx, date);
    if (holiday) throw new ValidationError({ date: `${holiday} is a holiday` });
  }

  /** Insert rows; a second mark for the same person and day overwrites the first. */
  protected async upsert(tx: Tx, table: PgTable, target: PgColumn[], values: Record<string, unknown>[], extra: Record<string, SQL> = {}) {
    await tx.insert(table).values(values as never).onConflictDoUpdate({
      target,
      set: { status: sql`excluded.status`, note: sql`excluded.note`, markedBy: sql`excluded.marked_by`, updatedAt: sql`now()`, ...extra } as never,
    });
  }

  /** Keep the last entry per person, so a repeated row in one request cannot collide with itself. */
  protected lastPerKey<T extends Record<string, unknown>>(entries: T[], key: keyof T): T[] {
    return [...new Map(entries.map((e) => [e[key], e])).values()];
  }
}

/** Student attendance: the daily sheet, the monthly register, per-student summaries, defaulters and school-wide numbers. */
export class StudentAttendanceService extends AttendanceBase {
  // ---------- who may see which section ----------

  /** Sections a teacher is class teacher of or teaches. */
  protected async teacherSectionIds(tx: Tx): Promise<string[]> {
    const [own, teaching] = await Promise.all([
      tx.select({ id: sections.id }).from(sections).where(eq(sections.classTeacherId, this.ctx.userId)),
      tx.select({ id: sectionTeachers.sectionId }).from(sectionTeachers).where(eq(sectionTeachers.teacherId, this.ctx.userId)),
    ]);
    return [...new Set([...own, ...teaching].map((r) => r.id))];
  }

  /** Admin and accountant: any section. Teacher: only their own. */
  protected async assertSectionAccess(tx: Tx, sectionId: string) {
    if (this.ctx.role !== "teacher") return;
    if (!(await this.teacherSectionIds(tx)).includes(sectionId)) throw new ForbiddenError("You can use only your own sections.");
  }

  protected async sectionLabels(tx: Tx, ids?: string[]): Promise<Map<string, string>> {
    if (ids && ids.length === 0) return new Map();
    const rows = await tx.select({ id: sections.id, section: sections.name, cls: classes.name }).from(sections)
      .innerJoin(classes, eq(classes.id, sections.classId)).where(ids ? inArray(sections.id, ids) : undefined);
    return new Map(rows.map((r) => [r.id, `${r.cls}-${r.section}`]));
  }

  protected async sectionLabel(tx: Tx, sectionId: string): Promise<string> {
    const label = (await this.sectionLabels(tx, [sectionId])).get(sectionId);
    if (!label) throw new NotFoundError("Section");
    return label;
  }

  /** Sections of the current year the caller may open, for the section picker. A teacher's own class comes first. */
  async sectionOptions(): Promise<{ id: string; label: string; own: boolean }[]> {
    return this.read("read", async (tx) => {
      const mine = this.ctx.role === "teacher" ? await this.teacherSectionIds(tx) : undefined;
      if (mine && mine.length === 0) return [];
      const [rows, owned] = await Promise.all([
        tx.select({ id: sections.id, section: sections.name, cls: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId))
          .innerJoin(academicYears, and(eq(academicYears.id, sections.yearId), eq(academicYears.isCurrent, true)))
          .where(mine ? inArray(sections.id, mine) : undefined)
          .orderBy(asc(classes.grade), asc(sections.name)),
        tx.select({ id: sections.id }).from(sections).where(eq(sections.classTeacherId, this.ctx.userId)),
      ]);
      const own = new Set(owned.map((r) => r.id));
      return rows.map((r) => ({ id: r.id, label: `${r.cls}-${r.section}`, own: own.has(r.id) })).sort((a, b) => Number(b.own) - Number(a.own));
    });
  }

  /** For one day: every section the caller may open, with how many of its students are marked (to chase the rest). */
  async sectionProgress(date: string) {
    this.assertDate(date);
    return this.read("read", async (tx) => {
      const mine = this.ctx.role === "teacher" ? await this.teacherSectionIds(tx) : undefined;
      if (mine && mine.length === 0) return [];
      const [rows, total, marked] = await Promise.all([
        tx.select({ id: sections.id, section: sections.name, cls: classes.name, teacher: users.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId))
          .innerJoin(academicYears, and(eq(academicYears.id, sections.yearId), eq(academicYears.isCurrent, true)))
          .leftJoin(users, eq(users.id, sections.classTeacherId))
          .where(mine ? inArray(sections.id, mine) : undefined)
          .orderBy(asc(classes.grade), asc(sections.name)),
        tx.select({ id: students.sectionId, n: count() }).from(students).where(eq(students.status, "active")).groupBy(students.sectionId),
        tx.select({ id: studentAttendance.sectionId, n: count() }).from(studentAttendance).where(eq(studentAttendance.date, date)).groupBy(studentAttendance.sectionId),
      ]);
      const totalOf = new Map(total.map((r) => [r.id, Number(r.n)])), markedOf = new Map(marked.map((r) => [r.id, Number(r.n)]));
      return rows.map((r) => ({ id: r.id, label: `${r.cls}-${r.section}`, teacher: r.teacher ?? null, students: totalOf.get(r.id) ?? 0, marked: markedOf.get(r.id) ?? 0 }))
        .filter((r) => r.students > 0);
    });
  }

  // ---------- the daily sheet ----------

  /** Active students of a section with their status on `date` (null = not marked yet). */
  async sectionSheet(sectionId: string, date: string) {
    this.assertDate(date);
    return this.read("read", async (tx) => {
      await this.assertSectionAccess(tx, sectionId);
      const label = await this.sectionLabel(tx, sectionId);
      const rows = await tx.select({
        studentId: students.id, name: students.name, rollNo: students.rollNo, admissionNo: students.admissionNo,
        status: studentAttendance.status, note: studentAttendance.note,
      }).from(students)
        .leftJoin(studentAttendance, and(eq(studentAttendance.studentId, students.id), eq(studentAttendance.date, date)))
        .where(and(eq(students.sectionId, sectionId), eq(students.status, "active")))
        .orderBy(asc(students.rollNo), asc(students.name));
      return { section: { id: sectionId, label }, date, holiday: await this.holidayOn(tx, date), rows };
    });
  }

  /** Mark (or re-mark) a whole section for one day. Returns the day's counts. */
  async mark(input: unknown): Promise<Counts> {
    this.authorize("mark", "write");
    const data = this.parse(markStudentsInput, input);
    const entries = this.lastPerKey(data.entries, "studentId");
    return this.write("mark", async (tx) => {
      await this.assertSectionAccess(tx, data.sectionId);
      await this.assertOpenDay(tx, data.date);
      const ids = entries.map((e) => e.studentId);
      const inSection = await tx.select({ id: students.id }).from(students).where(and(eq(students.sectionId, data.sectionId), inArray(students.id, ids)));
      if (inSection.length !== ids.length) throw new ValidationError({ entries: "Some students are not in this section" });
      await this.upsert(tx, studentAttendance, [studentAttendance.studentId, studentAttendance.date],
        entries.map((e) => ({ schoolId: this.ctx.schoolId, studentId: e.studentId, sectionId: data.sectionId, date: data.date, status: e.status, note: e.note ?? null, markedBy: this.ctx.userId })),
        { sectionId: sql`excluded.section_id` });
      return tally(entries.map((e) => e.status));
    }, (c) => ({ action: "mark", entity: "Attendance", summary: `Marked ${c.total} students on ${data.date}: ${c.present} present, ${c.absent} absent` }));
  }

  // ---------- the monthly register ----------

  /** A section's month as a matrix: one row per student, one status per day, plus counts and %. */
  async monthlyRegister(sectionId: string, month: string) {
    this.parse(monthInput, month);
    const days = monthDays(month);
    return this.read("read", async (tx) => {
      await this.assertSectionAccess(tx, sectionId);
      const label = await this.sectionLabel(tx, sectionId);
      const [people, marks, holidays] = await Promise.all([
        tx.select({ studentId: students.id, name: students.name, rollNo: students.rollNo }).from(students)
          .where(and(eq(students.sectionId, sectionId), eq(students.status, "active"))).orderBy(asc(students.rollNo), asc(students.name)),
        tx.select({ studentId: studentAttendance.studentId, date: studentAttendance.date, status: studentAttendance.status }).from(studentAttendance)
          .innerJoin(students, eq(students.id, studentAttendance.studentId))
          .where(and(eq(students.sectionId, sectionId), gte(studentAttendance.date, days[0]!), lte(studentAttendance.date, days.at(-1)!))),
        tx.select({ date: attendanceHolidays.date, name: attendanceHolidays.name }).from(attendanceHolidays)
          .where(and(gte(attendanceHolidays.date, days[0]!), lte(attendanceHolidays.date, days.at(-1)!))),
      ]);
      const byStudent = groupBy(marks, (m) => m.studentId);
      const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
      return {
        section: { id: sectionId, label }, month,
        days: days.map((date) => ({ date, day: Number(date.slice(8)), sunday: isSunday(date), holiday: holidayOf.get(date) ?? null })),
        rows: people.map((p) => {
          const mine = byStudent.get(p.studentId) ?? [];
          const counts = tally(mine.map((m) => m.status));
          return { ...p, marks: Object.fromEntries(mine.map((m) => [m.date, m.status])), counts, pct: attendancePercent(counts) };
        }),
      };
    });
  }

  // ---------- one student ----------

  /** The students the caller is: themselves (student) or their children (parent). */
  protected async myStudentIds(tx: Tx): Promise<string[]> {
    if (this.ctx.role === "student") {
      return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
    }
    const rows = await tx.select({ id: studentGuardians.studentId }).from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(eq(guardians.userId, this.ctx.userId));
    return rows.map((r) => r.id);
  }

  /** Staff roles read through "read" (teachers only their sections); students and parents through "self" (only their own). */
  protected async viewStudent<T>(studentId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const staff = this.can("read");
    return this.read(staff ? "read" : "self", async (tx) => {
      if (staff) {
        const [s] = await tx.select({ sectionId: students.sectionId }).from(students).where(eq(students.id, studentId)).limit(1);
        if (!s) throw new NotFoundError("Student");
        if (s.sectionId) await this.assertSectionAccess(tx, s.sectionId);
        else if (this.ctx.role === "teacher") throw new ForbiddenError();
      } else if (!(await this.myStudentIds(tx)).includes(studentId)) throw new NotFoundError("Student");
      return fn(tx);
    });
  }

  /** For students and parents: the children (or the student) whose attendance they may see. */
  async myStudents(): Promise<{ id: string; name: string; sectionLabel: string | null }[]> {
    return this.read("self", async (tx) => {
      const ids = await this.myStudentIds(tx);
      if (ids.length === 0) return [];
      const [rows, labels] = await Promise.all([
        tx.select({ id: students.id, name: students.name, sectionId: students.sectionId }).from(students).where(inArray(students.id, ids)).orderBy(asc(students.name)),
        this.sectionLabels(tx),
      ]);
      return rows.map((r) => ({ id: r.id, name: r.name, sectionLabel: (r.sectionId && labels.get(r.sectionId)) || null }));
    });
  }

  /** Counts and % for one student between two dates (inclusive). */
  async studentSummary(studentId: string, from: string, to: string) {
    this.assertDate(from, "from"); this.assertDate(to, "to");
    return this.viewStudent(studentId, async (tx) => {
      const rows = await tx.select({ status: studentAttendance.status }).from(studentAttendance)
        .where(and(eq(studentAttendance.studentId, studentId), gte(studentAttendance.date, from), lte(studentAttendance.date, to)));
      const counts = tally(rows.map((r) => r.status));
      return { ...counts, pct: attendancePercent(counts), from, to };
    });
  }

  /** One student's marks for a "YYYY-MM" month, plus the school's holidays in it, for the calendar. */
  async studentMonth(studentId: string, month: string) {
    this.parse(monthInput, month);
    const days = monthDays(month);
    return this.viewStudent(studentId, async (tx) => {
      const [marks, holidays] = await Promise.all([
        tx.select({ date: studentAttendance.date, status: studentAttendance.status }).from(studentAttendance)
          .where(and(eq(studentAttendance.studentId, studentId), gte(studentAttendance.date, days[0]!), lte(studentAttendance.date, days.at(-1)!))),
        tx.select({ date: attendanceHolidays.date, name: attendanceHolidays.name }).from(attendanceHolidays)
          .where(and(gte(attendanceHolidays.date, days[0]!), lte(attendanceHolidays.date, days.at(-1)!))),
      ]);
      return { month, marks: Object.fromEntries(marks.map((m) => [m.date, m.status])), holidays: Object.fromEntries(holidays.map((h) => [h.date, h.name])), counts: tally(marks.map((m) => m.status)) };
    });
  }

  /** Latest days the student was absent, late or on leave. */
  async recentAbsences(studentId: string, limit = 8) {
    return this.viewStudent(studentId, (tx) => tx.select({ date: studentAttendance.date, status: studentAttendance.status, note: studentAttendance.note }).from(studentAttendance)
      .where(and(eq(studentAttendance.studentId, studentId), ne(studentAttendance.status, "present")))
      .orderBy(sql`${studentAttendance.date} desc`).limit(limit));
  }

  // ---------- school-wide ----------

  /** Students under `below`% over the last `days` days (needs a few marked days to count). Teachers see their sections only. */
  async defaulters(below = DEFAULTER_BELOW, days = 90) {
    return this.read("read", async (tx) => {
      const mine = this.ctx.role === "teacher" ? await this.teacherSectionIds(tx) : undefined;
      if (mine && mine.length === 0) return [];
      const rows = await tx.select({ studentId: students.id, name: students.name, sectionId: students.sectionId, status: studentAttendance.status, n: count() })
        .from(studentAttendance).innerJoin(students, eq(students.id, studentAttendance.studentId))
        .where(and(eq(students.status, "active"), gte(studentAttendance.date, addDays(todayIST(), -days)), lte(studentAttendance.date, todayIST()),
          mine ? inArray(students.sectionId, mine) : undefined))
        .groupBy(students.id, students.name, students.sectionId, studentAttendance.status);
      const labels = await this.sectionLabels(tx);
      return [...groupBy(rows, (r) => r.studentId).values()].flatMap((g) => {
        const counts = countsOf(g);
        const pct = attendancePercent(counts);
        const counted = counts.present + counts.late + counts.absent;
        if (pct === null || pct >= below || counted < MIN_DAYS_FOR_DEFAULTER) return [];
        return [{ studentId: g[0]!.studentId, name: g[0]!.name, sectionId: g[0]!.sectionId, sectionLabel: (g[0]!.sectionId && labels.get(g[0]!.sectionId)) || null, absent: counts.absent, counted, pct }];
      }).sort((a, b) => a.pct - b.pct);
    });
  }

  /** Today's numbers for dashboards. */
  async todaySchoolSummary() {
    const date = todayIST();
    return this.read("read", async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({ status: studentAttendance.status, n: count() }).from(studentAttendance).where(eq(studentAttendance.date, date)).groupBy(studentAttendance.status),
        tx.select({ n: count() }).from(students).where(eq(students.status, "active")),
      ]);
      const counts = countsOf(rows);
      return { date, ...counts, marked: counts.total, students: Number(total[0]?.n ?? 0), pct: attendancePercent(counts) };
    });
  }

  /** Daily school-wide attendance %, oldest first, only for days that were marked. */
  async trend(days = 30): Promise<{ date: string; pct: number }[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ date: studentAttendance.date, status: studentAttendance.status, n: count() }).from(studentAttendance)
        .where(and(gte(studentAttendance.date, addDays(todayIST(), -days + 1)), lte(studentAttendance.date, todayIST())))
        .groupBy(studentAttendance.date, studentAttendance.status);
      return [...groupBy(rows, (r) => r.date).entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, g]) => {
        const pct = attendancePercent(countsOf(g));
        return pct === null ? [] : [{ date, pct }];
      });
    });
  }
}

/** Staff attendance: teachers and accountants, marked by the admin. */
export class StaffAttendanceService extends AttendanceBase {
  /** Active teachers and accountants with their status on `date`. */
  async staffSheet(date: string) {
    this.assertDate(date);
    return this.read("manage", async (tx) => {
      const rows = await tx.select({ userId: users.id, name: users.name, role: users.role, status: staffAttendance.status, note: staffAttendance.note }).from(users)
        .leftJoin(staffAttendance, and(eq(staffAttendance.userId, users.id), eq(staffAttendance.date, date)))
        .where(and(or(eq(users.role, "teacher"), eq(users.role, "accountant")), eq(users.status, "active")))
        .orderBy(asc(users.role), asc(users.name));
      return { date, holiday: await this.holidayOn(tx, date), rows };
    });
  }

  async mark(input: unknown): Promise<Counts> {
    this.authorize("manage", "write");
    const data = this.parse(markStaffInput, input);
    const entries = this.lastPerKey(data.entries, "userId");
    return this.write("manage", async (tx) => {
      await this.assertOpenDay(tx, data.date);
      const ids = entries.map((e) => e.userId);
      const staff = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), inArray(users.role, ["teacher", "accountant"])));
      if (staff.length !== ids.length) throw new ValidationError({ entries: "Some people are not staff" });
      await this.upsert(tx, staffAttendance, [staffAttendance.userId, staffAttendance.date],
        entries.map((e) => ({ schoolId: this.ctx.schoolId, userId: e.userId, date: data.date, status: e.status, note: e.note ?? null, markedBy: this.ctx.userId })));
      return tally(entries.map((e) => e.status));
    }, (c) => ({ action: "mark", entity: "Staff attendance", summary: `Marked ${c.total} staff on ${data.date}: ${c.present} present, ${c.absent} absent` }));
  }

  /** Staff present/absent today, for the staff page. */
  async todaySummary() {
    const date = todayIST();
    return this.read("manage", async (tx) => {
      const rows = await tx.select({ status: staffAttendance.status, n: count() }).from(staffAttendance).where(eq(staffAttendance.date, date)).groupBy(staffAttendance.status);
      const counts = countsOf(rows);
      return { date, ...counts, pct: attendancePercent(counts) };
    });
  }
}

/** School holidays: days nobody can be marked. */
export class HolidayService extends CrudService<typeof attendanceHolidays, Perm> {
  protected feature = attendanceFeature;
  protected table = attendanceHolidays;
  protected entityName = "Holiday";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = holidayInput;
  protected updateSchema = holidayInput;
  protected defaultSort = "date";

  constructor(ctx: Ctx) { super(ctx); }

  protected sortColumns() { return { date: attendanceHolidays.date }; }
  protected searchColumns() { return [attendanceHolidays.name]; }
  protected describe(r: Holiday) { return `${r.name} (${r.date})`; }

  async create(input: unknown) {
    try { return await super.create(input); } catch (e) { rethrowUnique(e, "That date is already a holiday"); }
  }
}
