import { bigint, boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { students } from "@smw/feature-students/schema";

export const VEHICLE_KINDS = ["bus", "van"] as const;

export const DOCUMENT_KINDS = ["fitness", "insurance", "permit", "puc", "other"] as const;
export interface ChecklistItem { label: string; ok: boolean }

export const vehicles = pgTable("vehicles", {
  ...schoolColumns(),
  registrationNo: text("registration_no").notNull(),
  kind: text("kind").$type<(typeof VEHICLE_KINDS)[number]>().notNull().default("bus"),
  capacity: integer("capacity").notNull(),
  driverName: text("driver_name").notNull(),
  driverPhone: text("driver_phone").notNull(),
  attendantName: text("attendant_name"),
  /** Id of the GPS tracker, when the vehicle has one. */
  gpsDeviceId: text("gps_device_id"),
  /** A GPS vendor's live-location page (https only), shown to students on "my transport". */
  trackingUrl: text("tracking_url"),
  /** The safety checklist: the items this school keeps and whether the vehicle has each. Empty = the defaults, all unticked. */
  checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
}, (t) => [...tenant(t, "vehicles"), uniqueIndex("vehicles_registration").on(t.schoolId, t.registrationNo)]);

export const routes = pgTable("routes", {
  ...schoolColumns(),
  name: text("name").notNull(),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  /** "HH:MM", 24-hour. First pickup in the morning and first drop in the afternoon. */
  morningStart: text("morning_start").notNull(),
  eveningStart: text("evening_start").notNull(),
}, (t) => [...tenant(t, "routes"), uniqueIndex("routes_name").on(t.schoolId, t.name), index("routes_vehicle").on(t.vehicleId)]);

export const routeStops = pgTable("route_stops", {
  ...schoolColumns(),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 1..n, renumbered after every change. */
  sequence: integer("sequence").notNull(),
  morningTime: text("morning_time").notNull(),
  eveningTime: text("evening_time").notNull(),
  monthlyFeePaise: bigint("monthly_fee_paise", { mode: "number" }).notNull().default(0),
}, (t) => [...tenant(t, "route_stops"), index("route_stops_route").on(t.routeId, t.sequence)]);

export const studentTransport = pgTable("student_transport", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  stopId: uuid("stop_id").notNull().references(() => routeStops.id, { onDelete: "cascade" }),
  pickup: boolean("pickup").notNull().default(true),
  drop: boolean("drop").notNull().default(true),
  startsOn: date("starts_on").notNull(),
}, (t) => [...tenant(t, "student_transport"), uniqueIndex("student_transport_student").on(t.schoolId, t.studentId), index("student_transport_route").on(t.routeId)]);

/** Fitness, insurance, permit, PUC: one row per paper, with its expiry and a copy in private storage. */
export const vehicleDocuments = pgTable("vehicle_documents", {
  ...schoolColumns(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  kind: text("kind").$type<(typeof DOCUMENT_KINDS)[number]>().notNull(),
  number: text("number"),
  expiresOn: date("expires_on").notNull(),
  fileKey: text("file_key"),
  fileName: text("file_name"),
}, (t) => [...tenant(t, "vehicle_documents"), index("vehicle_documents_vehicle").on(t.vehicleId), index("vehicle_documents_expiry").on(t.schoolId, t.expiresOn)]);

/** Which expiry alerts went out, so the daily job sends each (document, expiry date, threshold) once. A renewed paper has a new expiry date and starts again. */
export const vehicleDocumentAlerts = pgTable("vehicle_document_alerts", {
  ...schoolColumns(),
  documentId: uuid("document_id").notNull().references(() => vehicleDocuments.id, { onDelete: "cascade" }),
  expiresOn: date("expires_on").notNull(),
  /** Days before expiry: 30, 7 or 0 (the day it expires). */
  daysBefore: integer("days_before").notNull(),
  sentOn: date("sent_on").notNull(),
}, (t) => [...tenant(t, "vehicle_document_alerts"), uniqueIndex("vehicle_document_alerts_unique").on(t.documentId, t.expiresOn, t.daysBefore)]);
