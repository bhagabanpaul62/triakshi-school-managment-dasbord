import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createTestSchool } from "@smw/feature-kit/testing";
import { students } from "@smw/feature-students/schema";
import seed from "./seed";
import { RouteService, StudentTransportService, VehicleService } from "./service";

afterAll(closeDb);

describe("transport seed", () => {
  it("makes 2 buses, 2 vans, 4 routes and seats about 40% of the students without breaking any rule", async () => {
    const s = await createTestSchool("seedt", ["students", "academics", "transport"]);
    const rows = await withSchool(s.id, (tx) => tx.insert(students).values(Array.from({ length: 120 }, (_, i) => ({ schoolId: s.id, admissionNo: `S${i}`, name: `Kid ${i}` }))).returning({ id: students.id }));
    await seed(s.as.admin, { students: rows });
    const vehicles = (await new VehicleService(s.as.admin).list()).rows;
    expect(vehicles.map((v) => v.kind).sort()).toEqual(["bus", "bus", "van", "van"]);
    const overview = await new RouteService(s.as.admin).overview();
    expect(overview).toHaveLength(4);
    expect(overview.every((o) => o.stops >= 3 && o.pct <= 100)).toBe(true);
    const riders = overview.reduce((a, o) => a + o.riders, 0);
    expect(riders).toBeGreaterThanOrEqual(40);
    expect(riders).toBeLessThanOrEqual(56);
    expect((await new StudentTransportService(s.as.admin).roster(overview[0]!.route.id)).length).toBeGreaterThan(0);
  });
});
