import { and, asc, eq, ne, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, f, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { users } from "@smw/db";
import { classSubjects, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { z } from "zod";
import timetableFeature from "./feature";
import { periods, ttDayOverrides, ttRooms, ttSettings, ttSubjectLoad, ttTeacherRules } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;

export interface LoadRow { classId: string; className: string; subjectId: string; subject: string; periodsPerWeek: number | null; doublePeriods: number; roomKind: string | null; teachers: string[] }
export interface TeacherRuleRow { teacherId: string; name: string; maxPerDay: number | null; maxPerWeek: number | null; unavailable: { day: number; periodId: string }[] }
export interface RoomRow { id: string; name: string; kind: string; capacity: number | null }
export interface DayOverrideRow { id: string; date: string; label: string; periodIds: string[] }
export interface TtSettings { classTeacherFirstPeriod: boolean; noSameSubjectTwiceADay: boolean }

const loadsInput = z.object({
  rows: z.array(z.object({
    classId: f.id(), subjectId: f.id(),
    periodsPerWeek: f.int(0, 48), doublePeriods: f.int(0, 24), roomKind: f.optText(40),
  })).max(2000),
});
const teacherRuleInput = z.object({
  teacherId: f.id("Pick a teacher"),
  maxPerDay: f.optInt(1, 12), maxPerWeek: f.optInt(1, 72),
  /** "day:periodId" entries. */
  unavailable: f.list(),
});
const roomInput = z.object({ name: f.text(1, 40, "Name the room"), kind: f.text(1, 30, "Say what kind of room it is"), capacity: f.optInt(1, 500) });
const settingsInput = z.object({ classTeacherFirstPeriod: f.bool(), noSameSubjectTwiceADay: f.bool() });
const overrideInput = z.object({ date: f.date(), label: f.text(1, 60, "Name the day"), periodIds: f.list() });

/** The generator's rules: periods per subject, teacher limits, rooms, settings, and alternate-bell days. */
export class RulesService extends SchoolService<Perm> {
  protected feature = timetableFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Every subject of every class, with its saved load (null = not set yet). */
  async loads(): Promise<LoadRow[]> {
    return this.read("manage", async (tx) => {
      const [pairs, saved, who] = await Promise.all([
        tx.select({ classId: classes.id, className: classes.name, grade: classes.grade, subjectId: subjects.id, subject: subjects.name }).from(classSubjects)
          .innerJoin(classes, eq(classes.id, classSubjects.classId)).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
          .where(eq(classSubjects.isElective, false)).orderBy(asc(classes.grade), asc(subjects.name)),
        tx.select().from(ttSubjectLoad),
        tx.select({ classId: sections.classId, subjectId: sectionTeachers.subjectId, name: users.name }).from(sectionTeachers)
          .innerJoin(sections, eq(sections.id, sectionTeachers.sectionId)).innerJoin(users, eq(users.id, sectionTeachers.teacherId)),
      ]);
      const by = new Map(saved.map((r) => [`${r.classId}:${r.subjectId}`, r]));
      const teachers = new Map<string, Set<string>>();
      for (const w of who) (teachers.get(`${w.classId}:${w.subjectId}`) ?? teachers.set(`${w.classId}:${w.subjectId}`, new Set()).get(`${w.classId}:${w.subjectId}`)!).add(w.name);
      return pairs.map(({ grade: _g, ...p }) => {
        const r = by.get(`${p.classId}:${p.subjectId}`);
        return { ...p, periodsPerWeek: r?.periodsPerWeek ?? null, doublePeriods: r?.doublePeriods ?? 0, roomKind: r?.roomKind ?? null, teachers: [...(teachers.get(`${p.classId}:${p.subjectId}`) ?? [])] };
      });
    });
  }

  /** Save the whole grid: 0 periods removes the row. */
  async saveLoads(input: unknown): Promise<{ saved: number }> {
    this.authorize("manage", "write");
    const d = this.parse(loadsInput, input);
    for (const r of d.rows) if (r.doublePeriods * 2 > r.periodsPerWeek) throw new ValidationError({ rows: "A subject cannot have more double periods than half its periods" });
    return this.write("manage", async (tx) => {
      let saved = 0;
      for (const r of d.rows) {
        if (!r.periodsPerWeek) {
          await tx.delete(ttSubjectLoad).where(and(eq(ttSubjectLoad.classId, r.classId), eq(ttSubjectLoad.subjectId, r.subjectId)));
          continue;
        }
        const set = { periodsPerWeek: r.periodsPerWeek, doublePeriods: r.doublePeriods, roomKind: r.roomKind ?? null, updatedAt: new Date() };
        await tx.insert(ttSubjectLoad).values({ schoolId: this.ctx.schoolId, classId: r.classId, subjectId: r.subjectId, ...set })
          .onConflictDoUpdate({ target: [ttSubjectLoad.classId, ttSubjectLoad.subjectId], set });
        saved++;
      }
      return { saved };
    }, (r) => ({ action: "save_loads", entity: "Timetable rules", summary: `Saved periods per week for ${r.saved} class subjects` }));
  }

  /** All teachers with their limits (blank = no limit). */
  async teacherRules(): Promise<TeacherRuleRow[]> {
    return this.read("manage", async (tx) => {
      const [ts, rs] = await Promise.all([
        tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), ne(users.status, "disabled"))).orderBy(asc(users.name)),
        tx.select().from(ttTeacherRules),
      ]);
      const by = new Map(rs.map((r) => [r.teacherId, r]));
      return ts.map((t) => ({ teacherId: t.id, name: t.name, maxPerDay: by.get(t.id)?.maxPerDay ?? null, maxPerWeek: by.get(t.id)?.maxPerWeek ?? null, unavailable: by.get(t.id)?.unavailable ?? [] }));
    });
  }

  async saveTeacherRule(input: unknown): Promise<TeacherRuleRow> {
    this.authorize("manage", "write");
    const d = this.parse(teacherRuleInput, input);
    const unavailable = d.unavailable.map((u) => { const [day, periodId] = u.split(":"); return { day: Number(day), periodId: periodId ?? "" }; })
      .filter((u) => u.day >= 1 && u.day <= 6 && /^[0-9a-f-]{36}$/i.test(u.periodId));
    return this.write("manage", async (tx) => {
      const [t] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, d.teacherId), eq(users.role, "teacher"))).limit(1);
      if (!t) throw new NotFoundError("Teacher");
      const real = new Set((await tx.select({ id: periods.id }).from(periods).where(eq(periods.isBreak, false))).map((p) => p.id));
      const clean = unavailable.filter((u) => real.has(u.periodId));
      const set = { maxPerDay: d.maxPerDay ?? null, maxPerWeek: d.maxPerWeek ?? null, unavailable: clean, updatedAt: new Date() };
      await tx.insert(ttTeacherRules).values({ schoolId: this.ctx.schoolId, teacherId: t.id, ...set }).onConflictDoUpdate({ target: [ttTeacherRules.teacherId], set });
      return { teacherId: t.id, name: t.name, maxPerDay: set.maxPerDay, maxPerWeek: set.maxPerWeek, unavailable: clean };
    }, (r) => ({ action: "teacher_rule", entity: "Timetable rules", entityId: r.teacherId, summary: `Limits for ${r.name}: ${r.maxPerDay ?? "no"} a day, ${r.maxPerWeek ?? "no"} a week, ${r.unavailable.length} unavailable periods` }));
  }

  async rooms(): Promise<RoomRow[]> {
    return this.read("manage", (tx) => tx.select({ id: ttRooms.id, name: ttRooms.name, kind: ttRooms.kind, capacity: ttRooms.capacity }).from(ttRooms).orderBy(asc(ttRooms.kind), asc(ttRooms.name)));
  }

  async addRoom(input: unknown): Promise<RoomRow> {
    this.authorize("manage", "write");
    const d = this.parse(roomInput, input);
    return this.write("manage", async (tx) => {
      try {
        const [r] = await tx.insert(ttRooms).values({ schoolId: this.ctx.schoolId, name: d.name, kind: d.kind.toLowerCase(), capacity: d.capacity ?? null }).returning();
        return { id: r!.id, name: r!.name, kind: r!.kind, capacity: r!.capacity };
      } catch (e) { rethrowUnique(e, `A room called ${d.name} already exists.`); }
    }, (r) => ({ action: "add_room", entity: "Room", entityId: r.id, summary: `Added the ${r.kind} room ${r.name}` }));
  }

  async removeRoom(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const gone = await tx.delete(ttRooms).where(eq(ttRooms.id, id)).returning({ name: ttRooms.name });
      if (!gone.length) throw new NotFoundError("Room");
      return { id, name: gone[0]!.name };
    }, (r) => ({ action: "remove_room", entity: "Room", entityId: r.id, summary: `Removed the room ${(r as { name: string }).name}` }));
  }

  async settings(): Promise<TtSettings> {
    return this.read("manage", async (tx) => {
      const [r] = await tx.select().from(ttSettings).limit(1);
      return { classTeacherFirstPeriod: r?.classTeacherFirstPeriod ?? true, noSameSubjectTwiceADay: r?.noSameSubjectTwiceADay ?? true };
    });
  }

  async saveSettings(input: unknown): Promise<TtSettings> {
    this.authorize("manage", "write");
    const d = this.parse(settingsInput, input);
    return this.write("manage", async (tx) => {
      await tx.insert(ttSettings).values({ schoolId: this.ctx.schoolId, ...d }).onConflictDoUpdate({ target: [ttSettings.schoolId], set: { ...d, updatedAt: new Date() } });
      return d;
    }, (r) => ({ action: "settings", entity: "Timetable rules", summary: `Class teacher in period 1: ${r.classTeacherFirstPeriod ? "yes" : "no"}; no subject twice a day: ${r.noSameSubjectTwiceADay ? "yes" : "no"}` }));
  }

  // ---------- day overrides ----------

  /** Upcoming and recent alternate-bell days, newest first. */
  async overrides(): Promise<DayOverrideRow[]> {
    return this.read("manage", async (tx) => (await tx.select().from(ttDayOverrides).orderBy(sql`${ttDayOverrides.date} desc`).limit(60))
      .map((r) => ({ id: r.id, date: r.date, label: r.label, periodIds: r.periodIds })));
  }

  async saveOverride(input: unknown): Promise<DayOverrideRow> {
    this.authorize("manage", "write");
    const d = this.parse(overrideInput, input);
    if (!d.periodIds.length) throw new ValidationError({ periodIds: "Pick at least one period to hold" });
    return this.write("manage", async (tx) => {
      const real = new Set((await tx.select({ id: periods.id }).from(periods)).map((p) => p.id));
      const ids = d.periodIds.filter((id) => real.has(id));
      if (!ids.length) throw new ConflictError("None of those periods exist in the bell schedule.");
      const set = { label: d.label, periodIds: ids, updatedAt: new Date() };
      const [r] = await tx.insert(ttDayOverrides).values({ schoolId: this.ctx.schoolId, date: d.date, ...set }).onConflictDoUpdate({ target: [ttDayOverrides.schoolId, ttDayOverrides.date], set }).returning();
      return { id: r!.id, date: r!.date, label: r!.label, periodIds: r!.periodIds };
    }, (r) => ({ action: "day_override", entity: "Timetable", entityId: r.id, summary: `${r.date} runs ${r.periodIds.length} periods (${r.label})` }));
  }

  async removeOverride(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const gone = await tx.delete(ttDayOverrides).where(eq(ttDayOverrides.id, id)).returning({ date: ttDayOverrides.date });
      if (!gone.length) throw new NotFoundError("Day override");
      return { id, date: gone[0]!.date };
    }, (r) => ({ action: "remove_day_override", entity: "Timetable", entityId: r.id, summary: `Removed the special schedule of ${(r as { date: string }).date}` }));
  }
}
