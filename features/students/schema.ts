// Contract tables for students and guardians. Attendance, fees, exams, assignments, transport and library read these.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";

/** "joining": accepted, not started. May be billed and may pay; in no register, audience or plan count; login off until `joinsOn`. */
export const STUDENT_STATUSES = ["joining", "active", "alumni", "left"] as const;
export { WITHDREW_BEFORE_JOINING } from "./constants";
export const GENDERS = ["male", "female", "other"] as const;

export const students = pgTable("students", {
  ...schoolColumns(),
  admissionNo: text("admission_no").notNull(),
  name: text("name").notNull(),
  dob: date("dob"),
  gender: text("gender").$type<(typeof GENDERS)[number]>(),
  bloodGroup: text("blood_group"),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
  rollNo: integer("roll_no"),
  admissionDate: date("admission_date"),
  status: text("status").$type<(typeof STUDENT_STATUSES)[number]>().notNull().default("active"),
  /** S3 key of the photo (private; shown through a signed URL). */
  photoKey: text("photo_key"),
  address: text("address"),
  /** Optional APAAR ID (One Nation One Student ID). Aadhaar is never stored. */
  apaarId: text("apaar_id"),
  /** Admitted on a free seat under RTE section 12(1)(c). */
  rteQuota: boolean("rte_quota").notNull().default(false),
  category: text("category"),
  phone: text("phone"),
  altPhone: text("alt_phone"),
  motherTongue: text("mother_tongue"),
  religion: text("religion"),
  nationality: text("nationality"),
  previousSchool: text("previous_school"),
  /** Allergies or conditions. Visible to admins, the student, and teachers of the student's sections only. */
  medicalNotes: text("medical_notes"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
  /** The student's own login (role student), login_id = admission number. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** The last day attended. */
  leftOn: date("left_on"),
  leftReason: text("left_reason"),
  /** The office's own words about why. Blanked by erasure. */
  leftNote: text("left_note"),
  /** The last day the family of a left student can sign in (90 days from the day it was marked, or from the last day if later). Null = closed. */
  accessUntil: date("access_until"),
  /** Permanent Education Number (UDISE+). */
  pen: text("pen"),
  /** Only while joining: the first day, its year, and the section planned for it (sectionId stays empty until the day). */
  joinsOn: date("joins_on"),
  joinsYearId: uuid("joins_year_id").references(() => academicYears.id, { onDelete: "restrict" }),
  joinsSectionId: uuid("joins_section_id").references(() => sections.id, { onDelete: "set null" }),
}, (t) => [
  ...tenant(t, "students"),
  index("students_joins").on(t.schoolId, t.joinsOn).where(sql`${t.status} = 'joining'`),
  uniqueIndex("students_admission_no").on(t.schoolId, t.admissionNo),
  index("students_user").on(t.schoolId, t.userId),
  index("students_section").on(t.schoolId, t.sectionId),
  index("students_status").on(t.schoolId, t.status),
]);

export const GUARDIAN_RELATIONS = ["father", "mother", "guardian"] as const;

export const guardians = pgTable("guardians", {
  ...schoolColumns(),
  name: text("name").notNull(),
  relation: text("relation").$type<(typeof GUARDIAN_RELATIONS)[number]>().notNull().default("guardian"),
  phone: text("phone"),
  email: text("email"),
  occupation: text("occupation"),
  /** Parent login (role parent). One login covers all their children in this school. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "guardians"), index("guardians_user").on(t.userId)]);

export const studentGuardians = pgTable("student_guardians", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [...tenant(t, "student_guardians"), uniqueIndex("student_guardians_unique").on(t.studentId, t.guardianId)]);

/** DPDP: who consented to what, and when. */
export const guardianConsents = pgTable("guardian_consents", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  guardianId: uuid("guardian_id").references(() => guardians.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull(), // "data_processing", "photo_on_website", ...
  granted: boolean("granted").notNull().default(true),
  method: text("method").notNull().default("paper_form"),
  recordedBy: uuid("recorded_by"),
  givenAt: timestamp("given_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [...tenant(t, "guardian_consents"), index("guardian_consents_student").on(t.studentId)]);

export const studentDocuments = pgTable("student_documents", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "birth_certificate", "transfer_certificate", "photo", "other"
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
  uploadedBy: uuid("uploaded_by"),
}, (t) => [...tenant(t, "student_documents"), index("student_documents_student").on(t.studentId)]);

/** One row per student per academic year: the history promotions write. */
export const studentEnrollments = pgTable("student_enrollments", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
  rollNo: integer("roll_no"),
  outcome: text("outcome").$type<"studying" | "promoted" | "retained" | "left" | "graduated">().notNull().default("studying"),
}, (t) => [...tenant(t, "student_enrollments"), uniqueIndex("student_enrollments_unique").on(t.studentId, t.yearId)]);
