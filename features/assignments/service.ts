import { and, asc, count, eq, gt, inArray, ne, sql, type SQL } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, CrudService, ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx, type ListQuery } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import assignmentsFeature from "./feature";
import { assignmentInput, bulkGradeInput, commentInput, extensionInput, gradeInput, submitInput } from "./inputs";
import { assignmentExtensions, assignmentFiles, assignments, submissionComments, submissionFiles, submissions, type AssignmentStatus, type SubmissionStatus } from "./schema";
import { AssignmentNotices } from "./notices";
import { AssignmentAccess, isUuid, type Assignment, type Kid } from "./access";
import { FileStore, type FileLink, type UploadedFile } from "./files";
import { EMPTY_PROGRESS, isLate, selfState, sortSelf, tally, toIstInput, withinCommentWindow, type Progress, type SelfState } from "./rules";

export type { Assignment, Option } from "./access";
export type { FileLink, UploadedFile } from "./files";
export type { Progress, SelfState } from "./rules";
type Perm = keyof typeof assignmentsFeature.permissions;

const MAX_ATTACHMENTS = 10;
const MAX_BULK = 500;
const DAY = 86_400_000;
const NO_ID = "00000000-0000-0000-0000-000000000000"; // keeps `in ()` non-empty

/** One student's row in the teacher's grading table: the student, what they handed in (if anything) and its files. */
export interface RosterRow {
  student: Kid;
  status: SubmissionStatus | "missing";
  /** The student's own due date: the assignment's, or their extension. */
  dueAt: Date;
  extended: boolean;
  submission: { id: string; text: string | null; submittedAt: Date; marks: number | null; feedback: string | null } | null;
  files: FileLink[];
}

/** One message on a submission's thread. `mine` is true when the viewer wrote it. */
export interface CommentRow {
  id: string; submissionId: string; authorName: string | null; mine: boolean; body: string; createdAt: Date;
  edited: boolean;
  /** The author may edit and delete for 15 minutes. */
  canEdit: boolean;
  /** The author within 15 minutes; staff any time. */
  canDelete: boolean;
}

/** The student's extension, if one was granted, else the assignment's due date. */
async function dueFor(tx: Tx, assignmentId: string, studentId: string): Promise<Date | null> {
  const [ext] = await tx.select({ dueAt: assignmentExtensions.dueAt }).from(assignmentExtensions)
    .where(and(eq(assignmentExtensions.assignmentId, assignmentId), eq(assignmentExtensions.studentId, studentId))).limit(1);
  return ext?.dueAt ?? null;
}

/** Messages on these submissions, oldest first, with each author's name. */
async function threadRows(tx: Tx, submissionIds: string[], viewerId: string, staff: boolean, now = new Date()): Promise<CommentRow[]> {
  if (submissionIds.length === 0) return [];
  const rows = await tx.select({
    id: submissionComments.id, submissionId: submissionComments.submissionId, authorId: submissionComments.authorId,
    authorName: users.name, body: submissionComments.body, createdAt: submissionComments.createdAt, updatedAt: submissionComments.updatedAt,
  }).from(submissionComments).leftJoin(users, eq(users.id, submissionComments.authorId))
    .where(inArray(submissionComments.submissionId, submissionIds)).orderBy(asc(submissionComments.createdAt));
  return rows.map((r) => {
    const mine = r.authorId === viewerId, fresh = mine && withinCommentWindow(r.createdAt, now);
    return { id: r.id, submissionId: r.submissionId, authorName: r.authorName, mine, body: r.body, createdAt: r.createdAt, edited: r.updatedAt.getTime() > r.createdAt.getTime(), canEdit: fresh, canDelete: fresh || staff };
  });
}

/** One CSV cell: quoted when needed, and a leading = + - @ is neutralised so a spreadsheet never runs it as a formula. */
const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v).replace(/^([=+\-@\t\r])/, "'$1");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Grades, resubmissions and progress for the work students hand in. */
export class SubmissionService extends SchoolService<Perm> {
  protected feature = assignmentsFeature;
  private readonly access = new AssignmentAccess(this.ctx);
  private readonly files = new FileStore(this.ctx.schoolId, "submissions");

  private readonly notices = new AssignmentNotices(this.ctx);

  constructor(ctx: Ctx) { super(ctx); }

  /** The clock, overridable so a seed can hand work in "last week". */
  protected now(): Date { return new Date(); }

  /**
   * A student hands in text and/or files. Handing in after the student's due time marks it late (their extension counts).
   * They may resubmit until it is graded; new files replace the old ones, and no new files keeps the old ones.
   */
  async submit(input: unknown, uploads: UploadedFile[] = []) {
    this.authorize("submit", "write");
    const data = this.parse(submitInput, input);
    let stale: string[] = []; // replaced files: removed from storage only after the row write commits
    const out = await this.write("submit", async (tx) => {
      const me = await this.access.myStudent(tx);
      const a = await this.access.assignment(tx, data.assignmentId);
      if (a.status === "draft" || a.sectionId !== me.sectionId) throw new NotFoundError("Assignment");
      if (a.status === "closed") throw new ConflictError("This assignment is closed.");
      const [prev] = await tx.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), eq(submissions.studentId, me.id))).limit(1);
      if (prev?.status === "graded") throw new ConflictError("This was already graded, so it cannot be changed.");
      const oldFiles = prev ? await tx.select().from(submissionFiles).where(eq(submissionFiles.submissionId, prev.id)) : [];
      if (!data.text && uploads.length === 0 && oldFiles.length === 0) throw new ValidationError({ text: "Write your answer or attach a file" });

      const refs = await this.files.putAll(uploads);
      const at = this.now();
      const status: SubmissionStatus = isLate((await dueFor(tx, a.id, me.id)) ?? a.dueAt, at) ? "late" : "submitted";
      const [row] = await tx.insert(submissions).values({ schoolId: this.ctx.schoolId, assignmentId: a.id, studentId: me.id, text: data.text ?? null, submittedAt: at, status })
        .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: { text: data.text ?? null, submittedAt: at, status } }).returning();
      if (refs.length) {
        await tx.delete(submissionFiles).where(eq(submissionFiles.submissionId, row!.id));
        await tx.insert(submissionFiles).values(refs.map((r) => ({ ...r, schoolId: this.ctx.schoolId, submissionId: row!.id })));
        stale = oldFiles.map((f) => f.fileKey);
      }
      return { id: row!.id, status, title: a.title, student: me.name };
    }, (r) => ({ action: "submit", entity: "Submission", entityId: r.id, summary: `${r.student} handed in "${r.title}"${r.status === "late" ? " late" : ""}` }));
    await this.files.removeAll(stale);
    return out;
  }

  /**
   * Teacher marks a submission: marks (at most the assignment's maximum) and feedback, or sends it back to be redone.
   * A teacher can only grade work for a section and subject they teach.
   */
  async grade(submissionId: string, input: unknown) {
    this.authorize("write", "write");
    const data = this.parse(gradeInput, input);
    return this.write("write", async (tx) => {
      const [sub] = isUuid(submissionId) ? await tx.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1) : [];
      if (!sub) throw new NotFoundError("Submission");
      const a = await this.access.assignment(tx, sub.assignmentId);

      let status: SubmissionStatus = "graded";
      let marks: number | null = data.marks ?? null;
      if (data.returnForRework) {
        if (!data.feedback) throw new ValidationError({ feedback: "Tell the student what to fix" });
        status = "returned";
        marks = null;
      } else if (a.maxMarks == null) {
        if (marks != null) throw new ValidationError({ marks: "This assignment is not marked out of a number" });
      } else if (marks == null) {
        throw new ValidationError({ marks: `Enter marks out of ${a.maxMarks}` });
      } else if (marks > a.maxMarks) {
        throw new ValidationError({ marks: `Marks cannot be more than ${a.maxMarks}` });
      }

      const [row] = await tx.update(submissions).set({ status, marks, feedback: data.feedback ?? null, gradedBy: this.ctx.userId, gradedAt: this.now() }).where(eq(submissions.id, sub.id)).returning();
      const [st] = await tx.select({ name: students.name }).from(students).where(eq(students.id, sub.studentId)).limit(1);
      await this.notices.graded(tx, a, sub.studentId, status === "returned");
      // A re-grade keeps what it replaced in the audit log.
      const regrade = sub.status === "graded" || sub.status === "returned";
      const previous = regrade ? { status: sub.status, marks: sub.marks, feedback: sub.feedback, gradedBy: sub.gradedBy, gradedAt: sub.gradedAt } : null;
      return { ...row!, title: a.title, student: st?.name ?? "student", previous };
    }, (r) => ({
      action: r.status === "returned" ? "return" : r.previous ? "regrade" : "grade", entity: "Submission", entityId: r.id,
      summary: r.previous
        ? `Re-graded ${r.student} on "${r.title}": ${r.previous.marks ?? "no marks"} -> ${r.marks ?? "no marks"}`
        : `${r.status === "returned" ? "Sent back" : "Graded"} ${r.student} on "${r.title}"`,
      meta: r.previous ? { previous: r.previous, now: { status: r.status, marks: r.marks, feedback: r.feedback } } : undefined,
    }));
  }

  /**
   * The same marks and/or feedback for several submissions of one assignment. All or nothing: one bad mark refuses the lot.
   * Only submissions of this assignment count, so a selection cannot reach another assignment's work.
   */
  async bulkGrade(assignmentId: string, submissionIds: string[], input: unknown) {
    this.authorize("write", "write");
    const data = this.parse(bulkGradeInput, input);
    const ids = [...new Set(submissionIds)];
    if (ids.length === 0) throw new ValidationError({ submissionId: "Select at least one student" });
    if (ids.length > MAX_BULK) throw new ValidationError({ submissionId: `Grade at most ${MAX_BULK} at a time` });
    if (!ids.every(isUuid)) throw new NotFoundError("Submission");
    return this.write("write", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      if (data.marks != null && a.maxMarks == null) throw new ValidationError({ marks: "This assignment is not marked out of a number" });
      if (data.marks != null && a.maxMarks != null && data.marks > a.maxMarks) throw new ValidationError({ marks: `Marks cannot be more than ${a.maxMarks}` });
      const subs = await tx.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), inArray(submissions.id, ids)));
      if (subs.length !== ids.length) throw new NotFoundError("Submission");
      const at = this.now();
      const previous = subs.filter((s) => s.status === "graded" || s.status === "returned").map((s) => ({ id: s.id, status: s.status, marks: s.marks, feedback: s.feedback }));
      for (const s of subs) {
        await tx.update(submissions).set({ status: "graded", marks: data.marks ?? s.marks, feedback: data.feedback ?? s.feedback, gradedBy: this.ctx.userId, gradedAt: at })
          .where(eq(submissions.id, s.id));
        await this.notices.graded(tx, a, s.studentId, false);
      }
      return { count: subs.length, title: a.title, id: a.id, previous };
    }, (r) => ({ action: "grade", entity: "Assignment", entityId: r.id, summary: `Graded ${r.count} ${r.count === 1 ? "student" : "students"} in bulk on "${r.title}"`, meta: r.previous.length ? { previous: r.previous } : undefined }));
  }

  /**
   * A later due date for one student of the section. Work already handed in late moves to "submitted" if it now falls
   * inside the extension. Refused unless the new date is after the assignment's own due time.
   */
  async grantExtension(assignmentId: string, studentId: string, input: unknown) {
    this.authorize("write", "write");
    const data = this.parse(extensionInput, input);
    return this.write("write", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      if (data.dueAt.getTime() <= a.dueAt.getTime()) throw new ValidationError({ dueAt: "An extension must be later than the assignment's due time" });
      const [kid] = isUuid(studentId)
        ? await tx.select({ id: students.id, name: students.name }).from(students)
          .where(and(eq(students.id, studentId), eq(students.sectionId, a.sectionId), eq(students.status, "active"))).limit(1)
        : [];
      if (!kid) throw new NotFoundError("Student");
      const [before] = await tx.select({ dueAt: assignmentExtensions.dueAt }).from(assignmentExtensions).where(and(eq(assignmentExtensions.assignmentId, a.id), eq(assignmentExtensions.studentId, kid.id))).limit(1);
      await tx.insert(assignmentExtensions).values({ schoolId: this.ctx.schoolId, assignmentId: a.id, studentId: kid.id, dueAt: data.dueAt, grantedBy: this.ctx.userId })
        .onConflictDoUpdate({ target: [assignmentExtensions.assignmentId, assignmentExtensions.studentId], set: { dueAt: data.dueAt, grantedBy: this.ctx.userId } });
      await this.resettle(tx, a.id, kid.id, data.dueAt);
      await this.notices.extended(tx, a, kid.id, data.dueAt, a.dueAt);
      return { assignmentId: a.id, title: a.title, student: kid.name, dueAt: data.dueAt, previous: before?.dueAt ?? null };
    }, (r) => ({
      action: r.previous ? "extend-change" : "extend", entity: "Assignment", entityId: r.assignmentId,
      summary: `${r.previous ? "Changed the extension of" : "Extended"} "${r.title}" for ${r.student} to ${toIstInput(r.dueAt).replace("T", " ")} IST`,
      meta: r.previous ? { previous: r.previous.toISOString() } : undefined,
    }));
  }

  /** Take an extension back: the student's due date is the assignment's again, and a hand-in made inside the extension becomes late. */
  async revokeExtension(assignmentId: string, studentId: string) {
    this.authorize("write", "write");
    return this.write("write", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      const [ext] = isUuid(studentId) ? await tx.select().from(assignmentExtensions).where(and(eq(assignmentExtensions.assignmentId, a.id), eq(assignmentExtensions.studentId, studentId))).limit(1) : [];
      if (!ext) throw new NotFoundError("Extension");
      const [kid] = await tx.select({ name: students.name }).from(students).where(eq(students.id, ext.studentId)).limit(1);
      await tx.delete(assignmentExtensions).where(eq(assignmentExtensions.id, ext.id));
      await this.resettle(tx, a.id, ext.studentId, a.dueAt);
      await this.notices.extended(tx, a, ext.studentId, null, a.dueAt);
      return { assignmentId: a.id, title: a.title, student: kid?.name ?? "student", previous: ext.dueAt };
    }, (r) => ({ action: "extend-revoke", entity: "Assignment", entityId: r.assignmentId, summary: `Took back the extension on "${r.title}" for ${r.student}`, meta: { previous: r.previous.toISOString() } }));
  }

  /** Work not yet graded is late or on time against the student's current due date; graded work keeps the status it was graded with. */
  private async resettle(tx: Tx, assignmentId: string, studentId: string, dueAt: Date) {
    const [sub] = await tx.select().from(submissions).where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId))).limit(1);
    if (!sub || (sub.status !== "late" && sub.status !== "submitted")) return;
    const status: SubmissionStatus = isLate(dueAt, sub.submittedAt) ? "late" : "submitted";
    if (status !== sub.status) await tx.update(submissions).set({ status }).where(eq(submissions.id, sub.id));
  }

  /**
   * A student or staff member writes on a submission's thread. A student only on their own work; staff only on work of a
   * section and subject they teach. Everyone else (another student, a parent) is refused as if the work did not exist.
   */
  async comment(submissionId: string, input: unknown) {
    const perm: Perm = this.ctx.role === "student" ? "submit" : "write";
    this.authorize(perm, "write");
    const data = this.parse(commentInput, input);
    return this.write(perm, async (tx) => {
      const { sub, a } = await this.thread(tx, submissionId);
      const [row] = await tx.insert(submissionComments).values({ schoolId: this.ctx.schoolId, submissionId: sub.id, authorId: this.ctx.userId, body: data.body }).returning();
      await this.notices.commented(tx, a, sub.studentId, this.ctx.role !== "student");
      return { id: row!.id, submissionId: sub.id, title: a.title };
    }, (r) => ({ action: "comment", entity: "Submission", entityId: r.submissionId, summary: `Commented on "${r.title}"` }));
  }

  /** The author changes their own comment, within 15 minutes of writing it. */
  async editComment(commentId: string, input: unknown) {
    const perm = this.commentPerm();
    this.authorize(perm, "write");
    const data = this.parse(commentInput, input);
    return this.write(perm, async (tx) => {
      const { c, a } = await this.ownComment(tx, commentId);
      if (c.authorId !== this.ctx.userId) throw new ForbiddenError();
      if (!withinCommentWindow(c.createdAt, this.now())) throw new ConflictError("A comment can only be edited within 15 minutes.");
      await tx.update(submissionComments).set({ body: data.body, updatedAt: sql`now()` }).where(eq(submissionComments.id, c.id));
      return { id: c.id, submissionId: c.submissionId, title: a.title, previous: c.body };
    }, (r) => ({ action: "comment-edit", entity: "Submission", entityId: r.submissionId, summary: `Edited a comment on "${r.title}"`, meta: { previous: r.previous } }));
  }

  /** The author may delete their own comment within 15 minutes; staff who grade the work may delete any comment. */
  async deleteComment(commentId: string) {
    const perm = this.commentPerm();
    this.authorize(perm, "write");
    return this.write(perm, async (tx) => {
      const { c, a } = await this.ownComment(tx, commentId);
      const own = c.authorId === this.ctx.userId;
      if (this.ctx.role === "student") {
        if (!own) throw new ForbiddenError();
        if (!withinCommentWindow(c.createdAt, this.now())) throw new ConflictError("A comment can only be deleted within 15 minutes.");
      }
      await tx.delete(submissionComments).where(eq(submissionComments.id, c.id));
      return { id: c.id, submissionId: c.submissionId, title: a.title, previous: c.body };
    }, (r) => ({ action: "comment-delete", entity: "Submission", entityId: r.submissionId, summary: `Deleted a comment on "${r.title}"`, meta: { previous: r.previous } }));
  }

  private commentPerm(): Perm { return this.ctx.role === "student" ? "submit" : "write"; }

  /** The comment and its submission, if the caller may see that thread (same rule as writing on it). */
  private async ownComment(tx: Tx, commentId: string) {
    const [c] = isUuid(commentId) ? await tx.select().from(submissionComments).where(eq(submissionComments.id, commentId)).limit(1) : [];
    if (!c) throw new NotFoundError("Comment");
    const { a } = await this.thread(tx, c.submissionId);
    return { c, a };
  }

  /** A student takes back their hand-in before it is graded. Its files go too; teachers' comments on it go with it. */
  async withdraw(assignmentId: string) {
    this.authorize("submit", "write");
    let keys: string[] = [];
    const out = await this.write("submit", async (tx) => {
      const me = await this.access.myStudent(tx);
      const a = await this.access.assignment(tx, assignmentId);
      if (a.status === "draft" || a.sectionId !== me.sectionId) throw new NotFoundError("Assignment");
      const [sub] = await tx.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), eq(submissions.studentId, me.id))).limit(1);
      if (!sub) throw new NotFoundError("Submission");
      if (sub.status === "graded" || sub.status === "returned") throw new ConflictError("This was already marked, so it cannot be withdrawn.");
      keys = (await tx.select({ k: submissionFiles.fileKey }).from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id))).map((r) => r.k);
      await tx.delete(submissions).where(eq(submissions.id, sub.id));
      return { id: sub.id, title: a.title, student: me.name };
    }, (r) => ({ action: "withdraw", entity: "Submission", entityId: r.id, summary: `${r.student} withdrew "${r.title}"` }));
    await this.files.removeAll(keys);
    return out;
  }

  /** A student removes one of their handed-in files before grading. They must keep an answer or another file. */
  async removeFile(fileId: string) {
    this.authorize("submit", "write");
    let key = "";
    const out = await this.write("submit", async (tx) => {
      const me = await this.access.myStudent(tx);
      const [f] = isUuid(fileId) ? await tx.select().from(submissionFiles).where(eq(submissionFiles.id, fileId)).limit(1) : [];
      const [sub] = f ? await tx.select().from(submissions).where(eq(submissions.id, f.submissionId)).limit(1) : [];
      if (!f || !sub || sub.studentId !== me.id) throw new NotFoundError("File");
      if (sub.status === "graded") throw new ConflictError("This was already graded, so it cannot be changed.");
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id));
      if (Number(n) <= 1 && !sub.text) throw new ValidationError({ files: "Write an answer first, or withdraw the whole hand-in" });
      await tx.delete(submissionFiles).where(eq(submissionFiles.id, f.id));
      key = f.fileKey;
      return { id: sub.id, fileName: f.fileName };
    }, (r) => ({ action: "file-remove", entity: "Submission", entityId: r.id, summary: `Removed ${r.fileName} from a hand-in` }));
    await this.files.removeAll([key]);
    return out;
  }

  /** Every thread on one assignment, for the grading dialogs. Staff only. */
  async threadsOf(assignmentId: string): Promise<CommentRow[]> {
    return this.read("read", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      const subs = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.assignmentId, a.id));
      return threadRows(tx, subs.map((s) => s.id), this.ctx.userId, true, this.now());
    });
  }

  /** The submission, if the caller may see its thread. Staff: through the assignment scope. Students: their own only. */
  private async thread(tx: Tx, submissionId: string): Promise<{ sub: typeof submissions.$inferSelect; a: Assignment }> {
    if (!isUuid(submissionId)) throw new NotFoundError("Submission");
    const [sub] = await tx.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
    if (!sub) throw new NotFoundError("Submission");
    const a = await this.access.assignment(tx, sub.assignmentId);
    if (this.ctx.role === "student" && (await this.access.myStudent(tx)).id !== sub.studentId) throw new NotFoundError("Submission");
    return { sub, a };
  }

  /** Every active student of the section with what they handed in; students who handed in nothing are `missing`. */
  async roster(assignmentId: string): Promise<RosterRow[]> {
    return this.read("read", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      const [kids, subs, exts] = await Promise.all([
        this.access.roster(tx, a.sectionId),
        tx.select().from(submissions).where(eq(submissions.assignmentId, a.id)),
        tx.select().from(assignmentExtensions).where(eq(assignmentExtensions.assignmentId, a.id)),
      ]);
      const files = subs.length ? await tx.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).orderBy(asc(submissionFiles.createdAt)) : [];
      const links = await this.files.withUrls(files);
      return kids.map((student) => {
        const s = subs.find((x) => x.studentId === student.id);
        const ext = exts.find((x) => x.studentId === student.id);
        return {
          student,
          status: s?.status ?? "missing",
          dueAt: ext?.dueAt ?? a.dueAt,
          extended: !!ext,
          submission: s ? { id: s.id, text: s.text, submittedAt: s.submittedAt, marks: s.marks, feedback: s.feedback } : null,
          files: s ? links.filter((_, i) => files[i]!.submissionId === s.id) : [],
        };
      });
    });
  }

  /** Marks for every student of the section as CSV (student, admission no, status, submitted at IST, marks, feedback). */
  async marksCsv(assignmentId: string): Promise<{ fileName: string; csv: string }> {
    const rows = await this.roster(assignmentId);
    const title = await this.read("read", async (tx) => (await this.access.assignment(tx, assignmentId)).title);
    const lines = [
      ["Student", "Admission no", "Status", "Submitted at", "Marks", "Feedback"],
      ...rows.map((r) => [r.student.name, r.student.admissionNo, r.status, r.submission ? toIstInput(r.submission.submittedAt).replace("T", " ") : null, r.submission?.marks ?? null, r.submission?.feedback ?? null]),
    ];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assignment";
    return { fileName: `marks-${slug}.csv`, csv: `\uFEFF${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n` };
  }

  /** Submitted / late / graded / returned / missing counts for one assignment. */
  async progress(assignmentId: string): Promise<Progress> {
    return this.read("read", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      return (await this.progressOf(tx, [a])).get(a.id) ?? EMPTY_PROGRESS;
    });
  }

  /** Progress for many assignments in two queries (used by lists and summaries). */
  async progressOf(tx: Tx, rows: { id: string; sectionId: string; dueAt: Date }[]): Promise<Map<string, Progress>> {
    const out = new Map<string, Progress>();
    if (rows.length === 0) return out;
    const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
    const now = this.now();
    const [rosters, counts, running] = await Promise.all([
      tx.select({ sectionId: students.sectionId, n: count() }).from(students).where(and(inArray(students.sectionId, sectionIds), eq(students.status, "active"))).groupBy(students.sectionId),
      tx.select({ assignmentId: submissions.assignmentId, status: submissions.status, n: count() }).from(submissions).where(inArray(submissions.assignmentId, rows.map((r) => r.id))).groupBy(submissions.assignmentId, submissions.status),
      // Active students whose extension is still running on an assignment that is already past its own due time.
      tx.select({ assignmentId: assignmentExtensions.assignmentId, studentId: assignmentExtensions.studentId, sectionId: students.sectionId }).from(assignmentExtensions)
        .innerJoin(students, eq(students.id, assignmentExtensions.studentId))
        .where(and(inArray(assignmentExtensions.assignmentId, rows.filter((r) => r.dueAt <= now).map((r) => r.id).concat(NO_ID)), gt(assignmentExtensions.dueAt, now), eq(students.status, "active"))),
    ]);
    const handed = running.length ? await tx.select({ assignmentId: submissions.assignmentId, studentId: submissions.studentId }).from(submissions)
      .where(inArray(submissions.assignmentId, [...new Set(running.map((x) => x.assignmentId))])) : [];
    for (const r of rows) {
      const total = Number(rosters.find((x) => x.sectionId === r.sectionId)?.n ?? 0);
      const byStatus: Partial<Record<SubmissionStatus, number>> = {};
      for (const c of counts) if (c.assignmentId === r.id) byStatus[c.status] = Number(c.n);
      const pending = running.filter((x) => x.assignmentId === r.id && x.sectionId === r.sectionId && !handed.some((h) => h.assignmentId === r.id && h.studentId === x.studentId)).length;
      out.set(r.id, tally(total, byStatus, pending));
    }
    return out;
  }
}

/** Assignments themselves: create, edit, list and attach files. Teachers are limited to what they teach. */
export class AssignmentService extends CrudService<typeof assignments, Perm> {
  protected feature = assignmentsFeature;
  protected table = assignments;
  protected entityName = "Assignment";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = assignmentInput;
  protected updateSchema = assignmentInput;
  protected defaultSort = "dueAt";
  private readonly access = new AssignmentAccess(this.ctx);
  private readonly files = new FileStore(this.ctx.schoolId, "assignments");
  private readonly notices = new AssignmentNotices(this.ctx);

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [assignments.title]; }
  protected sortColumns() { return { dueAt: assignments.dueAt, title: assignments.title, createdAt: assignments.createdAt }; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [
      f.sectionId ? eq(assignments.sectionId, f.sectionId) : undefined,
      f.subjectId ? eq(assignments.subjectId, f.subjectId) : undefined,
      f.status ? eq(assignments.status, f.status as AssignmentStatus) : undefined,
    ];
  }
  protected describe(r: Assignment) { return r.title; }
  protected async scopeClause(_tx: Tx): Promise<SQL | undefined> { return this.access.teacherScope(); }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    await this.access.assertCanAssign(tx, String(data.sectionId), String(data.subjectId));
    return { ...data, createdBy: this.ctx.userId, publishAt: data.status === "draft" ? (data.publishAt ?? null) : null };
  }

  protected async afterCreate(tx: Tx, row: Assignment) {
    if (row.status === "published") await this.notices.published(tx, row);
  }

  protected async beforeUpdate(tx: Tx, existing: Assignment, data: Record<string, unknown>) {
    await this.access.assertCanAssign(tx, String(data.sectionId), String(data.subjectId));
    if (data.sectionId !== existing.sectionId) {
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(submissions).where(eq(submissions.assignmentId, existing.id));
      if (Number(n) > 0) throw new ConflictError("Students have already handed this in, so it cannot move to another section.");
    }
    // Going from draft to published is the moment students hear about it.
    if (existing.status === "draft" && data.status === "published") await this.notices.published(tx, { id: existing.id, sectionId: String(data.sectionId), title: String(data.title) });
    return { ...data, publishAt: data.status === "draft" ? (data.publishAt ?? null) : null };
  }

  /**
   * Deletes the assignment with its attachments and every submission. Stored files are removed only after the delete commits,
   * so a failed delete never leaves rows pointing at files that are already gone.
   */
  override async remove(id: string): Promise<{ id: string }> {
    let keys: string[] = [];
    let label = id;
    const out = await this.write(this.writePermission, async (tx) => {
      const existing = await this.findOrThrow(tx, id);
      label = existing.title;
      const own = await tx.select({ k: assignmentFiles.fileKey }).from(assignmentFiles).where(eq(assignmentFiles.assignmentId, existing.id));
      const theirs = await tx.select({ k: submissionFiles.fileKey }).from(submissionFiles).innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId)).where(eq(submissions.assignmentId, existing.id));
      keys = [...own, ...theirs].map((r) => r.k);
      await tx.delete(assignments).where(eq(assignments.id, existing.id));
      return { id: existing.id };
    }, () => ({ action: "delete", entity: "Assignment", entityId: id, summary: `Deleted assignment ${label}` }));
    await this.files.removeAll(keys);
    return out;
  }

  /** Quick publish (a draft goes live and students hear about it) or close (no more hand-ins). */
  async setStatus(assignmentId: string, status: "published" | "closed") {
    this.authorize("write", "write");
    return this.write("write", async (tx) => {
      const a = await this.findOrThrow(tx, assignmentId);
      if (a.status === status) throw new ConflictError(`This is already ${status}.`);
      const [row] = await tx.update(assignments).set({ status, publishAt: null }).where(eq(assignments.id, a.id)).returning();
      if (a.status === "draft" && status === "published") await this.notices.published(tx, row!);
      return row!;
    }, (r) => ({ action: status === "published" ? "publish" : "close", entity: "Assignment", entityId: r.id, summary: `${status === "published" ? "Published" : "Closed"} "${r.title}"` }));
  }

  /** Choices for the create/edit form. */
  async options() { return this.read("read", (tx) => this.access.options(tx)); }

  /** (section, subject, teacher) combinations the caller may assign for. Seeds and pickers use this. */
  async assignable() { return this.read("read", (tx) => this.access.assignable(tx)); }

  /** A page of assignments with section/subject names and submission progress. */
  async listWithStats(query: ListQuery = {}) {
    const page = await this.list(query);
    const { labels, progress } = await this.read("read", async (tx) => ({
      labels: await this.access.labels(tx, page.rows.map((r) => r.sectionId), page.rows.map((r) => r.subjectId)),
      progress: await new SubmissionService(this.ctx).progressOf(tx, page.rows),
    }));
    return { ...page, rows: page.rows.map((r) => ({ ...r, sectionLabel: labels.section(r.sectionId), subjectName: labels.subject(r.subjectId), progress: progress.get(r.id) ?? EMPTY_PROGRESS })) };
  }

  /** Headline numbers for the teacher's list page: what is open, what is coming, what needs marking, what is missing. */
  async summary() {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ id: assignments.id, sectionId: assignments.sectionId, dueAt: assignments.dueAt }).from(assignments)
        .where(and(eq(assignments.status, "published"), this.access.teacherScope()));
      const progress = await new SubmissionService(this.ctx).progressOf(tx, rows);
      const now = Date.now();
      let open = 0, dueSoon = 0, toGrade = 0, missing = 0;
      for (const r of rows) {
        const p = progress.get(r.id) ?? EMPTY_PROGRESS;
        toGrade += p.submitted + p.late;
        if (r.dueAt.getTime() > now) { open++; if (r.dueAt.getTime() - now <= 7 * DAY) dueSoon++; } else missing += p.missing;
      }
      return { open, dueSoon, toGrade, missing };
    });
  }

  /** One assignment with its names and attachments (signed links). */
  async detail(id: string) {
    return this.read("read", async (tx) => {
      const a = await this.findOrThrow(tx, id);
      const [labels, creator, files] = await Promise.all([
        this.access.labels(tx, [a.sectionId], [a.subjectId]),
        this.access.userName(tx, a.createdBy),
        tx.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, a.id)).orderBy(asc(assignmentFiles.createdAt)),
      ]);
      return { assignment: a, sectionLabel: labels.section(a.sectionId), subjectName: labels.subject(a.subjectId), createdByName: creator, attachments: await this.files.withUrls(files) };
    });
  }

  async attach(assignmentId: string, file: UploadedFile) {
    this.authorize("write", "write");
    return this.write("write", async (tx) => {
      const a = await this.findOrThrow(tx, assignmentId);
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(assignmentFiles).where(eq(assignmentFiles.assignmentId, a.id));
      if (Number(n) >= MAX_ATTACHMENTS) throw new ConflictError(`An assignment can have at most ${MAX_ATTACHMENTS} attachments.`);
      const [ref] = await this.files.putAll([file], 1);
      const [row] = await tx.insert(assignmentFiles).values({ ...ref!, schoolId: this.ctx.schoolId, assignmentId: a.id }).returning();
      return { ...row!, title: a.title };
    }, (r) => ({ action: "attach", entity: "Assignment", entityId: r.assignmentId, summary: `Attached ${r.fileName} to "${r.title}"` }));
  }

  async detach(fileId: string) {
    let key = "";
    const out = await this.write("write", async (tx) => {
      const [row] = isUuid(fileId) ? await tx.select().from(assignmentFiles).where(eq(assignmentFiles.id, fileId)).limit(1) : [];
      if (!row) throw new NotFoundError("Attachment");
      const a = await this.findOrThrow(tx, row.assignmentId);
      await tx.delete(assignmentFiles).where(eq(assignmentFiles.id, row.id));
      key = row.fileKey;
      return { id: row.id, assignmentId: a.id, fileName: row.fileName, title: a.title };
    }, (r) => ({ action: "detach", entity: "Assignment", entityId: r.assignmentId, summary: `Removed ${r.fileName} from "${r.title}"` }));
    await this.files.removeAll([key]);
    return out;
  }
}

/** One student's view of one assignment. */
export interface SelfEntry {
  student: { id: string; name: string };
  state: SelfState;
  /** The student's own due date: the assignment's, or their extension. */
  dueAt: Date;
  submission: { id: string; text: string | null; submittedAt: Date; marks: number | null; feedback: string | null; status: SubmissionStatus } | null;
  files: FileLink[];
  comments: CommentRow[];
  /** A student may hand in (or redo) until it is graded. */
  canSubmit: boolean;
}

/** What a student sees: assignments of their section and the status of each. */
export class SelfService extends SchoolService<Perm> {
  protected feature = assignmentsFeature;
  private readonly access = new AssignmentAccess(this.ctx);
  private readonly files = new FileStore(this.ctx.schoolId, "assignments");
  private readonly handedIn = new FileStore(this.ctx.schoolId, "submissions");

  constructor(ctx: Ctx) { super(ctx); }

  /** Assignments with the viewer's status, open work first. Latest 200. `dueAt` is each student's own due date. */
  async mine() {
    return this.read("self", async (tx) => {
      const kids = (await this.access.myStudents(tx)).filter((k) => k.sectionId);
      if (kids.length === 0) return [];
      const asg = await tx.select().from(assignments)
        .where(and(inArray(assignments.sectionId, [...new Set(kids.map((k) => k.sectionId!))]), ne(assignments.status, "draft")))
        .orderBy(asc(assignments.dueAt)).limit(200);
      if (asg.length === 0) return [];
      const [subs, exts, labels] = await Promise.all([
        tx.select().from(submissions).where(and(inArray(submissions.studentId, kids.map((k) => k.id)), inArray(submissions.assignmentId, asg.map((a) => a.id)))),
        tx.select().from(assignmentExtensions).where(and(inArray(assignmentExtensions.studentId, kids.map((k) => k.id)), inArray(assignmentExtensions.assignmentId, asg.map((a) => a.id)))),
        this.access.labels(tx, asg.map((a) => a.sectionId), asg.map((a) => a.subjectId)),
      ]);
      const now = new Date();
      return sortSelf(kids.flatMap((k) => asg.filter((a) => a.sectionId === k.sectionId).map((a) => {
        const s = subs.find((x) => x.assignmentId === a.id && x.studentId === k.id) ?? null;
        const due = exts.find((x) => x.assignmentId === a.id && x.studentId === k.id)?.dueAt ?? a.dueAt;
        return {
          assignmentId: a.id, title: a.title, subjectName: labels.subject(a.subjectId), sectionLabel: labels.section(a.sectionId),
          dueAt: due, maxMarks: a.maxMarks, studentId: k.id, studentName: k.name,
          state: selfState(a, s, now, due), marks: s?.marks ?? null, submittedAt: s?.submittedAt ?? null,
        };
      })));
    });
  }

  /** One assignment for the viewer: instructions, attachments, the student's own submission and its thread. */
  async detail(assignmentId: string) {
    return this.read("self", async (tx) => {
      const kids = await this.access.myStudents(tx);
      const a = await this.access.assignment(tx, assignmentId);
      const mine = kids.filter((k) => k.sectionId === a.sectionId);
      if (a.status === "draft" || mine.length === 0) throw new NotFoundError("Assignment");
      const [labels, attachments, subs, exts] = await Promise.all([
        this.access.labels(tx, [a.sectionId], [a.subjectId]),
        tx.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, a.id)).orderBy(asc(assignmentFiles.createdAt)),
        tx.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), inArray(submissions.studentId, mine.map((k) => k.id)))),
        tx.select().from(assignmentExtensions).where(and(eq(assignmentExtensions.assignmentId, a.id), inArray(assignmentExtensions.studentId, mine.map((k) => k.id)))),
      ]);
      const [subFiles, threads] = await Promise.all([
        subs.length ? tx.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).orderBy(asc(submissionFiles.createdAt)) : [],
        threadRows(tx, subs.map((s) => s.id), this.ctx.userId, false),
      ]);
      const links = await this.handedIn.withUrls(subFiles);
      const now = new Date();
      const entries: SelfEntry[] = mine.map((k) => {
        const s = subs.find((x) => x.studentId === k.id) ?? null;
        const due = exts.find((x) => x.studentId === k.id)?.dueAt ?? a.dueAt;
        return {
          student: { id: k.id, name: k.name },
          state: selfState(a, s, now, due),
          dueAt: due,
          submission: s ? { id: s.id, text: s.text, submittedAt: s.submittedAt, marks: s.marks, feedback: s.feedback, status: s.status } : null,
          files: s ? links.filter((_, i) => subFiles[i]!.submissionId === s.id) : [],
          comments: s ? threads.filter((t) => t.submissionId === s.id) : [],
          canSubmit: a.status === "published" && s?.status !== "graded",
        };
      });
      return {
        assignment: a, sectionLabel: labels.section(a.sectionId), subjectName: labels.subject(a.subjectId),
        attachments: await this.files.withUrls(attachments), entries,
      };
    });
  }
}
