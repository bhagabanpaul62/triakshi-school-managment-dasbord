import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { buildSchoolData, type Fixture } from "./test-fixture";
import { LeaveService } from "./leave-service";
import { leaveRequests, studentAttendance } from "./schema";
import { StudentAttendanceService } from "./service";
import { addDays, todayIST } from "./stats";
import { EligibilityService } from "./eligibility";

let a: TestSchool;
let fx: Fixture;
let joiningId: string, leftId: string, earlyId: string, quietId: string, todayLeaverId: string;

beforeAll(async () => {
  ({ a } = await createSchoolPair(["students", "academics", "attendance"], "jn"));
  fx = await buildSchoolData(a);
  await withSchool(a.id, async (tx) => {
    const [cls] = await tx.select({ id: classes.id }).from(classes).limit(1);
    const base = { schoolId: a.id, classId: cls!.id };
    // joining: class set, no section, planned into "own". left: keeps the section they left from.
    const [j] = await tx.insert(students).values({ ...base, name: "Joining Jiya", admissionNo: `ADM-${a.slug}-j`, status: "joining", joinsSectionId: fx.own }).returning();
    const [l] = await tx.insert(students).values({ ...base, sectionId: fx.own, rollNo: 9, name: "Left Laksh", admissionNo: `ADM-${a.slug}-l`, status: "left", leftOn: "2026-09-10" }).returning();
    joiningId = j!.id; leftId = l!.id;
    const gone = (name: string, no: string, roll: number, leftOn: string) => tx.insert(students).values({ ...base, sectionId: fx.own, rollNo: roll, name, admissionNo: `ADM-${a.slug}-${no}`, status: "left", leftOn }).returning();
    earlyId = (await gone("Early Esha", "e", 10, "2026-08-20"))[0]!.id;
    quietId = (await gone("Quiet Qadir", "q", 11, "2026-08-25"))[0]!.id;
    todayLeaverId = (await gone("Today Tara", "t", 12, todayIST()))[0]!.id;
    await tx.insert(studentAttendance).values([
      { schoolId: a.id, studentId: leftId, sectionId: fx.own, date: "2026-09-01", status: "present" },
      { schoolId: a.id, studentId: earlyId, sectionId: fx.own, date: "2026-09-02", status: "present" },
    ]);
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("a joining child is in no register, sheet, strength or marking; a left child is not in today's live lists", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const sheet = await svc.sectionSheet(fx.own, "2026-10-05");
    expect(sheet.rows.map((r) => r.studentId)).not.toContain(leftId); // they left on 10 Sep: gone from October
    expect(sheet.rows.map((r) => r.studentId)).not.toContain(joiningId);
    expect((await svc.monthlyRegister(fx.own, "2026-10")).rows.map((r) => r.studentId)).not.toContain(leftId);
    expect((await svc.monthlyRegister(fx.own, "2026-09")).rows.map((r) => r.studentId)).not.toContain(joiningId);
    expect((await svc.sectionProgress("2026-10-05")).find((s) => s.id === fx.own)?.students).toBe(5); // four at school and the child who left today, who was still there on 5 Oct
    expect((await svc.todaySchoolSummary()).students).toBe(5);
    expect((await svc.sectionSheet(fx.own, todayIST())).rows.map((r) => r.studentId)).not.toContain(todayLeaverId);
    await expect(svc.mark({ sectionId: fx.own, date: "2026-10-05", entries: [{ studentId: leftId, status: "absent" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.mark({ sectionId: fx.own, date: "2026-09-05", entries: [{ studentId: joiningId, status: "absent" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(new EligibilityService(a.as.admin).addCondonation({ studentId: leftId, reason: "medical" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the register of the month they left in lists them, marks up to the last day only, with a plain Left note", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const reg = await svc.monthlyRegister(fx.own, "2026-09");
    // A mark after the last day (a late entry) is never shown.
    await withSchool(a.id, (tx) => tx.insert(studentAttendance).values({ schoolId: a.id, studentId: leftId, sectionId: fx.own, date: "2026-09-12", status: "present" }));
    const row = (await svc.monthlyRegister(fx.own, "2026-09")).rows.find((r) => r.studentId === leftId)!;
    await withSchool(a.id, (tx) => tx.delete(studentAttendance).where(and(eq(studentAttendance.studentId, leftId), eq(studentAttendance.date, "2026-09-12"))));
    expect(row).toMatchObject({ name: "Left Laksh", leftNote: "Left 10 Sep", counts: { present: 1, total: 1 } });
    expect(Object.keys(row.marks)).toEqual(["2026-09-01"]); // the stray mark on 12 Sep is not shown
    expect(reg.rows.find((r) => r.studentId !== leftId)!.leftNote).toBeNull();
    // Left earlier than the month, but a mark inside it: listed. Left earlier with no mark: not.
    expect(reg.rows.map((r) => r.studentId)).toContain(earlyId);
    expect((await svc.monthlyRegister(fx.own, "2026-09")).rows.map((r) => r.studentId)).not.toContain(quietId);
    expect((await svc.monthlyRegister(fx.own, "2026-08")).rows.map((r) => r.studentId)).toContain(leftId); // left_on is after the month's first day
  });

  it("the PDF and the CSV list them with the note", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const csv = await svc.registerCsv(fx.own, "2026-09");
    expect(csv.text.split("\n").find((l) => l.includes("Left Laksh"))).toMatch(/Left 10 Sep$/);
    expect(csv.text.split("\n")[0]).toMatch(/,Note$/);
    expect((await svc.registerPdf(fx.own, "2026-09")).bytes.length).toBeGreaterThan(500);
  });

  it("the sheet and the strength of a past day count them up to the last day; marking follows the same line", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    expect((await svc.sectionSheet(fx.own, "2026-09-05")).rows.find((r) => r.studentId === leftId)).toMatchObject({ leftNote: "Left 10 Sep" });
    expect((await svc.sectionSheet(fx.own, "2026-09-10")).rows.map((r) => r.studentId)).toContain(leftId);
    expect((await svc.sectionSheet(fx.own, "2026-09-11")).rows.map((r) => r.studentId)).not.toContain(leftId);
    expect((await svc.sectionProgress("2026-09-05")).find((s) => s.id === fx.own)?.students).toBe(6);
    expect((await svc.sectionProgress("2026-09-11")).find((s) => s.id === fx.own)?.students).toBe(5);
    // yesterday still holds the child who left today; today does not
    expect((await svc.sectionSheet(fx.own, addDays(todayIST(), -1))).rows.map((r) => r.studentId)).toContain(todayLeaverId);
    await svc.mark({ sectionId: fx.own, date: "2026-09-05", entries: [{ studentId: leftId, status: "absent" }] });
    await expect(svc.mark({ sectionId: fx.own, date: "2026-09-11", entries: [{ studentId: leftId, status: "absent" }] })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.monthlyRegister(fx.own, "2026-09")).rows.find((r) => r.studentId === leftId)!.marks["2026-09-05"]).toBe("absent");
    await withSchool(a.id, (tx) => tx.delete(studentAttendance).where(and(eq(studentAttendance.studentId, leftId), eq(studentAttendance.date, "2026-09-05"))));
  });

  it("keep a left child's old attendance readable", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    expect(await svc.studentSummary(leftId, "2026-09-01", "2026-09-30")).toMatchObject({ present: 1 });
    expect((await svc.studentMonth(leftId, "2026-09")).marks["2026-09-01"]).toBe("present");
  });

  it("leave decided after the child left marks nothing past the last day", async () => {
    const [r] = await withSchool(a.id, (tx) => tx.insert(leaveRequests).values({ schoolId: a.id, kind: "student", studentId: leftId, requestedBy: a.users.student, fromDate: "2026-09-09", toDate: "2026-09-15", reason: "Moving house" }).returning());
    await new LeaveService(a.as.admin).decide({ id: r!.id, decision: "approved" });
    const dates = (await withSchool(a.id, (tx) => tx.select({ d: studentAttendance.date }).from(studentAttendance).where(eq(studentAttendance.studentId, leftId)))).map((x) => x.d).sort();
    expect(dates).toEqual(["2026-09-01", "2026-09-09", "2026-09-10"]);
  });
});
