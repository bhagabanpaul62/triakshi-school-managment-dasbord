import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, pgErrorCode } from "@smw/feature-kit";
import { csvText, PdfBuilder, slugOf } from "@smw/integrations";
import { teacherSections } from "@smw/feature-notifications/audience";
import { idList, rows, ts, type Meeting } from "./access";
import { MeetingBase } from "./base";
import type { MeetingState, VisitState } from "./constants";
import { noteInput, visitInput, walkInInput } from "./inputs";
import { dayOf, when } from "./format";
import { istDay } from "./rules";
import { meetingSlots } from "./schema";
import { clock } from "@smw/feature-kit/words";

export interface DayRow {
  slotId: string; startsAt: Date; endsAt: Date; studentId: string; studentName: string; studentLabel: string | null; walkIn: boolean;
  visit: VisitState | null; privateNote: string | null; sharedRemark: string | null; isNow: boolean;
  /** A mark is allowed from the slot's own day onward. */
  canMark: boolean;
}
export interface DayView {
  meeting: { id: string; title: string; state: MeetingState };
  teacher: { id: string; name: string }; place: string | null; videoUrl: string | null;
  /** The day this list is for ("YYYY-MM-DD", India), and every day this teacher has a time. */
  date: string; dates: string[]; isToday: boolean;
  rows: DayRow[]; free: number;
  counts: { booked: number; came: number; late: number; missed: number; unmarked: number };
  /** The slot to look at next: the one running now, else the first not marked yet. Only on the day itself. */
  nextSlotId: string | null; now: Date;
  /** A manager can switch to another teacher's list. */
  teachers: { id: string; name: string }[];
  privateNotesHidden: boolean;
}
export interface NotCameRow { slotId: string; studentId: string; studentName: string; studentLabel: string | null; phone: string | null; teacherName: string; startsAt: Date; status: "Did not come" | "Not marked" }

/** The teacher's day: who is next, who came, notes. A teacher sees only their own list; a manager sees every teacher's. */
export class DayService extends MeetingBase {
  private get support() { return !!this.ctx.supportStaffId; }

  private guardStaff() {
    if (this.isFamily) throw new ForbiddenError("This page is for teachers.");
  }

  /** `teacherId` is for managers; a teacher always gets their own list. `date` picks one of the teacher's days; the default is today, else the next day, else the last. */
  async day(meetingId: string, teacherId?: string, date?: string): Promise<DayView> {
    return this.read("use", async (tx) => {
      this.guardStaff();
      const m = await this.meeting(tx, meetingId);
      const who = this.canManage && teacherId ? teacherId : this.ctx.userId;
      if (who !== this.ctx.userId && !this.canManage) throw new ForbiddenError();
      await this.seen(tx, m.id);
      if (m.state === "draft") throw new ConflictError("Booking has not opened yet, so there is no list.");
      if (m.state === "cancelled") throw new ConflictError(`This meeting was cancelled${m.cancelReason ? `: ${m.cancelReason}` : "."}`);
      const wins = await rows<{ name: string; day: string; place: string | null; videoUrl: string | null }>(tx, sql`select u.name, w.day::text as day, w.place, w.video_url as "videoUrl"
        from meeting_windows w join users u on u.id = w.teacher_id where w.meeting_id = ${meetingId}::uuid and w.teacher_id = ${who}::uuid order by w.day, w.starts_at`);
      const teachers = this.canManage ? await rows<{ id: string; name: string }>(tx, sql`select distinct u.id, u.name from meeting_windows w join users u on u.id = w.teacher_id where w.meeting_id = ${meetingId}::uuid order by u.name`) : [];
      if (!wins.length) throw new NotFoundError("Meeting");
      const now = this.now(), today = istDay(now);
      const dates = [...new Set(wins.map((w) => w.day))];
      const pick = date && dates.includes(date) ? date : dates.includes(today) ? today : dates.find((d) => d > today) ?? dates.at(-1)!;
      const win = wins.find((w) => w.day === pick)!;
      const found = await rows<Omit<DayRow, "isNow" | "canMark">>(tx, sql`
        select s.id as "slotId", s.starts_at as "startsAt", s.ends_at as "endsAt", s.student_id as "studentId", st.name as "studentName", coalesce(c.name || coalesce('-' || sec.name, ''), null) as "studentLabel",
          s.walk_in as "walkIn", s.visit, ${this.support ? sql`null` : sql`s.private_note`} as "privateNote", s.shared_remark as "sharedRemark"
        from meeting_slots s join students st on st.id = s.student_id left join classes c on c.id = st.class_id left join sections sec on sec.id = st.section_id
        where s.meeting_id = ${meetingId}::uuid and s.teacher_id = ${who}::uuid and s.state = 'booked' and (s.starts_at at time zone 'Asia/Kolkata')::date = ${pick}::date order by s.starts_at`);
      const [free] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from meeting_slots where meeting_id = ${meetingId}::uuid and teacher_id = ${who}::uuid and state = 'open' and starts_at > ${ts(now)}
        and (starts_at at time zone 'Asia/Kolkata')::date = ${pick}::date`);
      const list = found.map((r) => ({ ...r, isNow: r.startsAt <= now && now < r.endsAt, canMark: istDay(r.startsAt) <= today }));
      const count = (v: VisitState) => list.filter((r) => r.visit === v).length;
      return {
        meeting: { id: m.id, title: m.title, state: m.state }, teacher: { id: who, name: win.name }, place: win.place, videoUrl: win.videoUrl,
        date: pick, dates, isToday: pick === today,
        rows: list, free: free?.n ?? 0,
        counts: { booked: list.length, came: count("came"), late: count("late"), missed: count("missed"), unmarked: list.filter((r) => !r.visit).length },
        nextSlotId: pick === today ? (list.find((r) => r.isNow && !r.visit) ?? list.find((r) => !r.visit && r.endsAt > now))?.slotId ?? null : null,
        now, teachers, privateNotesHidden: this.support,
      };
    });
  }

  private async ownSlot(tx: Tx, slotId: string) {
    this.guardStaff();
    const [s] = /^[0-9a-f-]{36}$/i.test(slotId) ? await tx.select().from(meetingSlots).where(and(eq(meetingSlots.id, slotId), eq(meetingSlots.state, "booked"))).limit(1) : [];
    if (!s || (s.teacherId !== this.ctx.userId && !this.canManage)) throw new NotFoundError("Booking");
    const m = await this.meeting(tx, s.meetingId);
    if (m.state === "draft" || m.state === "cancelled") throw new ConflictError("This meeting is not running.");
    return { s, m };
  }

  /** Came, late, missed, or null to clear the mark. Marks open on the slot's own day. */
  async mark(slotId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(visitInput, input);
    return this.write("use", async (tx) => {
      const { s } = await this.ownSlot(tx, slotId);
      if (data.visit && istDay(s.startsAt) > istDay(this.now())) throw new ConflictError(`Opens on ${dayOf(s.startsAt)}. Mark it when the family arrives.`);
      await tx.update(meetingSlots).set({ visit: data.visit ?? null }).where(eq(meetingSlots.id, slotId));
      return { slotId, visit: data.visit ?? null, startsAt: s.startsAt };
    }, (r) => ({ action: "mark", entity: "Meeting", entityId: slotId, summary: `Marked the ${clock(r.startsAt)} time as ${r.visit ?? "not marked"}` }));
  }

  /** The private note stays with staff. The shared remark reaches the family once the time is over. Support sessions never touch private notes. */
  async saveNotes(slotId: string, input: unknown) {
    this.authorize("use", "write");
    const data = this.parse(noteInput, input);
    if (data.privateNote !== undefined && this.support) throw new ForbiddenError("Support sessions cannot read or write private notes.");
    return this.write("use", async (tx) => {
      const { s } = await this.ownSlot(tx, slotId);
      const set: Partial<typeof meetingSlots.$inferInsert> = {};
      if (data.privateNote !== undefined) set.privateNote = data.privateNote || null;
      if (data.sharedRemark !== undefined) set.sharedRemark = data.sharedRemark || null;
      if (Object.keys(set).length) await tx.update(meetingSlots).set(set).where(eq(meetingSlots.id, slotId));
      return { slotId, startsAt: s.startsAt };
    }, (r) => ({ action: "notes", entity: "Meeting", entityId: slotId, summary: `Saved notes for the ${clock(r.startsAt)} time` }));
  }

  /** A family that walked in: a slot starting now inside the teacher's window of today, already marked as came. */
  async walkIn(meetingId: string, input: unknown): Promise<{ slotId: string }> {
    this.authorize("use", "write");
    const data = this.parse(walkInInput, input);
    try {
      return await this.write("use", async (tx) => {
        this.guardStaff();
        const m = await this.meeting(tx, meetingId);
        if (m.state !== "open" && m.state !== "closed") throw new ConflictError("Walk-ins can be added while the meeting is running.");
        const teacherId = this.canManage && data.teacherId ? data.teacherId : this.ctx.userId;
        const now = new Date(Math.floor(this.now().getTime() / 60_000) * 60_000);
        const [win] = await rows<{ id: string }>(tx, sql`select id from meeting_windows where meeting_id = ${meetingId}::uuid and teacher_id = ${teacherId}::uuid and day = ${istDay(now)}::date
          order by abs(extract(epoch from (starts_at - ${ts(now)}))) limit 1`);
        if (!win) throw new ConflictError("There is no meeting time for this teacher today.");
        const kid = (await this.walkInKids(tx, m, teacherId)).get(data.studentId);
        if (!kid) throw new ConflictError("This child is not on this meeting's list and is not in your classes. Ask the school office to add them.");
        const [row] = await tx.insert(meetingSlots).values({
          schoolId: this.ctx.schoolId, meetingId, windowId: win.id, teacherId, startsAt: now, endsAt: new Date(now.getTime() + m.slotMinutes * 60_000), state: "booked",
          studentId: kid.id, bookedBy: this.ctx.userId, bookedAt: now, walkIn: true, visit: "came",
        }).returning({ id: meetingSlots.id });
        await this.audit(tx, { action: "walk_in", entity: "Meeting", entityId: meetingId, summary: `Added walk-in ${kid.name} at ${when(now)}` });
        return { slotId: row!.id };
      });
    } catch (e) {
      if (pgErrorCode(e) === "23505") throw new ConflictError("This child already has a time with this teacher or at this hour. Mark that one instead.");
      throw e;
    }
  }

  /** Active children a walk-in may be: invited by the meeting's audience, or in one of this teacher's own sections. */
  private async walkInKids(tx: Tx, m: Meeting, teacherId: string): Promise<Map<string, { id: string; name: string; label: string }>> {
    const own = await teacherSections(tx, teacherId);
    const invited = (await this.families(tx, m)).map((f) => ({ id: f.studentId!, name: f.name, label: f.label }));
    const mine = own.length ? await rows<{ id: string; name: string; label: string }>(tx, sql`select s.id::text as id, s.name, coalesce(c.name || coalesce('-' || sec.name, ''), 'Student') as label
      from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id where s.status = 'active' and s.section_id in (${idList(own)})`) : [];
    return new Map([...invited, ...mine].map((k) => [k.id, k]));
  }

  /** Children the walk-in can be picked from (a manager asks for one teacher's). */
  async walkInChoices(meetingId: string, teacherId?: string): Promise<{ id: string; name: string; label: string }[]> {
    return this.read("use", async (tx) => {
      this.guardStaff();
      const m = await this.meeting(tx, meetingId);
      return [...(await this.walkInKids(tx, m, this.canManage && teacherId ? teacherId : this.ctx.userId)).values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ---- after ----

  /** Families that did not come, and times nobody marked once they ended. A teacher sees their own; a manager sees all. */
  async notCame(meetingId: string): Promise<NotCameRow[]> {
    return this.read("use", async (tx) => {
      this.guardStaff();
      await this.meeting(tx, meetingId);
      return rows<NotCameRow>(tx, sql`
        select s.id as "slotId", s.student_id as "studentId", st.name as "studentName", coalesce(c.name || coalesce('-' || sec.name, ''), null) as "studentLabel", st.phone, u.name as "teacherName", s.starts_at as "startsAt",
          case when s.visit = 'missed' then 'Did not come' else 'Not marked' end as status
        from meeting_slots s join students st on st.id = s.student_id join users u on u.id = s.teacher_id left join classes c on c.id = st.class_id left join sections sec on sec.id = st.section_id
        where s.meeting_id = ${meetingId}::uuid and s.state = 'booked' and (s.visit = 'missed' or (s.visit is null and s.ends_at < ${ts(this.now())}))
          ${this.canManage ? sql`` : sql`and s.teacher_id = ${this.ctx.userId}::uuid`} order by s.starts_at, st.name`);
    });
  }

  async notCameCsv(meetingId: string): Promise<{ csv: string; fileName: string }> {
    const list = await this.notCame(meetingId);
    const title = await this.read("use", async (tx) => (await this.meeting(tx, meetingId)).title);
    const lines = [["Child", "Class", "Phone", "Teacher", "Time", "Status"], ...list.map((r) => [r.studentName, r.studentLabel, r.phone, r.teacherName, when(r.startsAt), r.status])];
    return { csv: csvText(lines), fileName: `not-came-${slugOf(title, "meeting")}.csv` };
  }

  /** One teacher's list on paper: time, child, class, a box to tick. No private notes. */
  async teacherSheetPdf(meetingId: string, teacherId?: string, date?: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const v = await this.day(meetingId, teacherId, date);
    const school = await this.read("use", async (tx) => (await rows<{ name: string }>(tx, sql`select name from schools limit 1`))[0]?.name ?? "School");
    const pdf = await PdfBuilder.create();
    await pdf.need([school, v.meeting.title, v.teacher.name, ...v.rows.flatMap((r) => [r.studentName, r.studentLabel ?? ""])]);
    pdf.header({ orgName: school, title: `Meeting list: ${v.teacher.name}`, rightLines: [v.meeting.title, v.place ?? ""] });
    if (!v.rows.length) pdf.text("Nobody has booked a time yet.");
    else pdf.table({
      columns: [{ label: "Time", width: 90 }, { label: "Child", width: 190 }, { label: "Class", width: 90 }, { label: "Came", width: 60 }, { label: "Notes", width: 69 }],
      rows: v.rows.map((r) => [`${clock(r.startsAt)}${r.walkIn ? " (walk-in)" : ""}`, r.studentName, r.studentLabel ?? "", r.visit === "came" ? "Yes" : r.visit === "late" ? "Late" : r.visit === "missed" ? "No" : "[  ]", ""]),
    });
    pdf.space(6).text(`${v.counts.booked} booked, ${v.free} free times left.`, { size: 9, color: [0.4, 0.4, 0.45] });
    return { bytes: await pdf.save(), fileName: `meeting-list-${slugOf(v.teacher.name, "teacher")}.pdf` };
  }

  /** Where each teacher sits and when: for the door of the hall. Managers only. */
  async roomSheetPdf(meetingId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    if (!this.canManage) throw new ForbiddenError("Only the school office prints the room sheet.");
    const { title, list, school } = await this.read("manage", async (tx) => {
      const m = await this.meeting(tx, meetingId);
      const list = await rows<{ day: string; place: string | null; teacher: string; startsAt: Date; endsAt: Date; booked: number; total: number }>(tx, sql`
        select w.day::text as day, w.place, u.name as teacher, w.starts_at as "startsAt", w.ends_at as "endsAt",
          (select count(*)::int from meeting_slots s where s.window_id = w.id and s.state = 'booked') as booked,
          (select count(*)::int from meeting_slots s where s.window_id = w.id and s.state in ('open', 'booked')) as total
        from meeting_windows w join users u on u.id = w.teacher_id where w.meeting_id = ${meetingId}::uuid order by w.day, w.place nulls last, w.starts_at, u.name`);
      return { title: m.title, list, school: (await rows<{ name: string }>(tx, sql`select name from schools limit 1`))[0]?.name ?? "School" };
    });
    const pdf = await PdfBuilder.create();
    await pdf.need([school, title, ...list.flatMap((r) => [r.teacher, r.place ?? ""])]);
    pdf.header({ orgName: school, title: `Room sheet: ${title}`, rightLines: [] });
    if (!list.length) pdf.text("No teacher times yet.");
    else pdf.table({
      columns: [{ label: "Day", width: 80 }, { label: "Room", width: 120 }, { label: "Teacher", width: 150 }, { label: "Time", width: 100 }, { label: "Booked", width: 49, align: "right" }],
      rows: list.map((r) => [r.day, r.place ?? "-", r.teacher, `${clock(r.startsAt)} to ${clock(r.endsAt)}`, `${r.booked}/${r.total}`]),
    });
    return { bytes: await pdf.save(), fileName: `room-sheet-${slugOf(title, "meeting")}.pdf` };
  }
}
