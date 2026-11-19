import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { RouteService, StudentTransportService, TransportFeeHelper, VehicleService } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["students", "academics", "transport"])); });
afterAll(closeDb);

let n = 0;
const makeStudent = (s: TestSchool, userId?: string) => withSchool(s.id, async (tx) => {
  n++;
  const [row] = await tx.insert(students).values({ schoolId: s.id, admissionNo: `T${n}`, name: `Student ${n}`, userId }).returning();
  return row!;
});
const makeVehicle = (s: TestSchool, capacity: number, reg = `KA 01 XX ${1000 + ++n}`) =>
  new VehicleService(s.as.admin).create({ registrationNo: reg, kind: "van", capacity, driverName: "Driver One", driverPhone: "9845012345" });
const stopIn = (name: string, m: string, e: string, fee = 100000) => ({ name, morningTime: m, eveningTime: e, monthlyFeePaise: fee });

async function route(s: TestSchool, capacity = 2) {
  const v = await makeVehicle(s, capacity);
  const r = await new RouteService(s.as.admin).create({ name: `Route ${++n}`, vehicleId: v.id, morningStart: "07:00", eveningStart: "14:30" });
  const routes = new RouteService(s.as.admin);
  const s1 = await routes.addStop(r.id, stopIn("First", "07:00", "15:00"));
  const s2 = await routes.addStop(r.id, stopIn("Second", "07:10", "15:10", 80000));
  return { v, r, s1, s2 };
}

describe("VehicleService", () => {
  it("admin manages; teacher reads; students and parents cannot list", async () => {
    await expect(new VehicleService(a.as.teacher).create({ registrationNo: "KA 01 ZZ 1", capacity: 10, driverName: "X Y", driverPhone: "9845012345" })).rejects.toBeInstanceOf(ForbiddenError);
    await makeVehicle(a, 10, "KA 05 AA 1111");
    expect((await new VehicleService(a.as.teacher).list()).rows.length).toBeGreaterThan(0);
    await expect(new VehicleService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new VehicleService(a.as.parent).list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("registration numbers are unique per school (any case)", async () => {
    await makeVehicle(a, 10, "KA 06 BB 2222");
    await expect(makeVehicle(a, 10, "ka 06 bb 2222")).rejects.toBeInstanceOf(ConflictError);
    await expect(makeVehicle(b, 10, "KA 06 BB 2222")).resolves.toBeTruthy(); // another school may reuse it
  });

  it("validates the driver's phone", async () => {
    await expect(new VehicleService(a.as.admin).create({ registrationNo: "KA 07 CC 3333", capacity: 10, driverName: "X Y", driverPhone: "123" })).rejects.toMatchObject({ fieldErrors: { driverPhone: expect.any(String) } });
  });

  it("cannot shrink below the riders, nor be deleted while on a route", async () => {
    const { v, r, s1 } = await route(a, 3);
    for (let i = 0; i < 3; i++) await new StudentTransportService(a.as.admin).assign({ studentId: (await makeStudent(a)).id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    const svc = new VehicleService(a.as.admin);
    await expect(svc.update(v.id, { registrationNo: v.registrationNo, capacity: 2, driverName: "D D", driverPhone: "9845012345" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.remove(v.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("RouteService stops", () => {
  it("inserts at a position, renumbers, and removes without gaps", async () => {
    const { r } = await route(a);
    const routes = new RouteService(a.as.admin);
    await routes.addStop(r.id, { ...stopIn("Middle", "07:05", "15:05"), position: 2 });
    let d = await routes.detail(r.id);
    expect(d.stops.map((s) => [s.sequence, s.name])).toEqual([[1, "First"], [2, "Middle"], [3, "Second"]]);
    await routes.removeStop(d.stops[0]!.id);
    d = await routes.detail(r.id);
    expect(d.stops.map((s) => [s.sequence, s.name])).toEqual([[1, "Middle"], [2, "Second"]]);
  });

  it("refuses times that do not increase along the route", async () => {
    const { r } = await route(a);
    const routes = new RouteService(a.as.admin);
    await expect(routes.addStop(r.id, stopIn("Late", "07:20", "14:00"))).rejects.toMatchObject({ fieldErrors: { eveningTime: expect.any(String) } });
    await expect(routes.addStop(r.id, stopIn("Early", "06:00", "15:30"))).rejects.toMatchObject({ fieldErrors: { morningTime: expect.any(String) } });
    const d = await routes.detail(r.id);
    await expect(routes.updateStop(d.stops[1]!.id, stopIn("Second", "06:59", "15:10"))).rejects.toBeInstanceOf(ValidationError);
    await expect(routes.addStop(r.id, { ...stopIn("Bad time", "7am", "14:00") })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a stop with riders cannot be removed; a route with riders cannot be deleted", async () => {
    const { r, s1 } = await route(a, 5);
    await new StudentTransportService(a.as.admin).assign({ studentId: (await makeStudent(a)).id, routeId: r.id, stopId: s1.id, pickup: "true" });
    await expect(new RouteService(a.as.admin).removeStop(s1.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(new RouteService(a.as.admin).remove(r.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("route names are unique and only admin edits", async () => {
    const { r } = await route(a);
    await expect(new RouteService(a.as.admin).create({ name: r.name, morningStart: "07:00", eveningStart: "14:30" })).rejects.toBeInstanceOf(ConflictError);
    await expect(new RouteService(a.as.teacher).addStop(r.id, stopIn("Nope", "09:00", "16:00"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RouteService(a.as.accountant).overview()).resolves.toBeTruthy();
  });

  it("overview shows riders against seats", async () => {
    const { r, s1 } = await route(a, 4);
    await new StudentTransportService(a.as.admin).assign({ studentId: (await makeStudent(a)).id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    const row = (await new RouteService(a.as.teacher).overview()).find((x) => x.route.id === r.id)!;
    expect(row).toMatchObject({ riders: 1, stops: 2, pct: 25 });
  });
});

describe("StudentTransportService", () => {
  it("refuses a student when the vehicle is full, but lets a rider move within a full route", async () => {
    const { r, s1, s2 } = await route(a, 2);
    const svc = new StudentTransportService(a.as.admin);
    const [x, y, z] = [await makeStudent(a), await makeStudent(a), await makeStudent(a)];
    await svc.assign({ studentId: x.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    await svc.assign({ studentId: y.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    await expect(svc.assign({ studentId: z.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" })).rejects.toBeInstanceOf(LimitError);
    await expect(svc.assign({ studentId: y.id, routeId: r.id, stopId: s2.id, pickup: "true", drop: "true" })).resolves.toMatchObject({ stopId: s2.id });
    expect((await svc.roster(r.id)).length).toBe(2);
  });

  it("two admins taking the last seat at once: exactly one wins", async () => {
    const { r, s1 } = await route(a, 1);
    const [x, y] = [await makeStudent(a), await makeStudent(a)];
    const go = (id: string) => new StudentTransportService(a.as.admin).assign({ studentId: id, routeId: r.id, stopId: s1.id, pickup: "true" }).then(() => "ok", (e) => (e instanceof LimitError ? "full" : "error"));
    expect((await Promise.all([go(x.id), go(y.id)])).sort()).toEqual(["full", "ok"]);
  });

  it("a student moving to another route frees the seat; unassign works once", async () => {
    const one = await route(a, 1), two = await route(a, 1);
    const svc = new StudentTransportService(a.as.admin);
    const x = await makeStudent(a);
    await svc.assign({ studentId: x.id, routeId: one.r.id, stopId: one.s1.id, pickup: "true" });
    await svc.assign({ studentId: x.id, routeId: two.r.id, stopId: two.s1.id, pickup: "true" });
    expect(await svc.roster(one.r.id)).toHaveLength(0);
    await svc.assign({ studentId: (await makeStudent(a)).id, routeId: one.r.id, stopId: one.s1.id, pickup: "true" });
    await svc.unassign(x.id);
    await expect(svc.unassign(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs pickup or drop, a stop on that route and an active student", async () => {
    const one = await route(a, 5), two = await route(a, 5);
    const svc = new StudentTransportService(a.as.admin);
    const x = await makeStudent(a);
    await expect(svc.assign({ studentId: x.id, routeId: one.r.id, stopId: one.s1.id })).rejects.toMatchObject({ fieldErrors: { pickup: "Choose pickup, drop or both" } });
    await expect(svc.assign({ studentId: x.id, routeId: one.r.id, stopId: two.s1.id, pickup: "true" })).rejects.toMatchObject({ fieldErrors: { stopId: expect.any(String) } });
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left" }).where(eqId(x.id)));
    await expect(svc.assign({ studentId: x.id, routeId: one.r.id, stopId: one.s1.id, pickup: "true" })).rejects.toMatchObject({ fieldErrors: { studentId: expect.any(String) } });
  });

  it("only admin assigns; teachers read the roster", async () => {
    const { r, s1 } = await route(a, 5);
    const x = await makeStudent(a);
    await expect(new StudentTransportService(a.as.teacher).assign({ studentId: x.id, routeId: r.id, stopId: s1.id, pickup: "true" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentTransportService(a.as.teacher).roster(r.id)).resolves.toEqual([]);
    await expect(new StudentTransportService(a.as.student).roster(r.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("prints the route list as a PDF", async () => {
    const { r, s1 } = await route(a, 5);
    await new StudentTransportService(a.as.admin).assign({ studentId: (await makeStudent(a)).id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    const { bytes, fileName } = await new StudentTransportService(a.as.teacher).rosterPdf(r.id);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(fileName).toMatch(/^route-route-\d+\.pdf$/);
  });

  it("students and parents see their own route; others see nothing", async () => {
    const { r, s1 } = await route(a, 5);
    const mine = await makeStudent(a, a.users.student);
    const other = await makeStudent(a);
    const svc = new StudentTransportService(a.as.admin);
    await svc.assign({ studentId: mine.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    await svc.assign({ studentId: other.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    const seen = await new StudentTransportService(a.as.student).mine();
    expect(seen.map((x) => x.studentId)).toEqual([mine.id]);
    expect(seen[0]).toMatchObject({ stopName: "First", morningTime: "07:00", trip: "Both ways", feePaise: 100000 });

    // the parent is the guardian of `other` only
    await withSchool(a.id, async (tx) => {
      const [g] = await tx.insert(guardians).values({ schoolId: a.id, name: "Parent", userId: a.users.parent, phone: "9845000000" }).returning();
      await tx.insert(studentGuardians).values({ schoolId: a.id, studentId: other.id, guardianId: g!.id, isPrimary: true });
    });
    expect((await new StudentTransportService(a.as.parent).mine()).map((x) => x.studentId)).toEqual([other.id]);
    expect((await svc.roster(r.id)).find((x) => x.studentId === other.id)?.parentPhone).toBe("9845000000");
    await expect(new StudentTransportService(a.as.teacher).mine()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B sees none of A's routes, vehicles or riders and cannot assign A's student", async () => {
    const { r, s1, v } = await route(a, 5);
    const x = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: x.id, routeId: r.id, stopId: s1.id, pickup: "true" });
    const bRoutes = new RouteService(b.as.admin);
    expect((await bRoutes.overview()).some((o) => o.route.id === r.id)).toBe(false);
    await expect(bRoutes.detail(r.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bRoutes.update(r.id, { name: "Hacked", morningStart: "07:00", eveningStart: "14:00" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bRoutes.remove(r.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bRoutes.addStop(r.id, stopIn("Xy", "09:00", "16:00"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(bRoutes.removeStop(s1.id)).rejects.toBeInstanceOf(NotFoundError);
    const bVehicles = new VehicleService(b.as.admin);
    expect((await bVehicles.list()).rows.some((row) => row.id === v.id)).toBe(false);
    await expect(bVehicles.remove(v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new StudentTransportService(b.as.admin).roster(r.id)).resolves.toEqual([]);
    await expect(new StudentTransportService(b.as.admin).assign({ studentId: x.id, routeId: r.id, stopId: s1.id, pickup: "true" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new StudentTransportService(b.as.admin).unassign(x.id)).rejects.toBeInstanceOf(NotFoundError);
    // a route in B cannot take a vehicle from A
    await expect(bRoutes.create({ name: "Steal", vehicleId: v.id, morningStart: "07:00", eveningStart: "14:00" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("TransportFeeHelper", () => {
  it("returns the stop fee, halves it for one way, 0 when not riding", async () => {
    const { r, s1, s2 } = await route(a, 9);
    const svc = new StudentTransportService(a.as.admin);
    const [both, pickupOnly, none] = [await makeStudent(a), await makeStudent(a), await makeStudent(a)];
    await svc.assign({ studentId: both.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    await svc.assign({ studentId: pickupOnly.id, routeId: r.id, stopId: s2.id, pickup: "true" });
    const fee = new TransportFeeHelper(a.as.accountant);
    expect(await fee.monthlyFee(both.id)).toBe(100000);
    expect(await fee.monthlyFee(pickupOnly.id)).toBe(40000);
    expect(await fee.monthlyFee(none.id)).toBe(0);
    expect(await fee.monthlyFee("not-an-id")).toBe(0);
  });

  it("a parent can only look up their own child; another school gets 0", async () => {
    const { r, s1 } = await route(a, 9);
    const kid = await makeStudent(a, a.users.student);
    await new StudentTransportService(a.as.admin).assign({ studentId: kid.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "true" });
    expect(await new TransportFeeHelper(a.as.student).monthlyFee(kid.id)).toBe(100000);
    expect(await new TransportFeeHelper(a.as.parent).monthlyFee(kid.id)).toBe(0); // parent's children were set in an earlier test; not this one
    expect(await new TransportFeeHelper(b.as.admin).monthlyFee(kid.id)).toBe(0);
  });
});

import { eq } from "drizzle-orm";
function eqId(id: string) { return eq(students.id, id); }
