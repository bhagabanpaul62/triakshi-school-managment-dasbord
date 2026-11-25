import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, SchoolService, ValidationError, f, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { z } from "zod";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { DAYS, istDate } from "./bell";
import timetableFeature from "./feature";
import { generate, validateInput, type GenInput, type GenIssue, type Unplaced } from "./generator";
import { periods, timetableSlots as slots, ttBlockOptions, ttBlockSlots, ttBlocks, ttRooms, ttSettings, ttSubjectLoad, ttTeacherRules, ttVersions } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;

export interface VersionRow { id: string; name: string; status: "draft" | "live" | "archived"; createdAt: Date; publishedAt: Date | null; publishOn: string | null; cells: number; unplaced: number }
export interface Review {
  version: VersionRow;
  sections: { id: string; label: string }[];
  teachers: { id: string; name: string; periods: number }[];
  unplaced: (Unplaced & { section: string; subject: string; teacher: string })[];
  stats: Record<string, unknown> | null;
}
export interface GenerateResult { versionId: string; placed: number; unplaced: number; locked: number; changed: number; timedOut: boolean; ms: number }

const generateInput = z.object({ versionId: f.optId(), seed: f.optInt(1, 2_000_000_000) });
const lockInput = z.object({ versionId: f.id(), sectionId: f.optId(), dayOfWeek: f.optInt(1, 6), periodId: f.optId(), locked: f.bool() });
const idInput = z.object({ versionId: f.id() });
const publishInput = z.object({ versionId: f.id(), publishOn: f.optDate() });

/** Builds the solver's input from the database, runs it, and stores the result as a draft version. */
export class GeneratorService extends SchoolService<Perm> {
  protected feature = timetableFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Everything the solver needs. `lockedCells` are the pinned cells of the draft being re-run. */
  private async buildInput(tx: Tx, lockedCells: GenInput["locked"] = [], lockedBlocks: GenInput["lockedBlocks"] = []): Promise<GenInput> {
    const secs = await tx.select({ id: sections.id, name: sections.name, className: classes.name, grade: classes.grade, classId: sections.classId, ct: sections.classTeacherId, current: academicYears.isCurrent })
      .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId)).orderBy(asc(classes.grade), asc(sections.name));
    const cur = secs.some((s) => s.current) ? secs.filter((s) => s.current) : secs;
    const [ps, loads, rules, rooms, subs, teaching, ts, setRow, blockRows, optionRows] = await Promise.all([
      tx.select().from(periods).orderBy(asc(periods.sortOrder), asc(periods.startsAt)),
      tx.select().from(ttSubjectLoad),
      tx.select().from(ttTeacherRules), tx.select().from(ttRooms),
      tx.select({ id: subjects.id, name: subjects.name }).from(subjects),
      tx.select({ sectionId: sectionTeachers.sectionId, subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers),
      tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "teacher")),
      tx.select().from(ttSettings).limit(1),
      tx.select().from(ttBlocks), tx.select().from(ttBlockOptions),
    ]);
    const genPeriods: GenInput["periods"] = [];
    let pendingBreak = false;
    for (const p of ps) {
      if (p.isBreak) { pendingBreak = genPeriods.length > 0; continue; }
      genPeriods.push({ id: p.id, name: p.name, afterBreak: pendingBreak });
      pendingBreak = false;
    }
    const teacherOf = new Map(teaching.map((t) => [`${t.sectionId}:${t.subjectId}`, t.teacherId]));
    const demands: GenInput["demands"] = [];
    for (const s of cur) for (const l of loads.filter((x) => x.classId === s.classId)) {
      demands.push({ id: `${s.id}:${l.subjectId}`, sectionId: s.id, subjectId: l.subjectId, teacherId: teacherOf.get(`${s.id}:${l.subjectId}`) ?? null, count: l.periodsPerWeek, doubles: l.doublePeriods, roomKind: l.roomKind });
    }
    const blocks: NonNullable<GenInput["blocks"]> = blockRows.map((b) => ({ id: b.id, classId: b.classId, name: b.name, count: b.periodsPerWeek, doubles: b.doubles,
      options: optionRows.filter((o) => o.blockId === b.id).map((o) => ({ id: o.id, teacherId: o.teacherId, roomId: o.roomId })) })).filter((b) => b.options.length);
    return {
      sections: cur.map((s) => ({ id: s.id, label: `${s.className}-${s.name}`, classTeacherId: s.ct, classId: s.classId })),
      blocks, lockedBlocks,
      days: DAYS.map((d) => d.n), periods: genPeriods, demands,
      teacherRules: Object.fromEntries(rules.map((r) => [r.teacherId, { maxPerDay: r.maxPerDay, maxPerWeek: r.maxPerWeek, unavailable: r.unavailable }])),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
      locked: lockedCells,
      settings: { classTeacherFirstPeriod: setRow[0]?.classTeacherFirstPeriod ?? true, noSameSubjectTwiceADay: setRow[0]?.noSameSubjectTwiceADay ?? true },
      names: { subject: Object.fromEntries(subs.map((x) => [x.id, x.name])), teacher: Object.fromEntries(ts.map((x) => [x.id, x.name])) },
    };
  }

  /** Check the rules before generating: clear errors a person can fix. */
  async validate(): Promise<{ issues: GenIssue[]; sections: number; demands: number; periodsPerWeek: number }> {
    return this.read("manage", async (tx) => {
      const inp = await this.buildInput(tx);
      const issues = validateInput(inp);
      if (!inp.periods.length) issues.unshift({ level: "error", message: "Set up the bell schedule first." });
      if (!inp.demands.length) issues.unshift({ level: "error", message: "No periods per week are set yet. Fill in step 1." });
      return { issues, sections: inp.sections.length, demands: inp.demands.length, periodsPerWeek: inp.demands.reduce((n, d) => n + d.count, 0) + (inp.blocks ?? []).reduce((n, b) => n + b.count, 0) };
    });
  }

  /**
   * Build a draft timetable. With a draft's id, re-run it: locked cells stay, the rest is regenerated.
   * The solver runs outside any transaction so a long run does not hold the database.
   */
  async generate(input: unknown): Promise<GenerateResult> {
    this.authorize("manage", "write");
    const d = this.parse(generateInput, input);
    const prepared = await this.read("manage", async (tx) => {
      let locked: NonNullable<GenInput["locked"]> = [];
      let lockedBlocks: NonNullable<GenInput["lockedBlocks"]> = [];
      const lockedRoom = new Map<string, string>();
      const before = new Map<string, string>();
      if (d.versionId) {
        const [v] = await tx.select().from(ttVersions).where(eq(ttVersions.id, d.versionId)).limit(1);
        if (!v) throw new NotFoundError("Timetable version");
        if (v.status !== "draft") throw new ConflictError("Only a draft can be generated again.");
        const rows = await tx.select().from(slots).where(eq(slots.versionId, v.id));
        locked = rows.filter((r) => r.locked).map((r) => ({ sectionId: r.sectionId, day: r.dayOfWeek, periodId: r.periodId, subjectId: r.subjectId, teacherId: r.teacherId, roomId: null }));
        for (const r of rows) if (r.locked && r.room) lockedRoom.set(`${r.sectionId}:${r.dayOfWeek}:${r.periodId}`, r.room.toLowerCase());
        lockedBlocks = (await tx.select().from(ttBlockSlots).where(and(eq(ttBlockSlots.versionId, v.id), eq(ttBlockSlots.locked, true)))).map((r) => ({ blockId: r.blockId, day: r.dayOfWeek, periodId: r.periodId }));
        for (const r of rows) before.set(`${r.sectionId}:${r.dayOfWeek}:${r.periodId}`, `${r.subjectId}:${r.teacherId}`);
      }
      const input = await this.buildInput(tx, locked, lockedBlocks);
      const byName = new Map((input.rooms ?? []).map((r) => [r.name.toLowerCase(), r.id]));
      input.locked = locked.map((c) => ({ ...c, roomId: byName.get(lockedRoom.get(`${c.sectionId}:${c.day}:${c.periodId}`) ?? "") ?? null }));
      return { input, before };
    });
    if (!prepared.input.demands.length) throw new ConflictError("Set the periods per week for your classes first (step 1).");
    if (!prepared.input.periods.length) throw new ConflictError("Set up the bell schedule first.");
    const seed = d.seed ?? Math.floor(Math.random() * 2_000_000_000) + 1;
    const res = generate({ ...prepared.input, seed });
    const roomName = new Map((prepared.input.rooms ?? []).map((r) => [r.id, r.name]));

    return this.write("manage", async (tx) => {
      let versionId = d.versionId;
      if (!versionId) {
        const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(ttVersions))[0]?.n ?? 0;
        const [v] = await tx.insert(ttVersions).values({ schoolId: this.ctx.schoolId, name: `Draft ${Number(n) + 1}`, status: "draft", createdBy: this.ctx.userId }).returning();
        versionId = v!.id;
      } else {
        // Re-check under a row lock: another admin may have published this draft while the solver ran.
        const [cur] = await tx.select({ status: ttVersions.status }).from(ttVersions).where(eq(ttVersions.id, versionId)).for("update");
        if (!cur) throw new NotFoundError("Timetable version");
        if (cur.status !== "draft") throw new ConflictError("Only a draft can be generated again.");
        await tx.delete(slots).where(and(eq(slots.versionId, versionId), eq(slots.locked, false)));
        await tx.delete(ttBlockSlots).where(and(eq(ttBlockSlots.versionId, versionId), eq(ttBlockSlots.locked, false)));
      }
      const freshBlocks = res.blockPlacements.filter((b) => !b.locked);
      if (freshBlocks.length) await tx.insert(ttBlockSlots).values(freshBlocks.map((b) => ({ schoolId: this.ctx.schoolId, versionId: versionId!, blockId: b.blockId, dayOfWeek: b.day, periodId: b.periodId, locked: false })));
      const fresh = res.placements.filter((p) => !p.locked);
      for (let i = 0; i < fresh.length; i += 500) {
        await tx.insert(slots).values(fresh.slice(i, i + 500).map((p) => ({
          schoolId: this.ctx.schoolId, versionId: versionId!, sectionId: p.sectionId, dayOfWeek: p.day, periodId: p.periodId, subjectId: p.subjectId,
          teacherId: p.teacherId, room: p.roomId ? roomName.get(p.roomId) ?? null : null, locked: false,
        })));
      }
      await tx.update(ttVersions).set({ report: { seed, stats: res.stats, unplaced: res.unplaced }, updatedAt: new Date() }).where(eq(ttVersions.id, versionId));
      const after = new Map(res.placements.map((p) => [`${p.sectionId}:${p.day}:${p.periodId}`, `${p.subjectId}:${p.teacherId}`]));
      let changed = 0;
      for (const [k, v] of after) if (prepared.before.size && prepared.before.get(k) !== v) changed++;
      for (const k of prepared.before.keys()) if (!after.has(k)) changed++;
      return { versionId, placed: res.stats.placed, unplaced: res.stats.unplaced, locked: res.stats.locked, changed, timedOut: res.stats.timedOut, ms: res.stats.ms };
    }, (r) => ({ action: "generate", entity: "Timetable", entityId: r.versionId, summary: `Generated a draft: ${r.placed} periods placed, ${r.unplaced} could not be placed` }));
  }

  async versions(): Promise<VersionRow[]> {
    return this.read("manage", async (tx) => {
      const rows = await tx.select({
        id: ttVersions.id, name: ttVersions.name, status: ttVersions.status, createdAt: ttVersions.createdAt, publishedAt: ttVersions.publishedAt, publishOn: ttVersions.publishOn, report: ttVersions.report,
        cells: sql<number>`(select count(*)::int from timetable_slots s where s.version_id = ${ttVersions.id}) + (select count(*)::int from tt_block_slots b where b.version_id = ${ttVersions.id})`,
      }).from(ttVersions).orderBy(desc(ttVersions.createdAt));
      return rows.map(({ report, ...r }) => ({ ...r, unplaced: Number((report as { stats?: { unplaced?: number } } | null)?.stats?.unplaced ?? 0) }));
    });
  }

  /** One version with its sections, per-teacher load, and what could not be placed. */
  async review(versionId: string): Promise<Review> {
    return this.read("manage", async (tx) => {
      const [v] = /^[0-9a-f-]{36}$/i.test(versionId) ? await tx.select().from(ttVersions).where(eq(ttVersions.id, versionId)).limit(1) : [];
      if (!v) throw new NotFoundError("Timetable version");
      const [secs, loads, names, subs] = await Promise.all([
        tx.select({ id: sections.id, name: sections.name, className: classes.name, grade: classes.grade, current: academicYears.isCurrent }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId)).orderBy(asc(classes.grade), asc(sections.name)),
        tx.select({ teacherId: slots.teacherId, n: sql<number>`count(*)::int` }).from(slots).where(and(eq(slots.versionId, v.id), sql`${slots.teacherId} is not null`)).groupBy(slots.teacherId),
        tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "teacher")).orderBy(asc(users.name)),
        tx.select({ id: subjects.id, name: subjects.name }).from(subjects),
      ]);
      const cur = secs.some((s) => s.current) ? secs.filter((s) => s.current) : secs;
      const label = new Map(secs.map((s) => [s.id, `${s.className}-${s.name}`]));
      const per = new Map(loads.map((l) => [l.teacherId, Number(l.n)]));
      const tn = new Map(names.map((n) => [n.id, n.name]));
      const sn = new Map(subs.map((s) => [s.id, s.name]));
      const report = (v.report ?? null) as { unplaced?: Unplaced[]; stats?: Record<string, unknown>; seed?: number } | null;
      const cells = await this.cellCount(tx, v.id);
      const inBlocks = await tx.select({ teacherId: ttBlockOptions.teacherId, n: sql<number>`count(*)::int` }).from(ttBlockSlots)
        .innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlockSlots.blockId)).where(eq(ttBlockSlots.versionId, v.id)).groupBy(ttBlockOptions.teacherId);
      for (const b of inBlocks) per.set(b.teacherId, (per.get(b.teacherId) ?? 0) + Number(b.n));
      const blockName = new Map((await tx.select({ id: ttBlocks.id, name: ttBlocks.name, className: classes.name }).from(ttBlocks).innerJoin(classes, eq(classes.id, ttBlocks.classId))).map((b) => [b.id, b]));
      return {
        version: { id: v.id, name: v.name, status: v.status, createdAt: v.createdAt, publishedAt: v.publishedAt, publishOn: v.publishOn, cells: Number(cells), unplaced: Number((report?.stats as { unplaced?: number } | undefined)?.unplaced ?? 0) },
        sections: cur.map((s) => ({ id: s.id, label: `${s.className}-${s.name}` })),
        teachers: names.filter((n) => per.has(n.id)).map((n) => ({ id: n.id, name: n.name, periods: per.get(n.id)! })),
        unplaced: (report?.unplaced ?? []).map((u) => u.blockId
          ? { ...u, section: `${blockName.get(u.blockId)?.className ?? "Class"} (all sections)`, subject: blockName.get(u.blockId)?.name ?? "Elective block", teacher: "Block teachers" }
          : { ...u, section: label.get(u.sectionId) ?? "", subject: sn.get(u.subjectId) ?? "", teacher: u.teacherId ? tn.get(u.teacherId) ?? "" : "No teacher" }),
        stats: report ? { ...(report.stats ?? {}), seed: report.seed } : null,
      };
    });
  }

  private async cellCount(tx: Tx, versionId: string): Promise<number> {
    const [a, b] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(slots).where(eq(slots.versionId, versionId)),
      tx.select({ n: sql<number>`count(*)::int` }).from(ttBlockSlots).where(eq(ttBlockSlots.versionId, versionId)),
    ]);
    return Number(a[0]?.n ?? 0) + Number(b[0]?.n ?? 0);
  }

  /** Pin or release cells of a draft: one cell, a whole section, or the whole draft. */
  async setLocked(input: unknown): Promise<{ changed: number }> {
    this.authorize("manage", "write");
    const d = this.parse(lockInput, input);
    return this.write("manage", async (tx) => {
      const [v] = await tx.select().from(ttVersions).where(eq(ttVersions.id, d.versionId)).limit(1);
      if (!v) throw new NotFoundError("Timetable version");
      if (v.status !== "draft") throw new ConflictError("Only a draft has pinned cells.");
      const where = and(eq(slots.versionId, v.id), d.sectionId ? eq(slots.sectionId, d.sectionId) : undefined,
        d.dayOfWeek ? eq(slots.dayOfWeek, d.dayOfWeek) : undefined, d.periodId ? eq(slots.periodId, d.periodId) : undefined, ne(slots.locked, d.locked));
      const rows = await tx.update(slots).set({ locked: d.locked, updatedAt: new Date() }).where(where).returning({ id: slots.id });
      // Block cells belong to the class: pinning a section's cell pins the class's block there; the whole draft pins every block.
      let classBlocks: string[] | undefined;
      if (d.sectionId) {
        const [sec] = await tx.select({ classId: sections.classId }).from(sections).where(eq(sections.id, d.sectionId)).limit(1);
        classBlocks = sec ? (await tx.select({ id: ttBlocks.id }).from(ttBlocks).where(eq(ttBlocks.classId, sec.classId))).map((b) => b.id) : [];
      }
      const blockRows = classBlocks && !classBlocks.length ? [] : await tx.update(ttBlockSlots).set({ locked: d.locked, updatedAt: new Date() })
        .where(and(eq(ttBlockSlots.versionId, v.id), classBlocks ? inArray(ttBlockSlots.blockId, classBlocks) : undefined, d.dayOfWeek ? eq(ttBlockSlots.dayOfWeek, d.dayOfWeek) : undefined,
          d.periodId ? eq(ttBlockSlots.periodId, d.periodId) : undefined, ne(ttBlockSlots.locked, d.locked))).returning({ id: ttBlockSlots.id });
      return { changed: rows.length + blockRows.length };
    }, (r) => ({ action: d.locked ? "lock" : "unlock", entity: "Timetable", entityId: d.versionId, summary: `${d.locked ? "Pinned" : "Released"} ${r.changed} periods of a draft` }));
  }

  /**
   * Draft becomes the live timetable; the old live one is archived (kept, not deleted).
   * With a later `publishOn` day it is scheduled instead: it stays a draft (still editable) and the nightly job publishes it that morning.
   * Only one draft is scheduled at a time: scheduling another clears the earlier date.
   */
  async publish(input: unknown): Promise<{ versionId: string; name: string; publishOn: string | null }> {
    this.authorize("manage", "write");
    const d = this.parse(publishInput, input);
    const later = d.publishOn && d.publishOn > istDate(new Date()) ? d.publishOn : null;
    return this.write("manage", async (tx) => {
      const v = await this.draftOrThrow(tx, d.versionId, "published");
      if (!(await this.cellCount(tx, v.id))) throw new ValidationError({ versionId: "This draft is empty" });
      if (later) {
        await tx.update(ttVersions).set({ publishOn: null, updatedAt: new Date() }).where(and(eq(ttVersions.status, "draft"), ne(ttVersions.id, v.id)));
        await tx.update(ttVersions).set({ publishOn: later, updatedAt: new Date() }).where(eq(ttVersions.id, v.id));
        return { versionId: v.id, name: v.name, publishOn: later };
      }
      await this.goLive(tx, v.id);
      return { versionId: v.id, name: v.name, publishOn: null };
    }, (r) => ({ action: r.publishOn ? "schedule" : "publish", entity: "Timetable", entityId: r.versionId,
      summary: r.publishOn ? `Scheduled ${r.name} to go live on ${r.publishOn}` : `Published ${r.name} as the live timetable` }));
  }

  /** Take a draft off the schedule; it stays a draft. */
  async unschedule(input: unknown): Promise<{ versionId: string; name: string }> {
    this.authorize("manage", "write");
    const d = this.parse(idInput, input);
    return this.write("manage", async (tx) => {
      const v = await this.draftOrThrow(tx, d.versionId, "unscheduled");
      await tx.update(ttVersions).set({ publishOn: null, updatedAt: new Date() }).where(eq(ttVersions.id, v.id));
      return { versionId: v.id, name: v.name };
    }, (r) => ({ action: "unschedule", entity: "Timetable", entityId: r.versionId, summary: `Took ${r.name} off the schedule` }));
  }

  /** Nightly job: a draft whose day has come goes live. Returns how many went live (0 or 1). */
  async publishDue(today: string): Promise<number> {
    return this.write("manage", async (tx) => {
      const [v] = await tx.select().from(ttVersions).where(and(eq(ttVersions.status, "draft"), lte(ttVersions.publishOn, today))).orderBy(asc(ttVersions.publishOn)).limit(1).for("update");
      if (!v) return 0;
      if (!(await this.cellCount(tx, v.id))) { // emptied after scheduling: leave it, unscheduled, rather than publish an empty week
        await tx.update(ttVersions).set({ publishOn: null, updatedAt: new Date() }).where(eq(ttVersions.id, v.id));
        await this.audit(tx, { action: "unschedule", entity: "Timetable", entityId: v.id, summary: `${v.name} was empty on its publish day, so it was not published` });
        return 0;
      }
      await this.goLive(tx, v.id);
      await this.audit(tx, { action: "publish", entity: "Timetable", entityId: v.id, summary: `Published ${v.name} on schedule` });
      return 1;
    });
  }

  private async draftOrThrow(tx: Tx, versionId: string, verb: string) {
    const [v] = await tx.select().from(ttVersions).where(eq(ttVersions.id, versionId)).limit(1).for("update");
    if (!v) throw new NotFoundError("Timetable version");
    if (v.status !== "draft") throw new ConflictError(`Only a draft can be ${verb}.`);
    return v;
  }

  private async goLive(tx: Tx, versionId: string) {
    await tx.update(ttVersions).set({ status: "archived", updatedAt: new Date() }).where(eq(ttVersions.status, "live"));
    await tx.update(ttVersions).set({ status: "live", publishedAt: new Date(), publishOn: null, updatedAt: new Date() }).where(eq(ttVersions.id, versionId));
    await this.carryCovers(tx, versionId);
  }

  /**
   * Covers point at slot ids, which change on publish. Move today's and later covers to the matching new slot
   * (same section, day, period); a cover with no match (or whose teacher now teaches then) is removed and the cover teacher told.
   */
  private async carryCovers(tx: Tx, newId: string) {
    const today = istDate(new Date());
    await tx.execute(sql`update substitutions s set slot_id = n.id, absent_teacher_id = n.teacher_id, updated_at = now()
      from timetable_slots o, timetable_slots n
      where s.slot_id = o.id and o.version_id <> ${newId} and s.date >= ${today}::date
        and n.version_id = ${newId} and n.section_id = o.section_id and n.day_of_week = o.day_of_week and n.period_id = o.period_id
        and n.teacher_id is distinct from s.cover_teacher_id`);
    // Block covers follow the same block, day and period, and the same option (so the same alternative) when it is still there.
    await tx.execute(sql`update substitutions s set block_slot_id = n.id, absent_teacher_id = op.teacher_id, updated_at = now()
      from tt_block_slots o, tt_block_slots n, tt_block_options op
      where s.block_slot_id = o.id and o.version_id <> ${newId} and s.date >= ${today}::date
        and n.version_id = ${newId} and n.block_id = o.block_id and n.day_of_week = o.day_of_week and n.period_id = o.period_id
        and op.id = s.option_id and op.teacher_id <> s.cover_teacher_id`);
    const goneSlots = await tx.execute<{ cover: string; date: string }>(sql`delete from substitutions s using timetable_slots o
      where s.slot_id = o.id and o.version_id <> ${newId} and s.date >= ${today}::date returning s.cover_teacher_id as cover, s.date::text as date`);
    const goneBlocks = await tx.execute<{ cover: string; date: string }>(sql`delete from substitutions s using tt_block_slots o
      where s.block_slot_id = o.id and o.version_id <> ${newId} and s.date >= ${today}::date returning s.cover_teacher_id as cover, s.date::text as date`);
    const gone = [...goneSlots, ...goneBlocks];
    if (!gone.length || !this.ctx.features.has("notifications")) return;
    await NotificationWriter.insert(tx, this.ctx.schoolId, gone.map((g) => ({ userId: g.cover, topic: "work.cover" as const, subject: { type: "cover", id: `${g.cover}:${g.date}` }, title: "Cover duty cancelled", body: `The timetable changed, so your cover on ${g.date} was removed.`, href: "/app/timetable" })));
  }

  /** Throw a draft away. */
  async discard(input: unknown): Promise<{ versionId: string }> {
    this.authorize("manage", "write");
    const d = this.parse(idInput, input);
    return this.write("manage", async (tx) => {
      const [v] = await tx.select().from(ttVersions).where(eq(ttVersions.id, d.versionId)).limit(1);
      if (!v) throw new NotFoundError("Timetable version");
      if (v.status !== "draft") throw new ConflictError("Only a draft can be discarded.");
      await tx.delete(ttVersions).where(eq(ttVersions.id, v.id));
      return { versionId: v.id, name: v.name };
    }, (r) => ({ action: "discard", entity: "Timetable", entityId: r.versionId, summary: `Discarded ${(r as { name: string }).name}` }));
  }
}
