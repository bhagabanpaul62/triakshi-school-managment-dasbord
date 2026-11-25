// Platform tables: schools, plans, modules, identity, billing, support. School-owned feature tables live in features/*/schema.ts.
import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgPolicy, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, bigint,
} from "drizzle-orm/pg-core";
import { createdAt, id, schoolColumns, tenant, updatedAt } from "../columns";

export const SCHOOL_STATUSES = ["pending", "rejected", "trial", "active", "past_due", "read_only", "suspended", "cancelled"] as const;
/** Base kinds. `parent` is legacy (parent logins were retired 2026-11-19; rows are disabled). `staff` = non-teaching staff whose access comes from a custom role. */
export const SCHOOL_ROLES = ["admin", "accountant", "teacher", "student", "parent", "staff"] as const;
/** Base kinds a custom role may sit on. */
export const CUSTOM_ROLE_BASES = ["staff", "teacher"] as const;
export const STAFF_ROLES = ["owner", "support", "sales"] as const;
export const MODULE_STAGES = ["alpha", "beta", "ga"] as const;
export const SUPPORT_ACCESS = ["always", "until", "never"] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];
export type SchoolRole = (typeof SCHOOL_ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ModuleStage = (typeof MODULE_STAGES)[number];

// ---------- schools and plans ----------

const OWN_SCHOOL_ROW = sql.raw("id = nullif(current_setting('app.school_id', true), '')::uuid");

export const plans = pgTable("plans", {
  id: id(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  studentCap: integer("student_cap").notNull(),
  priceAnnualPaise: bigint("price_annual_paise", { mode: "number" }).notNull(),
  priceMonthlyPaise: bigint("price_monthly_paise", { mode: "number" }).notNull(),
  limits: jsonb("limits").$type<Record<string, number | boolean>>().notNull().default({}),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("plans_key_version").on(t.key, t.version)]);

export const modules = pgTable("modules", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  stage: text("stage").$type<ModuleStage>().notNull().default("alpha"),
  requires: text("requires").array().notNull().default(sql`'{}'::text[]`),
  core: boolean("core").notNull().default(false),
  description: text("description"),
});

export const planModules = pgTable("plan_modules", {
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  moduleKey: text("module_key").notNull().references(() => modules.key, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.planId, t.moduleKey] })]);

export const schools = pgTable("schools", {
  id: id(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<SchoolStatus>().notNull().default("trial"),
  planId: uuid("plan_id").references(() => plans.id),
  studentCap: integer("student_cap").notNull().default(300),
  board: text("board"),
  state: text("state"),
  city: text("city"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  udiseCode: text("udise_code"),
  affiliationNo: text("affiliation_no"),
  schoolCode: text("school_code"),
  schoolType: text("school_type"),
  medium: text("medium"),
  establishedYear: integer("established_year"),
  district: text("district"),
  pincode: text("pincode"),
  website: text("website"),
  headName: text("head_name"),
  headQualification: text("head_qualification"),
  /** May Triakshi staff open this school: always, only while `support_access_until` is in the future, or never. */
  supportAccess: text("support_access").$type<(typeof SUPPORT_ACCESS)[number]>().notNull().default("always"),
  supportAccessUntil: timestamp("support_access_until", { withTimezone: true }),
  /** Public pages on any other address of this school redirect to its main domain. */
  redirectToPrimary: boolean("redirect_to_primary").notNull().default(true),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  academicYearStartMonth: integer("academic_year_start_month").notNull().default(4),
  theme: jsonb("theme").$type<Record<string, unknown>>(),
  logoUrl: text("logo_url"),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow(),
  deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("schools_slug").on(t.slug),
  pgPolicy("schools_own_row", { as: "permissive", for: "all", using: OWN_SCHOOL_ROW, withCheck: OWN_SCHOOL_ROW }),
]);

export const schoolDomains = pgTable("school_domains", {
  ...schoolColumns(),
  hostname: text("hostname").notNull(),
  kind: text("kind").$type<"subdomain" | "custom">().notNull().default("custom"),
  status: text("status").$type<"pending" | "verified" | "failed">().notNull().default("pending"),
  verifyToken: text("verify_token").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  checkError: text("check_error"),
  isPrimary: boolean("is_primary").notNull().default(false),
  /** Of a verified domain: each record on its own. Written by the platform only. */
  health: text("health").$type<"ok" | "warning" | "broken">(),
  failingSince: timestamp("failing_since", { withTimezone: true }),
  txtMissingSince: timestamp("txt_missing_since", { withTimezone: true }),
  records: jsonb("records").$type<DomainRecordCheck[]>().notNull().default([]),
  certExpiresAt: timestamp("cert_expires_at", { withTimezone: true }),
  dnsProvider: text("dns_provider"),
  toldAt: timestamp("told_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "school_domains"),
  // An unproven claim blocks nobody: only one school can hold a verified name, and a school lists a name once.
  uniqueIndex("school_domains_verified_hostname").on(t.hostname).where(sql`${t.status} = 'verified'`),
  uniqueIndex("school_domains_school_hostname").on(t.schoolId, t.hostname),
]);

/** One DNS or certificate check of a domain, as the school sees it. */
export interface DomainRecordCheck { key: "txt" | "cname" | "a" | "https"; ok: boolean; expected: string; found: string[]; note?: string }

/** What happened to a domain. Written by the platform and by the school's own actions; never edited. */
export const schoolDomainEvents = pgTable("school_domain_events", {
  ...schoolColumns(),
  domainId: uuid("domain_id"),
  hostname: text("hostname").notNull(),
  kind: text("kind").$type<"added" | "checked" | "verified" | "failing" | "recovered" | "failed" | "released" | "primary" | "removed" | "lost">().notNull(),
  detail: text("detail"),
  byName: text("by_name"),
}, (t) => [...tenant(t, "school_domain_events"), index("school_domain_events_domain").on(t.schoolId, t.domainId, t.createdAt)]);

export const schoolModuleOverrides = pgTable("school_module_overrides", {
  ...schoolColumns(),
  moduleKey: text("module_key").notNull().references(() => modules.key, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  setBy: uuid("set_by"),
}, (t) => [...tenant(t, "school_module_overrides"), uniqueIndex("smo_school_module").on(t.schoolId, t.moduleKey)]);

/** Gap-free counters: receipt numbers, invoice numbers. Platform-wide counters (our invoices) use the nil UUID as school_id. */
export const sequences = pgTable("sequences", {
  ...schoolColumns(),
  key: text("key").notNull(),
  value: integer("value").notNull().default(0),
}, (t) => [...tenant(t, "sequences"), uniqueIndex("sequences_school_key").on(t.schoolId, t.key)]);

// ---------- identity ----------

/** Custom roles a school admin builds: a name, a base kind (drives data scoping) and `feature:permission` grants. */
export const schoolRoles = pgTable("school_roles", {
  ...schoolColumns(),
  name: text("name").notNull(),
  base: text("base").$type<(typeof CUSTOM_ROLE_BASES)[number]>().notNull().default("staff"),
  grants: text("grants").array().notNull().default(sql`'{}'::text[]`),
  isTemplate: boolean("is_template").notNull().default(false),
  description: text("description"),
}, (t) => [...tenant(t, "school_roles"), uniqueIndex("school_roles_name").on(t.schoolId, sql`lower(${t.name})`)]);

export const users = pgTable("users", {
  ...schoolColumns(),
  role: text("role").$type<SchoolRole>().notNull(),
  loginId: text("login_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  status: text("status").$type<"active" | "invited" | "disabled">().notNull().default("active"),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Custom role; null = the defaults in each feature.ts for `role`. Never set for admins. */
  roleId: uuid("role_id").references(() => schoolRoles.id, { onDelete: "set null" }),
  /** Set for default or temporary passwords; the app blocks everything but /app/change-password until cleared. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** When the person proved they own `email` (a code or link sent to it). Cleared whenever the email changes. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Mail me when a new device signs in. Null = the default of the role (on for admins and accountants). */
  alertNewDevice: boolean("alert_new_device"),
}, (t) => [
  ...tenant(t, "users"),
  uniqueIndex("users_school_login").on(t.schoolId, sql`lower(${t.loginId})`),
  uniqueIndex("users_school_email").on(t.schoolId, sql`lower(${t.email})`),
  uniqueIndex("users_school_phone").on(t.schoolId, t.phone),
  index("users_school_role").on(t.schoolId, t.role),
]);

export const sessions = pgTable("sessions", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  supportStaffId: uuid("support_staff_id"),
  readOnly: boolean("read_only").notNull().default(false),
}, (t) => [...tenant(t, "sessions"), uniqueIndex("sessions_token").on(t.tokenHash)]);

/** One-time tokens: email verification, password reset, invites, console support login. */
export const oneTimeTokens = pgTable("one_time_tokens", {
  ...schoolColumns(),
  purpose: text("purpose").$type<"verify_email" | "reset_password" | "invite" | "support_login" | "change_email" | "email_otp">().notNull(),
  tokenHash: text("token_hash").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [...tenant(t, "one_time_tokens"), uniqueIndex("ott_token").on(t.tokenHash)]);

export const LOGIN_OUTCOMES = ["success", "bad_password", "bad_code", "unknown_login", "disabled", "rate_limited", "support", "support_failed"] as const;
/** Every sign-in attempt on a school's host. `userId` is null when the login was not known. Append-only for the school. */
export const loginEvents = pgTable("login_events", {
  ...schoolColumns(),
  userId: uuid("user_id"),
  /** What was typed, cut to 80 characters; never a password. */
  identifier: text("identifier").notNull(),
  outcome: text("outcome").$type<(typeof LOGIN_OUTCOMES)[number]>().notNull(),
  method: text("method").$type<"password" | "code" | "reset" | "support" | "api">().notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  newDevice: boolean("new_device").notNull().default(false),
  supportStaffId: uuid("support_staff_id"),
}, (t) => [...tenant(t, "login_events"), index("login_events_school_time").on(t.schoolId, t.createdAt), index("login_events_user").on(t.schoolId, t.userId, t.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  ...schoolColumns(),
  actorUserId: uuid("actor_user_id"),
  actorStaffId: uuid("actor_staff_id"),
  module: text("module").notNull(),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  summary: text("summary"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
}, (t) => [...tenant(t, "audit_logs"), index("audit_school_time").on(t.schoolId, t.createdAt), index("audit_school_module").on(t.schoolId, t.module, t.createdAt)]);

export const platformStaff = pgTable("platform_staff", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<StaffRole>().notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  status: text("status").$type<"active" | "disabled">().notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("platform_staff_email").on(sql`lower(${t.email})`)]);

export const staffSessions = pgTable("staff_sessions", {
  id: id(),
  staffId: uuid("staff_id").notNull().references(() => platformStaff.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  twoFactorPassed: boolean("two_factor_passed").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("staff_sessions_token").on(t.tokenHash)]);

export const platformAuditLogs = pgTable("platform_audit_logs", {
  id: id(),
  staffId: uuid("staff_id"),
  schoolId: uuid("school_id"),
  action: text("action").notNull(),
  summary: text("summary"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("platform_audit_time").on(t.createdAt)]);

// ---------- billing (Cashfree) ----------

export const subscriptions = pgTable("subscriptions", {
  ...schoolColumns(),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  interval: text("interval").$type<"annual" | "monthly">().notNull(),
  status: text("status").$type<"pending" | "active" | "past_due" | "cancelled">().notNull().default("pending"),
  pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  pendingPlanId: uuid("pending_plan_id"),
  gatewaySubscriptionId: text("gateway_subscription_id"),
  autoRenew: boolean("auto_renew").notNull().default(false),
}, (t) => [...tenant(t, "subscriptions")]);

export const invoices = pgTable("invoices", {
  ...schoolColumns(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  number: text("number").notNull(),
  financialYear: text("financial_year").notNull(),
  status: text("status").$type<"draft" | "issued" | "paid" | "void">().notNull().default("issued"),
  description: text("description").notNull(),
  sacCode: text("sac_code").notNull().default("998431"),
  taxablePaise: bigint("taxable_paise", { mode: "number" }).notNull(),
  cgstPaise: bigint("cgst_paise", { mode: "number" }).notNull().default(0),
  sgstPaise: bigint("sgst_paise", { mode: "number" }).notNull().default(0),
  igstPaise: bigint("igst_paise", { mode: "number" }).notNull().default(0),
  totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
  schoolGstin: text("school_gstin"),
  placeOfSupply: text("place_of_supply"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  /** Tax the school withheld and will pay the government; the invoice is settled by cash plus this. */
  tdsPaise: bigint("tds_paise", { mode: "number" }).notNull().default(0),
  /** Total of credit notes issued against this invoice (the invoice itself is never edited). */
  creditedPaise: bigint("credited_paise", { mode: "number" }).notNull().default(0),
  /** Account credit used to pay this invoice at issue. The invoice total stays; the amount due is lower. */
  creditAppliedPaise: bigint("credit_applied_paise", { mode: "number" }).notNull().default(0),
}, (t) => [...tenant(t, "invoices"), uniqueIndex("invoices_number").on(t.number)]);

export const payments = pgTable("payments", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  method: text("method").$type<"cashfree" | "bank_transfer" | "cheque" | "cash" | "upi">().notNull(),
  status: text("status").$type<"created" | "success" | "failed">().notNull().default("created"),
  gatewayOrderId: text("gateway_order_id"),
  gatewayPaymentId: text("gateway_payment_id"),
  reference: text("reference"),
  recordedBy: uuid("recorded_by"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  /** Tax withheld by the school on this payment. Cash received is `amount_paise`; the invoice is settled by both. */
  tdsPaise: bigint("tds_paise", { mode: "number" }).notNull().default(0),
}, (t) => [...tenant(t, "payments"), uniqueIndex("payments_gateway_order").on(t.gatewayOrderId)]);

export const CREDIT_NOTE_KINDS = ["correction", "refund", "goodwill"] as const;
export const CREDIT_SETTLEMENTS = ["adjusted", "refund", "credit"] as const;

/** GST credit note against one of our invoices, numbered in its own gap-free series. Never edited. Console-only writes. */
export const creditNotes = pgTable("credit_notes", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  number: text("number").notNull(),
  financialYear: text("financial_year").notNull(),
  kind: text("kind").$type<(typeof CREDIT_NOTE_KINDS)[number]>().notNull(),
  status: text("status").$type<"issued">().notNull().default("issued"),
  reason: text("reason").notNull(),
  taxablePaise: bigint("taxable_paise", { mode: "number" }).notNull(),
  cgstPaise: bigint("cgst_paise", { mode: "number" }).notNull().default(0),
  sgstPaise: bigint("sgst_paise", { mode: "number" }).notNull().default(0),
  igstPaise: bigint("igst_paise", { mode: "number" }).notNull().default(0),
  totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
  /** adjusted = an unpaid invoice owes less; refund = cash goes back; credit = kept on the account. */
  settlement: text("settlement").$type<(typeof CREDIT_SETTLEMENTS)[number]>().notNull(),
  refundMethod: text("refund_method").$type<"bank_transfer" | "cheque" | "cash" | "upi">(),
  refundReference: text("refund_reference"),
  refundedOn: text("refunded_on"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  refundedBy: uuid("refunded_by"),
  issuedBy: uuid("issued_by"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
}, (t) => [...tenant(t, "credit_notes"), uniqueIndex("credit_notes_number").on(t.number), index("credit_notes_invoice").on(t.invoiceId)]);

/** What Triakshi holds for a school: + when credit is added, - when an invoice uses it. The balance is the sum. Console-only writes. */
export const accountCredits = pgTable("account_credits", {
  ...schoolColumns(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  kind: text("kind").$type<"second_payment" | "overpayment" | "voided_payment" | "credit_note" | "used" | "released">().notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  paymentId: uuid("payment_id").references(() => payments.id),
  creditNoteId: uuid("credit_note_id").references(() => creditNotes.id),
  /** One row per event, so a replay cannot add or spend the same credit twice. */
  sourceKey: text("source_key").notNull(),
  note: text("note"),
}, (t) => [...tenant(t, "account_credits"), uniqueIndex("account_credits_source").on(t.schoolId, t.sourceKey)]);

/** The government's TDS certificate for tax a school withheld. Awaited until the school uploads it, then verified by staff. Console-only writes. */
export const tdsCertificates = pgTable("tds_certificates", {
  ...schoolColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  /** "2026-27 Q2" of the day the tax was withheld. */
  quarter: text("quarter").notNull(),
  /** Day the reminder is due: 45 days after that quarter ends. */
  remindOn: text("remind_on").notNull(),
  status: text("status").$type<"awaited" | "received" | "verified">().notNull().default("awaited"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: uuid("verified_by"),
  /** Why staff sent the file back, shown to the school next to the upload button. */
  note: text("note"),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
}, (t) => [...tenant(t, "tds_certificates"), uniqueIndex("tds_certificates_payment").on(t.paymentId)]);

/** Webhook replay guard: each gateway event is processed once. Console-only. */
export const webhookEvents = pgTable("webhook_events", {
  id: id(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("webhook_events_provider_event").on(t.provider, t.eventId)]);

// ---------- support and design requests ----------

export const supportTicketNumber = pgSequence("support_ticket_number", { startWith: 1001 });
export const TICKET_CATEGORIES = ["question", "problem", "billing", "data", "onboarding", "idea", "closure"] as const;

export const supportTickets = pgTable("support_tickets", {
  ...schoolColumns(),
  /** "T-1042": one series for the whole platform, set by the database on insert. */
  number: integer("number").notNull().default(sql`nextval('support_ticket_number')`),
  subject: text("subject").notNull(),
  category: text("category").$type<(typeof TICKET_CATEGORIES)[number]>().notNull().default("question"),
  status: text("status").$type<"open" | "pending" | "resolved" | "closed">().notNull().default("open"),
  priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
  createdByUserId: uuid("created_by_user_id"),
  assignedStaffId: uuid("assigned_staff_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow(),
  /** Where it was written: page path and browser. Shown to the writer, who can leave it out. */
  context: jsonb("context").$type<{ page?: string; browser?: string; article?: string }>().notNull().default({}),
  followUpOf: uuid("follow_up_of"),
  replyDueAt: timestamp("reply_due_at", { withTimezone: true }),
  firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
  overdueToldAt: timestamp("overdue_told_at", { withTimezone: true }),
  pendingSince: timestamp("pending_since", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  rating: integer("rating"),
  ratingNote: text("rating_note"),
}, (t) => [...tenant(t, "support_tickets"), uniqueIndex("support_tickets_number").on(t.number), index("support_tickets_status").on(t.status, t.lastMessageAt)]);

export const supportMessages = pgTable("support_messages", {
  ...schoolColumns(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id"),
  authorStaffId: uuid("author_staff_id"),
  body: text("body").notNull(),
  /** Shown to the school as "Triakshi support" when staff wrote it. */
  staffName: text("staff_name"),
  /** When the school's people were told of a staff message (job `support.tell`). */
  toldAt: timestamp("told_at", { withTimezone: true }),
}, (t) => [...tenant(t, "support_messages"), index("support_messages_ticket").on(t.ticketId)]);

export const supportFiles = pgTable("support_files", {
  ...schoolColumns(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => supportMessages.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
}, (t) => [...tenant(t, "support_files"), index("support_files_ticket").on(t.ticketId)]);

/** Staff-only notes on a ticket. The school's database role has no rights on this table at all. */
export const supportNotes = pgTable("support_notes", {
  id: id(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("support_notes_ticket").on(t.ticketId)]);

/** Console-only. */
export const supportSavedReplies = pgTable("support_saved_replies", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

/** A help article opened or judged. No person is stored. */
export const supportViews = pgTable("support_views", {
  ...schoolColumns(),
  article: text("article").notNull(),
  useful: boolean("useful"),
}, (t) => [...tenant(t, "support_views"), index("support_views_article").on(t.article)]);

/** Each time Triakshi staff opened a school, written when the link is made and when it is used. The school reads it. */
export const supportVisits = pgTable("support_visits", {
  ...schoolColumns(),
  staffId: uuid("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  asUserId: uuid("as_user_id").notNull(),
  asUserName: text("as_user_name").notNull(),
  reason: text("reason").notNull(),
  readOnly: boolean("read_only").notNull(),
  /** Entry against the school's setting, by an owner. */
  emergency: boolean("emergency").notNull().default(false),
  enteredAt: timestamp("entered_at", { withTimezone: true }),
  toldAt: timestamp("told_at", { withTimezone: true }),
}, (t) => [...tenant(t, "support_visits"), index("support_visits_time").on(t.schoolId, t.createdAt)]);

/** Messages from Triakshi to schools (planned work, a problem, solved). Console writes; a school sees its own audience. */
export const platformNotices = pgTable("platform_notices", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tone: text("tone").$type<"info" | "warning" | "danger" | "success">().notNull().default("info"),
  audience: text("audience").$type<"all" | "plan" | "school">().notNull().default("all"),
  planKey: text("plan_key"),
  schoolId: uuid("school_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("platform_notices_time").on(t.startsAt)]);

/** A nightly picture of how far a school has come. Written by the worker, read by the console. */
export const schoolSetupStatus = pgTable("school_setup_status", {
  ...schoolColumns(),
  percent: integer("percent").notNull(),
  done: integer("done").notNull(),
  total: integer("total").notNull(),
  nextKey: text("next_key"),
  nextLabel: text("next_label"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  students: integer("students").notNull().default(0),
  firstAttendanceOn: text("first_attendance_on"),
  facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [...tenant(t, "school_setup_status"), uniqueIndex("school_setup_status_school").on(t.schoolId)]);

export const customDesignRequests = pgTable("custom_design_requests", {
  ...schoolColumns(),
  kind: text("kind").$type<"custom_styling" | "custom_template">().notNull(),
  status: text("status").$type<"requested" | "quoted" | "paid" | "in_progress" | "in_review" | "delivered" | "cancelled">().notNull().default("requested"),
  brief: text("brief").notNull(),
  quotePaise: bigint("quote_paise", { mode: "number" }),
  invoiceId: uuid("invoice_id"),
}, (t) => [...tenant(t, "custom_design_requests")]);
