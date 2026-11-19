import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid, bigint } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { students } from "@smw/feature-students/schema";

export const VEHICLE_KINDS = ["bus", "van"] as const;

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
