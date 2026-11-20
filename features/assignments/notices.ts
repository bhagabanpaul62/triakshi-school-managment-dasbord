import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import { sectionTeachers } from "@smw/feature-academics/schema";

/** The notifications this feature sends, written inside the caller's transaction. Never the actor. */
export class AssignmentNotices {
  constructor(private readonly ctx: Ctx) {}

  /** A comment on a student's work: the student hears about a teacher's comment, and the staff who teach it hear about the student's. */
  async commented(tx: Tx, a: { id: string; sectionId: string; subjectId: string; title: string; createdBy: string | null }, studentId: string, fromStaff: boolean) {
    const link = { href: `/app/assignments/${a.id}` };
    if (fromStaff) {
      const [kid] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, studentId)).limit(1);
      if (!kid?.userId || kid.userId === this.ctx.userId) return;
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: kid.userId, kind: "assignment", title: `New comment on: ${a.title}`, ...link }]);
      return;
    }
    const teachers = await tx.select({ id: sectionTeachers.teacherId }).from(sectionTeachers)
      .where(and(eq(sectionTeachers.sectionId, a.sectionId), eq(sectionTeachers.subjectId, a.subjectId)));
    const ids = [...new Set([...teachers.map((t) => t.id), ...(a.createdBy ? [a.createdBy] : [])])].filter((id) => id !== this.ctx.userId);
    await NotificationWriter.insert(tx, this.ctx.schoolId, ids.map((userId) => ({ userId, kind: "assignment" as const, title: `New comment from a student on: ${a.title}`, ...link })));
  }

  /** Due-soon reminder or scheduled publish: the scheduler passes its own context, so these are plain inserts. */
  async dueSoon(tx: Tx, a: { id: string; title: string }, userIds: string[]) {
    await NotificationWriter.insert(tx, this.ctx.schoolId, userIds.map((userId) => ({
      userId, kind: "assignment" as const, title: `Due within 24 hours: ${a.title}`, body: "Hand it in before the due time.", href: `/app/assignments/${a.id}`,
    })));
  }

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

  /** An extension was granted, changed (`dueAt` set) or taken back (`dueAt` null): that one student. */
  async extended(tx: Tx, a: { id: string; title: string }, studentId: string, dueAt: Date | null, assignmentDue: Date) {
    const [kid] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, studentId)).limit(1);
    if (!kid?.userId || kid.userId === this.ctx.userId) return;
    const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{
      userId: kid.userId, kind: "assignment",
      title: dueAt ? `More time for: ${a.title}` : `Extension withdrawn: ${a.title}`,
      body: dueAt ? `Your new due time is ${when(dueAt)} IST.` : `The due time is back to ${when(assignmentDue)} IST.`,
      href: `/app/assignments/${a.id}`,
    }]);
  }
}
