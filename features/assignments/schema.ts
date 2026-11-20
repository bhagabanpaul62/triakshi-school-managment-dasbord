import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { sections, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export const ASSIGNMENT_STATUSES = ["draft", "published", "closed"] as const;
export const SUBMISSION_STATUSES = ["submitted", "late", "graded", "returned"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const assignments = pgTable("assignments", {
  ...schoolColumns(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instructions: text("instructions").notNull().default(""),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  /** Null = not marked; teachers give feedback only. */
  maxMarks: integer("max_marks"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  status: text("status").$type<AssignmentStatus>().notNull().default("published"),
  /** Drafts only: the moment the scheduler publishes it (and sends the notice). Null = publish by hand. */
  publishAt: timestamp("publish_at", { withTimezone: true }),
  /** Set once the due-soon reminder has run for this assignment, so it fires once. */
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
}, (t) => [...tenant(t, "assignments"), index("assignments_section_due").on(t.schoolId, t.sectionId, t.dueAt)]);

/** A later due date for one student. Late detection and that student's due date use it when present. */
export const assignmentExtensions = pgTable("assignment_extensions", {
  ...schoolColumns(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "assignment_extensions"), uniqueIndex("assignment_extensions_assignment_student").on(t.assignmentId, t.studentId)]);

export const assignmentFiles = pgTable("assignment_files", {
  ...schoolColumns(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  /** S3 key (private; shown through a signed URL). */
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
}, (t) => [...tenant(t, "assignment_files"), index("assignment_files_assignment").on(t.assignmentId)]);

export const submissions = pgTable("submissions", {
  ...schoolColumns(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  text: text("text"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").$type<SubmissionStatus>().notNull().default("submitted"),
  marks: integer("marks"),
  feedback: text("feedback"),
  gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "submissions"),
  uniqueIndex("submissions_assignment_student").on(t.assignmentId, t.studentId),
  index("submissions_student").on(t.studentId),
]);

/** Thread on one submission between the student and the staff who can grade it. */
export const submissionComments = pgTable("submission_comments", {
  ...schoolColumns(),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
}, (t) => [...tenant(t, "submission_comments"), index("submission_comments_submission").on(t.submissionId, t.createdAt)]);

export const submissionFiles = pgTable("submission_files", {
  ...schoolColumns(),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
}, (t) => [...tenant(t, "submission_files"), index("submission_files_submission").on(t.submissionId)]);
