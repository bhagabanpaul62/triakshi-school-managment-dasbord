import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, pgErrorCode, ValidationError } from "@smw/feature-kit";
import { audienceMatches, resolveAudience } from "@smw/feature-notifications/audience";
import { clashFor, idList, ts, kidById, kidOfLogin, lockFamily, rows, siblingIds, teachersOf, type Kid, type Meeting, type Teacher } from "./access";
import { MeetingBase, type Perm } from "./base";
import type { MeetingState, VisitState } from "./constants";
import { bookInput, changeBookingInput, waitInput } from "./inputs";
import { when } from "./format";
import { meetingSlots, meetingWaits } from "./schema";
import { plural } from "@smw/feature-kit/words";

export const TAKEN = "Someone just took this time. Pick another.";

export interface BookedView { slotId: string; teacherId: string; teacherName: string; startsAt: Date; endsAt: Date; place: string | null; videoUrl: string | null; visit: VisitState | null; remark: string | null }
export interface TeacherView {
  teacherId: string; name: string; why: string; place: string | null; videoUrl: string | null;
  /** Free times this child could take now: in the future and clear of the family's other meetings. */
  slots: { id: string; startsAt: Date; endsAt: Date }[];
  booked: BookedView | null; waiting: boolean;
}
export interface KidView {
  student: { id: string; name: string; label: string }; used: number; limit: number; booked: BookedView[]; teachers: TeacherView[];
  /** Teachers of the child who have no time in this meeting, so the page never claims "every teacher". */
  notInMeeting: string[];
}
export interface BookingView {
  meeting: { id: string; title: string; note: string | null; state: MeetingState; opensAt: Date; closesAt: Date; perFamily: number; cancelReason: string | null };
  kids: KidView[];
  /** Whether this caller may book, change or cancel right now; when not, `why` says so in one sentence. */
  can: boolean; why: string | null;
}

/** A family picks times with the teachers of their child; staff do the same on a family's behalf. */
export class BookingService extends MeetingBase {
  protected authorize(permission: Perm, mode: "read" | "write") { this.refuseSupport(); super.authorize(permission, mode); }

  /** Why this caller cannot change bookings of the meeting right now, or null. */
  private gate(m: Meeting, staff: boolean): string | null {
    const now = this.now();
    if (m.state === "cancelled") return `This meeting was cancelled${m.cancelReason ? `: ${m.cancelReason}` : "."}`;
    if (m.state === "draft") return "Booking has not opened yet.";
    if (m.state === "done") return "This meeting is over.";
    if (staff) return null;
    if (m.state === "closed" || now >= m.closesAt) return "Booking is closed. Ask the school office if you still need a time.";
    if (now < m.opensAt) return `Booking opens ${when(m.opensAt)}.`;
    return null;
  }

  // ---- reading ----

  /** One booked time for "Add to calendar". Only the child's own family, the teacher, or a manager; anyone else gets "not found". */
  async slotForCalendar(slotId: string) {
    return this.read("use", async (tx) => {
      const [s] = /^[0-9a-f-]{36}$/i.test(slotId) ? await rows<{ id: string; teacherId: string; studentId: string; startsAt: Date; endsAt: Date; title: string; teacher: string; student: string; place: string | null }>(tx, sql`
        select s.id, s.teacher_id as "teacherId", s.student_id as "studentId", s.starts_at as "startsAt", s.ends_at as "endsAt", m.title, u.name as teacher, st.name as student, w.place
        from meeting_slots s join meeting_days m on m.id = s.meeting_id join users u on u.id = s.teacher_id join students st on st.id = s.student_id join meeting_windows w on w.id = s.window_id
        where s.id = ${slotId}::uuid and s.state = 'booked' and m.state not in ('draft', 'cancelled')`) : [];
      const mine = !s ? false : this.isFamily ? (await kidOfLogin(tx, this.ctx.userId))?.id === s.studentId : s.teacherId === this.ctx.userId || this.canManage;
      if (!s || !mine) throw new NotFoundError("Booking");
      return s;
    });
  }

  /** The family's page: the login's own child, only the teachers who teach them, only times that are free. */
  async forFamily(meetingId: string): Promise<BookingView> {
    return this.read("use", async (tx) => {
      if (!this.isFamily) throw new ForbiddenError("This page is for families. Staff open a meeting from the list.");
      const m = await this.meeting(tx, meetingId);
      const kid = await kidOfLogin(tx, this.ctx.userId);
      if (!kid || !(await audienceMatches(tx, m.audience, { userId: this.ctx.userId, studentIds: [kid.id] })) || m.state === "draft") throw new NotFoundError("Meeting");
      await this.seen(tx, m.id);
      const why = this.gate(m, false);
      return this.view(tx, m, [kid], !why, why);
    });
  }

  /** The same page for staff booking on a family's behalf. */
  async forStudent(meetingId: string, studentId: string): Promise<BookingView> {
    return this.read("manage", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const kid = await this.invited(tx, m, studentId);
      const why = this.gate(m, true);
      return this.view(tx, m, [kid], !why, why);
    });
  }

  /** Children of the audience, for the "book for a family" search. */
  async invitedChildren(meetingId: string): Promise<{ id: string; name: string; label: string }[]> {
    return this.read("manage", async (tx) => (await resolveAudience(tx, (await this.meeting(tx, meetingId)).audience))
      .filter((r) => r.studentId).map((r) => ({ id: r.studentId!, name: r.name, label: r.label })));
  }

  private async invited(tx: Tx, m: Meeting, studentId: string): Promise<Kid> {
    const kid = await kidById(tx, studentId);
    if (!kid || !(await this.families(tx, m)).some((f) => f.studentId === kid.id)) throw new ValidationError({ studentId: "This child is not invited to this meeting" });
    return kid;
  }

  private async view(tx: Tx, m: Meeting, kids: Kid[], can: boolean, why: string | null): Promise<BookingView> {
    const now = this.now();
    const views: KidView[] = [];
    for (const kid of kids) {
      const teachers = await teachersOf(tx, kid.id);
      const ids = teachers.map((t) => t.teacherId);
      const wins = await rows<{ teacherId: string; place: string | null; videoUrl: string | null }>(tx, sql`select distinct on (teacher_id) teacher_id as "teacherId", place, video_url as "videoUrl"
        from meeting_windows where meeting_id = ${m.id}::uuid and teacher_id in (${idList(ids)}) order by teacher_id, starts_at`);
      const mine = await rows<BookedView>(tx, sql`select s.id as "slotId", s.teacher_id as "teacherId", u.name as "teacherName", s.starts_at as "startsAt", s.ends_at as "endsAt", w.place, w.video_url as "videoUrl", s.visit,
          case when s.ends_at <= ${ts(now)} then s.shared_remark end as remark
        from meeting_slots s join users u on u.id = s.teacher_id join meeting_windows w on w.id = s.window_id
        where s.meeting_id = ${m.id}::uuid and s.state = 'booked' and s.student_id = ${kid.id}::uuid order by s.starts_at`);
      const free = ids.length ? await rows<{ id: string; teacherId: string; startsAt: Date; endsAt: Date }>(tx, sql`select id, teacher_id as "teacherId", starts_at as "startsAt", ends_at as "endsAt"
        from meeting_slots where meeting_id = ${m.id}::uuid and state = 'open' and starts_at > ${ts(now)} and teacher_id in (${idList(ids)}) order by starts_at`) : [];
      const family = [kid.id, ...(await siblingIds(tx, kid.id))];
      const busy = await rows<{ startsAt: Date; endsAt: Date; teacherId: string; studentId: string }>(tx, sql`select s.starts_at as "startsAt", s.ends_at as "endsAt", s.teacher_id as "teacherId", s.student_id as "studentId"
        from meeting_slots s join meeting_days md on md.id = s.meeting_id and md.state <> 'cancelled' where s.state = 'booked' and s.student_id in (${idList(family)}) and s.ends_at > ${ts(now)}`);
      const waits = new Set((await tx.select({ t: meetingWaits.teacherId }).from(meetingWaits).where(and(eq(meetingWaits.meetingId, m.id), eq(meetingWaits.studentId, kid.id)))).map((w) => w.t));
      const listed: TeacherView[] = wins.map((w) => {
        const t = teachers.find((x) => x.teacherId === w.teacherId) as Teacher;
        // Changing a booking with this teacher frees its own time, so it must not block the list.
        const others = busy.filter((b) => !(b.studentId === kid.id && b.teacherId === t.teacherId));
        return {
          teacherId: t.teacherId, name: t.name, why: t.why, place: w.place, videoUrl: w.videoUrl, waiting: waits.has(t.teacherId),
          booked: mine.find((b) => b.teacherId === t.teacherId) ?? null,
          slots: free.filter((s) => s.teacherId === t.teacherId && !others.some((b) => b.startsAt < s.endsAt && b.endsAt > s.startsAt)),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      views.push({ student: { id: kid.id, name: kid.name, label: kid.label }, used: mine.length, limit: m.perFamily, booked: mine, teachers: listed, notInMeeting: teachers.filter((t) => !wins.some((w) => w.teacherId === t.teacherId)).map((t) => t.name) });
    }
    return {
      meeting: { id: m.id, title: m.title, note: m.note, state: m.state, opensAt: m.opensAt, closesAt: m.closesAt, perFamily: m.perFamily, cancelReason: m.cancelReason },
      kids: views, can, why,
    };
  }

  // ---- changing ----

  /** Who the booking is for: a family's own child, or the child staff picked. */
  private async actingFor(tx: Tx, m: Meeting, studentId?: string): Promise<{ kid: Kid; staff: boolean }> {
    if (this.isFamily) {
      const kid = await kidOfLogin(tx, this.ctx.userId);
      if (!kid) throw new ForbiddenError("Your child is not active at the school, so nothing can be booked.");
      if (studentId && studentId !== kid.id) throw new ForbiddenError();
      if (!(await audienceMatches(tx, m.audience, { userId: this.ctx.userId, studentIds: [kid.id] }))) throw new NotFoundError("Meeting");
      return { kid, staff: false };
    }
    if (!this.canManage) throw new ForbiddenError("Only the school office can book for a family.");
    if (!studentId) throw new ValidationError({ studentId: "Pick the child" });
    return { kid: await this.invited(tx, m, studentId), staff: true };
  }

  /** The time rule for changing a booking, then the slot must still be in the future. */
  private mayChange(m: Meeting, staff: boolean, startsAt: Date) {
    const why = this.gate(m, staff);
    if (why) throw new ConflictError(why);
    if (startsAt <= this.now()) throw new ConflictError("That time has already passed.");
  }

  /**
   * Take a free slot, optionally giving up `replacing` in the same transaction. The family lock serialises one family's changes;
   * the conditional update serialises everyone on the same slot, so of 20 families only one wins and the rest hear TAKEN.
   */
  private async place(tx: Tx, m: Meeting, kid: Kid, staff: boolean, slotId: string, replacing?: string) {
    await lockFamily(tx, kid.id);
    const [slot] = await rows<{ id: string; teacherId: string; startsAt: Date; endsAt: Date; state: string; meetingId: string; teacherName: string }>(tx, sql`
      select s.id, s.teacher_id as "teacherId", s.starts_at as "startsAt", s.ends_at as "endsAt", s.state, s.meeting_id as "meetingId", u.name as "teacherName"
      from meeting_slots s join users u on u.id = s.teacher_id where s.id = ${slotId}::uuid and s.meeting_id = ${m.id}::uuid`);
    if (!slot) throw new NotFoundError("Time");
    this.mayChange(m, staff, slot.startsAt);
    if (slot.state !== "open") throw new ConflictError(TAKEN);
    if (!(await teachersOf(tx, kid.id)).some((t) => t.teacherId === slot.teacherId)) throw new ForbiddenError(`${slot.teacherName} does not teach ${kid.name}.`);

    if (replacing) {
      const old = await this.ownSlot(tx, m, kid, replacing);
      this.mayChange(m, staff, old.startsAt);
      await this.release(tx, replacing);
    }
    const held = await rows<{ id: string; teacherId: string }>(tx, sql`select id, teacher_id as "teacherId" from meeting_slots where meeting_id = ${m.id}::uuid and state = 'booked' and student_id = ${kid.id}::uuid`);
    if (held.some((h) => h.teacherId === slot.teacherId)) throw new ConflictError(`${kid.name} already has a time with ${slot.teacherName}. Change or cancel it instead.`);
    if (held.length >= m.perFamily) throw new ConflictError(`You can book ${plural(m.perFamily, "teacher")} for one child. Cancel one to pick another.`);
    const [clash] = await clashFor(tx, [kid.id, ...(await siblingIds(tx, kid.id))], slot);
    if (clash) throw new ConflictError(clash.studentId === kid.id
      ? `${kid.name} already has a meeting with ${clash.teacherName} at that time. Pick another time.`
      : `${clash.studentName} (brother or sister) already has a meeting with ${clash.teacherName} at that time. Pick another time.`);

    const [won] = await tx.update(meetingSlots).set({ state: "booked", studentId: kid.id, bookedBy: this.ctx.userId, bookedAt: this.now(), visit: null })
      .where(and(eq(meetingSlots.id, slotId), eq(meetingSlots.state, "open"))).returning({ id: meetingSlots.id });
    if (!won) throw new ConflictError(TAKEN);
    await this.dropWait(tx, m.id, slot.teacherId, kid.id);
    if (kid.userId) {
      if (await this.familyFull(tx, m, kid.userId)) await this.notices.booked(tx, m.id, kid.userId);
      if (staff) await this.notices.changed(tx, m, [kid.userId], `A time was booked for ${kid.name}`, `${slot.teacherName}, ${when(slot.startsAt)}.`);
    }
    return slot;
  }

  /** Every invited child of this login holds as many times as the meeting lets them (or all their teachers): the "book a time" row has done its job. */
  private async familyFull(tx: Tx, m: Meeting, userId: string): Promise<boolean> {
    for (const f of (await this.families(tx, m)).filter((x) => x.userId === userId && x.studentId)) {
      const ids = (await teachersOf(tx, f.studentId!)).map((t) => t.teacherId);
      if (!ids.length) continue;
      const [w] = await rows<{ teachers: number; held: number }>(tx, sql`select
        (select count(distinct teacher_id)::int from meeting_windows where meeting_id = ${m.id}::uuid and teacher_id in (${idList(ids)})) as teachers,
        (select count(*)::int from meeting_slots where meeting_id = ${m.id}::uuid and state = 'booked' and student_id = ${f.studentId}::uuid) as held`);
      if (w!.held < Math.min(m.perFamily, w!.teachers)) return false;
    }
    return true;
  }

  private async ownSlot(tx: Tx, m: Meeting, kid: Kid, slotId: string) {
    const [s] = await tx.select().from(meetingSlots).where(and(eq(meetingSlots.id, slotId), eq(meetingSlots.meetingId, m.id), eq(meetingSlots.studentId, kid.id), eq(meetingSlots.state, "booked"))).limit(1);
    if (!s) throw new NotFoundError("Booking");
    return s;
  }

  private async release(tx: Tx, slotId: string) {
    await tx.update(meetingSlots).set({ state: "open", studentId: null, bookedBy: null, bookedAt: null, visit: null, remindedDay: false, remindedHour: false }).where(eq(meetingSlots.id, slotId));
  }

  /** The unique indexes are the last guard: if two requests still got through, the loser gets the same friendly answer. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (e) { if (pgErrorCode(e) === "23505") throw new ConflictError(TAKEN); throw e; }
  }

  async book(meetingId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(bookInput, input);
    return this.guarded(() => this.write("use", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const { kid, staff } = await this.actingFor(tx, m, data.studentId);
      const slot = await this.place(tx, m, kid, staff, data.slotId);
      return { slotId: slot.id, studentName: kid.name, teacher: slot.teacherName, startsAt: slot.startsAt };
    }, (r) => ({ action: "book", entity: "Meeting", entityId: meetingId, summary: `Booked ${r.studentName} with ${r.teacher} at ${when(r.startsAt)}` })));
  }

  /** Move a booking to another time (any teacher the child may book) in one step: if the new time is gone, the old one stays. */
  async changeBooking(meetingId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(changeBookingInput, input);
    return this.guarded(() => this.write("use", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const { kid, staff } = await this.actingFor(tx, m, data.studentId);
      const slot = await this.place(tx, m, kid, staff, data.toSlotId, data.fromSlotId);
      const [old] = await tx.select({ teacherId: meetingSlots.teacherId }).from(meetingSlots).where(eq(meetingSlots.id, data.fromSlotId));
      if (old) await this.offerFreed(tx, m, old.teacherId, 1);
      return { slotId: slot.id, studentName: kid.name, teacher: slot.teacherName, startsAt: slot.startsAt };
    }, (r) => ({ action: "change_booking", entity: "Meeting", entityId: meetingId, summary: `Moved ${r.studentName} to ${r.teacher} at ${when(r.startsAt)}` })));
  }

  async cancelBooking(meetingId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(bookInput, input);
    return this.write("use", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const { kid, staff } = await this.actingFor(tx, m, data.studentId);
      await lockFamily(tx, kid.id);
      const s = await this.ownSlot(tx, m, kid, data.slotId);
      this.mayChange(m, staff, s.startsAt);
      await this.release(tx, s.id);
      const [t] = await rows<{ name: string }>(tx, sql`select name from users where id = ${s.teacherId}::uuid`);
      if (staff && kid.userId) await this.notices.changed(tx, m, [kid.userId], `A meeting time was cancelled for ${kid.name}`, `${t?.name ?? "The teacher"}, ${when(s.startsAt)}. Open the meeting to pick another.`);
      if (m.state === "open") await this.offerFreed(tx, m, s.teacherId, 1);
      return { slotId: s.id, studentName: kid.name, startsAt: s.startsAt };
    }, (r) => ({ action: "cancel_booking", entity: "Meeting", entityId: meetingId, summary: `Cancelled ${r.studentName}'s time at ${when(r.startsAt)}` }));
  }

  // ---- waiting list ----

  /** Join the line for a teacher whose times are all taken. The first in line is told when a time frees up, once. */
  async joinWaitlist(meetingId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(waitInput, input);
    return this.write("use", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const { kid, staff } = await this.actingFor(tx, m, data.studentId);
      const why = this.gate(m, staff);
      if (why) throw new ConflictError(why);
      if (!(await teachersOf(tx, kid.id)).some((t) => t.teacherId === data.teacherId)) throw new ForbiddenError("This teacher does not teach this child.");
      const [free] = await rows<{ n: number; mine: number; total: number }>(tx, sql`select count(*) filter (where state in ('open', 'booked'))::int as total, count(*) filter (where state = 'open' and starts_at > now())::int as n, count(*) filter (where state = 'booked' and student_id = ${kid.id}::uuid)::int as mine
        from meeting_slots where meeting_id = ${m.id}::uuid and teacher_id = ${data.teacherId}::uuid`);
      if (!free?.total) throw new ConflictError("This teacher has no times in this meeting.");
      if (free?.mine) throw new ConflictError("This child already has a time with this teacher.");
      if (free?.n) throw new ConflictError("This teacher still has free times. Pick one of them.");
      const [last] = await rows<{ n: number }>(tx, sql`select coalesce(max(sort), 0)::int as n from meeting_waits where meeting_id = ${m.id}::uuid and teacher_id = ${data.teacherId}::uuid`);
      await tx.insert(meetingWaits).values({ schoolId: this.ctx.schoolId, meetingId: m.id, teacherId: data.teacherId, studentId: kid.id, sort: (last?.n ?? 0) + 1 }).onConflictDoNothing();
      return { studentName: kid.name };
    }, (r) => ({ action: "wait", entity: "Meeting", entityId: meetingId, summary: `${r.studentName} joined a waiting list` }));
  }

  async leaveWaitlist(meetingId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(waitInput, input);
    return this.write("use", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const { kid } = await this.actingFor(tx, m, data.studentId);
      await this.dropWait(tx, m.id, data.teacherId, kid.id);
      return { studentName: kid.name };
    }, (r) => ({ action: "unwait", entity: "Meeting", entityId: meetingId, summary: `${r.studentName} left a waiting list` }));
  }
}
