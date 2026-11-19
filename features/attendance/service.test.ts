import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { buildSchoolData, type Fixture } from "./test-fixture";
import { HolidayService, StaffAttendanceService, StudentAttendanceService } from "./service";
import { addDays, attendancePercent, todayIST } from "./stats";

let a: TestSchool, b: TestSchool;
let fx: Fixture;

const entries = (ids: string[], status: "present" | "absent" | "late" | "leave" = "present") => ids.map((studentId) => ({ studentId, status }));

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["students", "academics", "attendance"]));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
});
afterAll(closeDb);

describe("percent", () => {
  it("counts late as present, half day as half, leave as excused", () => {
    expect(attendancePercent({ present: 8, late: 1, absent: 1, half_day: 0 })).toBe(90);
    expect(attendancePercent({ present: 1, late: 0, absent: 0, half_day: 2 })).toBe(66.7);
    expect(attendancePercent({ present: 0, late: 0, absent: 0, half_day: 0 })).toBeNull();
  });
});

describe("StudentAttendanceService", () => {
  it("sheet starts unmarked, mark saves it, marking again updates instead of duplicating", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const date = "2026-10-05";
    expect((await svc.sectionSheet(fx.own, date)).rows.every((r) => r.status === null)).toBe(true);
    const c = await svc.mark({ sectionId: fx.own, date, entries: [...entries(fx.kids.slice(0, 3)), { studentId: fx.kids[3], status: "absent" }] });
    expect(c).toMatchObject({ present: 3, absent: 1, total: 4 });
    await svc.mark({ sectionId: fx.own, date, entries: [{ studentId: fx.kids[3], status: "late", note: "Bus delay" }] });
    const sheet = await svc.sectionSheet(fx.own, date);
    expect(sheet.rows).toHaveLength(4);
    expect(sheet.rows.find((r) => r.studentId === fx.kids[3])).toMatchObject({ status: "late", note: "Bus delay" });
  });

  it("accepts the grid's JSON string and keeps the last row for a repeated student", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const json = JSON.stringify([{ studentId: fx.kids[0], status: "absent" }, { studentId: fx.kids[0], status: "leave" }]);
    expect(await svc.mark({ sectionId: fx.own, date: "2026-10-06", entries: json })).toMatchObject({ leave: 1, total: 1 });
  });

  it("refuses future dates, holidays and students from another section", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    await expect(svc.mark({ sectionId: fx.own, date: addDays(todayIST(), 1), entries: entries(fx.kids) })).rejects.toMatchObject({ fieldErrors: { date: "You cannot mark a future date" } });
    await new HolidayService(a.as.admin).create({ date: "2026-10-02", name: "Gandhi Jayanti" });
    await expect(svc.mark({ sectionId: fx.own, date: "2026-10-02", entries: entries(fx.kids) })).rejects.toMatchObject({ fieldErrors: { date: "Gandhi Jayanti is a holiday" } });
    expect((await svc.sectionSheet(fx.own, "2026-10-02")).holiday).toBe("Gandhi Jayanti");
    await expect(svc.mark({ sectionId: fx.other, date: "2026-10-07", entries: entries(fx.kids) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a teacher marks only sections they are class teacher of or teach; admin marks any", async () => {
    const teacher = new StudentAttendanceService(a.as.teacher);
    await expect(teacher.mark({ sectionId: fx.own, date: "2026-10-08", entries: entries(fx.kids) })).resolves.toMatchObject({ total: 4 });
    await expect(teacher.mark({ sectionId: fx.other, date: "2026-10-08", entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.sectionSheet(fx.other, "2026-10-08")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.sectionSheet(fx.taught, "2026-10-08")).resolves.toMatchObject({ rows: [] });
    expect((await teacher.sectionOptions()).map((o) => o.id).sort()).toEqual([fx.own, fx.taught].sort());
    expect((await new StudentAttendanceService(a.as.admin).sectionOptions()).map((o) => o.label)).toEqual(["Class 5-A", "Class 5-B", "Class 5-C"]);
  });

  it("permissions: only admin and teacher mark; students and parents cannot use the staff views", async () => {
    const input = { sectionId: fx.own, date: "2026-10-09", entries: entries(fx.kids) };
    for (const who of [a.as.student, a.as.parent, a.as.accountant]) {
      await expect(new StudentAttendanceService(who).mark(input)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(new StudentAttendanceService(a.as.student).sectionSheet(fx.own, "2026-10-09")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentAttendanceService(a.as.parent).defaulters()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentAttendanceService(a.as.accountant).sectionSheet(fx.own, "2026-10-09")).resolves.toBeDefined();
  });

  it("monthly register: matrix, counts and % per student", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const [k0, k1] = fx.kids as [string, string];
    await svc.mark({ sectionId: fx.own, date: "2025-08-04", entries: entries([k0, k1]) });
    await svc.mark({ sectionId: fx.own, date: "2025-08-05", entries: [{ studentId: k0, status: "present" }, { studentId: k1, status: "absent" }] });
    await svc.mark({ sectionId: fx.own, date: "2025-08-06", entries: [{ studentId: k0, status: "late" }, { studentId: k1, status: "leave" }] });
    const reg = await svc.monthlyRegister(fx.own, "2025-08");
    expect(reg.days).toHaveLength(31);
    expect(reg.days.find((d) => d.date === "2025-08-03")?.sunday).toBe(true);
    const r0 = reg.rows.find((r) => r.studentId === k0)!, r1 = reg.rows.find((r) => r.studentId === k1)!;
    expect(r0.marks["2025-08-06"]).toBe("late");
    expect(r0.pct).toBe(100);
    expect(r1.pct).toBe(50); // 1 present, 1 absent, leave excused
    expect(reg.rows.find((r) => r.studentId === fx.kids[3])?.pct).toBeNull();
    await expect(svc.monthlyRegister(fx.own, "2025-13")).rejects.toBeInstanceOf(ValidationError);
  });

  it("students and parents see only their own record", async () => {
    const admin = new StudentAttendanceService(a.as.admin);
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) {
      await admin.mark({ sectionId: fx.own, date: d, entries: [{ studentId: fx.studentUserKid, status: d === "2026-09-04" ? "absent" : "present" }, { studentId: fx.parentKid, status: "present" }] });
    }
    const student = new StudentAttendanceService(a.as.student);
    expect(await student.studentSummary(fx.studentUserKid, "2026-09-01", "2026-09-30")).toMatchObject({ present: 3, absent: 1, pct: 75 });
    expect((await student.recentAbsences(fx.studentUserKid)).map((r) => r.date)).toContain("2026-09-04");
    await expect(student.studentSummary(fx.parentKid, "2026-09-01", "2026-09-30")).rejects.toBeInstanceOf(NotFoundError);
    expect((await student.myStudents()).map((s) => s.name)).toEqual(["Aarav Sharma"]);

    const parent = new StudentAttendanceService(a.as.parent);
    expect((await parent.myStudents()).map((s) => s.name)).toEqual(["Diya Patel"]);
    expect(await parent.studentSummary(fx.parentKid, "2026-09-01", "2026-09-30")).toMatchObject({ present: 4, pct: 100 });
    await expect(parent.studentSummary(fx.studentUserKid, "2026-09-01", "2026-09-30")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("defaulters: below the threshold with enough days, worst first", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const k = fx.kids[2]!;
    for (let i = 1; i <= 6; i++) await svc.mark({ sectionId: fx.own, date: addDays(todayIST(), -i), entries: [{ studentId: k, status: i <= 2 ? "present" : "absent" }, { studentId: fx.kids[1], status: "present" }] });
    const list = await svc.defaulters(75, 6); // a 6-day window ignores earlier tests
    expect(list.find((d) => d.studentId === k)).toMatchObject({ name: "Kabir Singh", pct: 33.3, absent: 4, sectionLabel: "Class 5-A" });
    expect(list.some((d) => d.studentId === fx.kids[1])).toBe(false);
    expect((await svc.defaulters(20, 6)).some((d) => d.studentId === k)).toBe(false);
  });

  it("today's summary and the trend count real marks", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    await svc.mark({ sectionId: fx.own, date: todayIST(), entries: [...entries(fx.kids.slice(0, 3)), { studentId: fx.kids[3], status: "absent" }] });
    expect(await svc.todaySchoolSummary()).toMatchObject({ present: 3, absent: 1, marked: 4, students: 5, pct: 75 });
    const trend = await svc.trend(30);
    expect(trend.at(-1)).toEqual({ date: todayIST(), pct: 75 });
    expect(trend.every((p, i) => i === 0 || trend[i - 1]!.date < p.date)).toBe(true);
  });

  it("a teacher's own class comes first; section progress shows who is unmarked; a student's month has marks and holidays", async () => {
    const teacher = new StudentAttendanceService(a.as.teacher);
    expect((await teacher.sectionOptions())[0]).toMatchObject({ id: fx.own, own: true });
    const date = todayIST();
    const admin = new StudentAttendanceService(a.as.admin);
    const progress = await admin.sectionProgress(date);
    expect(progress.find((p) => p.id === fx.own)).toMatchObject({ students: 4, marked: 4 });
    expect(progress.find((p) => p.id === fx.other)).toMatchObject({ students: 1, marked: 0 });
    expect((await teacher.sectionProgress(date)).some((p) => p.id === fx.other)).toBe(false);
    const m = await admin.studentMonth(fx.kids[0]!, "2026-10");
    expect(m.holidays["2026-10-02"]).toBe("Gandhi Jayanti");
    expect(m.marks["2026-10-05"]).toBe("present");
  });

  it("isolation: school B cannot read or write school A's attendance", async () => {
    const bSvc = new StudentAttendanceService(b.as.admin);
    await expect(bSvc.sectionSheet(fx.own, "2026-10-05")).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.mark({ sectionId: fx.own, date: "2026-10-05", entries: entries(fx.kids) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bSvc.studentSummary(fx.kids[0]!, "2026-01-01", "2026-12-31")).rejects.toBeInstanceOf(NotFoundError);
    expect((await bSvc.defaulters(100)).some((d) => fx.kids.includes(d.studentId))).toBe(false);
    expect((await bSvc.sectionOptions()).some((o) => o.id === fx.own)).toBe(false);
  });
});

describe("StaffAttendanceService", () => {
  it("admin marks staff; half day counts; the sheet shows teachers and accountants only", async () => {
    const svc = new StaffAttendanceService(a.as.admin);
    const date = "2026-10-05";
    const sheet = await svc.staffSheet(date);
    expect(sheet.rows.map((r) => r.role).sort()).toEqual(["accountant", "teacher"]);
    await svc.mark({ date, entries: [{ userId: a.users.teacher, status: "half_day" }, { userId: a.users.accountant, status: "present" }] });
    await svc.mark({ date, entries: [{ userId: a.users.accountant, status: "late" }] });
    const after = await svc.staffSheet(date);
    expect(after.rows.find((r) => r.userId === a.users.teacher)?.status).toBe("half_day");
    expect(after.rows.find((r) => r.userId === a.users.accountant)?.status).toBe("late");
  });

  it("only the admin marks staff, and only staff can be marked", async () => {
    const input = { date: "2026-10-06", entries: [{ userId: a.users.teacher, status: "present" }] };
    await expect(new StaffAttendanceService(a.as.teacher).mark(input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StaffAttendanceService(a.as.student).staffSheet("2026-10-06")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StaffAttendanceService(a.as.teacher).staffSheet("2026-10-06")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StaffAttendanceService(a.as.accountant).todaySummary()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StaffAttendanceService(a.as.admin).mark({ date: "2026-10-06", entries: [{ userId: a.users.student, status: "present" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(new StaffAttendanceService(a.as.admin).mark({ date: addDays(todayIST(), 2), entries: input.entries })).rejects.toBeInstanceOf(ValidationError);
  });

  it("isolation: school B cannot mark or see school A's staff", async () => {
    const bSvc = new StaffAttendanceService(b.as.admin);
    await expect(bSvc.mark({ date: "2026-10-05", entries: [{ userId: a.users.teacher, status: "absent" }] })).rejects.toBeInstanceOf(ValidationError);
    expect((await bSvc.staffSheet("2026-10-05")).rows.every((r) => r.status === null)).toBe(true);
  });
});

describe("HolidayService", () => {
  it("admin manages holidays; one per date; others cannot write; B cannot touch A's", async () => {
    const svc = new HolidayService(a.as.admin);
    const h = await svc.create({ date: "2026-11-01", name: "Diwali break" });
    await expect(svc.create({ date: "2026-11-01", name: "Again" })).rejects.toMatchObject({ code: "conflict" });
    await expect(new HolidayService(a.as.teacher).create({ date: "2026-11-02", name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    const bSvc = new HolidayService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === h.id)).toBe(false);
    await expect(bSvc.get(h.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(h.id, { date: "2026-11-01", name: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(h.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
