import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export const CASH_KINDS = ["cash", "bank"] as const;
export const JOURNAL_KINDS = ["auto", "manual", "transfer", "opening", "reversal"] as const;
export const PARTY_TYPES = ["student", "vendor", "staff"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export const PERIOD_STATUSES = ["open", "soft", "closed"] as const;
export const TEMPLATE_KINDS = ["receipt", "invoice", "statement", "certificate", "payslip", "voucher"] as const;

const paise = (name: string) => bigint(name, { mode: "number" });

/** Chart of accounts. `systemKey` marks the accounts the product posts to; those are never deleted. */
export const finAccounts = pgTable("fin_accounts", {
  ...schoolColumns(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").$type<(typeof ACCOUNT_TYPES)[number]>().notNull(),
  group: text("group_name").notNull(),
  systemKey: text("system_key"),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "fin_accounts"), uniqueIndex("fin_accounts_code").on(t.schoolId, t.code), uniqueIndex("fin_accounts_system").on(t.schoolId, t.systemKey)]);

/** Where money physically is: the cash box, a bank account. Each has its own ledger account. */
export const finCashAccounts = pgTable("fin_cash_accounts", {
  ...schoolColumns(),
  name: text("name").notNull(),
  kind: text("kind").$type<(typeof CASH_KINDS)[number]>().notNull(),
  accountId: uuid("account_id").notNull().references(() => finAccounts.id, { onDelete: "restrict" }),
  bankName: text("bank_name"),
  /** Last 4 digits only; the full number is never needed here. */
  accountLast4: text("account_last4"),
  ifsc: text("ifsc"),
  /** The school's own UPI ID, shown to families as a QR. */
  upiId: text("upi_id"),
  upiName: text("upi_name"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "fin_cash_accounts"), uniqueIndex("fin_cash_accounts_name").on(t.schoolId, t.name), uniqueIndex("fin_cash_accounts_account").on(t.accountId)]);

/** Department, class group, transport... an optional tag on a journal line. */
export const finCostCentres = pgTable("fin_cost_centres", {
  ...schoolColumns(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [...tenant(t, "fin_cost_centres"), uniqueIndex("fin_cost_centres_name").on(t.schoolId, t.name)]);

/** One balanced entry. Never edited or deleted: a wrong one is reversed by another. `source_key` posts a document once. */
export const finJournals = pgTable("fin_journals", {
  ...schoolColumns(),
  number: text("number").notNull(),
  date: date("date").notNull(),
  /** Set when the document's own date fell in a closed month and the entry landed in the next open one. */
  originalDate: date("original_date"),
  kind: text("kind").$type<(typeof JOURNAL_KINDS)[number]>().notNull(),
  sourceKey: text("source_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  memo: text("memo").notNull(),
  reversesId: uuid("reverses_id").references((): AnyPgColumn => finJournals.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by"),
}, (t) => [
  ...tenant(t, "fin_journals"),
  uniqueIndex("fin_journals_source").on(t.schoolId, t.sourceKey),
  uniqueIndex("fin_journals_number").on(t.schoolId, t.number),
  uniqueIndex("fin_journals_reverses").on(t.reversesId),
  index("fin_journals_date").on(t.schoolId, t.date),
  index("fin_journals_ref").on(t.schoolId, t.sourceType, t.sourceId),
]);

export const finJournalLines = pgTable("fin_journal_lines", {
  ...schoolColumns(),
  journalId: uuid("journal_id").notNull().references(() => finJournals.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull().references(() => finAccounts.id, { onDelete: "restrict" }),
  debitPaise: paise("debit_paise").notNull().default(0),
  creditPaise: paise("credit_paise").notNull().default(0),
  partyType: text("party_type").$type<(typeof PARTY_TYPES)[number]>(),
  partyId: uuid("party_id"),
  costCentreId: uuid("cost_centre_id").references(() => finCostCentres.id, { onDelete: "restrict" }),
  memo: text("memo"),
}, (t) => [
  ...tenant(t, "fin_journal_lines"),
  check("fin_journal_lines_one_side", sql`(debit_paise > 0 and credit_paise = 0) or (credit_paise > 0 and debit_paise = 0)`),
  index("fin_journal_lines_journal").on(t.journalId),
  index("fin_journal_lines_account").on(t.schoolId, t.accountId),
  index("fin_journal_lines_party").on(t.schoolId, t.partyType, t.partyId),
]);

/** One row per request. The module that asked registers a handler for `kind`; deciding runs it in the same transaction. */
export const finApprovals = pgTable("fin_approvals", {
  ...schoolColumns(),
  kind: text("kind").notNull(),
  refType: text("ref_type").notNull(),
  refId: uuid("ref_id").notNull(),
  title: text("title").notNull(),
  amountPaise: paise("amount_paise").notNull().default(0),
  reason: text("reason").notNull(),
  href: text("href"),
  status: text("status").$type<(typeof APPROVAL_STATUSES)[number]>().notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
  /** True when the only admin approved their own request. */
  selfApproved: boolean("self_approved").notNull().default(false),
}, (t) => [...tenant(t, "fin_approvals"), index("fin_approvals_status").on(t.schoolId, t.status), uniqueIndex("fin_approvals_open").on(t.schoolId, t.kind, t.refId).where(sql`status = 'pending'`)]);

/** How each document is numbered. `locked` once a number was used. */
export const finSeries = pgTable("fin_series", {
  ...schoolColumns(),
  key: text("key").notNull(),
  prefix: text("prefix").notNull(),
  width: integer("width").notNull().default(6),
  startAt: integer("start_at").notNull().default(1),
  locked: boolean("locked").notNull().default(false),
}, (t) => [...tenant(t, "fin_series"), uniqueIndex("fin_series_key").on(t.schoolId, t.key)]);

/** A document layout. Saving makes a new version; a document keeps the version it was issued with. */
export const finTemplates = pgTable("fin_templates", {
  ...schoolColumns(),
  kind: text("kind").$type<(typeof TEMPLATE_KINDS)[number]>().notNull(),
  version: integer("version").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "fin_templates"), uniqueIndex("fin_templates_version").on(t.schoolId, t.kind, t.version)]);

/** Every print or download of a numbered document. The second one onwards says DUPLICATE. */
export const finPrints = pgTable("fin_prints", {
  ...schoolColumns(),
  docType: text("doc_type").notNull(),
  docId: uuid("doc_id").notNull(),
  copyNo: integer("copy_no").notNull(),
  printedBy: uuid("printed_by"),
}, (t) => [...tenant(t, "fin_prints"), uniqueIndex("fin_prints_copy").on(t.schoolId, t.docType, t.docId, t.copyNo)]);

/** A month's lock. No row = open. */
export const finPeriods = pgTable("fin_periods", {
  ...schoolColumns(),
  month: date("month").notNull(),
  status: text("status").$type<(typeof PERIOD_STATUSES)[number]>().notNull(),
  reason: text("reason"),
  changedBy: uuid("changed_by"),
}, (t) => [...tenant(t, "fin_periods"), uniqueIndex("fin_periods_month").on(t.schoolId, t.month)]);

/** One row per school; no row = the defaults in settings.ts. */
export const finSettings = pgTable("fin_settings", {
  ...schoolColumns(),
  basis: text("basis").$type<"accrual" | "cash">().notNull().default("accrual"),
  /** See FinanceSettings in settings.ts for the shape and defaults. */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [...tenant(t, "fin_settings"), uniqueIndex("fin_settings_school").on(t.schoolId)]);

export const finBankStatements = pgTable("fin_bank_statements", {
  ...schoolColumns(),
  cashAccountId: uuid("cash_account_id").notNull().references(() => finCashAccounts.id, { onDelete: "restrict" }),
  fileName: text("file_name").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  importedBy: uuid("imported_by"),
}, (t) => [...tenant(t, "fin_bank_statements")]);

export const finBankLines = pgTable("fin_bank_lines", {
  ...schoolColumns(),
  statementId: uuid("statement_id").notNull().references(() => finBankStatements.id, { onDelete: "restrict" }),
  cashAccountId: uuid("cash_account_id").notNull().references(() => finCashAccounts.id, { onDelete: "restrict" }),
  date: date("date").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  /** Positive = money in, negative = money out. */
  amountPaise: paise("amount_paise").notNull(),
  /** Same line imported twice is one row. */
  fingerprint: text("fingerprint").notNull(),
  journalLineId: uuid("journal_line_id").references(() => finJournalLines.id, { onDelete: "restrict" }),
  matchedBy: uuid("matched_by"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
}, (t) => [...tenant(t, "fin_bank_lines"), uniqueIndex("fin_bank_lines_fingerprint").on(t.cashAccountId, t.fingerprint), uniqueIndex("fin_bank_lines_match").on(t.journalLineId)]);

/** A manual entry waiting for approval. Approving posts it; the lines cannot change once asked. */
export const finJournalDrafts = pgTable("fin_journal_drafts", {
  ...schoolColumns(),
  date: date("date").notNull(),
  memo: text("memo").notNull(),
  lines: jsonb("lines").$type<{ accountId: string; debitPaise: number; creditPaise: number; costCentreId?: string | null; memo?: string }[]>().notNull(),
  createdBy: uuid("created_by").notNull(),
}, (t) => [...tenant(t, "fin_journal_drafts")]);

/** A bank line that settles several journal lines at once (one deposit slip for many receipts). A one-to-one match stays on fin_bank_lines.journal_line_id. */
export const finBankMatches = pgTable("fin_bank_matches", {
  ...schoolColumns(),
  bankLineId: uuid("bank_line_id").notNull().references(() => finBankLines.id, { onDelete: "restrict" }),
  journalLineId: uuid("journal_line_id").notNull().references(() => finJournalLines.id, { onDelete: "restrict" }),
}, (t) => [...tenant(t, "fin_bank_matches"), uniqueIndex("fin_bank_matches_line").on(t.journalLineId), index("fin_bank_matches_bank").on(t.bankLineId)]);

/** "Record as other entry" from a bank line: the draft entry waiting for approval. Approving posts it and matches the bank line. */
export const finBankDrafts = pgTable("fin_bank_drafts", {
  ...schoolColumns(),
  bankLineId: uuid("bank_line_id").notNull().references(() => finBankLines.id, { onDelete: "restrict" }),
  draftId: uuid("draft_id").notNull().references(() => finJournalDrafts.id, { onDelete: "restrict" }),
}, (t) => [...tenant(t, "fin_bank_drafts"), uniqueIndex("fin_bank_drafts_line").on(t.bankLineId)]);

/** One row per year-close run. Reopening marks the run `reopened`; closing again makes run + 1. */
export const finYearCloses = pgTable("fin_year_closes", {
  ...schoolColumns(),
  fy: text("fy").notNull(),
  run: integer("run").notNull().default(1),
  /** The closing entry; null when the year had no income or expense to carry. */
  journalId: uuid("journal_id").references(() => finJournals.id, { onDelete: "restrict" }),
  status: text("status").$type<"pending" | "closed" | "reopened">().notNull().default("closed"),
  surplusPaise: paise("surplus_paise").notNull().default(0),
  closedBy: uuid("closed_by"),
  reopenReason: text("reopen_reason"),
  reopenedBy: uuid("reopened_by"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
}, (t) => [...tenant(t, "fin_year_closes"), uniqueIndex("fin_year_closes_run").on(t.schoolId, t.fy, t.run)]);
