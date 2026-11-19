// Platform tables: schools, plans, modules, identity, billing, support. School-owned feature tables live in features/*/schema.ts.
import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, bigint,
} from "drizzle-orm/pg-core";
import { createdAt, id, schoolColumns, tenant, updatedAt } from "../columns";

export const SCHOOL_STATUSES = ["pending", "rejected", "trial", "active", "past_due", "read_only", "suspended", "cancelled"] as const;
export const SCHOOL_ROLES = ["admin", "accountant", "teacher", "student", "parent"] as const;
export const STAFF_ROLES = ["owner", "support", "sales"] as const;
export const MODULE_STAGES = ["alpha", "beta", "ga"] as const;
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
}, (t) => [...tenant(t, "school_domains"), uniqueIndex("school_domains_hostname").on(t.hostname)]);

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
  purpose: text("purpose").$type<"verify_email" | "reset_password" | "invite" | "support_login">().notNull(),
  tokenHash: text("token_hash").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [...tenant(t, "one_time_tokens"), uniqueIndex("ott_token").on(t.tokenHash)]);

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
}, (t) => [...tenant(t, "audit_logs"), index("audit_school_time").on(t.schoolId, t.createdAt)]);

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
}, (t) => [...tenant(t, "payments"), uniqueIndex("payments_gateway_order").on(t.gatewayOrderId)]);

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

export const supportTickets = pgTable("support_tickets", {
  ...schoolColumns(),
  subject: text("subject").notNull(),
  status: text("status").$type<"open" | "pending" | "resolved" | "closed">().notNull().default("open"),
  priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
  createdByUserId: uuid("created_by_user_id"),
  assignedStaffId: uuid("assigned_staff_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow(),
}, (t) => [...tenant(t, "support_tickets")]);

export const supportMessages = pgTable("support_messages", {
  ...schoolColumns(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id"),
  authorStaffId: uuid("author_staff_id"),
  body: text("body").notNull(),
}, (t) => [...tenant(t, "support_messages"), index("support_messages_ticket").on(t.ticketId)]);

export const customDesignRequests = pgTable("custom_design_requests", {
  ...schoolColumns(),
  kind: text("kind").$type<"custom_styling" | "custom_template">().notNull(),
  status: text("status").$type<"requested" | "quoted" | "paid" | "in_progress" | "in_review" | "delivered" | "cancelled">().notNull().default("requested"),
  brief: text("brief").notNull(),
  quotePaise: bigint("quote_paise", { mode: "number" }),
  invoiceId: uuid("invoice_id"),
}, (t) => [...tenant(t, "custom_design_requests")]);
