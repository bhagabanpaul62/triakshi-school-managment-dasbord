import { and, asc, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { CrudService, ConflictError, LimitError, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { schools, type Tx } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import { classes, sections } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import transportFeature from "./feature";
import { assignInput, routeInput, stopInput, vehicleInput } from "./inputs";
import { syncTransportCharges } from "./billing";
import { monthlyFeeFor, nextMonthStart, occupancyPct, stopTimeProblem } from "./rules";
import { routeStops, routes, studentTransport, vehicles } from "./schema";
import { VehicleCareService, todayIST } from "./vehicle-care";
import { NotificationWriter } from "@smw/feature-notifications/writer";

type Perm = keyof typeof transportFeature.permissions;
export type Vehicle = typeof vehicles.$inferSelect;
export type Route = typeof routes.$inferSelect;
export type Stop = typeof routeStops.$inferSelect;

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Vehicles with their driver. A vehicle cannot shrink below the riders on any route it serves. */
export class VehicleService extends CrudService<typeof vehicles, Perm> {
  protected feature = transportFeature;
  protected table = vehicles;
  protected entityName = "Vehicle";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = vehicleInput;
  protected updateSchema = vehicleInput;
  protected defaultSort = "registrationNo";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [vehicles.registrationNo, vehicles.driverName]; }
  protected sortColumns() { return { registrationNo: vehicles.registrationNo, capacity: vehicles.capacity, createdAt: vehicles.createdAt }; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.kind ? eq(vehicles.kind, f.kind as Vehicle["kind"]) : undefined]; }
  protected describe(r: Vehicle) { return r.registrationNo; }

  async create(input: unknown) {
    try { return await super.create(input); } catch (e) { return rethrowUnique(e, "A vehicle with this registration number already exists."); }
  }
  async update(id: string, input: unknown) {
    try { return await super.update(id, input); } catch (e) { return rethrowUnique(e, "A vehicle with this registration number already exists."); }
  }

  protected async beforeUpdate(tx: Tx, existing: Vehicle, data: Record<string, unknown>) {
    const capacity = Number(data.capacity);
    const [worst] = await tx.select({ n: count() }).from(studentTransport).innerJoin(routes, eq(routes.id, studentTransport.routeId))
      .where(eq(routes.vehicleId, existing.id)).groupBy(routes.id).orderBy(sql`count(*) desc`).limit(1);
    if (worst && Number(worst.n) > capacity) throw new ValidationError({ capacity: `${worst.n} students already ride this vehicle.` });
    return { ...data, trackingUrl: data.trackingUrl ?? null };
  }

  protected async beforeRemove(tx: Tx, existing: Vehicle) {
    const [r] = await tx.select({ name: routes.name }).from(routes).where(eq(routes.vehicleId, existing.id)).limit(1);
    if (r) throw new ConflictError(`${existing.registrationNo} runs on ${r.name}. Give that route another vehicle first.`);
  }

  /** Vehicles for the list page, each with the routes it runs. */
  async listDetailed(query: Parameters<VehicleService["list"]>[0] = {}) {
    const page = await this.list(query);
    const ids = page.rows.map((v) => v.id);
    const rs = ids.length ? await this.read("read", (tx) => tx.select({ vehicleId: routes.vehicleId, name: routes.name }).from(routes).where(inArray(routes.vehicleId, ids))) : [];
    const expired = await new VehicleCareService(this.ctx).expiredCounts(ids);
    return { ...page, rows: page.rows.map((v) => ({ ...v, routeNames: rs.filter((r) => r.vehicleId === v.id).map((r) => r.name).join(", ") || null, papers: expired.get(v.id) ? "Expired" : "OK" })) };
  }

  /** Every vehicle, for pickers. */
  async options() {
    return this.read("read", (tx) => tx.select({ id: vehicles.id, registrationNo: vehicles.registrationNo, kind: vehicles.kind, capacity: vehicles.capacity }).from(vehicles).orderBy(asc(vehicles.registrationNo)));
  }
}

/** Routes and their stops. Stops are kept numbered 1..n and their times must increase along the route. */
export class RouteService extends CrudService<typeof routes, Perm> {
  protected feature = transportFeature;
  protected table = routes;
  protected entityName = "Route";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = routeInput;
  protected updateSchema = routeInput;
  protected defaultSort = "name";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [routes.name]; }
  protected sortColumns() { return { name: routes.name, createdAt: routes.createdAt }; }
  protected describe(r: Route) { return r.name; }

  async create(input: unknown) {
    try { return await super.create(input); } catch (e) { return rethrowUnique(e, "A route with this name already exists."); }
  }
  async update(id: string, input: unknown) {
    try { return await super.update(id, input); } catch (e) { return rethrowUnique(e, "A route with this name already exists."); }
  }

  /** A route may only use a vehicle of this school, and the vehicle must seat the riders already on the route. */
  private async checkVehicle(tx: Tx, data: Record<string, unknown>, routeId?: string) {
    if (!data.vehicleId) return;
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, String(data.vehicleId))).limit(1);
    if (!v) throw new ValidationError({ vehicleId: "Choose a vehicle" });
    if (routeId) {
      const [riders] = await tx.select({ n: count() }).from(studentTransport).where(eq(studentTransport.routeId, routeId));
      if (Number(riders?.n ?? 0) > v.capacity) throw new LimitError(`${v.registrationNo} seats ${v.capacity}, but ${riders!.n} students ride this route.`);
    }
  }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { await this.checkVehicle(tx, data); return data; }
  protected async beforeUpdate(tx: Tx, existing: Route, data: Record<string, unknown>) {
    await this.checkVehicle(tx, data, existing.id);
    return { ...data, vehicleId: data.vehicleId ?? null };
  }
  protected async beforeRemove(tx: Tx, existing: Route) {
    const [riders] = await tx.select({ n: count() }).from(studentTransport).where(eq(studentTransport.routeId, existing.id));
    if (Number(riders?.n) > 0) throw new ConflictError(`${riders!.n} students ride ${existing.name}. Move them to another route first.`);
  }

  /** Every route with its vehicle, stop count and riders. Routes per school are few, so this is not paginated. */
  async overview() {
    return this.read("read", async (tx) => {
      const [rs, vs, riders, stops] = await Promise.all([
        tx.select().from(routes).orderBy(asc(routes.name)),
        tx.select().from(vehicles),
        tx.select({ routeId: studentTransport.routeId, n: count() }).from(studentTransport).groupBy(studentTransport.routeId),
        tx.select({ routeId: routeStops.routeId, n: count() }).from(routeStops).groupBy(routeStops.routeId),
      ]);
      return rs.map((r) => {
        const vehicle = vs.find((v) => v.id === r.vehicleId) ?? null;
        const n = Number(riders.find((x) => x.routeId === r.id)?.n ?? 0);
        return { route: r, vehicle, riders: n, stops: Number(stops.find((x) => x.routeId === r.id)?.n ?? 0), pct: occupancyPct(n, vehicle?.capacity) };
      });
    });
  }

  /** One route: vehicle, ordered stops with riders per stop. */
  async detail(id: string) {
    return this.read("read", async (tx) => {
      if (!isUuid(id)) throw new NotFoundError("Route");
      const [route] = await tx.select().from(routes).where(eq(routes.id, id)).limit(1);
      if (!route) throw new NotFoundError("Route");
      const [vehicle, stops, riders] = await Promise.all([
        route.vehicleId ? tx.select().from(vehicles).where(eq(vehicles.id, route.vehicleId)).then((r) => r[0] ?? null) : Promise.resolve(null),
        tx.select().from(routeStops).where(eq(routeStops.routeId, id)).orderBy(asc(routeStops.sequence)),
        tx.select({ stopId: studentTransport.stopId, n: count() }).from(studentTransport).where(eq(studentTransport.routeId, id)).groupBy(studentTransport.stopId),
      ]);
      const total = riders.reduce((a, r) => a + Number(r.n), 0);
      return {
        route, vehicle, riders: total, pct: occupancyPct(total, vehicle?.capacity),
        stops: stops.map((s) => ({ ...s, riders: Number(riders.find((r) => r.stopId === s.id)?.n ?? 0) })),
      };
    });
  }

  // ----- stops -----

  private async orderedStops(tx: Tx, routeId: string) {
    return tx.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.sequence), asc(routeStops.createdAt));
  }

  private checkTimes(stops: { name: string; morningTime: string; eveningTime: string }[]) {
    const p = stopTimeProblem(stops);
    if (p) throw new ValidationError({ [p.field]: p.message }, p.message);
  }

  /** Locks the route row so two stop edits cannot number stops at the same time. */
  private async routeOrThrow(tx: Tx, routeId: string) {
    if (!isUuid(routeId)) throw new NotFoundError("Route");
    const [r] = await tx.select().from(routes).where(eq(routes.id, routeId)).for("update");
    if (!r) throw new NotFoundError("Route");
    return r;
  }

  /** Add a stop at the end, or at `position` (the stops after it move down). */
  async addStop(routeId: string, input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(stopInput, input);
    return this.write("manage", async (tx) => {
      const route = await this.routeOrThrow(tx, routeId);
      const existing = await this.orderedStops(tx, routeId);
      const at = Math.min(data.position ?? existing.length + 1, existing.length + 1);
      this.checkTimes([...existing.slice(0, at - 1), data, ...existing.slice(at - 1)]);
      await tx.update(routeStops).set({ sequence: sql`${routeStops.sequence} + 1` }).where(and(eq(routeStops.routeId, routeId), gte(routeStops.sequence, at)));
      const [row] = await tx.insert(routeStops).values({ schoolId: this.ctx.schoolId, routeId, name: data.name, sequence: at, morningTime: data.morningTime, eveningTime: data.eveningTime, monthlyFeePaise: data.monthlyFeePaise }).returning();
      return { stop: row!, route };
    }, (r) => ({ action: "add_stop", entity: "Route", entityId: routeId, summary: `Added stop ${r.stop.name} to ${r.route.name}` })).then((r) => r.stop);
  }

  async updateStop(stopId: string, input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(stopInput, input);
    return this.write("manage", async (tx) => {
      const stop = await this.stopOrThrow(tx, stopId);
      await this.routeOrThrow(tx, stop.routeId);
      const existing = await this.orderedStops(tx, stop.routeId);
      this.checkTimes(existing.map((s) => (s.id === stopId ? { ...s, ...data } : s)));
      const [row] = await tx.update(routeStops).set({ name: data.name, morningTime: data.morningTime, eveningTime: data.eveningTime, monthlyFeePaise: data.monthlyFeePaise }).where(eq(routeStops.id, stopId)).returning();
      return row!;
    }, (r) => ({ action: "update_stop", entity: "Route", entityId: r.routeId, summary: `Updated stop ${r.name}` }));
  }

  async removeStop(stopId: string) {
    return this.write("manage", async (tx) => {
      const stop = await this.stopOrThrow(tx, stopId);
      await this.routeOrThrow(tx, stop.routeId);
      const [riders] = await tx.select({ n: count() }).from(studentTransport).where(eq(studentTransport.stopId, stopId));
      if (Number(riders?.n) > 0) throw new ConflictError(`${riders!.n} students board at ${stop.name}. Move them to another stop first.`);
      await tx.delete(routeStops).where(eq(routeStops.id, stopId));
      const rest = await this.orderedStops(tx, stop.routeId);
      for (const [i, s] of rest.entries()) if (s.sequence !== i + 1) await tx.update(routeStops).set({ sequence: i + 1 }).where(eq(routeStops.id, s.id));
      return stop;
    }, (s) => ({ action: "remove_stop", entity: "Route", entityId: s.routeId, summary: `Removed stop ${s.name}` })).then((s) => ({ id: s.id }));
  }

  private async stopOrThrow(tx: Tx, stopId: string) {
    if (!isUuid(stopId)) throw new NotFoundError("Stop");
    const [s] = await tx.select().from(routeStops).where(eq(routeStops.id, stopId)).limit(1);
    if (!s) throw new NotFoundError("Stop");
    return s;
  }
}

export interface RosterRow {
  assignmentId: string; studentId: string; name: string; admissionNo: string; classLabel: string | null;
  stopId: string; stopName: string; stopSequence: number; pickup: boolean; drop: boolean; trip: string; startsOn: string; parentPhone: string | null;
}

const tripLabel = (pickup: boolean, drop: boolean) => (pickup && drop ? "Both ways" : pickup ? "Pickup only" : "Drop only");

/** Shared by the services that serve student logins: who is "mine". */
abstract class TransportBase extends SchoolService<Perm> {
  protected feature = transportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** The caller's own student record. */
  protected async ownStudentIds(tx: Tx): Promise<string[]> {
    return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
  }
}

/** Which students ride which route and stop. Checks seats before it assigns. */
export class StudentTransportService extends TransportBase {

  /** Put a student on a route stop (or move them). Fails with LimitError when the vehicle is full. */
  async assign(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(assignInput, input);
    return this.write("manage", async (tx) => {
      const [route] = await tx.select().from(routes).where(eq(routes.id, data.routeId)).limit(1);
      if (!route) throw new ValidationError({ routeId: "Choose the route" });
      const [stop] = await tx.select().from(routeStops).where(and(eq(routeStops.id, data.stopId), eq(routeStops.routeId, route.id))).limit(1);
      if (!stop) throw new ValidationError({ stopId: "Choose a stop on this route" });
      const [student] = await tx.select({ id: students.id, name: students.name, status: students.status }).from(students).where(eq(students.id, data.studentId)).limit(1);
      if (!student) throw new ValidationError({ studentId: "Choose the student" });
      if (student.status !== "active") throw new ValidationError({ studentId: `${student.name} is not an active student` });

      if (route.vehicleId) {
        // Lock the vehicle so two admins assigning at once cannot both take the last seat.
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, route.vehicleId)).for("update");
        if (vehicle) {
          const [taken] = await tx.select({ n: count() }).from(studentTransport).where(and(eq(studentTransport.routeId, route.id), ne(studentTransport.studentId, data.studentId)));
          if (Number(taken?.n) >= vehicle.capacity) throw new LimitError(`${vehicle.registrationNo} is full (${vehicle.capacity} seats). Pick another route.`);
        }
      }

      const [before] = await tx.select({ id: studentTransport.id }).from(studentTransport).where(eq(studentTransport.studentId, data.studentId)).limit(1);
      const values = { routeId: route.id, stopId: stop.id, pickup: data.pickup, drop: data.drop, startsOn: data.startsOn ?? todayIST() };
      const [row] = await tx.insert(studentTransport).values({ schoolId: this.ctx.schoolId, studentId: data.studentId, ...values })
        .onConflictDoUpdate({ target: [studentTransport.schoolId, studentTransport.studentId], set: values }).returning();
      // A10 fee rule: a new rider pays from the month after they start; a move changes the fee from the month after today.
      await syncTransportCharges(tx, this.ctx.schoolId, data.studentId, monthlyFeeFor(stop.monthlyFeePaise, data.pickup, data.drop), nextMonthStart(before ? todayIST() : values.startsOn));
      return { row: row!, student, route, stop };
    }, (r) => ({ action: "assign", entity: "Transport", entityId: r.row.id, summary: `${r.student.name} rides ${r.route.name} from ${r.stop.name}` })).then((r) => r.row);
  }

  async unassign(studentId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(studentId)) throw new NotFoundError("Transport assignment");
      const [row] = await tx.delete(studentTransport).where(eq(studentTransport.studentId, studentId)).returning();
      if (!row) throw new NotFoundError("Transport assignment");
      // Unassigning stops the fee from next month; this month stays billed.
      await syncTransportCharges(tx, this.ctx.schoolId, studentId, 0, nextMonthStart(todayIST()));
      const [s] = await tx.select({ name: students.name }).from(students).where(eq(students.id, studentId)).limit(1);
      return { id: row.id, name: s?.name ?? "Student" };
    }, (r) => ({ action: "unassign", entity: "Transport", entityId: r.id, summary: `Removed ${r.name} from transport` }));
  }

  /** Students on a route in boarding order. */
  async roster(routeId: string): Promise<RosterRow[]> {
    return this.read("read", async (tx) => {
      if (!isUuid(routeId)) throw new NotFoundError("Route");
      const rows = await tx.select({
        assignmentId: studentTransport.id, studentId: students.id, name: students.name, admissionNo: students.admissionNo,
        className: classes.name, sectionName: sections.name, stopId: routeStops.id, stopName: routeStops.name, stopSequence: routeStops.sequence,
        pickup: studentTransport.pickup, drop: studentTransport.drop, startsOn: studentTransport.startsOn,
      }).from(studentTransport)
        .innerJoin(students, eq(students.id, studentTransport.studentId))
        .innerJoin(routeStops, eq(routeStops.id, studentTransport.stopId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(sections, eq(sections.id, students.sectionId))
        .where(eq(studentTransport.routeId, routeId))
        .orderBy(asc(routeStops.sequence), asc(students.name));
      const phones = rows.length
        ? await tx.select({ studentId: studentGuardians.studentId, phone: guardians.phone, primary: studentGuardians.isPrimary }).from(studentGuardians)
          .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(inArray(studentGuardians.studentId, rows.map((r) => r.studentId)))
        : [];
      return rows.map((r) => ({
        assignmentId: r.assignmentId, studentId: r.studentId, name: r.name, admissionNo: r.admissionNo,
        classLabel: r.className ? `${r.className}${r.sectionName ? `-${r.sectionName}` : ""}` : null,
        stopId: r.stopId, stopName: r.stopName, stopSequence: r.stopSequence, pickup: r.pickup, drop: r.drop, trip: tripLabel(r.pickup, r.drop), startsOn: r.startsOn,
        parentPhone: phones.filter((p) => p.studentId === r.studentId && p.phone).sort((a, b) => Number(b.primary) - Number(a.primary))[0]?.phone ?? null,
      }));
    });
  }

  /** The printable route list for the driver: one A4 PDF. */
  async rosterPdf(routeId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const detail = await new RouteService(this.ctx).detail(routeId);
    const roster = await this.roster(routeId);
    const school = await this.read("read", (tx) => tx.select({ name: schools.name }).from(schools).limit(1).then((r) => r[0]));
    const pdf = await PdfBuilder.create();
    pdf.header({
      orgName: school?.name ?? "School", title: "Route list",
      rightLines: [detail.route.name, detail.vehicle ? `${detail.vehicle.registrationNo} (${detail.vehicle.kind})` : "No vehicle yet"],
    });
    pdf.facts([
      ["Driver", detail.vehicle ? `${detail.vehicle.driverName}, ${detail.vehicle.driverPhone}` : "-"],
      ["Attendant", detail.vehicle?.attendantName ?? "-"],
      ["Morning start", detail.route.morningStart], ["Evening start", detail.route.eveningStart],
      ["Students", `${roster.length}${detail.vehicle ? ` of ${detail.vehicle.capacity} seats` : ""}`],
    ]);
    pdf.table({
      columns: [{ label: "#", width: 24 }, { label: "Student", width: 130 }, { label: "Class", width: 56 }, { label: "Stop", width: 110 }, { label: "Trip", width: 64 }, { label: "Parent phone", width: 115 }],
      rows: roster.map((r, i) => [String(i + 1), r.name, r.classLabel ?? "-", r.stopName, r.trip, r.parentPhone ?? "-"]),
    });
    const bytes = await pdf.save();
    return { bytes, fileName: `route-${detail.route.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf` };
  }

  /** Students without a seat yet, for the assign picker. */
  async unassigned(limit = 300) {
    return this.read("read", (tx) => tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, className: classes.name, sectionName: sections.name }).from(students)
      .leftJoin(studentTransport, eq(studentTransport.studentId, students.id))
      .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
      .where(and(eq(students.status, "active"), isNull(studentTransport.id))).orderBy(asc(students.name)).limit(limit));
  }

  /** Student view: route, stop, times and driver. */
  async mine() {
    return this.read("self", async (tx) => {
      const ids = await this.ownStudentIds(tx);
      if (!ids.length) return [];
      const rows = await tx.select({
        studentId: students.id, studentName: students.name, routeId: routes.id, routeName: routes.name, stopName: routeStops.name,
        morningTime: routeStops.morningTime, eveningTime: routeStops.eveningTime, pickup: studentTransport.pickup, drop: studentTransport.drop,
        monthlyFeePaise: routeStops.monthlyFeePaise, vehicle: vehicles.registrationNo, trackingUrl: vehicles.trackingUrl, driverName: vehicles.driverName, driverPhone: vehicles.driverPhone,
      }).from(studentTransport)
        .innerJoin(students, eq(students.id, studentTransport.studentId))
        .innerJoin(routes, eq(routes.id, studentTransport.routeId))
        .innerJoin(routeStops, eq(routeStops.id, studentTransport.stopId))
        .leftJoin(vehicles, eq(vehicles.id, routes.vehicleId))
        .where(inArray(studentTransport.studentId, ids)).orderBy(asc(students.name));
      if (!this.ctx.readOnly && !this.ctx.supportStaffId) for (const id of new Set(rows.map((r) => r.routeId))) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "route", id }, this.ctx);
      return rows.map(({ routeId: _r, ...r }) => ({ ...r, trip: tripLabel(r.pickup, r.drop), feePaise: monthlyFeeFor(r.monthlyFeePaise, r.pickup, r.drop) }));
    });
  }
}

/** For the fees feature: what a student pays for transport each month. */
export class TransportFeeHelper extends TransportBase {
  /** Monthly fee in paise: the stop's fee both ways, half for one way, 0 when the student does not use transport. */
  async monthlyFee(studentId: string): Promise<number> {
    const staff = this.can("read");
    return this.read(staff ? "read" : "self", async (tx) => {
      if (!isUuid(studentId)) return 0;
      if (!staff) {
        const own = await this.ownStudentIds(tx);
        if (!own.includes(studentId)) return 0;
      }
      const [row] = await tx.select({ fee: routeStops.monthlyFeePaise, pickup: studentTransport.pickup, drop: studentTransport.drop }).from(studentTransport)
        .innerJoin(routeStops, eq(routeStops.id, studentTransport.stopId)).where(eq(studentTransport.studentId, studentId)).limit(1);
      return row ? monthlyFeeFor(row.fee, row.pickup, row.drop) : 0;
    });
  }
}
