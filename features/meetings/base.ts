import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService } from "@smw/feature-kit";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { rows, type Meeting } from "./access";
import meetingsFeature from "./feature";
import { MeetingNotices } from "./notices";
import { meetingDays, meetingWaits } from "./schema";

export type Perm = keyof typeof meetingsFeature.permissions;

/** What every meetings service shares: the feature, who the caller is, the clock and the notices. */
export abstract class MeetingBase extends SchoolService<Perm> {
  protected feature = meetingsFeature;
  protected readonly notices = new MeetingNotices(this.ctx);

  /** The clock, so a test or a seed can stand somewhere else in time. */
  protected now(): Date { return new Date(); }
  /** A family login: the student's own. */
  protected get isFamily() { return this.ctx.role === "student"; }
  /** Staff who set meetings up and see every teacher's day. */
  get canManage() { return this.can("manage"); }

  protected authorize(permission: Perm, mode: "read" | "write") {
    if (this.ctx.role === "parent") throw new ForbiddenError("Parent logins are retired. Sign in with the student login.");
    super.authorize(permission, mode);
  }

  protected async meeting(tx: Tx, id: string): Promise<Meeting> {
    const [m] = z.uuid().safeParse(id).success ? await tx.select().from(meetingDays).where(eq(meetingDays.id, id)).limit(1) : [];
    if (!m) throw new NotFoundError("Meeting");
    return m;
  }

  /** The meeting page was opened: its bell rows are read. A "book a time" action stays open until the family books. */
  protected async seen(tx: Tx, meetingId: string) {
    await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "meeting", id: meetingId }, this.ctx);
  }

  /** Every active family login this meeting's audience reaches, once each. */
  protected async families(tx: Tx, m: Pick<Meeting, "audience">) {
    const reached = await resolveAudience(tx, m.audience);
    return reached.filter((r) => r.studentId);
  }

  /** Next in line for a teacher with free time: one notice each, never twice. Returns how many were told. */
  protected async offerFreed(tx: Tx, m: Pick<Meeting, "id" | "title">, teacherId: string, free: number): Promise<number> {
    if (free <= 0) return 0;
    const next = await rows<{ id: string; userId: string; teacher: string }>(tx, sql`
      select w.id, s.user_id as "userId", u.name as teacher from meeting_waits w join students s on s.id = w.student_id and s.status = 'active' and s.user_id is not null
      join users u on u.id = w.teacher_id
      where w.meeting_id = ${m.id}::uuid and w.teacher_id = ${teacherId}::uuid and w.notified_at is null order by w.sort, w.created_at limit ${free}`);
    for (const n of next) {
      await tx.update(meetingWaits).set({ notifiedAt: new Date() }).where(eq(meetingWaits.id, n.id));
      await this.notices.changed(tx, m, [n.userId], `A time is free with ${n.teacher}`, "Open the meeting to take it before someone else does.");
    }
    return next.length;
  }

  protected async dropWait(tx: Tx, meetingId: string, teacherId: string, studentId: string) {
    await tx.delete(meetingWaits).where(and(eq(meetingWaits.meetingId, meetingId), eq(meetingWaits.teacherId, teacherId), eq(meetingWaits.studentId, studentId)));
  }
}
