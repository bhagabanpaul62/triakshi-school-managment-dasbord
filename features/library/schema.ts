import { bigint, boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schoolColumns, tenant, users } from "@smw/db";
import { students } from "@smw/feature-students/schema";

export const books = pgTable("books", {
  ...schoolColumns(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  isbn: text("isbn"),
  publisher: text("publisher"),
  category: text("category").notNull(),
  language: text("language").notNull().default("English"),
}, (t) => [
  ...tenant(t, "books"),
  uniqueIndex("books_isbn").on(t.schoolId, t.isbn).where(sql`${t.isbn} is not null`),
  index("books_title").on(t.schoolId, t.title),
]);

export const COPY_STATUSES = ["available", "issued", "lost", "damaged"] as const;

export const bookCopies = pgTable("book_copies", {
  ...schoolColumns(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  /** Gap-free per school, from nextSequence(tx, schoolId, "accession"). */
  accessionNo: integer("accession_no").notNull(),
  status: text("status").$type<(typeof COPY_STATUSES)[number]>().notNull().default("available"),
  shelf: text("shelf"),
}, (t) => [...tenant(t, "book_copies"), uniqueIndex("book_copies_accession").on(t.schoolId, t.accessionNo), index("book_copies_book").on(t.bookId)]);

export const BORROWER_KINDS = ["student", "staff"] as const;

export const loans = pgTable("loans", {
  ...schoolColumns(),
  copyId: uuid("copy_id").notNull().references(() => bookCopies.id, { onDelete: "cascade" }),
  borrowerKind: text("borrower_kind").$type<(typeof BORROWER_KINDS)[number]>().notNull(),
  studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
  /** The staff member's login when borrowerKind = staff. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  issuedOn: date("issued_on").notNull(),
  dueOn: date("due_on").notNull(),
  returnedOn: date("returned_on"),
  /** Fine charged at return, in paise. Open loans accrue a fine that is computed, not stored. */
  finePaise: bigint("fine_paise", { mode: "number" }).notNull().default(0),
  fineWaived: boolean("fine_waived").notNull().default(false),
  issuedBy: uuid("issued_by"),
  /** How many times this loan was renewed. */
  renewals: integer("renewals").notNull().default(0),
  /** Set when the fine is posted to the fee ledger (a later stream does the posting). Null until then. */
  finePostedAt: timestamp("fine_posted_at", { withTimezone: true }),
  /** The last day an overdue reminder went out; one a week. */
  lastReminderOn: date("last_reminder_on"),
}, (t) => [
  ...tenant(t, "loans"),
  // a copy can be out on one loan at a time
  uniqueIndex("loans_open_copy").on(t.copyId).where(sql`${t.returnedOn} is null`),
  index("loans_student").on(t.schoolId, t.studentId),
  index("loans_user").on(t.schoolId, t.userId),
  index("loans_due").on(t.schoolId, t.returnedOn, t.dueOn),
]);

/** One row per school; no row means the defaults in rules.ts. */
export const librarySettings = pgTable("library_settings", {
  ...schoolColumns(),
  loanDays: integer("loan_days").notNull().default(14),
  studentLimit: integer("student_limit").notNull().default(2),
  staffLimit: integer("staff_limit").notNull().default(5),
  finePerDayPaise: integer("fine_per_day_paise").notNull().default(200),
  renewalsAllowed: integer("renewals_allowed").notNull().default(1),
}, (t) => [...tenant(t, "library_settings"), uniqueIndex("library_settings_school").on(t.schoolId)]);

export const HOLD_STATUSES = ["waiting", "ready", "fulfilled", "cancelled"] as const;

/** A reservation on a title. The first waiting hold becomes "ready" when a copy comes back, for 3 days. */
export const bookHolds = pgTable("book_holds", {
  ...schoolColumns(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").references(() => students.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<(typeof HOLD_STATUSES)[number]>().notNull().default("waiting"),
  /** Last day the held copy is kept aside (set when ready). */
  readyUntil: date("ready_until"),
}, (t) => [
  ...tenant(t, "book_holds"),
  index("book_holds_book").on(t.schoolId, t.bookId, t.status),
  // one live hold per member per title
  uniqueIndex("book_holds_student_live").on(t.bookId, t.studentId).where(sql`${t.status} in ('waiting','ready') and ${t.studentId} is not null`),
  uniqueIndex("book_holds_user_live").on(t.bookId, t.userId).where(sql`${t.status} in ('waiting','ready') and ${t.userId} is not null`),
]);
