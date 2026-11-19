import { and, asc, count, eq, inArray, ne, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, CrudService, NotFoundError, SchoolService, ValidationError, type Ctx, type ListQuery } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import assignmentsFeature from "./feature";
import { assignmentInput, gradeInput, submitInput } from "./inputs";
import { assignmentFiles, assignments, submissionFiles, submissions, type AssignmentStatus, type SubmissionStatus } from "./schema";
import { AssignmentNotices } from "./notices";
import { AssignmentAccess, isUuid, type Assignment, type Kid } from "./access";
import { FileStore, type FileLink, type UploadedFile } from "./files";
import { EMPTY_PROGRESS, isLate, selfState, sortSelf, tally, type Progress, type SelfState } from "./rules";

export type { Assignment, Option } from "./access";
export type { FileLink, UploadedFile } from "./files";
export type { Progress, SelfState } from "./rules";
type Perm = keyof typeof assignmentsFeature.permissions;

const MAX_ATTACHMENTS = 10;
const DAY = 86_400_000;

/** One student's row in the teacher's grading table: the student, what they handed in (if anything) and its files. */
export interface RosterRow {
  student: Kid;
  status: SubmissionStatus | "missing";
  submission: { id: string; text: string | null; submittedAt: Date; marks: number | null; feedback: string | null } | null;
  files: FileLink[];
}

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
   * A student hands in text and/or files. Handing in after the due time marks it late. They may resubmit until
   * it is graded; new files replace the old ones, and no new files keeps the old ones.
   */
  async submit(input: unknown, uploads: UploadedFile[] = []) {
    this.authorize("submit", "write");
    const data = this.parse(submitInput, input);
    return this.write("submit", async (tx) => {
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
      const status: SubmissionStatus = isLate(a.dueAt, at) ? "late" : "submitted";
      const [row] = await tx.insert(submissions).values({ schoolId: this.ctx.schoolId, assignmentId: a.id, studentId: me.id, text: data.text ?? null, submittedAt: at, status })
        .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: { text: data.text ?? null, submittedAt: at, status } }).returning();
      if (refs.length) {
        await tx.delete(submissionFiles).where(eq(submissionFiles.submissionId, row!.id));
        await tx.insert(submissionFiles).values(refs.map((r) => ({ ...r, schoolId: this.ctx.schoolId, submissionId: row!.id })));
        await this.files.removeAll(oldFiles.map((f) => f.fileKey));
      }
      return { id: row!.id, status, title: a.title, student: me.name };
    }, (r) => ({ action: "submit", entity: "Submission", entityId: r.id, summary: `${r.student} handed in "${r.title}"${r.status === "late" ? " late" : ""}` }));
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
      return { ...row!, title: a.title, student: st?.name ?? "student" };
    }, (r) => ({ action: r.status === "returned" ? "return" : "grade", entity: "Submission", entityId: r.id, summary: `${r.status === "returned" ? "Sent back" : "Graded"} ${r.student} on "${r.title}"` }));
  }

  /** Every active student of the section with what they handed in; students who handed in nothing are `missing`. */
  async roster(assignmentId: string): Promise<RosterRow[]> {
    return this.read("read", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      const [kids, subs] = await Promise.all([
        this.access.roster(tx, a.sectionId),
        tx.select().from(submissions).where(eq(submissions.assignmentId, a.id)),
      ]);
      const files = subs.length ? await tx.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).orderBy(asc(submissionFiles.createdAt)) : [];
      const links = await this.files.withUrls(files);
      return kids.map((student) => {
        const s = subs.find((x) => x.studentId === student.id);
        return {
          student,
          status: s?.status ?? "missing",
          submission: s ? { id: s.id, text: s.text, submittedAt: s.submittedAt, marks: s.marks, feedback: s.feedback } : null,
          files: s ? links.filter((_, i) => files[i]!.submissionId === s.id) : [],
        };
      });
    });
  }

  /** Submitted / late / graded / returned / missing counts for one assignment. */
  async progress(assignmentId: string): Promise<Progress> {
    return this.read("read", async (tx) => {
      const a = await this.access.assignment(tx, assignmentId);
      return (await this.progressOf(tx, [a])).get(a.id) ?? EMPTY_PROGRESS;
    });
  }

  /** Progress for many assignments in two queries (used by lists and summaries). */
  async progressOf(tx: Tx, rows: { id: string; sectionId: string }[]): Promise<Map<string, Progress>> {
    const out = new Map<string, Progress>();
    if (rows.length === 0) return out;
    const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
    const [rosters, counts] = await Promise.all([
      tx.select({ sectionId: students.sectionId, n: count() }).from(students).where(and(inArray(students.sectionId, sectionIds), eq(students.status, "active"))).groupBy(students.sectionId),
      tx.select({ assignmentId: submissions.assignmentId, status: submissions.status, n: count() }).from(submissions).where(inArray(submissions.assignmentId, rows.map((r) => r.id))).groupBy(submissions.assignmentId, submissions.status),
    ]);
    for (const r of rows) {
      const total = Number(rosters.find((x) => x.sectionId === r.sectionId)?.n ?? 0);
      const byStatus: Partial<Record<SubmissionStatus, number>> = {};
      for (const c of counts) if (c.assignmentId === r.id) byStatus[c.status] = Number(c.n);
      out.set(r.id, tally(total, byStatus));
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
    return { ...data, createdBy: this.ctx.userId };
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
    return data;
  }

  // shortcut: files are removed from storage before the row delete commits; a failed commit would orphan the rows' files, acceptable for homework.
  protected async beforeRemove(tx: Tx, existing: Assignment) {
    const own = await tx.select({ k: assignmentFiles.fileKey }).from(assignmentFiles).where(eq(assignmentFiles.assignmentId, existing.id));
    const theirs = await tx.select({ k: submissionFiles.fileKey }).from(submissionFiles).innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId)).where(eq(submissions.assignmentId, existing.id));
    await this.files.removeAll([...own, ...theirs].map((r) => r.k));
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
    return this.write("write", async (tx) => {
      const [row] = isUuid(fileId) ? await tx.select().from(assignmentFiles).where(eq(assignmentFiles.id, fileId)).limit(1) : [];
      if (!row) throw new NotFoundError("Attachment");
      const a = await this.findOrThrow(tx, row.assignmentId);
      await tx.delete(assignmentFiles).where(eq(assignmentFiles.id, row.id));
      await this.files.removeAll([row.fileKey]);
      return { id: row.id, assignmentId: a.id, fileName: row.fileName, title: a.title };
    }, (r) => ({ action: "detach", entity: "Assignment", entityId: r.assignmentId, summary: `Removed ${r.fileName} from "${r.title}"` }));
  }
}

/** One student's view of one assignment. */
export interface SelfEntry {
  student: { id: string; name: string };
  state: SelfState;
  submission: { id: string; text: string | null; submittedAt: Date; marks: number | null; feedback: string | null; status: SubmissionStatus } | null;
  files: FileLink[];
  /** A student may hand in (or redo) until it is graded; parents never submit. */
  canSubmit: boolean;
}

/** What a student (or a parent, for each child) sees: assignments of their section(s) and the status of each. */
export class SelfService extends SchoolService<Perm> {
  protected feature = assignmentsFeature;
  private readonly access = new AssignmentAccess(this.ctx);
  private readonly files = new FileStore(this.ctx.schoolId, "assignments");
  private readonly handedIn = new FileStore(this.ctx.schoolId, "submissions");

  constructor(ctx: Ctx) { super(ctx); }

  /** Assignments with the viewer's status, open work first. A parent gets one row per child. Latest 200. */
  async mine() {
    return this.read("self", async (tx) => {
      const kids = (await this.access.myStudents(tx)).filter((k) => k.sectionId);
      if (kids.length === 0) return [];
      const asg = await tx.select().from(assignments)
        .where(and(inArray(assignments.sectionId, [...new Set(kids.map((k) => k.sectionId!))]), ne(assignments.status, "draft")))
        .orderBy(asc(assignments.dueAt)).limit(200);
      if (asg.length === 0) return [];
      const [subs, labels] = await Promise.all([
        tx.select().from(submissions).where(and(inArray(submissions.studentId, kids.map((k) => k.id)), inArray(submissions.assignmentId, asg.map((a) => a.id)))),
        this.access.labels(tx, asg.map((a) => a.sectionId), asg.map((a) => a.subjectId)),
      ]);
      const now = new Date();
      return sortSelf(kids.flatMap((k) => asg.filter((a) => a.sectionId === k.sectionId).map((a) => {
        const s = subs.find((x) => x.assignmentId === a.id && x.studentId === k.id) ?? null;
        return {
          assignmentId: a.id, title: a.title, subjectName: labels.subject(a.subjectId), sectionLabel: labels.section(a.sectionId),
          dueAt: a.dueAt, maxMarks: a.maxMarks, studentId: k.id, studentName: k.name,
          state: selfState(a, s, now), marks: s?.marks ?? null, submittedAt: s?.submittedAt ?? null,
        };
      })));
    });
  }

  /** One assignment for the viewer: instructions, attachments and each child's (or the student's own) submission. */
  async detail(assignmentId: string) {
    return this.read("self", async (tx) => {
      const kids = await this.access.myStudents(tx);
      const a = await this.access.assignment(tx, assignmentId);
      const mine = kids.filter((k) => k.sectionId === a.sectionId);
      if (a.status === "draft" || mine.length === 0) throw new NotFoundError("Assignment");
      const [labels, attachments, subs] = await Promise.all([
        this.access.labels(tx, [a.sectionId], [a.subjectId]),
        tx.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, a.id)).orderBy(asc(assignmentFiles.createdAt)),
        tx.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), inArray(submissions.studentId, mine.map((k) => k.id)))),
      ]);
      const subFiles = subs.length ? await tx.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).orderBy(asc(submissionFiles.createdAt)) : [];
      const links = await this.handedIn.withUrls(subFiles);
      const now = new Date();
      const entries: SelfEntry[] = mine.map((k) => {
        const s = subs.find((x) => x.studentId === k.id) ?? null;
        return {
          student: { id: k.id, name: k.name },
          state: selfState(a, s, now),
          submission: s ? { id: s.id, text: s.text, submittedAt: s.submittedAt, marks: s.marks, feedback: s.feedback, status: s.status } : null,
          files: s ? links.filter((_, i) => subFiles[i]!.submissionId === s.id) : [],
          canSubmit: this.ctx.role === "student" && a.status === "published" && s?.status !== "graded",
        };
      });
      return {
        assignment: a, sectionLabel: labels.section(a.sectionId), subjectName: labels.subject(a.subjectId),
        attachments: await this.files.withUrls(attachments), entries,
      };
    });
  }
}
