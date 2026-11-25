import { eq } from "drizzle-orm";
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
import { EligibilityService } from "./eligibility";

let a: TestSchool;
let fx: Fixture;
let joiningId: string, leftId: string;

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
    await tx.insert(studentAttendance).values({ schoolId: a.id, studentId: leftId, sectionId: fx.own, date: "2026-09-01", status: "present" });
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("appear in no register, sheet, strength or marking", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const sheet = await svc.sectionSheet(fx.own, "2026-10-05");
    expect(sheet.rows.map((r) => r.studentId)).not.toContain(leftId);
    expect(sheet.rows.map((r) => r.studentId)).not.toContain(joiningId);
    expect((await svc.monthlyRegister(fx.own, "2026-09")).rows.map((r) => r.studentId)).not.toContain(leftId);
    expect((await svc.sectionProgress("2026-10-05")).find((s) => s.id === fx.own)?.students).toBe(4);
    expect((await svc.todaySchoolSummary()).students).toBe(5);
    await expect(svc.mark({ sectionId: fx.own, date: "2026-10-05", entries: [{ studentId: leftId, status: "absent" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(new EligibilityService(a.as.admin).addCondonation({ studentId: leftId, reason: "medical" })).rejects.toBeInstanceOf(NotFoundError);
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
