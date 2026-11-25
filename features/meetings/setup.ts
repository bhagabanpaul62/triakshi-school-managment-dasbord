import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, toPage, ValidationError, listQuerySchema, type ListQuery, type Page } from "@smw/feature-kit";
import { audienceMatches, describeAudience, resolveAudience } from "@smw/feature-notifications/audience";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { kidOfLogin, rows, idList, ts, type Meeting } from "./access";
import { MeetingBase } from "./base";
import type { MeetingState, SlotState, VisitState } from "./constants";
import { cancelInput, changeWindowInput, confirmInput, duplicateInput, meetingInput, reopenInput, windowsInput } from "./inputs";
import { atIst, breaksOf, buildGrid, istDay, reconcile, type Existing, type Plan, type Span } from "./rules";
import { meetingDays, meetingSlots, meetingWindows } from "./schema";
import { when } from "./format";
import { plural } from "@smw/feature-kit/words";

type Window = typeof meetingWindows.$inferSelect;
const DAY_MS = 86_400_000;

export interface MeetingRow {
  id: string; title: string; state: MeetingState; opensAt: Date; closesAt: Date; firstAt: Date | null; lastAt: Date | null;
  teachers: number; slots: number; booked: number;
  /** Family only: this child's own bookings. */
  mine: number;
}
export interface SlotView { id: string; startsAt: Date; endsAt: Date; state: SlotState; studentId: string | null; studentName: string | null; studentLabel: string | null; walkIn: boolean; visit: VisitState | null }
export interface WindowView { id: string; teacherId: string; teacherName: string; day: string; startsAt: Date; endsAt: Date; place: string | null; videoUrl: string | null; open: number; booked: number; slots: SlotView[] }
export interface MeetingDetail { meeting: Meeting; audienceText: string; windows: WindowView[]; open: number; booked: number; waiting: number; teachers: number }
export interface TeacherChoice { teacherId: string; name: string; why: string }
export interface Dropped { slotId: string; studentId: string; studentName: string; userId: string | null; startsAt: Date; teacherName: string }
export interface WindowChange { applied: boolean; dropped: Dropped[]; added: number; removed: number }
export interface Check { families: number; withoutTeacher: number; problems: string[]; warnings: string[] }

const NO_UNDO = new Set<MeetingState>(["done", "cancelled"]);

/** Setting a meeting up and running its state. Managers do all of it; a teacher only reads their own windows. */
export class MeetingService extends MeetingBase {
  // ---- reading ----

  /** Meetings the caller may see: managers all, a teacher those they have a window in, a family those their child is invited to. */
  async list(query: ListQuery = {}): Promise<Page<MeetingRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("use", async (tx) => {
      const kid = this.isFamily ? await kidOfLogin(tx, this.ctx.userId) : null;
      if (this.isFamily && !kid) return toPage([], 0, q);
      const scope = this.isFamily ? sql`md.state in ('open', 'closed', 'done', 'cancelled')`
        : this.canManage ? sql`true`
          : sql`md.state <> 'draft' and exists (select 1 from meeting_windows w where w.meeting_id = md.id and w.teacher_id = ${this.ctx.userId}::uuid)`;
      const found = await rows<MeetingRow & { audience: Audience }>(tx, sql`
        select md.id, md.title, md.state, md.opens_at as "opensAt", md.closes_at as "closesAt", md.audience,
          (select min(w.starts_at) from meeting_windows w where w.meeting_id = md.id) as "firstAt",
          (select max(w.ends_at) from meeting_windows w where w.meeting_id = md.id) as "lastAt",
          (select count(distinct w.teacher_id)::int from meeting_windows w where w.meeting_id = md.id) as teachers,
          (select count(*)::int from meeting_slots s where s.meeting_id = md.id and s.state in ('open', 'booked')) as slots,
          (select count(*)::int from meeting_slots s where s.meeting_id = md.id and s.state = 'booked') as booked,
          ${kid ? sql`(select count(*)::int from meeting_slots s where s.meeting_id = md.id and s.state = 'booked' and s.student_id = ${kid.id}::uuid)` : sql`0`} as mine
        from meeting_days md where ${scope} ${q.filters.state ? sql`and md.state = ${q.filters.state}` : sql``} ${q.q ? sql`and md.title ilike ${`%${q.q}%`}` : sql``}
        order by case md.state when 'open' then 0 when 'draft' then 1 when 'closed' then 2 else 3 end, md.opens_at desc, md.id`);
      const mine = kid ? (await Promise.all(found.map(async (m) => (await audienceMatches(tx, m.audience, { userId: this.ctx.userId, studentIds: [kid.id] })) ? m : null))).filter((m) => m) as typeof found : found;
      const list = mine.map(({ audience: _a, ...m }) => ({ ...m, mine: Number(m.mine) }));
      return toPage(list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), list.length, q);
    });
  }

  /** One meeting for staff: windows by teacher with their slots. A teacher sees only their own windows. */
  async get(id: string): Promise<MeetingDetail> {
    return this.read("use", async (tx) => {
      if (this.isFamily) throw new ForbiddenError("Families book from their own page.");
      const meeting = await this.meeting(tx, id);
      const own = !this.canManage;
      if (own && meeting.state === "draft") throw new NotFoundError("Meeting");
      const wins = await rows<Omit<WindowView, "slots" | "open" | "booked" | "day"> & { day: string }>(tx, sql`
        select w.id, w.teacher_id as "teacherId", u.name as "teacherName", w.day::text as day, w.starts_at as "startsAt", w.ends_at as "endsAt", w.place, w.video_url as "videoUrl"
        from meeting_windows w join users u on u.id = w.teacher_id where w.meeting_id = ${id}::uuid ${own ? sql`and w.teacher_id = ${this.ctx.userId}::uuid` : sql``}
        order by w.day, u.name, w.starts_at`);
      if (own && !wins.length) throw new NotFoundError("Meeting");
      await this.seen(tx, id);
      const slots = wins.length ? await rows<SlotView & { windowId: string }>(tx, sql`
        select s.id, s.window_id as "windowId", s.starts_at as "startsAt", s.ends_at as "endsAt", s.state, s.student_id as "studentId", st.name as "studentName",
          coalesce(c.name || coalesce('-' || sec.name, ''), null) as "studentLabel", s.walk_in as "walkIn", s.visit
        from meeting_slots s left join students st on st.id = s.student_id left join classes c on c.id = st.class_id left join sections sec on sec.id = st.section_id
        where s.window_id in (${idList(wins.map((w) => w.id))}) and s.state <> 'removed' order by s.starts_at`) : [];
      const windows = wins.map((w) => {
        const mine = slots.filter((s) => s.windowId === w.id);
        return { ...w, slots: mine, open: mine.filter((s) => s.state === "open").length, booked: mine.filter((s) => s.state === "booked").length };
      });
      const [waits] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from meeting_waits where meeting_id = ${id}::uuid ${own ? sql`and teacher_id = ${this.ctx.userId}::uuid` : sql``}`);
      return {
        meeting, audienceText: await describeAudience(tx, meeting.audience), windows, waiting: waits?.n ?? 0,
        open: windows.reduce((n, w) => n + w.open, 0), booked: windows.reduce((n, w) => n + w.booked, 0), teachers: new Set(windows.map((w) => w.teacherId)).size,
      };
    });
  }

  /** Teachers to offer first: the class teachers and subject teachers of the sections the audience reaches. */
  async suggestTeachers(audience: Audience): Promise<TeacherChoice[]> {
    return this.read("manage", async (tx) => {
      const reached = await resolveAudience(tx, audience);
      const sectionIds = [...new Set(reached.flatMap((r) => (r.sectionId ? [r.sectionId] : [])))];
      if (!sectionIds.length) return [];
      const found = await rows<{ teacherId: string; name: string; classOf: string | null; subjects: string | null }>(tx, sql`
        select u.id as "teacherId", u.name,
          string_agg(distinct (c.name || '-' || sec.name), ', ') filter (where sec.class_teacher_id = u.id) as "classOf",
          string_agg(distinct subj.name, ', ') as subjects
        from sections sec join classes c on c.id = sec.class_id
        join users u on u.status = 'active' and (u.id = sec.class_teacher_id or exists (select 1 from section_teachers t where t.section_id = sec.id and t.teacher_id = u.id))
        left join section_teachers st on st.section_id = sec.id and st.teacher_id = u.id left join subjects subj on subj.id = st.subject_id
        where sec.id in (${idList(sectionIds)}) group by u.id, u.name order by u.name`);
      return found.map((t) => ({ teacherId: t.teacherId, name: t.name, why: [t.classOf ? `Class teacher of ${t.classOf}` : null, t.subjects ? `Teaches ${t.subjects}` : null].filter(Boolean).join(". ") }));
    });
  }

  /** Everyone who can be given a window: active staff, by name. */
  async staff(): Promise<{ id: string; name: string }[]> {
    return this.read("manage", (tx) => rows<{ id: string; name: string }>(tx, sql`select id, name from users where status = 'active' and role not in ('student', 'parent') order by name`));
  }

  /** The last look before opening: what would stop it, and what looks wrong. */
  async check(id: string): Promise<Check> {
    return this.read("manage", async (tx) => this.checkIn(tx, await this.meeting(tx, id)));
  }

  private async checkIn(tx: Tx, m: Meeting): Promise<Check> {
    const families = await this.families(tx, m);
    const [t] = await rows<{ windows: number; openSlots: number; noSlots: number }>(tx, sql`
      select count(distinct w.id)::int as windows, (select count(*)::int from meeting_slots s where s.meeting_id = ${m.id}::uuid and s.state = 'open') as "openSlots",
        count(distinct w.id) filter (where not exists (select 1 from meeting_slots s where s.window_id = w.id and s.state = 'open'))::int as "noSlots"
      from meeting_windows w where w.meeting_id = ${m.id}::uuid`);
    // A family with no teacher in this meeting cannot book anything: say so before families find out.
    const [lone] = await rows<{ n: number }>(tx, sql`
      select count(*)::int as n from students s where s.status = 'active' and s.id in (${idList(families.map((f) => f.studentId!))}) and not exists (
        select 1 from meeting_windows w where w.meeting_id = ${m.id}::uuid and (w.teacher_id in (select class_teacher_id from sections where id = s.section_id)
          or w.teacher_id in (select teacher_id from section_teachers where section_id = s.section_id)))`);
    const problems: string[] = [], warnings: string[] = [];
    if (!t?.windows) problems.push("Add the teachers and the times they are free.");
    else if (!t.openSlots) problems.push("No time is left to book. Widen a window or shorten the slot length.");
    if (!families.length) problems.push("The audience reaches no families. Choose who the meeting is for.");
    if (m.closesAt <= this.now()) problems.push("Booking closes in the past. Move the closing time.");
    if (t?.noSlots) warnings.push(`${t.noSlots} teacher time${t.noSlots === 1 ? " has" : "s have"} no free slot.`);
    if (lone?.n) warnings.push(`${plural(lone.n, "family has", "families have")} no teacher in this meeting, so they cannot book anything.`);
    return { families: families.length, withoutTeacher: lone?.n ?? 0, problems, warnings };
  }

  // ---- the meeting itself ----

  /** Create (id null) or change a meeting. After booking opens, who it is for and the slot length are fixed. */
  async saveDraft(id: string | null, input: unknown): Promise<Meeting> {
    this.authorize("manage", "write");
    const data = this.parse(meetingInput, input);
    return this.write("manage", async (tx) => {
      if (!id) {
        const [row] = await tx.insert(meetingDays).values({ ...data, schoolId: this.ctx.schoolId, state: "draft", createdBy: this.ctx.userId }).returning();
        await this.audit(tx, { action: "create", entity: "Meeting", entityId: row!.id, summary: `Started meeting "${row!.title}"` });
        return row!;
      }
      const m = await this.meeting(tx, id);
      if (NO_UNDO.has(m.state)) throw new ConflictError("This meeting is over, so it cannot be changed. Duplicate it to run it again.");
      if (m.state !== "draft") {
        if (data.slotMinutes !== m.slotMinutes) throw new ValidationError({ slotMinutes: "Slot length is fixed once booking has opened." });
        if (JSON.stringify(data.audience) !== JSON.stringify(m.audience)) throw new ValidationError({ audience: "Who it is for is fixed once booking has opened." });
      }
      const [row] = await tx.update(meetingDays).set({ ...data, updatedAt: new Date() }).where(eq(meetingDays.id, id)).returning();
      if (m.state === "draft" && data.slotMinutes !== m.slotMinutes) {
        for (const w of await tx.select().from(meetingWindows).where(eq(meetingWindows.meetingId, id))) await this.syncWindow(tx, row!, w, w);
      }
      await this.audit(tx, { action: "update", entity: "Meeting", entityId: id, summary: `Changed meeting "${row!.title}"` });
      return row!;
    });
  }

  /** A draft nobody has seen can go; once it was opened, cancel it instead. */
  async remove(id: string) {
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      if (m.state !== "draft" || m.openedAt) throw new ConflictError("Only a draft that was never opened can be deleted. Cancel this one instead.");
      await tx.delete(meetingSlots).where(eq(meetingSlots.meetingId, id));
      await tx.delete(meetingDays).where(eq(meetingDays.id, id));
      return { id };
    }, (r) => ({ action: "delete", entity: "Meeting", entityId: r.id, summary: "Deleted a draft meeting" }));
  }

  /** Open booking: tells every family in the audience, each with one action that closes when they book. */
  async open(id: string) {
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      if (m.state !== "draft") throw new ConflictError(m.state === "open" ? "Booking is already open." : "Only a draft can be opened. Use Reopen for a closed meeting.");
      const check = await this.checkIn(tx, m);
      if (check.problems.length) throw new ConflictError(check.problems[0]!);
      await tx.update(meetingDays).set({ state: "open", openedAt: this.now(), updatedAt: new Date() }).where(eq(meetingDays.id, id));
      const told = await this.notices.opened(tx, m, [...new Set((await this.families(tx, m)).flatMap((f) => (f.userId ? [f.userId] : [])))]);
      return { id, told, title: m.title };
    }, (r) => ({ action: "open", entity: "Meeting", entityId: r.id, summary: `Opened booking for "${r.title}" to ${r.told} families` }));
  }

  async close(id: string) {
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      if (m.state !== "open") throw new ConflictError("Only a meeting that is open can be closed.");
      await tx.update(meetingDays).set({ state: "closed", updatedAt: new Date() }).where(eq(meetingDays.id, id));
      await this.notices.over(tx, id);
      return { id, title: m.title };
    }, (r) => ({ action: "close", entity: "Meeting", entityId: r.id, summary: `Closed booking for "${r.title}"` }));
  }

  /** Booking after a close. If the closing time has passed, a new one must be given. */
  async reopen(id: string, input: unknown = {}) {
    const data = this.parse(reopenInput, input);
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      if (m.state !== "closed") throw new ConflictError("Only a closed meeting can be reopened.");
      const closesAt = data.closesAt ?? m.closesAt;
      if (closesAt <= this.now()) throw new ValidationError({ closesAt: "Pick a closing time that has not passed" });
      await tx.update(meetingDays).set({ state: "open", closesAt, updatedAt: new Date() }).where(eq(meetingDays.id, id));
      return { id, title: m.title };
    }, (r) => ({ action: "reopen", entity: "Meeting", entityId: r.id, summary: `Reopened booking for "${r.title}"` }));
  }

  /** Cancel with a reason. Families and teachers who hold a booking are told. */
  async cancel(id: string, input: unknown) {
    const data = this.parse(cancelInput, input);
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      if (NO_UNDO.has(m.state)) throw new ConflictError(m.state === "done" ? "This meeting already took place." : "This meeting is already cancelled.");
      await tx.update(meetingDays).set({ state: "cancelled", cancelReason: data.reason, updatedAt: new Date() }).where(eq(meetingDays.id, id));
      const held = await rows<{ userId: string | null; teacherId: string }>(tx, sql`select st.user_id as "userId", s.teacher_id as "teacherId" from meeting_slots s join students st on st.id = s.student_id where s.meeting_id = ${id}::uuid and s.state = 'booked'`);
      const people = [...new Set(held.flatMap((h) => [h.userId, h.teacherId]).filter((u): u is string => !!u))];
      await this.notices.over(tx, id);
      await this.notices.changed(tx, m, people, `Cancelled: ${m.title}`, data.reason);
      return { id, title: m.title, told: people.length };
    }, (r) => ({ action: "cancel", entity: "Meeting", entityId: r.id, summary: `Cancelled "${r.title}" (${data.reason}); ${r.told} people told` }));
  }

  /** A new draft with the same people and times moved to another date. Nothing is booked in the copy. */
  async duplicate(id: string, input: unknown): Promise<Meeting> {
    const data = this.parse(duplicateInput, input);
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, id);
      const wins = await tx.select().from(meetingWindows).where(eq(meetingWindows.meetingId, id)).orderBy(asc(meetingWindows.startsAt));
      const first = wins[0] ? istDay(wins[0].startsAt) : istDay(m.opensAt);
      const shift = Math.round((atIst(data.date, "00:00").getTime() - atIst(first, "00:00").getTime()) / DAY_MS) * DAY_MS;
      const [copy] = await tx.insert(meetingDays).values({
        schoolId: this.ctx.schoolId, title: data.title ?? `${m.title} (copy)`.slice(0, 120), note: m.note, state: "draft", audience: m.audience, slotMinutes: m.slotMinutes, perFamily: m.perFamily,
        opensAt: new Date(m.opensAt.getTime() + shift), closesAt: new Date(m.closesAt.getTime() + shift), createdBy: this.ctx.userId,
      }).returning();
      for (const w of wins) {
        const span = { startsAt: new Date(w.startsAt.getTime() + shift), endsAt: new Date(w.endsAt.getTime() + shift) };
        const old = await this.slotsOf(tx, w.id);
        const [nw] = await tx.insert(meetingWindows).values({ schoolId: this.ctx.schoolId, meetingId: copy!.id, teacherId: w.teacherId, day: istDay(span.startsAt), ...span, place: w.place, videoUrl: w.videoUrl }).returning();
        await this.syncWindow(tx, copy!, nw!, span, breaksOf(old).map((b) => ({ startsAt: new Date(b.startsAt.getTime() + shift), endsAt: new Date(b.endsAt.getTime() + shift) })));
      }
      await this.audit(tx, { action: "duplicate", entity: "Meeting", entityId: copy!.id, summary: `Copied "${m.title}" to ${data.date}` });
      return copy!;
    });
  }

  // ---- teachers and times ----

  /** The same window for every chosen teacher, with its slots. Adding to an open meeting also offers the new times to the waiting list. */
  async addWindows(meetingId: string, input: unknown): Promise<{ added: number }> {
    this.authorize("manage", "write");
    const data = this.parse(windowsInput, input);
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      if (NO_UNDO.has(m.state)) throw new ConflictError("This meeting is over, so no times can be added.");
      const span = this.span(data.day, data.from, data.to, m);
      const staff = await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(inArray(users.id, data.teacherIds), eq(users.status, "active"), notInArray(users.role, ["student", "parent"])));
      if (staff.length !== new Set(data.teacherIds).size) throw new ValidationError({ teacherIds: "Choose teachers from the staff list" });
      const breaks = data.breakFrom ? [{ startsAt: atIst(data.day, data.breakFrom), endsAt: atIst(data.day, data.breakTo!) }] : [];
      for (const t of staff) {
        await this.noOverlap(tx, t.id, span, t.name);
        const [w] = await tx.insert(meetingWindows).values({ schoolId: this.ctx.schoolId, meetingId, teacherId: t.id, day: data.day, ...span, place: data.place ?? null, videoUrl: data.videoUrl ?? null }).returning();
        const plan = await this.syncWindow(tx, m, w!, span, breaks);
        if (m.state === "open") await this.offerFreed(tx, m, t.id, plan.insert.filter((c) => c.state === "open").length);
      }
      await this.audit(tx, { action: "add_windows", entity: "Meeting", entityId: meetingId, summary: `Added ${staff.length} teacher times on ${data.day}` });
      return { added: staff.length };
    });
  }

  /** Make every window's slots match the meeting's slot length. Safe to run again. */
  async generateSlots(meetingId: string): Promise<{ created: number }> {
    return this.write("manage", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      let created = 0;
      for (const w of await tx.select().from(meetingWindows).where(eq(meetingWindows.meetingId, meetingId))) created += (await this.syncWindow(tx, m, w, w)).insert.length;
      return { created };
    });
  }

  /**
   * Change a window's day, hours, place or breaks. Free slots follow; bookings that no longer fit are listed first.
   * Without `confirm: true` nothing is saved when bookings would be dropped. Dropped families are told and can book again.
   */
  async changeWindow(windowId: string, input: unknown): Promise<WindowChange> {
    this.authorize("manage", "write");
    const data = this.parse(changeWindowInput, input);
    return this.write("manage", async (tx) => {
      const w = await this.windowOf(tx, windowId);
      const m = await this.meeting(tx, w.meetingId);
      if (NO_UNDO.has(m.state)) throw new ConflictError("This meeting is over, so its times cannot change.");
      const day = data.day ?? w.day, from = data.from ?? hm(w.startsAt), to = data.to ?? hm(w.endsAt);
      const span = this.span(day, from, to, m);
      const old = await this.slotsOf(tx, w.id);
      const shift = atIst(day, "00:00").getTime() - atIst(w.day, "00:00").getTime();
      const breaks = data.noBreak ? [] : data.breakFrom ? [{ startsAt: atIst(day, data.breakFrom), endsAt: atIst(day, data.breakTo!) }]
        : breaksOf(old).map((b) => ({ startsAt: new Date(b.startsAt.getTime() + shift), endsAt: new Date(b.endsAt.getTime() + shift) }));
      const plan = reconcile(buildGrid(span, m.slotMinutes, breaks), old);
      const dropped = await this.droppedOf(tx, plan);
      if (dropped.length && !data.confirm) return { applied: false, dropped, added: 0, removed: 0 };
      await this.noOverlap(tx, w.teacherId, span, await this.nameOf(tx, w.teacherId), w.id);
      await tx.update(meetingWindows).set({ day, ...span, place: data.place ?? w.place, videoUrl: data.videoUrl ?? w.videoUrl }).where(eq(meetingWindows.id, w.id));
      await this.applyPlan(tx, m, w, plan);
      await this.tellDropped(tx, m, dropped, `Your meeting time changed: ${m.title}`);
      await this.audit(tx, { action: "change_window", entity: "Meeting", entityId: m.id, summary: `Changed a teacher time on ${day}; ${dropped.length} bookings dropped` });
      return { applied: true, dropped, added: plan.insert.length, removed: plan.remove.length };
    });
  }

  /** Take a teacher out of the meeting. Same two-step rule as changeWindow. */
  async removeWindow(windowId: string, input: unknown = {}): Promise<WindowChange> {
    this.authorize("manage", "write");
    const { confirm } = this.parse(confirmInput, input);
    return this.write("manage", async (tx) => {
      const w = await this.windowOf(tx, windowId);
      const m = await this.meeting(tx, w.meetingId);
      if (NO_UNDO.has(m.state)) throw new ConflictError("This meeting is over, so its times cannot change.");
      const [seen] = await tx.select({ id: meetingSlots.id }).from(meetingSlots).where(and(eq(meetingSlots.windowId, w.id), eq(meetingSlots.walkIn, true))).limit(1);
      if (seen) throw new ConflictError("This teacher already met a family in this time, so it stays on record.");
      const old = await this.slotsOf(tx, w.id);
      const dropped = await this.droppedOf(tx, reconcile([], old));
      if (dropped.length && !confirm) return { applied: false, dropped, added: 0, removed: 0 };
      await tx.delete(meetingSlots).where(eq(meetingSlots.windowId, w.id));
      await tx.delete(meetingWindows).where(eq(meetingWindows.id, w.id));
      await this.tellDropped(tx, m, dropped, `Your meeting time was cancelled: ${m.title}`);
      await this.audit(tx, { action: "remove_window", entity: "Meeting", entityId: m.id, summary: `Removed a teacher time; ${dropped.length} bookings dropped` });
      return { applied: true, dropped, added: 0, removed: old.length };
    });
  }

  // ---- shared pieces ----

  private span(day: string, from: string, to: string, m: Meeting): Span {
    const span = { startsAt: atIst(day, from), endsAt: atIst(day, to) };
    if (span.endsAt <= this.now() && m.state !== "draft") throw new ValidationError({ day: "That time has already passed" });
    if (span.endsAt.getTime() - span.startsAt.getTime() < m.slotMinutes * 60_000) throw new ValidationError({ to: `The window must fit at least one ${m.slotMinutes}-minute slot` });
    return span;
  }

  private async windowOf(tx: Tx, id: string): Promise<Window & { day: string }> {
    const [w] = /^[0-9a-f-]{36}$/i.test(id) ? await tx.select().from(meetingWindows).where(eq(meetingWindows.id, id)).limit(1) : [];
    if (!w) throw new NotFoundError("Teacher time");
    return w;
  }

  private async nameOf(tx: Tx, userId: string) {
    return (await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1))[0]?.name ?? "This teacher";
  }

  private async noOverlap(tx: Tx, teacherId: string, span: Span, name: string, ignore?: string) {
    const [clash] = await rows<{ title: string }>(tx, sql`select md.title from meeting_windows w join meeting_days md on md.id = w.meeting_id and md.state <> 'cancelled'
      where w.teacher_id = ${teacherId}::uuid and w.starts_at < ${ts(span.endsAt)} and w.ends_at > ${ts(span.startsAt)} ${ignore ? sql`and w.id <> ${ignore}::uuid` : sql``} limit 1`);
    if (clash) throw new ValidationError({ teacherIds: `${name} already has a time then in "${clash.title}"` });
  }

  private async slotsOf(tx: Tx, windowId: string): Promise<Existing[]> {
    return tx.select({ id: meetingSlots.id, startsAt: meetingSlots.startsAt, endsAt: meetingSlots.endsAt, state: meetingSlots.state, studentId: meetingSlots.studentId })
      .from(meetingSlots).where(and(eq(meetingSlots.windowId, windowId), eq(meetingSlots.walkIn, false)));
  }

  private async droppedOf(tx: Tx, plan: Plan): Promise<Dropped[]> {
    if (!plan.drop.length) return [];
    return rows<Dropped>(tx, sql`select s.id as "slotId", st.id as "studentId", st.name as "studentName", st.user_id as "userId", s.starts_at as "startsAt", u.name as "teacherName"
      from meeting_slots s join students st on st.id = s.student_id join users u on u.id = s.teacher_id where s.id in (${idList(plan.drop.map((d) => d.id))}) order by s.starts_at`);
  }

  private async tellDropped(tx: Tx, m: Meeting, dropped: Dropped[], title: string) {
    for (const d of dropped) if (d.userId) await this.notices.changed(tx, m, [d.userId], title, `${d.teacherName} at ${when(d.startsAt)} no longer stands. Open the meeting to pick another time.`);
  }

  /** Write a reconcile plan, then offer what is free again to the people waiting. */
  private async applyPlan(tx: Tx, m: Meeting, w: Pick<Window, "id" | "teacherId">, plan: Plan) {
    if (plan.remove.length) await tx.delete(meetingSlots).where(inArray(meetingSlots.id, plan.remove));
    if (plan.toBreak.length) await tx.update(meetingSlots).set({ state: "break" }).where(inArray(meetingSlots.id, plan.toBreak));
    if (plan.toOpen.length) await tx.update(meetingSlots).set({ state: "open" }).where(inArray(meetingSlots.id, plan.toOpen));
    if (plan.drop.length) await tx.update(meetingSlots).set({ state: "removed" }).where(inArray(meetingSlots.id, plan.drop.map((d) => d.id)));
    if (plan.insert.length) await tx.insert(meetingSlots).values(plan.insert.map((c) => ({ schoolId: this.ctx.schoolId, meetingId: m.id, windowId: w.id, teacherId: w.teacherId, startsAt: c.startsAt, endsAt: c.endsAt, state: c.state })));
    if (m.state === "open") await this.offerFreed(tx, m, w.teacherId, plan.insert.filter((c) => c.state === "open").length + plan.toOpen.length);
  }

  /** Bring a window's slots in line with `span` (its own times, unless it is moving) and the meeting's slot length. Breaks stay unless new ones are given. */
  private async syncWindow(tx: Tx, m: Meeting, w: Window, span: Span, breaks?: Span[]): Promise<Plan> {
    const old = await this.slotsOf(tx, w.id);
    const plan = reconcile(buildGrid(span, m.slotMinutes, breaks ?? breaksOf(old)), old);
    await this.applyPlan(tx, m, w, plan);
    return plan;
  }
}

/** "10:30" in India time. */
const hm = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);
