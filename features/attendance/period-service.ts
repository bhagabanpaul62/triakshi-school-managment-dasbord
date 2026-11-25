import { and, asc, between, count, eq, inArray, sql } from "drizzle-orm";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { TimetableService, type TodayRow } from "@smw/feature-timetable/service";
import { cellKey } from "@smw/feature-timetable/bell";
import { periods, substitutions, timetableSlots, ttBlockOptions, ttBlockSlots } from "@smw/feature-timetable/schema";
import type { Tx } from "@smw/db";
import { loadSettings, queueAlerts } from "./alerts";
import { MIN_PERIODS_FOR_ALERT } from "./constants";
import { markPeriodInput } from "./inputs";
import type { SubjectReport } from "./register-export";
import { periodAttendance, studentAttendance } from "./schema";
import { StudentAttendanceService } from "./service";
import { attendancePercent, countsOf, groupBy, isSunday, rollupStatus, tally, todayIST, type Counts } from "./stats";

/** The note on a daily row the roll-up wrote, so a later roll-up may replace it (a leave row from an approved request has another note). */
export const ROLLUP_NOTE = "From period attendance";

/** Which period: an ordinary one, or one option of an elective block. */
export type PeriodRef = { slotId?: string | null; blockSlotId?: string | null; optionId?: string | null };
export interface PeriodItem extends PeriodRef {
  periodId: string; name: string; startsAt: string; endsAt: string;
  subject: string | null; teacher: string | null; section: string | null; cover: "covering" | "away" | null; marked: number;
}

const weekday = (date: string) => (isSunday(date) ? null : new Date(`${date}T00:00:00Z`).getUTCDay());
const refKey = (r: PeriodRef) => (r.blockSlotId ? `${r.blockSlotId}:${r.optionId}` : String(r.slotId));

/**
 * Period-wise attendance: the teacher of a period (or the cover) marks the students in it; the day's row in
 * `student_attendance` is worked out from the periods marked, so registers, eligibility, alerts and report cards need no change.
 * Teachers mark only today; the admin can mark or correct any past day.
 */
export class PeriodAttendanceService extends StudentAttendanceService {
  // Period mode rides on the timetable module; a school without it (e.g. switched off by the console) stays daily.
  private timetable() {
    if (!this.ctx.features.has("timetable")) throw new ValidationError({ date: "Period attendance needs the timetable module" });
    return new TimetableService(this.ctx);
  }

  async mode(): Promise<"daily" | "period"> {
    if (!this.ctx.features.has("timetable")) return "daily";
    return this.read("read", async (tx) => (await loadSettings(tx)).mode);
  }

  // ---------- which periods ----------

  /**
   * The periods to pick from on `date`. A teacher gets today's own periods and covers (from the timetable).
   * The admin picks a section and gets its periods that weekday.
   */
  async periods(date: string, sectionId?: string): Promise<PeriodItem[]> {
    this.assertDate(date);
    this.authorize("mark", "read");
    const items: Omit<PeriodItem, "marked">[] = [];
    if (this.ctx.role === "teacher") {
      if (date !== todayIST()) throw new ForbiddenError("Teachers see only today's periods.");
      for (const r of (await this.timetable().today()).rows as TodayRow[]) {
        if (r.isBreak || !(r.slotId || r.blockSlotId)) continue;
        items.push({ slotId: r.slotId, blockSlotId: r.blockSlotId ?? null, optionId: r.optionId ?? null, periodId: r.periodId, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, subject: r.subject, teacher: r.teacher, section: r.section, cover: r.cover ?? null });
      }
    } else if (sectionId) {
      const day = weekday(date);
      const grid = await this.timetable().sectionGrid(sectionId);
      for (const p of grid.periods) {
        const cell = day && !p.isBreak ? grid.cells[cellKey(day, p.id)] : undefined;
        if (!cell) continue;
        const base = { periodId: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, section: cell.section, cover: null };
        if (cell.blockId) for (const o of cell.options ?? []) items.push({ ...base, slotId: null, blockSlotId: cell.slotId, optionId: o.optionId, subject: o.subject, teacher: o.teacher });
        else items.push({ ...base, slotId: cell.slotId, blockSlotId: null, optionId: null, subject: cell.subject, teacher: cell.teacher });
      }
    }
    const done = await this.read("read", (tx) => tx.select({ slotId: periodAttendance.slotId, blockSlotId: periodAttendance.blockSlotId, optionId: periodAttendance.optionId, n: count() })
      .from(periodAttendance).where(eq(periodAttendance.date, date)).groupBy(periodAttendance.slotId, periodAttendance.blockSlotId, periodAttendance.optionId));
    const marked = new Map(done.map((d) => [refKey(d), Number(d.n)]));
    return items.map((i) => ({ ...i, marked: marked.get(refKey(i)) ?? 0 }));
  }

  /** The timetable cell behind a ref: its period, subject, weekday and teacher. NotFound when it is not in the live timetable. */
  private async cell(tx: Tx, ref: PeriodRef) {
    const named = { periodName: periods.name, subject: subjects.name };
    if (ref.blockSlotId && ref.optionId) {
      const [c] = await tx.select({ periodId: ttBlockSlots.periodId, day: ttBlockSlots.dayOfWeek, subjectId: ttBlockOptions.subjectId, teacherId: ttBlockOptions.teacherId, ...named })
        .from(ttBlockSlots).innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlockSlots.blockId))
        .innerJoin(periods, eq(periods.id, ttBlockSlots.periodId)).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId))
        .where(and(eq(ttBlockSlots.id, ref.blockSlotId), eq(ttBlockOptions.id, ref.optionId))).limit(1);
      if (!c) throw new NotFoundError("Period");
      return c;
    }
    const [c] = ref.slotId ? await tx.select({ periodId: timetableSlots.periodId, day: timetableSlots.dayOfWeek, subjectId: timetableSlots.subjectId, teacherId: timetableSlots.teacherId, ...named })
      .from(timetableSlots).innerJoin(periods, eq(periods.id, timetableSlots.periodId)).innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
      .where(eq(timetableSlots.id, ref.slotId)).limit(1) : [];
    if (!c) throw new NotFoundError("Period");
    return c;
  }

  /** A teacher marks only a period they teach, or one they cover on that date. */
  private async assertMine(tx: Tx, ref: PeriodRef, teacherId: string | null, date: string) {
    if (this.ctx.role !== "teacher" || teacherId === this.ctx.userId) return;
    const where = ref.blockSlotId ? and(eq(substitutions.blockSlotId, ref.blockSlotId), eq(substitutions.optionId, ref.optionId!)) : eq(substitutions.slotId, ref.slotId!);
    const [cover] = await tx.select({ id: substitutions.id }).from(substitutions).where(and(where, eq(substitutions.date, date), eq(substitutions.coverTeacherId, this.ctx.userId))).limit(1);
    if (!cover) throw new ForbiddenError("This is not your period.");
  }

  // ---------- the period sheet ----------

  /** The students in a period with their mark on `date` (null = not marked yet). The roster comes from the timetable (a block lists every section's students who chose it). */
  async periodSheet(ref: PeriodRef, date: string) {
    this.assertDate(date);
    this.authorize("mark", "read");
    const roster = await this.timetable().slotStudents(ref);
    return this.read("read", async (tx) => {
      const cell = await this.cell(tx, ref);
      await this.assertMine(tx, ref, cell.teacherId, date);
      const [marks, holiday, settings] = await Promise.all([
        roster.length ? tx.select({ studentId: periodAttendance.studentId, status: periodAttendance.status }).from(periodAttendance)
          .where(and(eq(periodAttendance.date, date), eq(periodAttendance.periodId, cell.periodId), inArray(periodAttendance.studentId, roster.map((r) => r.id)))) : [],
        this.studentWho(tx, [...new Set(roster.map((r) => r.sectionId))]).then((who) => this.holidayOn(tx, date, who)), loadSettings(tx),
      ]);
      const status = new Map(marks.map((m) => [m.studentId, m.status]));
      const isTeacher = this.ctx.role === "teacher";
      return {
        date, periodName: cell.periodName, subject: cell.subject, holiday, mode: settings.mode,
        canMark: this.can("mark") && settings.mode === "period" && !holiday && (!isTeacher || date === todayIST()),
        rows: roster.map((r) => ({ studentId: r.id, name: r.name, rollNo: r.rollNo, section: r.section, status: status.get(r.id) ?? null })),
      };
    });
  }

  // ---------- marking ----------

  /**
   * Mark (or re-mark) one period. Then the day's status of each student is worked out from all their periods that day
   * and written to `student_attendance`; an absence alert goes out once per student and day, only after they missed at least two periods.
   */
  async markPeriod(input: unknown): Promise<Counts & { days: number }> {
    this.authorize("mark", "write");
    const data = this.parse(markPeriodInput, input);
    const ref: PeriodRef = { slotId: data.slotId, blockSlotId: data.blockSlotId, optionId: data.optionId };
    if (this.ctx.role === "teacher" && data.date !== todayIST()) throw new ForbiddenError("Teachers can mark only today. Ask the office to correct a past day.");
    const entries = this.lastPerKey(data.entries, "studentId");
    // The timetable refuses another teacher's period; it also gives the roster.
    const roster = new Map((await this.timetable().slotStudents(ref)).map((r) => [r.id, r]));
    if (entries.some((e) => !roster.has(e.studentId))) throw new ValidationError({ entries: "Some students are not in this period" });

    const out = await this.write("mark", async (tx) => {
      const settings = await loadSettings(tx);
      if (settings.mode !== "period") throw new ValidationError({ date: "Period attendance is not turned on for this school" });
      await this.assertOpenDay(tx, data.date, await this.studentWho(tx, [...new Set([...roster.values()].map((r) => r.sectionId))]));
      const cell = await this.cell(tx, ref);
      if (cell.day !== weekday(data.date)) throw new ValidationError({ date: "This period does not run on that day" });
      await this.assertMine(tx, ref, cell.teacherId, data.date);

      await tx.insert(periodAttendance).values(entries.map((e) => ({
        schoolId: this.ctx.schoolId, studentId: e.studentId, sectionId: roster.get(e.studentId)!.sectionId, date: data.date, periodId: cell.periodId, subjectId: cell.subjectId,
        slotId: ref.slotId ?? null, blockSlotId: ref.blockSlotId ?? null, optionId: ref.optionId ?? null, status: e.status, markedBy: this.ctx.userId,
      }))).onConflictDoUpdate({
        target: [periodAttendance.studentId, periodAttendance.date, periodAttendance.periodId],
        set: { status: sql`excluded.status`, subjectId: sql`excluded.subject_id`, slotId: sql`excluded.slot_id`, blockSlotId: sql`excluded.block_slot_id`, optionId: sql`excluded.option_id`, markedBy: sql`excluded.marked_by`, updatedAt: sql`now()` },
      });
      const days = await this.rollUp(tx, data.date, entries.map((e) => ({ studentId: e.studentId, sectionId: roster.get(e.studentId)!.sectionId })), settings.rollupPercent);
      await queueAlerts(tx, this.ctx.schoolId, data.date, days.alerts.map((studentId) => ({ studentId, status: "absent" as const })));
      return { counts: tally(entries.map((e) => e.status)), days: days.written };
    }, (o) => ({ action: "mark", entity: "Period attendance", summary: `Marked ${o.counts.total} students for a period on ${data.date}: ${o.counts.present} present, ${o.counts.absent} absent` }));
    return { ...out.counts, days: out.days };
  }

  /**
   * The day's status per student from their period marks, written to the daily table. A day an approved leave request
   * marked as leave stays leave. Returns how many daily rows were written and who earns an absence alert.
   */
  private async rollUp(tx: Tx, date: string, people: { studentId: string; sectionId: string }[], pct: number) {
    const marks = await tx.select({ studentId: periodAttendance.studentId, status: periodAttendance.status }).from(periodAttendance)
      .where(and(eq(periodAttendance.date, date), inArray(periodAttendance.studentId, people.map((p) => p.studentId))));
    const by = groupBy(marks, (m) => m.studentId);
    const plan = people.map((p) => {
      const mine = (by.get(p.studentId) ?? []).map((m) => m.status);
      return { ...p, status: rollupStatus(mine, pct), missed: mine.filter((s) => s === "absent").length };
    });
    const written = await tx.insert(studentAttendance).values(plan.map((p) => ({
      schoolId: this.ctx.schoolId, studentId: p.studentId, sectionId: p.sectionId, date, status: p.status, note: ROLLUP_NOTE, markedBy: this.ctx.userId,
    }))).onConflictDoUpdate({
      target: [studentAttendance.studentId, studentAttendance.date],
      set: { status: sql`excluded.status`, sectionId: sql`excluded.section_id`, note: sql`excluded.note`, markedBy: sql`excluded.marked_by`, updatedAt: sql`now()` },
      // Leave from an approved request is not overwritten; leave this roll-up wrote itself is.
      setWhere: sql`${studentAttendance.status} <> 'leave' or ${studentAttendance.note} = ${ROLLUP_NOTE}`,
    }).returning({ studentId: studentAttendance.studentId });
    const kept = new Set(written.map((w) => w.studentId));
    return { written: written.length, alerts: plan.filter((p) => kept.has(p.studentId) && p.status === "absent" && p.missed >= MIN_PERIODS_FOR_ALERT).map((p) => p.studentId) };
  }

  // ---------- subject-wise ----------

  /** Per student and subject: periods attended over periods held (leave is excused). For Class 9 to 12 practicals. */
  async subjectReport(sectionId: string, from: string, to: string): Promise<SubjectReport> {
    this.assertDate(from, "from"); this.assertDate(to, "to");
    if (to < from) throw new ValidationError({ to: "The last day cannot be before the first day" });
    return this.read("read", async (tx) => {
      await this.assertSectionAccess(tx, sectionId);
      const label = await this.sectionLabel(tx, sectionId);
      const [people, marks] = await Promise.all([
        tx.select({ studentId: students.id, name: students.name, rollNo: students.rollNo }).from(students)
          .where(and(eq(students.sectionId, sectionId), eq(students.status, "active"))).orderBy(asc(students.rollNo), asc(students.name)),
        tx.select({ studentId: periodAttendance.studentId, subjectId: periodAttendance.subjectId, subject: subjects.name, status: periodAttendance.status, n: count() })
          .from(periodAttendance).innerJoin(subjects, eq(subjects.id, periodAttendance.subjectId))
          .where(and(eq(periodAttendance.sectionId, sectionId), between(periodAttendance.date, from, to)))
          .groupBy(periodAttendance.studentId, periodAttendance.subjectId, subjects.name, periodAttendance.status),
      ]);
      const names = new Map(marks.map((m) => [m.subjectId, m.subject]));
      const byStudent = groupBy(marks, (m) => m.studentId);
      const measure = (rows: { status: string; n: number | string }[]) => {
        const c = countsOf(rows);
        return { attended: c.present + c.late, total: c.present + c.late + c.absent, pct: attendancePercent(c) };
      };
      return {
        section: { id: sectionId, label }, from, to,
        subjects: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        rows: people.map((p) => {
          const mine = byStudent.get(p.studentId) ?? [];
          return { ...p, overall: measure(mine).pct, bySubject: Object.fromEntries([...groupBy(mine, (m) => m.subjectId)].map(([id, g]) => [id, measure(g)])) };
        }),
      };
    });
  }
}
