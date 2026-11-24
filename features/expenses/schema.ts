import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { finAccounts, finCashAccounts, finCostCentres } from "@smw/feature-finance/schema";
import type { BILL_STATUSES, CLAIM_STATUSES, FREQUENCIES, OUT_METHODS, PETTY_STATUSES } from "./constants";

const paise = (name: string) => bigint(name, { mode: "number" });
const account = () => uuid("account_id").notNull().references(() => finAccounts.id, { onDelete: "restrict" });
const costCentre = () => uuid("cost_centre_id").references(() => finCostCentres.id, { onDelete: "restrict" });
const cash = () => uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" });

export const expVendors = pgTable("exp_vendors", {
  ...schoolColumns(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  gstin: text("gstin"),
  /** Sealed with feature-kit/secret; `*Last4` is what screens show. */
  panSealed: text("pan_sealed"),
  panLast4: text("pan_last4"),
  bankSealed: text("bank_sealed"),
  bankLast4: text("bank_last4"),
  ifsc: text("ifsc"),
  upiId: text("upi_id"),
  /** Basis points withheld by default. */
  tdsBasisPoints: integer("tds_basis_points").notNull().default(0),
  defaultAccountId: uuid("default_account_id").references(() => finAccounts.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "exp_vendors"), uniqueIndex("exp_vendors_name").on(t.schoolId, sql`lower(${t.name})`)]);

/** A vendor's bill. Draft → pending (approval) → approved → paid; posts when approved. */
export const expBills = pgTable("exp_bills", {
  ...schoolColumns(),
  vendorId: uuid("vendor_id").notNull().references(() => expVendors.id, { onDelete: "restrict" }),
  billNo: text("bill_no").notNull(),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date").notNull(),
  status: text("status").$type<(typeof BILL_STATUSES)[number]>().notNull().default("draft"),
  note: text("note"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  grossPaise: paise("gross_paise").notNull().default(0),
  tdsPaise: paise("tds_paise").notNull().default(0),
  paidPaise: paise("paid_paise").notNull().default(0),
  /** Made by a recurring cost or our own subscription: once per key. */
  sourceKey: text("source_key"),
  createdBy: uuid("created_by"),
}, (t) => [
  ...tenant(t, "exp_bills"),
  uniqueIndex("exp_bills_number").on(t.vendorId, sql`lower(${t.billNo})`).where(sql`status <> 'cancelled'`),
  uniqueIndex("exp_bills_source").on(t.schoolId, t.sourceKey),
  index("exp_bills_status").on(t.schoolId, t.status, t.dueDate),
  check("exp_bills_paid", sql`paid_paise >= 0 and paid_paise <= gross_paise - tds_paise`),
]);

export const expBillLines = pgTable("exp_bill_lines", {
  ...schoolColumns(),
  billId: uuid("bill_id").notNull().references(() => expBills.id, { onDelete: "cascade" }),
  accountId: account(),
  costCentreId: costCentre(),
  vehicleId: uuid("vehicle_id"),
  label: text("label").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** GST inside the line, for the record; schools usually cannot claim it, so it stays part of the cost. */
  gstPaise: paise("gst_paise").notNull().default(0),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "exp_bill_lines"), index("exp_bill_lines_bill").on(t.billId), index("exp_bill_lines_account").on(t.schoolId, t.accountId), check("exp_bill_lines_amount", sql`amount_paise > 0`)]);

/** One payment to one vendor, covering one or more bills. Reversed, never edited. */
export const expPayments = pgTable("exp_payments", {
  ...schoolColumns(),
  number: text("number").notNull(),
  vendorId: uuid("vendor_id").notNull().references(() => expVendors.id, { onDelete: "restrict" }),
  date: date("date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  method: text("method").$type<(typeof OUT_METHODS)[number]>().notNull(),
  cashAccountId: cash(),
  reference: text("reference"),
  status: text("status").$type<"valid" | "reversed">().notNull().default("valid"),
  reverseReason: text("reverse_reason"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "exp_payments"), uniqueIndex("exp_payments_number").on(t.schoolId, t.number), index("exp_payments_vendor").on(t.vendorId), index("exp_payments_date").on(t.schoolId, t.date)]);

export const expPaymentBills = pgTable("exp_payment_bills", {
  ...schoolColumns(),
  paymentId: uuid("payment_id").notNull().references(() => expPayments.id, { onDelete: "restrict" }),
  billId: uuid("bill_id").notNull().references(() => expBills.id, { onDelete: "restrict" }),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "exp_payment_bills"), uniqueIndex("exp_payment_bills_unique").on(t.paymentId, t.billId), index("exp_payment_bills_bill").on(t.billId)]);

/** Rent, electricity, internet: a draft bill appears each period. */
export const expRecurring = pgTable("exp_recurring", {
  ...schoolColumns(),
  vendorId: uuid("vendor_id").notNull().references(() => expVendors.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  frequency: text("frequency").$type<(typeof FREQUENCIES)[number]>().notNull(),
  nextOn: date("next_on").notNull(),
  endsOn: date("ends_on"),
  dueDays: integer("due_days").notNull().default(7),
  lines: jsonb("lines").$type<{ accountId: string; costCentreId?: string | null; label: string; amountPaise: number }[]>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "exp_recurring"), index("exp_recurring_next").on(t.schoolId, t.nextOn)]);

/** A person's petty cash float and each spend from it. */
export const expPettyFloats = pgTable("exp_petty_floats", {
  ...schoolColumns(),
  holderId: uuid("holder_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  limitPaise: paise("limit_paise").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "exp_petty_floats"), uniqueIndex("exp_petty_floats_name").on(t.schoolId, t.name)]);

export const expPettyEntries = pgTable("exp_petty_entries", {
  ...schoolColumns(),
  floatId: uuid("float_id").notNull().references(() => expPettyFloats.id, { onDelete: "restrict" }),
  kind: text("kind").$type<"top_up" | "spend" | "return">().notNull(),
  date: date("date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  accountId: uuid("account_id").references(() => finAccounts.id, { onDelete: "restrict" }),
  costCentreId: costCentre(),
  cashAccountId: cash(),
  label: text("label").notNull(),
  fileKey: text("file_key"),
  status: text("status").$type<(typeof PETTY_STATUSES)[number]>().notNull().default("posted"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "exp_petty_entries"), index("exp_petty_entries_float").on(t.floatId), check("exp_petty_entries_amount", sql`amount_paise > 0`)]);

export const expClaims = pgTable("exp_claims", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  spentOn: date("spent_on").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  accountId: uuid("account_id").references(() => finAccounts.id, { onDelete: "restrict" }),
  costCentreId: costCentre(),
  fileKey: text("file_key"),
  status: text("status").$type<(typeof CLAIM_STATUSES)[number]>().notNull().default("submitted"),
  /** How it is paid back: straight away, or with the next salary. */
  payWith: text("pay_with").$type<"now" | "salary">().notNull().default("now"),
  cashAccountId: cash(),
  paidOn: date("paid_on"),
  /** The payroll run that paid it. */
  payrollRef: uuid("payroll_ref"),
}, (t) => [...tenant(t, "exp_claims"), index("exp_claims_user").on(t.schoolId, t.userId), index("exp_claims_status").on(t.schoolId, t.status), check("exp_claims_amount", sql`amount_paise > 0`)]);

export const expBudgets = pgTable("exp_budgets", {
  ...schoolColumns(),
  fy: text("fy").notNull(),
  accountId: account(),
  costCentreId: costCentre(),
  /** 12 months, April first. */
  months: jsonb("months").$type<number[]>().notNull(),
  onOver: text("on_over").$type<"warn" | "block">().notNull().default("warn"),
}, (t) => [...tenant(t, "exp_budgets"), uniqueIndex("exp_budgets_unique").on(t.schoolId, t.fy, t.accountId, sql`coalesce(${t.costCentreId}, '00000000-0000-0000-0000-000000000000'::uuid)`)]);

/** Money in that is not fees: hall rent, a donation, scrap, interest. */
export const expIncome = pgTable("exp_income", {
  ...schoolColumns(),
  number: text("number").notNull(),
  date: date("date").notNull(),
  fromName: text("from_name").notNull(),
  accountId: account(),
  costCentreId: costCentre(),
  label: text("label").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  method: text("method").$type<(typeof OUT_METHODS)[number]>().notNull(),
  cashAccountId: cash(),
  reference: text("reference"),
  status: text("status").$type<"valid" | "reversed">().notNull().default("valid"),
  reverseReason: text("reverse_reason"),
  verifyToken: text("verify_token").notNull(),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "exp_income"), uniqueIndex("exp_income_number").on(t.schoolId, t.number), index("exp_income_date").on(t.schoolId, t.date), uniqueIndex("exp_income_token").on(t.verifyToken)]);

/** When a budget alert last went out, so each threshold is told once. */
export const expBudgetAlerts = pgTable("exp_budget_alerts", {
  ...schoolColumns(),
  budgetId: uuid("budget_id").notNull().references(() => expBudgets.id, { onDelete: "cascade" }),
  percent: integer("percent").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [...tenant(t, "exp_budget_alerts"), uniqueIndex("exp_budget_alerts_unique").on(t.budgetId, t.percent)]);
