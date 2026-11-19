import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import seed from "./seed";
import { buildSchoolData } from "./test-fixture";
import { StaffAttendanceService, StudentAttendanceService } from "./service";
import { addDays, isSunday, todayIST } from "./stats";

let a: TestSchool;
beforeAll(async () => {
  ({ a } = await createSchoolPair(["students", "academics", "attendance"], "seed"));
  await buildSchoolData(a);
});
afterAll(closeDb);

describe("attendance seed", () => {
  it("marks 25 school days for every section and for staff, around 90% present", async () => {
    await seed(a.as.admin, {});
    const svc = new StudentAttendanceService(a.as.admin);
    const sections = await svc.sectionOptions();
    expect(sections).toHaveLength(3);
    const own = sections.find((s) => s.label.endsWith("-A"))!;
    const month = todayIST().slice(0, 7);
    const prev = addDays(`${month}-01`, -1).slice(0, 7);
    const reg = [...(await svc.monthlyRegister(own.id, prev)).rows, ...(await svc.monthlyRegister(own.id, month)).rows];
    const days = new Set(reg.flatMap((r) => Object.keys(r.marks)));
    expect(days.size).toBe(25);
    expect([...days].some(isSunday)).toBe(false);
    const sum = await svc.trend(40);
    const avg = sum.reduce((t, p) => t + p.pct, 0) / sum.length;
    expect(avg).toBeGreaterThan(80);
    expect(avg).toBeLessThan(99);
    const staff = await new StaffAttendanceService(a.as.admin).staffSheet(addDays(todayIST(), isSunday(todayIST()) ? -1 : 0));
    expect(staff.rows.every((r) => r.status !== null)).toBe(true);
  });
});
