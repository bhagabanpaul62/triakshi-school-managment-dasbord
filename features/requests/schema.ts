import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { messageThreads } from "@smw/feature-messages/schema";
import type { EscalationLevel, RequestField, RequestState } from "./constants";

export const requestCategories = pgTable("request_categories", {
  ...schoolColumns(),
  name: text("name").notNull(),
  /** complaint and safety change who may see the request. */
  nature: text("nature").$type<"general" | "complaint" | "safety">().notNull().default("general"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Built-in role key, custom role id, or "class_teacher". */
  ownerRole: text("owner_role").notNull().default("admin"),
  targetDays: smallint("target_days").notNull().default(3),
  escalation: jsonb("escalation").$type<EscalationLevel[]>().notNull().default([]),
  fields: jsonb("fields").$type<RequestField[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "request_categories"), uniqueIndex("request_categories_name").on(t.schoolId, sql`lower(${t.name})`)]);

/** A request is a conversation (messages module) with an owner, a state and a clock. */
export const requests = pgTable("requests", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  categoryId: uuid("category_id").notNull().references(() => requestCategories.id, { onDelete: "restrict" }),
  studentId: uuid("student_id"),
  /** Who raised it: the family login, or the staff member who wrote it down for them. */
  raisedBy: uuid("raised_by").references(() => users.id, { onDelete: "set null" }),
  raisedByName: text("raised_by_name").notNull(),
  state: text("state").$type<RequestState>().notNull().default("new"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  ownerRole: text("owner_role").notNull(),
  level: smallint("level").notNull().default(0),
  values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
  /** A notice, receipt or other record it is about: {label, href}. */
  linked: jsonb("linked").$type<{ label: string; href: string } | null>(),
  /** A complaint about these people is invisible to them everywhere. */
  aboutUserIds: uuid("about_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  /** While waiting for the family the clock stops; the rest is added back when they answer. */
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  firstAnswerAt: timestamp("first_answer_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  reopenedCount: integer("reopened_count").notNull().default(0),
  mergedIntoId: uuid("merged_into_id"),
  solved: boolean("solved"),
  feedback: text("feedback"),
}, (t) => [...tenant(t, "requests"), uniqueIndex("requests_number").on(t.schoolId, t.number), uniqueIndex("requests_thread").on(t.threadId), index("requests_queue").on(t.schoolId, t.state, t.dueAt), index("requests_owner").on(t.schoolId, t.ownerId)]);

/** What happened to a request, in order. Append only. */
export const requestEvents = pgTable("request_events", {
  ...schoolColumns(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  detail: text("detail"),
  byUserId: uuid("by_user_id"),
  byName: text("by_name").notNull(),
}, (t) => [...tenant(t, "request_events"), index("request_events_request").on(t.requestId, t.createdAt)]);
