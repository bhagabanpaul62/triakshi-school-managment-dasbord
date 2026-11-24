// The fee tables before 2026-11, read only by scripts/move-fees.mts, which copies them into invoices and receipts.
// shortcut: kept one release so no receipt can be lost; drop this file and its tables once every school is moved.
import { bigint, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { feeHeads } from "./schema";

const paise = (name: string) => bigint(name, { mode: "number" });

/** What one class pays in one academic year. */
export const feeStructures = pgTable("fee_structures", {
  ...schoolColumns(),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [...tenant(t, "fee_structures"), uniqueIndex("fee_structures_class_year").on(t.schoolId, t.yearId, t.classId)]);

/** The yearly amount of each head in a structure (paise). Their sum is the structure total. */
export const feeStructureItems = pgTable("fee_structure_items", {
  ...schoolColumns(),
  structureId: uuid("structure_id").notNull().references(() => feeStructures.id, { onDelete: "cascade" }),
  headId: uuid("head_id").notNull().references(() => feeHeads.id, { onDelete: "restrict" }),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "fee_structure_items"), uniqueIndex("fee_structure_items_head").on(t.structureId, t.headId)]);

/** When money falls due. Installment amounts add up to the structure total (checked on save). */
export const installments = pgTable("installments", {
  ...schoolColumns(),
  structureId: uuid("structure_id").notNull().references(() => feeStructures.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dueDate: date("due_date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "installments"), index("installments_structure").on(t.structureId)]);

/** Late fee. installment_id null = applies to every installment of the structure; a row for one installment overrides it. */
export const lateFeeRules = pgTable("late_fee_rules", {
  ...schoolColumns(),
  structureId: uuid("structure_id").notNull().references(() => feeStructures.id, { onDelete: "cascade" }),
  installmentId: uuid("installment_id").references(() => installments.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"flat" | "per_day">().notNull(),
  amountPaise: paise("amount_paise").notNull(),
  graceDays: integer("grace_days").notNull().default(0),
  /** Most the late fee of one installment can reach. Null = no cap. */
  maxPaise: paise("max_paise"),
}, (t) => [...tenant(t, "late_fee_rules"), index("late_fee_rules_structure").on(t.structureId)]);

/** A discount for one student in one year. head_id null = on the whole fee. value: paise for "amount", basis points (1000 = 10%) for "percent". */
export const studentConcessions = pgTable("student_concessions", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  headId: uuid("head_id").references(() => feeHeads.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"amount" | "percent">().notNull(),
  value: bigint("value", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  approvedBy: uuid("approved_by"),
}, (t) => [...tenant(t, "student_concessions"), index("student_concessions_student").on(t.studentId, t.yearId)]);

/**
 * A due that sits beside the fee structure: one month of transport, a library fine. Each active charge is one more
 * line on the student's ledger. `source_key` is unique per school, so a feature posts the same charge only once
 * (for example "transport:<student>:2026-07", "library-fine:<loan>"). A paid charge is never cancelled.
 */
export const feeCharges = pgTable("fee_charges", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"transport" | "library_fine" | "other">().notNull(),
  label: text("label").notNull(),
  dueDate: date("due_date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  status: text("status").$type<"active" | "cancelled">().notNull().default("active"),
  sourceKey: text("source_key").notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "fee_charges"),
  uniqueIndex("fee_charges_source").on(t.schoolId, t.sourceKey),
  index("fee_charges_student").on(t.studentId, t.yearId),
]);

/** Money received. Never deleted; a wrong one is cancelled with a reason and keeps its receipt number. */
export const feePayments = pgTable("fee_payments", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  receiptNo: text("receipt_no").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  method: text("method").$type<"cash" | "cheque" | "upi" | "bank_transfer">().notNull(),
  reference: text("reference"),
  paidOn: date("paid_on").notNull(),
  collectedBy: uuid("collected_by"),
  status: text("status").$type<"valid" | "cancelled">().notNull().default("valid"),
  cancelReason: text("cancel_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "fee_payments"),
  uniqueIndex("fee_payments_receipt").on(t.schoolId, t.receiptNo),
  index("fee_payments_student").on(t.studentId, t.yearId),
  index("fee_payments_paid_on").on(t.schoolId, t.paidOn),
]);

/** Where a payment went: principal and late fee per installment. */
export const feePaymentAllocations = pgTable("fee_payment_allocations", {
  ...schoolColumns(),
  paymentId: uuid("payment_id").notNull().references(() => feePayments.id, { onDelete: "cascade" }),
  /** Exactly one of installment_id and charge_id is set. */
  installmentId: uuid("installment_id").references(() => installments.id, { onDelete: "cascade" }),
  chargeId: uuid("charge_id").references(() => feeCharges.id, { onDelete: "cascade" }),
  amountPaise: paise("amount_paise").notNull(),
  lateFeePaise: paise("late_fee_paise").notNull().default(0),
}, (t) => [...tenant(t, "fee_payment_allocations"), index("fee_payment_allocations_payment").on(t.paymentId), index("fee_payment_allocations_charge").on(t.chargeId)]);

/** Which overdue reminders went out, so the daily job never sends the same one twice. */
export const legacyFeeReminders = pgTable("fee_reminders", {
  ...schoolColumns(),
  installmentId: uuid("installment_id").notNull().references(() => installments.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"overdue">().notNull().default("overdue"),
  sentOn: date("sent_on").notNull(),
}, (t) => [...tenant(t, "fee_reminders"), uniqueIndex("fee_reminders_unique").on(t.installmentId, t.studentId, t.kind)]);
