import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import seed from "./seed";
import { buildSchoolData } from "./test-fixture";
import { HolidayService } from "./holiday-service";
import { attendanceHolidays, staffAttendance, studentAttendance } from "./schema";
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

  it("adds a year of realistic holidays and never marks a closed day", async () => {
    const names = (await new HolidayService(a.as.admin).spans()).map((h) => h.name);
    expect(names).toEqual(expect.arrayContaining(["Independence Day", "Gandhi Jayanti", "Diwali break", "Christmas", "Republic Day", "Working Sunday"]));
    expect(names.some((n) => /preparation leave/.test(n))).toBe(true);
    const rows = await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays));
    expect(rows.filter((r) => r.name === "Diwali break")).toHaveLength(5);
    expect(rows.find((r) => r.kind === "working" && isSunday(r.date))).toBeTruthy();
    const closed = new Set(rows.filter((r) => r.kind !== "working" && r.appliesTo === "all").map((r) => r.date));
    const marked = await withSchool(a.id, async (tx) => [...(await tx.select({ d: studentAttendance.date }).from(studentAttendance)), ...(await tx.select({ d: staffAttendance.date }).from(staffAttendance))].map((r) => r.d));
    expect(marked.filter((d) => closed.has(d))).toEqual([]);
  });
});
