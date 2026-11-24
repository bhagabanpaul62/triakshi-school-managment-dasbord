import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { finAccounts, finCashAccounts } from "@smw/feature-finance/schema";
import { students } from "@smw/feature-students/schema";
import type { ADMISSION_TYPES, ADVANCE_KINDS, CHEQUE_STATUSES, CONCESSION_STATUSES, FEE_HEAD_KINDS, FEE_HEAD_TYPES, INVOICE_KINDS, INVOICE_STATUSES, LINE_KINDS, LateRule, NOTE_KINDS, NOTE_REASONS, PAY_METHODS, PLAN_STATUSES, RECEIPT_STATUSES, REFUND_SOURCES, REQUEST_STATUSES, SLIP_STATUSES } from "./constants";

// Money rows outlive everything: every key to a student, year, class or document is RESTRICT, so nothing can cascade a receipt away.
const paise = (name: string) => bigint(name, { mode: "number" });
const student = () => uuid("student_id").notNull().references(() => students.id, { onDelete: "restrict" });
const year = () => uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "restrict" });

// ---------- setup ----------

/** What a fee is for. `type` deposit = refundable money we owe back, never income. */
export const feeHeads = pgTable("fee_heads", {
  ...schoolColumns(),
  name: text("name").notNull(),
  kind: text("kind").$type<(typeof FEE_HEAD_KINDS)[number]>().notNull().default("other"),
  type: text("type").$type<(typeof FEE_HEAD_TYPES)[number]>().notNull().default("income"),
  /** Income account; null = Fee income. */
  accountId: uuid("account_id").references(() => finAccounts.id, { onDelete: "restrict" }),
  /** Counts on the tuition certificate. */
  isTuition: boolean("is_tuition").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "fee_heads"), uniqueIndex("fee_heads_name").on(t.schoolId, t.name)]);

/**
 * A price list for some classes in one year. Published plans never change: an edit is a new draft version with the same
 * `rootId`, and bills already issued for a root and due key are never issued again.
 */
export const feePlans = pgTable("fee_plans", {
  ...schoolColumns(),
  yearId: year(),
  rootId: uuid("root_id").notNull(),
  version: integer("version").notNull().default(1),
  name: text("name").notNull(),
  status: text("status").$type<(typeof PLAN_STATUSES)[number]>().notNull().default("draft"),
  admissionType: text("admission_type").$type<(typeof ADMISSION_TYPES)[number]>().notNull().default("all"),
  lateRule: jsonb("late_rule").$type<LateRule | null>(),
  /** Mid-year joiners: bill everything, only months from joining on, or only terms from joining on. */
  joinRule: text("join_rule").$type<"full" | "due_after_joining">().notNull().default("due_after_joining"),
  note: text("note"),
  approvalFileKey: text("approval_file_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_plans"), uniqueIndex("fee_plans_version").on(t.rootId, t.version), index("fee_plans_year").on(t.schoolId, t.yearId, t.status)]);

export const feePlanClasses = pgTable("fee_plan_classes", {
  ...schoolColumns(),
  planId: uuid("plan_id").notNull().references(() => feePlans.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "restrict" }),
}, (t) => [...tenant(t, "fee_plan_classes"), uniqueIndex("fee_plan_classes_unique").on(t.planId, t.classId)]);

export const feePlanLines = pgTable("fee_plan_lines", {
  ...schoolColumns(),
  planId: uuid("plan_id").notNull().references(() => feePlans.id, { onDelete: "cascade" }),
  headId: uuid("head_id").notNull().references(() => feeHeads.id, { onDelete: "restrict" }),
  /** Billed only to students who opted in. */
  optional: boolean("optional").notNull().default(false),
}, (t) => [...tenant(t, "fee_plan_lines"), uniqueIndex("fee_plan_lines_head").on(t.planId, t.headId)]);

/** One bill of one line: "2026-07" for July, "T1", "ONCE". All dues of a plan with the same key make one invoice. */
export const feePlanDues = pgTable("fee_plan_dues", {
  ...schoolColumns(),
  lineId: uuid("line_id").notNull().references(() => feePlanLines.id, { onDelete: "cascade" }),
  dueKey: text("due_key").notNull(),
  label: text("label").notNull(),
  billOn: date("bill_on").notNull(),
  dueOn: date("due_on").notNull(),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "fee_plan_dues"), uniqueIndex("fee_plan_dues_key").on(t.lineId, t.dueKey), check("fee_plan_dues_amount", sql`amount_paise > 0`)]);

/** A student on a plan other than their class's. */
export const feeStudentPlans = pgTable("fee_student_plans", {
  ...schoolColumns(),
  studentId: student(),
  yearId: year(),
  rootId: uuid("root_id").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_student_plans"), uniqueIndex("fee_student_plans_unique").on(t.studentId, t.yearId)]);

/** Optional heads a student takes. */
export const feeOptIns = pgTable("fee_opt_ins", {
  ...schoolColumns(),
  studentId: student(),
  yearId: year(),
  headId: uuid("head_id").notNull().references(() => feeHeads.id, { onDelete: "restrict" }),
}, (t) => [...tenant(t, "fee_opt_ins"), uniqueIndex("fee_opt_ins_unique").on(t.studentId, t.yearId, t.headId)]);

// ---------- invoices ----------

/**
 * A bill, frozen when issued: class, names and prices are copied in. Draft → issued → cancelled (unpaid only).
 * Editing an issued bill cancels it and issues a new version (`replacesId`). The totals are caches of the lines, kept in
 * the same transaction and checked nightly. due = gross - concession - credited + late - paid.
 */
export const feeInvoices = pgTable("fee_invoices", {
  ...schoolColumns(),
  /** Null while a draft. */
  number: text("number"),
  studentId: student(),
  yearId: year(),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "restrict" }),
  kind: text("kind").$type<(typeof INVOICE_KINDS)[number]>().notNull(),
  status: text("status").$type<(typeof INVOICE_STATUSES)[number]>().notNull().default("draft"),
  /** Set for bills made by the system, so each is made once: "plan:<root>:<student>:<dueKey>", "transport:<student>:2026-07". */
  sourceKey: text("source_key"),
  label: text("label").notNull(),
  issueDate: date("issue_date"),
  dueDate: date("due_date").notNull(),
  version: integer("version").notNull().default(1),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => feeInvoices.id, { onDelete: "restrict" }),
  note: text("note"),
  /** Who it was for, as it was that day. */
  snapshot: jsonb("snapshot").$type<{ studentName: string; admissionNo: string; classLabel: string; guardian: string | null }>().notNull(),
  lateRule: jsonb("late_rule").$type<LateRule | null>(),
  templateVersion: integer("template_version"),
  verifyToken: text("verify_token"),
  grossPaise: paise("gross_paise").notNull().default(0),
  concessionPaise: paise("concession_paise").notNull().default(0),
  creditedPaise: paise("credited_paise").notNull().default(0),
  latePaise: paise("late_paise").notNull().default(0),
  paidPaise: paise("paid_paise").notNull().default(0),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by"),
}, (t) => [
  ...tenant(t, "fee_invoices"),
  uniqueIndex("fee_invoices_number").on(t.schoolId, t.number),
  // One live bill per source: cancelled ones step aside so the charge can come back.
  uniqueIndex("fee_invoices_source").on(t.schoolId, t.sourceKey).where(sql`status <> 'cancelled'`),
  uniqueIndex("fee_invoices_token").on(t.verifyToken),
  index("fee_invoices_student").on(t.schoolId, t.studentId, t.status),
  index("fee_invoices_open").on(t.schoolId, t.dueDate).where(sql`status = 'issued' and paid_paise < gross_paise - concession_paise - credited_paise + late_paise`),
  check("fee_invoices_paid", sql`paid_paise >= 0 and paid_paise <= gross_paise - concession_paise - credited_paise + late_paise`),
]);

export const feeInvoiceLines = pgTable("fee_invoice_lines", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => feeInvoices.id, { onDelete: "restrict" }),
  headId: uuid("head_id").references(() => feeHeads.id, { onDelete: "restrict" }),
  kind: text("kind").$type<(typeof LINE_KINDS)[number]>().notNull().default("fee"),
  label: text("label").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  concessionPaise: paise("concession_paise").notNull().default(0),
  creditedPaise: paise("credited_paise").notNull().default(0),
  paidPaise: paise("paid_paise").notNull().default(0),
  sort: integer("sort").notNull().default(0),
}, (t) => [
  ...tenant(t, "fee_invoice_lines"),
  index("fee_invoice_lines_invoice").on(t.invoiceId),
  index("fee_invoice_lines_head").on(t.schoolId, t.headId),
  check("fee_invoice_lines_paid", sql`amount_paise > 0 and concession_paise >= 0 and credited_paise >= 0 and paid_paise >= 0 and concession_paise + credited_paise + paid_paise <= amount_paise`),
]);

/** Part of an invoice due on its own date (a settlement or a payment plan). The parts add up to what was open that day. */
export const feeDueParts = pgTable("fee_due_parts", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => feeInvoices.id, { onDelete: "restrict" }),
  dueOn: date("due_on").notNull(),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "fee_due_parts"), uniqueIndex("fee_due_parts_unique").on(t.invoiceId, t.dueOn)]);

/** Credit or debit note against an invoice: a concession, a waiver, a write-off or a correction. */
export const feeNotes = pgTable("fee_notes", {
  ...schoolColumns(),
  number: text("number"),
  invoiceId: uuid("invoice_id").notNull().references(() => feeInvoices.id, { onDelete: "restrict" }),
  studentId: student(),
  kind: text("kind").$type<(typeof NOTE_KINDS)[number]>().notNull(),
  reasonType: text("reason_type").$type<(typeof NOTE_REASONS)[number]>().notNull(),
  reason: text("reason").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  lines: jsonb("lines").$type<{ lineId: string; amountPaise: number }[]>().notNull(),
  status: text("status").$type<(typeof REQUEST_STATUSES)[number]>().notNull().default("pending"),
  issuedOn: date("issued_on"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_notes"), uniqueIndex("fee_notes_number").on(t.schoolId, t.number), index("fee_notes_invoice").on(t.invoiceId), index("fee_notes_student").on(t.schoolId, t.studentId)]);

// ---------- concessions and settlements ----------

export const feeConcessionTypes = pgTable("fee_concession_types", {
  ...schoolColumns(),
  name: text("name").notNull(),
  /** Suggested by the system from siblings or the RTE flag. */
  auto: text("auto").$type<"sibling" | "rte" | "staff_child">(),
  mode: text("mode").$type<"percent" | "amount">().notNull(),
  /** Basis points or paise. */
  value: paise("value").notNull(),
  headId: uuid("head_id").references(() => feeHeads.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "fee_concession_types"), uniqueIndex("fee_concession_types_name").on(t.schoolId, t.name)]);

/** A discount for one student in one year. Approved ones cut every bill issued while they last, and open bills by a note. */
export const feeConcessions = pgTable("fee_concessions", {
  ...schoolColumns(),
  studentId: student(),
  yearId: year(),
  typeId: uuid("type_id").references(() => feeConcessionTypes.id, { onDelete: "restrict" }),
  headId: uuid("head_id").references(() => feeHeads.id, { onDelete: "restrict" }),
  mode: text("mode").$type<"percent" | "amount">().notNull(),
  value: paise("value").notNull(),
  reason: text("reason").notNull(),
  fileKey: text("file_key"),
  status: text("status").$type<(typeof CONCESSION_STATUSES)[number]>().notNull().default("pending"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_concessions"), index("fee_concessions_student").on(t.studentId, t.yearId)]);

/** One approved deal on a student's dues: waive, write off, split into dated parts, use advance or deposit. */
export const feeSettlements = pgTable("fee_settlements", {
  ...schoolColumns(),
  studentId: student(),
  reason: text("reason").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<(typeof REQUEST_STATUSES)[number]>().notNull().default("pending"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_settlements"), index("fee_settlements_student").on(t.schoolId, t.studentId)]);

// ---------- receipts ----------

/** One person's cash session at the counter. */
export const feeCounters = pgTable("fee_counters", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull(),
  cashAccountId: uuid("cash_account_id").notNull().references(() => finCashAccounts.id, { onDelete: "restrict" }),
  day: date("day").notNull(),
  floatPaise: paise("float_paise").notNull().default(0),
  expectedPaise: paise("expected_paise"),
  countedPaise: paise("counted_paise"),
  denominations: jsonb("denominations").$type<Record<string, number>>(),
  differenceReason: text("difference_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [...tenant(t, "fee_counters"), uniqueIndex("fee_counters_open").on(t.schoolId, t.userId).where(sql`closed_at is null`), uniqueIndex("fee_counters_day").on(t.schoolId, t.userId, t.day)]);

/** Money received. Never edited; a wrong one is reversed with approval and keeps its number. May pay siblings' bills too. */
export const feeReceipts = pgTable("fee_receipts", {
  ...schoolColumns(),
  number: text("number").notNull(),
  studentId: student(),
  date: date("date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** The part that paid no bill and became an advance. */
  advancePaise: paise("advance_paise").notNull().default(0),
  status: text("status").$type<(typeof RECEIPT_STATUSES)[number]>().notNull().default("valid"),
  counterId: uuid("counter_id").references(() => feeCounters.id, { onDelete: "restrict" }),
  payerName: text("payer_name"),
  note: text("note"),
  snapshot: jsonb("snapshot").$type<{ studentName: string; admissionNo: string; classLabel: string; guardian: string | null }>().notNull(),
  templateVersion: integer("template_version"),
  verifyToken: text("verify_token").notNull(),
  collectedBy: uuid("collected_by"),
  reverseReason: text("reverse_reason"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "fee_receipts"),
  uniqueIndex("fee_receipts_number").on(t.schoolId, t.number),
  uniqueIndex("fee_receipts_token").on(t.verifyToken),
  index("fee_receipts_student").on(t.schoolId, t.studentId),
  index("fee_receipts_date").on(t.schoolId, t.date),
  check("fee_receipts_amount", sql`amount_paise > 0 and advance_paise >= 0 and advance_paise <= amount_paise`),
]);

export const feeReceiptMethods = pgTable("fee_receipt_methods", {
  ...schoolColumns(),
  receiptId: uuid("receipt_id").notNull().references(() => feeReceipts.id, { onDelete: "restrict" }),
  method: text("method").$type<(typeof PAY_METHODS)[number]>().notNull(),
  amountPaise: paise("amount_paise").notNull(),
  cashAccountId: uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  /** UPI UTR, bank reference, cheque number. */
  reference: text("reference"),
}, (t) => [...tenant(t, "fee_receipt_methods"), index("fee_receipt_methods_receipt").on(t.receiptId), check("fee_receipt_methods_amount", sql`amount_paise > 0`)]);

/** Which bill line each rupee paid. `receiptId` null = an advance was used. */
export const feeAllocations = pgTable("fee_allocations", {
  ...schoolColumns(),
  receiptId: uuid("receipt_id").references(() => feeReceipts.id, { onDelete: "restrict" }),
  invoiceLineId: uuid("invoice_line_id").notNull().references(() => feeInvoiceLines.id, { onDelete: "restrict" }),
  studentId: student(),
  amountPaise: paise("amount_paise").notNull(),
  date: date("date").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
}, (t) => [...tenant(t, "fee_allocations"), index("fee_allocations_receipt").on(t.receiptId), index("fee_allocations_line").on(t.invoiceLineId), index("fee_allocations_student").on(t.schoolId, t.studentId), index("fee_allocations_date").on(t.schoolId, t.date), check("fee_allocations_amount", sql`amount_paise > 0`)]);

/** A student's advance as a running list; the balance is the sum. */
export const feeAdvances = pgTable("fee_advances", {
  ...schoolColumns(),
  studentId: student(),
  kind: text("kind").$type<(typeof ADVANCE_KINDS)[number]>().notNull(),
  /** Positive in, negative out. */
  amountPaise: paise("amount_paise").notNull(),
  refId: uuid("ref_id"),
  note: text("note"),
  date: date("date").notNull(),
}, (t) => [...tenant(t, "fee_advances"), index("fee_advances_student").on(t.schoolId, t.studentId)]);

export const feeCheques = pgTable("fee_cheques", {
  ...schoolColumns(),
  receiptId: uuid("receipt_id").notNull().references(() => feeReceipts.id, { onDelete: "restrict" }),
  chequeNo: text("cheque_no").notNull(),
  bank: text("bank").notNull(),
  chequeDate: date("cheque_date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  status: text("status").$type<(typeof CHEQUE_STATUSES)[number]>().notNull().default("received"),
  depositedTo: uuid("deposited_to").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  depositedOn: date("deposited_on"),
  clearedOn: date("cleared_on"),
  bouncedOn: date("bounced_on"),
  bounceReason: text("bounce_reason"),
}, (t) => [...tenant(t, "fee_cheques"), uniqueIndex("fee_cheques_receipt").on(t.receiptId), index("fee_cheques_status").on(t.schoolId, t.status)]);

/** Money back to a family, from an advance or a deposit. */
export const feeRefunds = pgTable("fee_refunds", {
  ...schoolColumns(),
  number: text("number"),
  studentId: student(),
  source: text("source").$type<(typeof REFUND_SOURCES)[number]>().notNull(),
  amountPaise: paise("amount_paise").notNull(),
  method: text("method").$type<"cash" | "cheque" | "upi" | "bank_transfer">().notNull(),
  cashAccountId: uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  reference: text("reference"),
  reason: text("reason").notNull(),
  status: text("status").$type<(typeof REQUEST_STATUSES)[number]>().notNull().default("pending"),
  paidOn: date("paid_on"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_refunds"), uniqueIndex("fee_refunds_number").on(t.schoolId, t.number), index("fee_refunds_student").on(t.schoolId, t.studentId)]);

/** A family says it paid by UPI. The office checks the bank and turns it into a receipt. */
export const feeUpiSlips = pgTable("fee_upi_slips", {
  ...schoolColumns(),
  studentId: student(),
  amountPaise: paise("amount_paise").notNull(),
  utr: text("utr").notNull(),
  paidOn: date("paid_on").notNull(),
  invoiceIds: jsonb("invoice_ids").$type<string[]>().notNull(),
  fileKey: text("file_key"),
  status: text("status").$type<(typeof SLIP_STATUSES)[number]>().notNull().default("submitted"),
  reason: text("reason"),
  receiptId: uuid("receipt_id").references(() => feeReceipts.id, { onDelete: "restrict" }),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [...tenant(t, "fee_upi_slips"), uniqueIndex("fee_upi_slips_utr").on(t.schoolId, t.utr).where(sql`status <> 'rejected'`), index("fee_upi_slips_status").on(t.schoolId, t.status)]);

// ---------- chasing ----------

export const feeReminders = pgTable("fee_reminder_log", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => feeInvoices.id, { onDelete: "restrict" }),
  studentId: student(),
  /** Days relative to the due date this reminder was for. */
  offsetDays: integer("offset_days").notNull(),
  dueOn: date("due_on").notNull(),
  sentOn: date("sent_on").notNull(),
}, (t) => [...tenant(t, "fee_reminder_log"), uniqueIndex("fee_reminder_log_unique").on(t.invoiceId, t.dueOn, t.offsetDays)]);

/** "I will pay by the 10th": reminders pause until then. */
export const feePromises = pgTable("fee_promises", {
  ...schoolColumns(),
  studentId: student(),
  promisedOn: date("promised_on").notNull(),
  amountPaise: paise("amount_paise"),
  note: text("note"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fee_promises"), index("fee_promises_student").on(t.schoolId, t.studentId)]);

/** A student the office does not want reminded. */
export const feeReminderStops = pgTable("fee_reminder_stops", {
  ...schoolColumns(),
  studentId: student(),
  reason: text("reason").notNull(),
}, (t) => [...tenant(t, "fee_reminder_stops"), uniqueIndex("fee_reminder_stops_student").on(t.schoolId, t.studentId)]);
