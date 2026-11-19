import type { FeatureSeed } from "@smw/feature-kit";
import { RouteService, StudentTransportService, VehicleService } from "./service";

interface SeedStudent { id: string }

const RUPEE = 100;

const PLAN = [
  { vehicle: { registrationNo: "KA 01 AB 4521", kind: "bus", capacity: 40, driverName: "Ramesh Gowda", driverPhone: "9845012345", attendantName: "Savitha", gpsDeviceId: "GPS-1001" },
    route: { name: "Koramangala - HSR Layout", morningStart: "06:50", eveningStart: "14:30" },
    stops: [["Koramangala 5th Block", "06:50", "14:40", 1400], ["Forum Mall", "07:00", "14:50", 1400], ["Agara Lake", "07:12", "15:00", 1200], ["HSR BDA Complex", "07:24", "15:10", 1200], ["HSR Sector 2", "07:35", "15:20", 1000]] },
  { vehicle: { registrationNo: "KA 03 MN 7788", kind: "van", capacity: 14, driverName: "Suresh Naik", driverPhone: "9886098860", attendantName: "Lakshmi", gpsDeviceId: null },
    route: { name: "Indiranagar - Domlur", morningStart: "07:10", eveningStart: "14:30" },
    stops: [["Indiranagar 100 Feet Road", "07:10", "14:50", 1500], ["Domlur Flyover", "07:22", "15:00", 1300], ["Ejipura Signal", "07:34", "15:10", 1300]] },
  { vehicle: { registrationNo: "MH 12 PQ 3306", kind: "bus", capacity: 36, driverName: "Dattatray Pawar", driverPhone: "9822012345", attendantName: "Sunita", gpsDeviceId: "GPS-1002" },
    route: { name: "Kothrud - Karve Nagar", morningStart: "07:00", eveningStart: "14:30" },
    stops: [["Kothrud Depot", "07:00", "14:45", 1100], ["Paud Road Chowk", "07:10", "14:55", 1100], ["Karve Nagar", "07:22", "15:05", 900], ["Warje Bridge", "07:34", "15:15", 900]] },
  { vehicle: { registrationNo: "MH 14 RS 9012", kind: "van", capacity: 14, driverName: "Prakash Kadam", driverPhone: "9890123456", attendantName: null, gpsDeviceId: null },
    route: { name: "Baner - Aundh", morningStart: "07:15", eveningStart: "14:30" },
    stops: [["Baner Gaon", "07:15", "14:50", 1200], ["Balewadi Phata", "07:27", "15:00", 1200], ["Aundh ITI Road", "07:40", "15:10", 1000]] },
] as const;

/** 4 routes in Bengaluru and Pune with 2 buses and 2 vans; about 40% of students ride. */
const seed: FeatureSeed = async (ctx, state) => {
  const vehicles = new VehicleService(ctx);
  const routes = new RouteService(ctx);
  const rides = new StudentTransportService(ctx);
  const made: { routeId: string; stopIds: string[]; capacity: number }[] = [];

  for (const p of PLAN) {
    const v = await vehicles.create(p.vehicle);
    const r = await routes.create({ ...p.route, vehicleId: v.id });
    const stopIds: string[] = [];
    for (const [name, morningTime, eveningTime, fee] of p.stops) {
      stopIds.push((await routes.addStop(r.id, { name, morningTime, eveningTime, monthlyFeePaise: fee * RUPEE })).id);
    }
    made.push({ routeId: r.id, stopIds, capacity: p.vehicle.capacity });
  }

  const all = (state.students as SeedStudent[] | undefined) ?? [];
  const riders = all.filter((_, i) => i % 5 === 0 || i % 5 === 2); // 40%
  const taken = made.map(() => 0);
  for (const [i, s] of riders.entries()) {
    const k = i % made.length;
    if (taken[k]! >= made[k]!.capacity) continue;
    const m = made[k]!;
    const oneWay = i % 9 === 0;
    await rides.assign({ studentId: s.id, routeId: m.routeId, stopId: m.stopIds[Math.floor(i / made.length) % m.stopIds.length], pickup: "true", drop: oneWay ? undefined : "true", startsOn: "2026-04-10" });
    taken[k]!++;
  }
};
export default seed;
