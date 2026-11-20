import { z } from "zod";
import { f } from "@smw/feature-kit";
import { DOCUMENT_KINDS, VEHICLE_KINDS } from "./schema";
import { TIME_RE, isHttpsUrl } from "./rules";

const time = (msg = "Pick a time") => z.string().regex(TIME_RE, msg);

export const vehicleInput = z.object({
  registrationNo: f.text(4, 20, "Enter the registration number").transform((s) => s.toUpperCase()),
  kind: z.enum(VEHICLE_KINDS).default("bus"),
  capacity: f.int(1, 120),
  driverName: f.text(2, 80, "Enter the driver's name"),
  driverPhone: f.phone(),
  attendantName: f.optText(80),
  gpsDeviceId: f.optText(60),
  trackingUrl: f.optText(300).refine((v) => v === undefined || isHttpsUrl(v), { message: "Enter a link that starts with https://" }),
});

export const documentInput = z.object({
  vehicleId: f.id("Choose the vehicle"),
  kind: z.enum(DOCUMENT_KINDS),
  number: f.optText(60),
  expiresOn: f.date("Enter the expiry date"),
});

export const checklistItemInput = z.object({
  vehicleId: f.id("Choose the vehicle"),
  label: f.text(2, 40, "Name the item"),
});

export const noticeInput = z.object({
  routeId: f.id("Choose the route"),
  title: f.text(3, 120, "Write a short title"),
  body: f.text(3, 1000, "Write the message"),
});

export const routeInput = z.object({
  name: f.text(2, 80, "Give the route a name"),
  vehicleId: f.optId(),
  morningStart: time(),
  eveningStart: time(),
});

export const stopInput = z.object({
  name: f.text(2, 80, "Enter the stop name"),
  morningTime: time(),
  eveningTime: time(),
  monthlyFeePaise: f.paise(0),
  /** 1-based place on the route; empty adds the stop at the end. */
  position: f.optInt(1, 100),
});

export const assignInput = z.object({
  studentId: f.id("Choose the student"),
  routeId: f.id("Choose the route"),
  stopId: f.id("Choose the stop"),
  pickup: f.bool(),
  drop: f.bool(),
  startsOn: f.optDate(),
}).refine((v) => v.pickup || v.drop, { message: "Choose pickup, drop or both", path: ["pickup"] });
