import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";

/** The notifications this feature sends, written inside the caller's transaction. Never the actor. */
export class AssignmentNotices {
  constructor(private readonly ctx: Ctx) {}

  /** New homework: every active student of the section with a login. */
  async published(tx: Tx, a: { id: string; sectionId: string; title: string }) {
    const kids = await tx.select({ userId: students.userId }).from(students)
      .where(and(eq(students.sectionId, a.sectionId), eq(students.status, "active"), isNotNull(students.userId)));
    await NotificationWriter.insert(tx, this.ctx.schoolId, kids.filter((k) => k.userId !== this.ctx.userId).map((k) => ({
      userId: k.userId!, kind: "assignment" as const, title: `New assignment: ${a.title}`, href: `/app/assignments/${a.id}`,
    })));
  }

  /** Marked or sent back: that one student. */
  async graded(tx: Tx, a: { id: string; title: string }, studentId: string, sentBack: boolean) {
    const [kid] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, studentId)).limit(1);
    if (!kid?.userId || kid.userId === this.ctx.userId) return;
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{
      userId: kid.userId, kind: "assignment", title: sentBack ? `Sent back to redo: ${a.title}` : `Graded: ${a.title}`, href: `/app/assignments/${a.id}`,
    }]);
  }
}
