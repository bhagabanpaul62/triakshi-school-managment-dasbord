import { eq, sql } from "drizzle-orm";
import { schools, withConsole } from "@smw/db";
import { systemCtx, type Ctx } from "@smw/feature-kit";
import { rows, ts } from "./access";
import { MeetingBase } from "./base";
import { when } from "./format";
import { istDay } from "./rules";
import { plural } from "@smw/feature-kit/words";

const HOUR_MS = 3_600_000;

interface Due { id: string; meetingId: string; startsAt: Date; teacherId: string; teacherName: string; studentName: string; userId: string | null }

/** The work the scheduler does for one school: reminders, then closing and finishing meetings. */
export class MeetingSchedule extends MeetingBase {
  constructor(ctx: Ctx, private readonly at: Date = new Date()) { super(ctx); }
  protected override now() { return this.at; }

  /**
   * Day before (from 17:00 India time) and one hour before. The flags are flipped in the same statement that picks the slots,
   * so each reminder goes out once even if two runs overlap.
   */
  reminders(): Promise<number> {
    return this.write("manage", async (tx) => {
      const now = this.now();
      const tomorrow = istDay(new Date(now.getTime() + 24 * HOUR_MS));
      const evening = new Date(now.getTime() + 330 * 60_000).getUTCHours() >= 17;
      const hourAhead = ts(new Date(now.getTime() + HOUR_MS));
      const picked = await rows<Due & { kind: "day" | "hour" }>(tx, sql`
        update meeting_slots s set reminded_hour = reminded_hour or (s.starts_at <= ${hourAhead}),
          reminded_day = true
        from meeting_days md, users u, students st
        where md.id = s.meeting_id and md.state in ('open', 'closed') and s.state = 'booked' and s.starts_at > ${ts(now)} and u.id = s.teacher_id and st.id = s.student_id
          and ((not s.reminded_hour and s.starts_at <= ${hourAhead})
            or (${evening} and not s.reminded_day and (s.starts_at at time zone 'Asia/Kolkata')::date = ${tomorrow}::date))
        returning s.id, s.meeting_id as "meetingId", s.starts_at as "startsAt", s.teacher_id as "teacherId", u.name as "teacherName", st.name as "studentName", st.user_id as "userId",
          case when s.starts_at <= ${hourAhead} then 'hour' else 'day' end as kind`);
      const perTeacher = new Map<string, { n: number; meetingId: string }>();
      for (const d of picked) {
        if (d.userId) await this.notices.reminder(tx, { id: d.meetingId }, d.userId, `Meeting with ${d.teacherName} ${d.kind === "hour" ? "in about an hour" : "tomorrow"}`, `${d.studentName}, ${when(d.startsAt)}.`);
        if (d.kind === "day") perTeacher.set(d.teacherId, { n: (perTeacher.get(d.teacherId)?.n ?? 0) + 1, meetingId: d.meetingId });
      }
      for (const [teacherId, t] of perTeacher) await this.notices.reminder(tx, { id: t.meetingId }, teacherId, `${plural(t.n, "family is", "families are")} booked with you tomorrow`, "Open the meeting for your list.");
      return picked.length;
    });
  }

  /** Booking closes at its closing time; a meeting is done once its last time is over; a leaver's time is freed. */
  tidy(): Promise<number> {
    return this.write("manage", async (tx) => {
      const now = this.now();
      const closed = await tx.execute(sql`update meeting_days set state = 'closed', updated_at = now() where state = 'open' and closes_at <= ${ts(now)} returning id`);
      const done = await tx.execute(sql`update meeting_days md set state = 'done', updated_at = now() where md.state in ('open', 'closed')
        and exists (select 1 from meeting_windows w where w.meeting_id = md.id) and not exists (select 1 from meeting_windows w where w.meeting_id = md.id and w.ends_at > ${ts(now)}) returning id`);
      // A child who left no longer needs their time: give it back so another family can take it.
      const freed = await tx.execute(sql`update meeting_slots set state = 'open', student_id = null, booked_by = null, booked_at = null, visit = null, reminded_day = false, reminded_hour = false
        where state = 'booked' and not walk_in and starts_at > ${ts(now)} and student_id in (select id from students where status <> 'active') returning id`);
      return [...closed].length + [...done].length + [...freed].length;
    });
  }
}

/** Every active school, one at a time; one failing does not stop the rest, and the run fails at the end so the queue retries. */
export async function eachSchool<T>(run: (ctx: Ctx) => Promise<T>): Promise<void> {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try { await run(systemCtx(id, ["meetings"])); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "meetings job failed", schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`${failed} of ${ids.length} schools failed`);
}

