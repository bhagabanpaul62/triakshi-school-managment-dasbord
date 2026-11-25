import type { Tx } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { NotificationWriter, type NotificationRow } from "@smw/feature-notifications/writer";

import { when } from "./format";

/** What this feature tells people, written inside the caller's transaction. */
export class MeetingNotices {
  constructor(private readonly ctx: Ctx) {}

  private put(tx: Tx, rows: NotificationRow[]) {
    return NotificationWriter.insert(tx, this.ctx.schoolId, rows);
  }
  private link = (meetingId: string) => ({ href: `/app/meetings/${meetingId}`, subject: { type: "meeting", id: meetingId } });

  /** Booking is open: every family of the audience, with a "book" action that closes when they book. */
  opened(tx: Tx, m: { id: string; title: string; closesAt: Date }, userIds: string[]) {
    return this.put(tx, userIds.map((userId) => ({
      userId, topic: "meeting.open" as const, action: true, title: `Book a time: ${m.title}`, body: `Choose a time with your child's teachers before ${when(m.closesAt)}.`, ...this.link(m.id),
    })));
  }

  changed(tx: Tx, m: { id: string }, userIds: string[], title: string, body?: string) {
    return this.put(tx, userIds.map((userId) => ({ userId, topic: "meeting.changed" as const, title, body, ...this.link(m.id) })));
  }

  reminder(tx: Tx, m: { id: string }, userId: string, title: string, body?: string) {
    return this.put(tx, [{ userId, topic: "meeting.reminder", title, body, ...this.link(m.id) }]);
  }

  /** Someone booked: close their "book a time" action. */
  booked(tx: Tx, meetingId: string, userId: string) {
    return NotificationWriter.done(tx, this.ctx.schoolId, { type: "meeting", id: meetingId }, userId);
  }
}
