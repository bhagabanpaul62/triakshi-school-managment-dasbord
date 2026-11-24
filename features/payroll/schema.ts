import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { finAccounts, finCashAccounts, finCostCentres } from "@smw/feature-finance/schema";
import type { COMPONENT_KINDS, COMPONENT_MODES, EXIT_STATUSES, LOAN_STATUSES, PAYOUT_STATUSES, RUN_KINDS, RUN_STATUSES } from "./constants";

// Every table starts with pay_: the school's general data export leaves these out unless the admin asks for payroll.
const paise = (name: string) => bigint(name, { mode: "number" });
const person = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" });

/** Identity and bank details, sealed with feature-kit/secret. Screens only ever see the last 4. */
export const payProfiles = pgTable("pay_profiles", {
  ...schoolColumns(),
  userId: person(),
  panSealed: text("pan_sealed"), panLast4: text("pan_last4"),
  uanSealed: text("uan_sealed"), uanLast4: text("uan_last4"),
  esiSealed: text("esi_sealed"), esiLast4: text("esi_last4"),
  bankSealed: text("bank_sealed"), bankLast4: text("bank_last4"),
  bankName: text("bank_name"),
  ifsc: text("ifsc"),
  /** When the account or IFSC last changed; a run flags changes of the last 30 days. */
  bankChangedAt: timestamp("bank_changed_at", { withTimezone: true }),
  payBy: text("pay_by").$type<"bank" | "cash" | "cheque">().notNull().default("bank"),
  regime: text("regime").$type<"new" | "old">().notNull().default("new"),
  /** State for professional tax and labour welfare fund; null = the school's. */
  state: text("state"),
  /** Null = worked out from pay; true/false = decided by the school. */
  pfApplies: boolean("pf_applies"),
  esiApplies: boolean("esi_applies"),
  ptApplies: boolean("pt_applies"),
  /** Pay PF on full wages instead of up to the ceiling. */
  pfOnFullWages: boolean("pf_on_full_wages").notNull().default(false),
  paysMonthly: boolean("pays_monthly").notNull().default(true),
  /** Salary lines of this person post to this cost centre. */
  costCentreId: uuid("cost_centre_id").references(() => finCostCentres.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "pay_profiles"), uniqueIndex("pay_profiles_user").on(t.userId)]);

/** A pay structure: an ordered list of components, with a version per change. */
export const payStructures = pgTable("pay_structures", {
  ...schoolColumns(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "pay_structures"), uniqueIndex("pay_structures_name").on(t.schoolId, t.name)]);

export const payComponents = pgTable("pay_components", {
  ...schoolColumns(),
  structureId: uuid("structure_id").notNull().references(() => payStructures.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: text("kind").$type<(typeof COMPONENT_KINDS)[number]>().notNull(),
  mode: text("mode").$type<(typeof COMPONENT_MODES)[number]>().notNull(),
  /** Paise for fixed, basis points for percent. */
  value: paise("value").notNull().default(0),
  isBasic: boolean("is_basic").notNull().default(false),
  /** Counts as "wages" for PF and gratuity (basic, DA); other allowances may be added back by the 50% rule. */
  isWage: boolean("is_wage").notNull().default(false),
  /** Cut when days are unpaid. */
  proRata: boolean("pro_rata").notNull().default(true),
  taxable: boolean("taxable").notNull().default(true),
  /** Where a deduction or employer cost is held until it is paid out; empty = "Other salary deductions". */
  accountId: uuid("account_id").references(() => finAccounts.id, { onDelete: "restrict" }),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "pay_components"), index("pay_components_structure").on(t.structureId)]);

/** What one person is paid from a date on. The newest row on or before a month applies. */
export const payAssignments = pgTable("pay_assignments", {
  ...schoolColumns(),
  userId: person(),
  structureId: uuid("structure_id").notNull().references(() => payStructures.id, { onDelete: "restrict" }),
  /** Monthly gross, paise. */
  grossPaise: paise("gross_paise").notNull(),
  fromDate: date("from_date").notNull(),
  /** Pay by the hour or period instead of the month. */
  hourlyPaise: paise("hourly_paise"),
  overrides: jsonb("overrides").$type<Record<string, number>>().notNull().default({}),
  reason: text("reason"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "pay_assignments"), uniqueIndex("pay_assignments_unique").on(t.userId, t.fromDate), check("pay_assignments_gross", sql`gross_paise >= 0`)]);

export const payRuns = pgTable("pay_runs", {
  ...schoolColumns(),
  kind: text("kind").$type<(typeof RUN_KINDS)[number]>().notNull(),
  /** First day of the month paid for. */
  month: date("month").notNull(),
  label: text("label").notNull(),
  status: text("status").$type<(typeof RUN_STATUSES)[number]>().notNull().default("draft"),
  /** Rates used, frozen at approval: key, value, source, confidence. */
  rates: jsonb("rates").$type<Record<string, unknown>[]>().notNull().default([]),
  totals: jsonb("totals").$type<Record<string, number>>().notNull().default({}),
  payDate: date("pay_date"),
  createdBy: uuid("created_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, (t) => [...tenant(t, "pay_runs"), uniqueIndex("pay_runs_month").on(t.schoolId, t.month).where(sql`kind = 'monthly' and status <> 'cancelled'`), index("pay_runs_list").on(t.schoolId, t.month)]);

/** One person in one run. */
export const payItems = pgTable("pay_items", {
  ...schoolColumns(),
  runId: uuid("run_id").notNull().references(() => payRuns.id, { onDelete: "restrict" }),
  userId: person(),
  payslipNo: text("payslip_no"),
  calendarDays: integer("calendar_days").notNull(),
  /** Days paid, in half-days: 60 = 30 days. */
  paidHalfDays: integer("paid_half_days").notNull(),
  unpaidHalfDays: integer("unpaid_half_days").notNull().default(0),
  unmarkedDays: integer("unmarked_days").notNull().default(0),
  hours: numeric("hours", { precision: 8, scale: 2 }),
  grossPaise: paise("gross_paise").notNull().default(0),
  deductionsPaise: paise("deductions_paise").notNull().default(0),
  employerPaise: paise("employer_paise").notNull().default(0),
  netPaise: paise("net_paise").notNull().default(0),
  /** Left out of this run (paid later as arrears), with why. */
  skippedReason: text("skipped_reason"),
  payout: text("payout").$type<(typeof PAYOUT_STATUSES)[number]>().notNull().default("pending"),
  payoutRef: text("payout_ref"),
  paidOn: date("paid_on"),
  cashAccountId: uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  failReason: text("fail_reason"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  templateVersion: integer("template_version"),
}, (t) => [...tenant(t, "pay_items"), uniqueIndex("pay_items_unique").on(t.runId, t.userId), uniqueIndex("pay_items_slip").on(t.schoolId, t.payslipNo), index("pay_items_user").on(t.schoolId, t.userId)]);

export const payLines = pgTable("pay_lines", {
  ...schoolColumns(),
  itemId: uuid("item_id").notNull().references(() => payItems.id, { onDelete: "cascade" }),
  kind: text("kind").$type<(typeof COMPONENT_KINDS)[number]>().notNull(),
  /** A statutory line's key, "loan", "claim", "arrears", "adjustment" or null for the school's own component. */
  code: text("code"),
  label: text("label").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  /** Typed by a person instead of worked out. */
  manual: boolean("manual").notNull().default(false),
  refId: uuid("ref_id"),
  note: text("note"),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "pay_lines"), index("pay_lines_item").on(t.itemId), index("pay_lines_code").on(t.schoolId, t.code)]);

export const payLoans = pgTable("pay_loans", {
  ...schoolColumns(),
  userId: person(),
  amountPaise: paise("amount_paise").notNull(),
  emiPaise: paise("emi_paise").notNull(),
  startsOn: date("starts_on").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<(typeof LOAN_STATUSES)[number]>().notNull().default("pending"),
  cashAccountId: uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  givenOn: date("given_on"),
  pausedUntil: date("paused_until"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "pay_loans"), index("pay_loans_user").on(t.schoolId, t.userId), check("pay_loans_amount", sql`amount_paise > 0 and emi_paise > 0`)]);

/** Recoveries; balance = amount - sum. `runId` null = paid back by hand. */
export const payLoanRepayments = pgTable("pay_loan_repayments", {
  ...schoolColumns(),
  loanId: uuid("loan_id").notNull().references(() => payLoans.id, { onDelete: "restrict" }),
  itemId: uuid("item_id").references(() => payItems.id, { onDelete: "restrict" }),
  date: date("date").notNull(),
  amountPaise: paise("amount_paise").notNull(),
}, (t) => [...tenant(t, "pay_loan_repayments"), index("pay_loan_repayments_loan").on(t.loanId)]);

export const payExits = pgTable("pay_exits", {
  ...schoolColumns(),
  userId: person(),
  lastDay: date("last_day").notNull(),
  reason: text("reason").notNull(),
  /** Leave encashment, notice, gratuity, recoveries: label, amount, kind, how it was worked out. */
  lines: jsonb("lines").$type<{ kind: "earning" | "deduction" | "employer"; code: string; label: string; amountPaise: number; note?: string; /** The claim or loan this line settles. */ refId?: string }[]>().notNull().default([]),
  status: text("status").$type<(typeof EXIT_STATUSES)[number]>().notNull().default("draft"),
  runId: uuid("run_id").references(() => payRuns.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "pay_exits"), uniqueIndex("pay_exits_user").on(t.userId, t.lastDay)]);

/** What a person declared for tax this year. */
export const payDeclarations = pgTable("pay_declarations", {
  ...schoolColumns(),
  userId: person(),
  fy: text("fy").notNull(),
  otherIncomePaise: paise("other_income_paise").notNull().default(0),
  deductionsPaise: paise("deductions_paise").notNull().default(0),
  previousSalaryPaise: paise("previous_salary_paise").notNull().default(0),
  previousTdsPaise: paise("previous_tds_paise").notNull().default(0),
  note: text("note"),
  /** What the person declared counts for tax only once the office has accepted it; any change clears this. */
  acceptedBy: uuid("accepted_by"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** Why the office sent it back. */
  returnedNote: text("returned_note"),
}, (t) => [...tenant(t, "pay_declarations"), uniqueIndex("pay_declarations_unique").on(t.userId, t.fy)]);

/** The school's own value for a statutory rate, over the built-in one. */
export const payRateOverrides = pgTable("pay_rate_overrides", {
  ...schoolColumns(),
  key: text("key").notNull(),
  state: text("state"),
  fromDate: date("from_date").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "pay_rate_overrides"), uniqueIndex("pay_rate_overrides_unique").on(t.schoolId, t.key, sql`coalesce(${t.state}, '')`, t.fromDate)]);

export const payConfig = pgTable("pay_config", {
  ...schoolColumns(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [...tenant(t, "pay_config"), uniqueIndex("pay_config_school").on(t.schoolId)]);

/** Money paid to the PF, ESI, PT or tax office. */
export const payRemittances = pgTable("pay_remittances", {
  ...schoolColumns(),
  key: text("key").notNull(),
  month: date("month").notNull(),
  amountPaise: paise("amount_paise").notNull(),
  paidOn: date("paid_on").notNull(),
  reference: text("reference"),
  cashAccountId: uuid("cash_account_id").references(() => finCashAccounts.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "pay_remittances"), index("pay_remittances_month").on(t.schoolId, t.key, t.month)]);
