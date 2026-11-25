import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { notifications } from "@smw/feature-notifications/schema";
import { students } from "@smw/feature-students/schema";
import { DocumentExpiryAlerts } from "./expiry";
import { RouteNoticeService } from "./notices";
import { DEFAULT_CHECKLIST, daysToExpiry, dueAlertDays } from "./rules";
import { RouteService, StudentTransportService, VehicleService } from "./service";
import { VehicleCareService, todayIST } from "./vehicle-care";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["students", "academics", "transport", "fees", "notifications"], "tc"));
});
afterAll(closeDb);

const today = todayIST();
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
let n = 0;
const vehicle = (s: TestSchool) => new VehicleService(s.as.admin).create({ registrationNo: `KA 02 CC ${2000 + ++n}`, kind: "van", capacity: 12, driverName: "Driver Two", driverPhone: "9845012345" });
const notesOf = (s: TestSchool, userId: string) => withSchool(s.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
const inCharge = (s: TestSchool): Ctx => ({ ...s.as.teacher, grants: new Set(["transport:read", "transport:manage"]) });

describe("expiry rules", () => {
  it("thresholds are reached at 30, 7 and 0 days and a missed run still catches up for a week", () => {
    expect(dueAlertDays("2026-12-31", "2026-11-01")).toEqual([]); // 60 days out
    expect(dueAlertDays("2026-12-01", "2026-11-01")).toEqual([30]);
    expect(dueAlertDays("2026-11-08", "2026-11-01")).toEqual([30, 7]);
    expect(dueAlertDays("2026-11-01", "2026-11-01")).toEqual([30, 7, 0]);
    expect(dueAlertDays("2026-10-28", "2026-11-01")).toEqual([30, 7, 0]); // expired 4 days ago
    expect(dueAlertDays("2026-09-01", "2026-11-01")).toEqual([]); // long gone: the page flags it instead
    expect(daysToExpiry("2026-11-08", "2026-11-01")).toBe(7);
  });
});

describe("vehicle papers", () => {
  it("are added by the transport manager, flagged when expired, and the vehicle shows it", async () => {
    const v = await vehicle(a);
    const svc = new VehicleCareService(a.as.admin);
    await svc.addDocument({ vehicleId: v.id, kind: "fitness", number: "FC-1", expiresOn: addDays(today, -3) });
    await svc.addDocument({ vehicleId: v.id, kind: "insurance", expiresOn: addDays(today, 20) });
    await svc.addDocument({ vehicleId: v.id, kind: "permit", expiresOn: addDays(today, 200) });
    const d = await svc.detail(v.id);
    expect(d.documents.map((x) => [x.kind, x.state])).toEqual([["fitness", "expired"], ["insurance", "soon"], ["permit", "valid"]]);
    expect(d.expired).toBe(1);
    expect((await new VehicleService(a.as.admin).listDetailed()).rows.find((r) => r.id === v.id)?.papers).toBe("Expired");
    const renewed = await svc.updateDocument(d.documents[0]!.id, { vehicleId: v.id, kind: "fitness", number: "FC-2", expiresOn: addDays(today, 365) });
    expect(renewed).toMatchObject({ number: "FC-2" });
    expect((await svc.detail(v.id)).expired).toBe(0);
    await svc.removeDocument(d.documents[2]!.id);
    expect((await svc.detail(v.id)).documents).toHaveLength(2);
    await expect(svc.addDocument({ vehicleId: v.id, kind: "puc", expiresOn: "soon" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("need transport:manage; a custom Transport in-charge role can; school B cannot see them", async () => {
    const v = await vehicle(a);
    const doc = { vehicleId: v.id, kind: "puc", expiresOn: addDays(today, 90) };
    await expect(new VehicleCareService(a.as.teacher).addDocument(doc)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new VehicleCareService(a.as.student).detail(v.id)).rejects.toBeInstanceOf(ForbiddenError);
    await new VehicleCareService(inCharge(a)).addDocument(doc);
    await expect(new VehicleCareService(b.as.admin).detail(v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new VehicleCareService(b.as.admin).addDocument(doc)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("raise each alert once: at 30 days, at 7 days and on the day, never twice", async () => {
    const v = await vehicle(a);
    const expiry = addDays(today, 30);
    await new VehicleCareService(a.as.admin).addDocument({ vehicleId: v.id, kind: "insurance", expiresOn: expiry });
    const run = (day: string) => new DocumentExpiryAlerts(a.as.admin).run(day);
    const titles = async () => (await notesOf(a, a.users.admin)).filter((x) => x.title.includes(v.registrationNo)).map((x) => x.title);
    await run(today); // 30 days out
    await run(today); // same day again
    expect(await titles()).toHaveLength(1);
    await run(addDays(today, 10)); // 20 days left: nothing new
    expect(await titles()).toHaveLength(1);
    await run(addDays(expiry, -7));
    await run(addDays(expiry, -7));
    expect(await titles()).toHaveLength(2);
    await run(expiry);
    await run(expiry);
    await run(addDays(expiry, 1)); // already claimed
    const all = await titles();
    expect(all).toHaveLength(3);
    expect(all.some((t) => t.includes("expires in 30 days"))).toBe(true);
    expect(all.some((t) => t.includes("expires in 7 days"))).toBe(true);
    expect(all.some((t) => t.includes("expires today"))).toBe(true);
    expect((await notesOf(a, a.users.admin)).filter((x) => x.title.includes(v.registrationNo)).every((x) => x.topic === "work.update" && x.subjectType === "vehicle-document")).toBe(true);
    // renewing gives the new expiry date its own alerts
    const [doc] = (await new VehicleCareService(a.as.admin).detail(v.id)).documents;
    await new VehicleCareService(a.as.admin).updateDocument(doc!.id, { vehicleId: v.id, kind: "insurance", expiresOn: addDays(today, 29) });
    await run(today);
    expect(await titles()).toHaveLength(4);
  });

  it("alerts stay inside the school: B's admin hears nothing about A's papers", async () => {
    const v = await vehicle(a);
    await new VehicleCareService(a.as.admin).addDocument({ vehicleId: v.id, kind: "permit", expiresOn: addDays(today, 5) });
    await new DocumentExpiryAlerts(a.as.admin).run(today);
    expect((await notesOf(b, b.users.admin)).filter((x) => x.title.includes(v.registrationNo))).toHaveLength(0);
  });
});

describe("safety checklist", () => {
  it("starts with the defaults, ticks, adds and removes items, and reports completeness", async () => {
    const v = await vehicle(a);
    const svc = new VehicleCareService(a.as.admin);
    let d = await svc.detail(v.id);
    expect(d.checklist.map((i) => i.label)).toEqual([...DEFAULT_CHECKLIST]);
    expect(d.checklistPct).toBe(0);
    await svc.toggleItem({ vehicleId: v.id, label: "GPS" });
    await svc.toggleItem({ vehicleId: v.id, label: "CCTV" });
    d = await svc.detail(v.id);
    expect(d.checklistPct).toBe(Math.round((2 / DEFAULT_CHECKLIST.length) * 100));
    const added = await svc.addItem({ vehicleId: v.id, label: "Panic button" });
    expect(added.items.at(-1)).toEqual({ label: "Panic button", ok: false });
    await expect(svc.addItem({ vehicleId: v.id, label: "panic BUTTON" })).rejects.toBeInstanceOf(ValidationError);
    await svc.removeItem({ vehicleId: v.id, label: "Fire extinguisher" });
    expect((await svc.detail(v.id)).checklist.some((i) => i.label === "Fire extinguisher")).toBe(false);
    await expect(svc.toggleItem({ vehicleId: v.id, label: "No such item" })).rejects.toBeInstanceOf(NotFoundError);
    await svc.toggleItem({ vehicleId: v.id, label: "GPS" });
    expect((await svc.detail(v.id)).checklist.find((i) => i.label === "GPS")?.ok).toBe(false);
  });

  it("cannot be emptied, only the manager edits, and school B cannot touch it", async () => {
    const v = await vehicle(a);
    const svc = new VehicleCareService(a.as.admin);
    for (const l of DEFAULT_CHECKLIST.slice(1)) await svc.removeItem({ vehicleId: v.id, label: l });
    await expect(svc.removeItem({ vehicleId: v.id, label: DEFAULT_CHECKLIST[0] })).rejects.toBeInstanceOf(ConflictError);
    await expect(new VehicleCareService(a.as.teacher).toggleItem({ vehicleId: v.id, label: DEFAULT_CHECKLIST[0] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new VehicleCareService(b.as.admin).toggleItem({ vehicleId: v.id, label: DEFAULT_CHECKLIST[0] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("route notices", () => {
  it("reach every student on the route in the app (topic transport.notice), and nobody else", async () => {
    const v = await vehicle(a);
    const routes = new RouteService(a.as.admin);
    const r = await routes.create({ name: `Notice route ${++n}`, vehicleId: v.id, morningStart: "07:00", eveningStart: "14:30" });
    const other = await routes.create({ name: `Other route ${++n}`, morningStart: "07:00", eveningStart: "14:30" });
    const stop = await routes.addStop(r.id, { name: "Gate", morningTime: "07:00", eveningTime: "15:00", monthlyFeePaise: 0 });
    const stop2 = await routes.addStop(other.id, { name: "Far gate", morningTime: "07:00", eveningTime: "15:00", monthlyFeePaise: 0 });
    const rider = await withSchool(a.id, async (tx) => (await tx.insert(students).values({ schoolId: a.id, admissionNo: `N${++n}`, name: "Noticed Rider", userId: a.users.student }).returning())[0]!);
    const walker = await withSchool(a.id, async (tx) => (await tx.insert(students).values({ schoolId: a.id, admissionNo: `N${++n}`, name: "No Login Rider" }).returning())[0]!);
    const svc = new StudentTransportService(a.as.admin);
    await svc.assign({ studentId: rider.id, routeId: r.id, stopId: stop.id, pickup: "true", drop: "true" });
    await svc.assign({ studentId: walker.id, routeId: r.id, stopId: stop.id, pickup: "true", drop: "true" });
    const elsewhere = await withSchool(a.id, async (tx) => (await tx.insert(students).values({ schoolId: a.id, admissionNo: `N${++n}`, name: "Elsewhere", userId: a.users.parent }).returning())[0]!);
    await svc.assign({ studentId: elsewhere.id, routeId: other.id, stopId: stop2.id, pickup: "true", drop: "true" });

    const sent = await new RouteNoticeService(a.as.admin).send({ routeId: r.id, title: "Bus late by 20 minutes", body: "Heavy traffic on the main road." });
    expect(sent).toMatchObject({ riders: 2, notified: 1 });
    expect((await notesOf(a, a.users.student)).some((x) => x.title.includes("Bus late by 20 minutes") && x.topic === "transport.notice" && x.subjectType === "route")).toBe(true);
    expect((await notesOf(a, a.users.parent)).some((x) => x.title.includes("Bus late"))).toBe(false);
    await expect(new RouteNoticeService(a.as.teacher).send({ routeId: r.id, title: "Hello", body: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RouteNoticeService(inCharge(a)).send({ routeId: r.id, title: "Hello", body: "In-charge may" })).resolves.toBeTruthy();
    await expect(new RouteNoticeService(b.as.admin).send({ routeId: r.id, title: "Hello", body: "Wrong school" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new RouteNoticeService(a.as.admin).send({ routeId: r.id, title: "", body: "x" })).rejects.toBeInstanceOf(ValidationError);
  });
});
