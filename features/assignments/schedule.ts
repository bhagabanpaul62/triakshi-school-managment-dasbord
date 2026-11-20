import { and, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { schools, withConsole, type Tx } from "@smw/db";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import assignmentsFeature from "./feature";
import { AssignmentNotices } from "./notices";
import { assignmentExtensions, assignments, submissions } from "./schema";

type Perm = keyof typeof assignmentsFeature.permissions;

/** How far ahead the due-soon reminder looks. */
const REMINDER_WINDOW_MS = 24 * 3_600_000;

/**
 * The work the scheduler does for one school: the due-soon reminder and scheduled publishing.
 * Runs in that school's scope, so a school's drafts and students are only ever touched by its own run.
 */
export class AssignmentSchedule extends SchoolService<Perm> {
  protected feature = assignmentsFeature;
  private readonly notices: AssignmentNotices;

  constructor(ctx: Ctx) {
    super(ctx);
    this.notices = new AssignmentNotices(ctx);
  }

  /**
   * Published assignments due within the next 24 hours get one reminder each. Students with no hand-in yet get it,
   * and a student with an extension gets it only when their own date falls in the window. The marker commits with the notices.
   */
  // shortcut: candidates are picked by the assignment's own due time, so an extension that lands in the window after the base due has passed gets no reminder, revisit with a per-student marker if teachers extend a lot.
  remind(now: Date): Promise<number> {
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
    return this.write("write", async (tx) => {
      const due = await tx.update(assignments).set({ remindedAt: now })
        .where(and(eq(assignments.status, "published"), isNull(assignments.remindedAt), gt(assignments.dueAt, now), lte(assignments.dueAt, windowEnd)))
        .returning({ id: assignments.id, sectionId: assignments.sectionId, title: assignments.title, dueAt: assignments.dueAt });
      let sent = 0;
      for (const a of due) {
        const [kids, handedIn, exts] = await Promise.all([
          tx.select({ id: students.id, userId: students.userId }).from(students)
            .where(and(eq(students.sectionId, a.sectionId), eq(students.status, "active"), isNotNull(students.userId))),
          tx.select({ studentId: submissions.studentId }).from(submissions).where(eq(submissions.assignmentId, a.id)),
          tx.select({ studentId: assignmentExtensions.studentId, dueAt: assignmentExtensions.dueAt }).from(assignmentExtensions).where(eq(assignmentExtensions.assignmentId, a.id)),
        ]);
        const done = new Set(handedIn.map((h) => h.studentId));
        const extended = new Map(exts.map((e) => [e.studentId, e.dueAt]));
        const who = kids.filter((k) => !done.has(k.id) && (extended.get(k.id) ?? a.dueAt) > now && (extended.get(k.id) ?? a.dueAt) <= windowEnd);
        await this.notices.dueSoon(tx, a, who.map((k) => k.userId!));
        sent += who.length;
        await this.audit(tx, { action: "remind", entity: "Assignment", entityId: a.id, summary: `Due-soon reminder for "${a.title}" to ${who.length} students` });
      }
      return sent;
    });
  }

  /** Drafts whose publish time has passed go live; each gets the publish notice. The schedule is cleared so it runs once. */
  publishScheduled(now: Date): Promise<number> {
    return this.write("write", async (tx: Tx) => {
      const live = await tx.update(assignments).set({ status: "published", publishAt: null })
        .where(and(eq(assignments.status, "draft"), isNotNull(assignments.publishAt), lte(assignments.publishAt, now)))
        .returning();
      for (const a of live) {
        await this.notices.published(tx, a);
        await this.audit(tx, { action: "publish", entity: "Assignment", entityId: a.id, summary: `Published "${a.title}" on schedule` });
      }
      return live.length;
    });
  }
}

/** Every active school, one at a time. One school failing does not stop the rest; the run fails at the end so the queue retries. */
async function eachSchool(run: (ctx: Ctx) => Promise<number>): Promise<number> {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let total = 0;
  let failed = 0;
  for (const id of ids) {
    try { total += await run(systemCtx(id, ["assignments"])); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "assignment job failed", schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`Assignment job failed for ${failed} of ${ids.length} schools`);
  return total;
}

/** Worker job "assignments.due-reminders": tell students about homework due in the next 24 hours, once per assignment. Returns notices sent. */
export const sendDueReminders = (now: Date) => eachSchool((ctx) => new AssignmentSchedule(ctx).remind(now));

/** Worker job "assignments.publish-due": publish drafts whose scheduled time has come. Returns how many went live. */
export const publishDue = (now: Date) => eachSchool((ctx) => new AssignmentSchedule(ctx).publishScheduled(now));
