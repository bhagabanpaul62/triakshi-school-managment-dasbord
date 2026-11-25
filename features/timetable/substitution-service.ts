import { and, asc, eq, ne, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, SchoolService, ValidationError, f, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { z } from "zod";
import { classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { dayName } from "./bell";
import { teacherUse } from "./block-service";
import timetableFeature from "./feature";
import { periods, substitutions, timetableSlots as slots, ttBlockOptions, ttBlockSlots as bslots, ttBlocks, ttVersions } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;

export interface CoverCandidate { id: string; name: string; sameSubject: boolean; load: number }
export interface AbsentPeriod {
  /** The ordinary slot, or for a block period the block slot (then `optionId` says which alternative's teacher is away). */
  slotId: string; optionId: string | null; periodId: string; period: string; startsAt: string; endsAt: string; section: string; subject: string;
  cover: { teacherId: string; name: string; note: string | null } | null;
  suggestions: CoverCandidate[];
}
export interface AbsentTeacher { teacherId: string; name: string; reason: string; periods: AbsentPeriod[] }
export interface CoverBoard { date: string; day: number | null; absent: AbsentTeacher[]; teachers: { id: string; name: string }[] }

const assignInput = z.object({ date: f.date(), slotId: f.id("Pick a period"), optionId: f.optId(), coverTeacherId: f.id("Pick a teacher"), note: f.optText(200) });
const clearInput = z.object({ date: f.date(), slotId: f.id("Pick a period"), optionId: f.optId() });

const keyOf = (slotId: string | null, optionId: string | null) => (optionId ? `${slotId}:${optionId}` : slotId!);

/** Weekday 1 (Mon) to 6 (Sat) of a "YYYY-MM-DD" date, null on Sunday. */
const weekday = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? null : d; };

/** Cover for absent teachers: who is away, which periods that leaves open, who can take them. */
export class SubstitutionService extends SchoolService<Perm> {
  protected feature = timetableFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private async hasTable(tx: Tx, name: string): Promise<boolean> {
    const r = await tx.execute<{ ok: boolean }>(sql`select to_regclass(${name}) is not null as ok`);
    return Boolean([...r][0]?.ok);
  }

  /** Teachers away on a date, from staff attendance (absent, on leave) and approved staff leave. Raw SQL: attendance is optional. */
  private async awayOn(tx: Tx, date: string): Promise<Map<string, string>> {
    const away = new Map<string, string>();
    if (this.ctx.features.has("attendance")) {
      if (await this.hasTable(tx, "staff_attendance")) {
        const rows = await tx.execute<{ id: string; status: string }>(sql`select a.user_id as id, a.status from staff_attendance a join users u on u.id = a.user_id
          where a.date = ${date}::date and a.status in ('absent', 'leave') and u.role = 'teacher'`);
        for (const r of rows) away.set(r.id, r.status === "leave" ? "On leave" : "Marked absent");
      }
      if (await this.hasTable(tx, "leave_requests")) {
        const rows = await tx.execute<{ id: string }>(sql`select l.user_id as id from leave_requests l join users u on u.id = l.user_id
          where l.kind = 'staff' and l.status = 'approved' and l.user_id is not null and l.from_date <= ${date}::date and l.to_date >= ${date}::date and u.role = 'teacher'`);
        for (const r of rows) if (!away.has(r.id)) away.set(r.id, "Approved leave");
      }
    }
    return away;
  }

  /** The day's board: absent teachers, their live periods, any cover already set, and who could cover each. `also` adds teachers the admin names by hand. */
  async board(date: string, also: string[] = []): Promise<CoverBoard> {
    this.parse(z.object({ date: f.date() }), { date });
    return this.read("manage", async (tx) => {
      const day = weekday(date);
      const teachers = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), ne(users.status, "disabled"))).orderBy(asc(users.name));
      const away = await this.awayOn(tx, date);
      const names = new Map(teachers.map((t) => [t.id, t.name]));
      for (const id of also) if (names.has(id) && !away.has(id)) away.set(id, "Added by you");
      if (!day || !away.size) return { date, day, absent: [], teachers };

      const [live] = await tx.select({ id: ttVersions.id }).from(ttVersions).where(eq(ttVersions.status, "live")).limit(1);
      if (!live) return { date, day, absent: [], teachers };
      const [ps, normal, blockItems, covers, teaching] = await Promise.all([
        tx.select().from(periods).where(eq(periods.isBreak, false)).orderBy(asc(periods.sortOrder)),
        tx.select({ slotId: slots.id, periodId: slots.periodId, teacherId: slots.teacherId, subjectId: slots.subjectId, section: sections.name, className: classes.name, subject: subjects.name })
          .from(slots).innerJoin(sections, eq(sections.id, slots.sectionId)).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(subjects, eq(subjects.id, slots.subjectId))
          .where(and(eq(slots.versionId, live.id), eq(slots.dayOfWeek, day))),
        // Elective blocks: one period per option, so an absent option teacher's block period is covered like any other.
        tx.select({ slotId: bslots.id, optionId: ttBlockOptions.id, periodId: bslots.periodId, teacherId: ttBlockOptions.teacherId, subjectId: ttBlockOptions.subjectId, blockName: ttBlocks.name, className: classes.name, subject: subjects.name })
          .from(bslots).innerJoin(ttBlocks, eq(ttBlocks.id, bslots.blockId)).innerJoin(classes, eq(classes.id, ttBlocks.classId))
          .innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlocks.id)).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId))
          .where(and(eq(bslots.versionId, live.id), eq(bslots.dayOfWeek, day))),
        tx.select({ slotId: substitutions.slotId, blockSlotId: substitutions.blockSlotId, optionId: substitutions.optionId, coverId: substitutions.coverTeacherId, note: substitutions.note, periodId: sql<string>`coalesce(${slots.periodId}, ${bslots.periodId})` })
          .from(substitutions).leftJoin(slots, eq(slots.id, substitutions.slotId)).leftJoin(bslots, eq(bslots.id, substitutions.blockSlotId))
          .where(and(eq(substitutions.date, date), sql`coalesce(${slots.versionId}, ${bslots.versionId}) = ${live.id}`)),
        tx.select({ subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers),
      ]);
      type Item = { slotId: string; optionId: string | null; periodId: string; teacherId: string | null; subjectId: string; section: string; subject: string };
      const today: Item[] = [
        ...normal.map((s) => ({ slotId: s.slotId, optionId: null, periodId: s.periodId, teacherId: s.teacherId, subjectId: s.subjectId, section: `${s.className}-${s.section}`, subject: s.subject })),
        ...blockItems.map((s) => ({ slotId: s.slotId, optionId: s.optionId, periodId: s.periodId, teacherId: s.teacherId, subjectId: s.subjectId, section: `${s.className} (all sections), ${s.blockName}`, subject: s.subject })),
      ];
      const period = new Map(ps.map((p) => [p.id, p]));
      const load = new Map<string, number>();
      for (const s of today) if (s.teacherId) load.set(s.teacherId, (load.get(s.teacherId) ?? 0) + 1);
      for (const c of covers) load.set(c.coverId, (load.get(c.coverId) ?? 0) + 1);
      const coverOf = new Map(covers.map((c) => [c.blockSlotId ? keyOf(c.blockSlotId, c.optionId) : c.slotId!, c]));
      const subjectTeachers = new Map<string, Set<string>>();
      for (const t of teaching) (subjectTeachers.get(t.subjectId) ?? subjectTeachers.set(t.subjectId, new Set()).get(t.subjectId)!).add(t.teacherId);

      const absent: AbsentTeacher[] = [];
      for (const [teacherId, reason] of away) {
        const mine = today.filter((s) => s.teacherId === teacherId).sort((a, b) => (period.get(a.periodId)?.sortOrder ?? 0) - (period.get(b.periodId)?.sortOrder ?? 0));
        absent.push({
          teacherId, name: names.get(teacherId) ?? "Teacher", reason,
          periods: mine.map((s) => {
            const p = period.get(s.periodId)!;
            const c = coverOf.get(keyOf(s.slotId, s.optionId));
            const busy = new Set([...today.filter((x) => x.periodId === s.periodId).map((x) => x.teacherId), ...covers.filter((x) => x.periodId === s.periodId).map((x) => x.coverId)]);
            const suggestions = teachers.filter((t) => !away.has(t.id) && !busy.has(t.id))
              .map((t) => ({ id: t.id, name: t.name, sameSubject: subjectTeachers.get(s.subjectId)?.has(t.id) ?? false, load: load.get(t.id) ?? 0 }))
              .sort((a, b) => Number(b.sameSubject) - Number(a.sameSubject) || a.load - b.load || a.name.localeCompare(b.name)).slice(0, 8);
            return {
              slotId: s.slotId, optionId: s.optionId, periodId: s.periodId, period: p.name, startsAt: p.startsAt, endsAt: p.endsAt, section: s.section, subject: s.subject,
              cover: c ? { teacherId: c.coverId, name: names.get(c.coverId) ?? "Teacher", note: c.note } : null, suggestions: c ? [] : suggestions,
            };
          }),
        });
      }
      absent.sort((a, b) => a.name.localeCompare(b.name));
      return { date, day, absent, teachers };
    });
  }

  /** Put a cover teacher on one period of one date. Refuses a teacher who has a class then, covers another section then, or is away. A block period needs `optionId`. */
  async assign(input: unknown): Promise<{ slotId: string; cover: string }> {
    this.authorize("manage", "write");
    const d = this.parse(assignInput, input);
    return this.write("manage", async (tx) => {
      const day = weekday(d.date);
      const [live] = await tx.select({ id: ttVersions.id }).from(ttVersions).where(eq(ttVersions.status, "live")).limit(1);
      let slot: { id: string; day: number; periodId: string; teacherId: string | null; label: string; subject: string; period: string } | undefined;
      if (d.optionId) {
        const [r] = await tx.select({ id: bslots.id, day: bslots.dayOfWeek, periodId: bslots.periodId, teacherId: ttBlockOptions.teacherId, versionId: bslots.versionId, block: ttBlocks.name, className: classes.name, subject: subjects.name, period: periods.name })
          .from(bslots).innerJoin(ttBlocks, eq(ttBlocks.id, bslots.blockId)).innerJoin(classes, eq(classes.id, ttBlocks.classId)).innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlocks.id))
          .innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId)).innerJoin(periods, eq(periods.id, bslots.periodId)).where(and(eq(bslots.id, d.slotId), eq(ttBlockOptions.id, d.optionId))).limit(1);
        if (r && r.versionId === live?.id) slot = { ...r, label: `${r.className} ${r.block}` };
      } else {
        const [r] = await tx.select({ id: slots.id, day: slots.dayOfWeek, periodId: slots.periodId, teacherId: slots.teacherId, versionStatus: ttVersions.status, section: sections.name, className: classes.name, subject: subjects.name, period: periods.name })
          .from(slots).innerJoin(ttVersions, eq(ttVersions.id, slots.versionId)).innerJoin(sections, eq(sections.id, slots.sectionId)).innerJoin(classes, eq(classes.id, sections.classId))
          .innerJoin(subjects, eq(subjects.id, slots.subjectId)).innerJoin(periods, eq(periods.id, slots.periodId)).where(eq(slots.id, d.slotId)).limit(1);
        if (r && r.versionStatus === "live") slot = { ...r, label: `${r.className}-${r.section}` };
      }
      if (!slot || !live) throw new NotFoundError("Period");
      if (slot.day !== day) throw new ValidationError({ date: `${d.date} is not a ${dayName(slot.day)}` });
      const [cover] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, d.coverTeacherId), eq(users.role, "teacher"), ne(users.status, "disabled"))).limit(1);
      if (!cover) throw new NotFoundError("Teacher");
      if (cover.id === slot.teacherId) throw new ConflictError("The absent teacher cannot cover their own period.");
      const own = (await teacherUse(tx, live.id, [cover.id], slot.day, slot.periodId)).get(cover.id);
      if (own) throw new ConflictError(`${cover.name} is ${own} in ${slot.period}.`);
      const mineKey = keyOf(slot.id, d.optionId ?? null);
      const same = await tx.select({ slotId: substitutions.slotId, blockSlotId: substitutions.blockSlotId, optionId: substitutions.optionId, periodId: sql<string>`coalesce(${slots.periodId}, ${bslots.periodId})` })
        .from(substitutions).leftJoin(slots, eq(slots.id, substitutions.slotId)).leftJoin(bslots, eq(bslots.id, substitutions.blockSlotId))
        .where(and(eq(substitutions.date, d.date), eq(substitutions.coverTeacherId, cover.id)));
      if (same.some((o) => o.periodId === slot.periodId && keyOf(o.blockSlotId ?? o.slotId, o.optionId) !== mineKey)) throw new ConflictError(`${cover.name} is already covering another class in ${slot.period}.`);
      if ((await this.awayOn(tx, d.date)).has(cover.id)) throw new ConflictError(`${cover.name} is away on ${d.date}.`);

      const set = { coverTeacherId: cover.id, note: d.note ?? null, absentTeacherId: slot.teacherId, updatedAt: new Date() };
      const base = { schoolId: this.ctx.schoolId, date: d.date, ...set };
      if (d.optionId) await tx.insert(substitutions).values({ ...base, blockSlotId: slot.id, optionId: d.optionId }).onConflictDoUpdate({ target: [substitutions.blockSlotId, substitutions.optionId, substitutions.date], set });
      else await tx.insert(substitutions).values({ ...base, slotId: slot.id }).onConflictDoUpdate({ target: [substitutions.slotId, substitutions.date], set });
      await this.notify(tx, cover.id, d.date, `Cover duty: ${slot.label}, ${slot.period}`, `${slot.subject} on ${dayName(slot.day)} ${d.date}${d.note ? `. ${d.note}` : ""}`);
      return { slotId: slot.id, cover: cover.name, label: slot.label, date: d.date, period: slot.period };
    }, (r) => ({ action: "assign_cover", entity: "Substitution", entityId: r.slotId, summary: `${r.cover} covers ${(r as { label: string }).label}, ${(r as { period: string }).period} on ${(r as { date: string }).date}` }));
  }

  /** Remove a cover. Clearing nothing is fine. */
  async clear(input: unknown): Promise<{ cleared: number }> {
    this.authorize("manage", "write");
    const d = this.parse(clearInput, input);
    return this.write("manage", async (tx) => {
      const which = d.optionId ? and(eq(substitutions.blockSlotId, d.slotId), eq(substitutions.optionId, d.optionId)) : eq(substitutions.slotId, d.slotId);
      const gone = await tx.delete(substitutions).where(and(which, eq(substitutions.date, d.date))).returning({ coverId: substitutions.coverTeacherId });
      for (const g of gone) await this.notify(tx, g.coverId, d.date, "Cover duty cancelled", `You no longer cover a period on ${d.date}.`);
      return { cleared: gone.length, slotId: d.slotId, date: d.date };
    }, (r) => ({ action: "clear_cover", entity: "Substitution", entityId: r.slotId, summary: `Cleared ${r.cleared} cover on ${r.date}` }));
  }

  /** Tells the cover teacher. */
  private async notify(tx: Tx, userId: string, date: string, title: string, body: string) {
    if (!this.ctx.features.has("notifications")) return;
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId, topic: "work.cover", subject: { type: "cover", id: `${userId}:${date}` }, title, body, href: "/app/timetable" }]);
  }

  /** Covers a teacher takes on a date (for the teacher's own page and tests). `optionId` is set for a block period. */
  async coversFor(teacherId: string, date: string): Promise<{ slotId: string; optionId: string | null }[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ slotId: substitutions.slotId, blockSlotId: substitutions.blockSlotId, optionId: substitutions.optionId }).from(substitutions)
        .leftJoin(slots, eq(slots.id, substitutions.slotId)).leftJoin(bslots, eq(bslots.id, substitutions.blockSlotId))
        .leftJoin(ttVersions, eq(ttVersions.id, sql`coalesce(${slots.versionId}, ${bslots.versionId})`))
        .where(and(eq(substitutions.coverTeacherId, teacherId), eq(substitutions.date, date), eq(ttVersions.status, "live")));
      return rows.map((r) => (r.optionId ? { slotId: r.blockSlotId!, optionId: r.optionId } : { slotId: r.slotId!, optionId: null }));
    });
  }
}
