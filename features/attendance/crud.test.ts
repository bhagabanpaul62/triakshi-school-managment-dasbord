import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { auditLogs } from "@smw/db";
import { sections } from "@smw/feature-academics/schema";
import { buildSchoolData, type Fixture } from "./test-fixture";
import { EligibilityService } from "./eligibility";
import { LeaveService } from "./leave-service";
import { HolidayService, StaffAttendanceService, StudentAttendanceService } from "./service";
import { attendanceCondonations, leaveRequests, studentAttendance } from "./schema";
import { addDays, todayIST } from "./stats";

let a: TestSchool, b: TestSchool;
let fx: Fixture;
const mail = new MemoryEmailSender();
// A Monday at least 14 days back: the leave back-dating limit never ages these tests.
const base = (() => { let x = addDays(todayIST(), -14); while (new Date(`${x}T00:00:00Z`).getUTCDay() !== 1) x = addDays(x, -1); return x; })();
const d = (n: number) => addDays(base, n);
const before = (n: number) => addDays(base, -n); // days well in the past, clear of the leave tests
const notes = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.title));
const leaveDays = (who: string, from: string, to: string) => withSchool(a.id, async (tx) =>
  (await tx.select().from(studentAttendance).where(eq(studentAttendance.studentId, who))).filter((r) => r.status === "leave" && r.date >= from && r.date <= to).map((r) => r.date).sort());
const actions = (entity: string, entityId: string) => withSchool(a.id, async (tx) =>
  (await tx.select({ action: auditLogs.action }).from(auditLogs).where(sql`${auditLogs.entity} = ${entity} and ${auditLogs.entityId} = ${entityId}`).orderBy(auditLogs.createdAt)).map((r) => r.action));

beforeAll(async () => {
  useServices({ email: mail, storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(["students", "academics", "timetable", "attendance", "notifications"], "cr"));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
});
afterAll(closeDb);

describe("leave: edit while waiting, reverse after deciding", () => {
  let id: string;

  it("the requester edits a waiting request; nobody else does; a decided one is locked", async () => {
    const student = new LeaveService(a.as.student);
    const r = await student.apply({ fromDate: d(0), toDate: d(1), reason: "Fever" });
    id = r.id;
    expect((await student.mine())[0]).toMatchObject({ canEdit: true });
    const edited = await student.edit({ id, fromDate: d(0), toDate: d(4), reason: "Fever and rest" });
    expect(edited).toMatchObject({ toDate: d(4), reason: "Fever and rest", status: "pending" });
    await expect(student.edit({ id, fromDate: d(4), toDate: d(0), reason: "Backwards" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new LeaveService(a.as.teacher).edit({ id, fromDate: d(0), toDate: d(1), reason: "Not mine" })).rejects.toBeInstanceOf(NotFoundError);
    // Overlap with another live request is refused, but a request never clashes with itself.
    const other = await student.apply({ fromDate: d(8), toDate: d(9), reason: "Trip" });
    await expect(student.edit({ id: other.id, fromDate: d(3), toDate: d(9), reason: "Trip" })).rejects.toMatchObject({ fieldErrors: { fromDate: expect.any(String) } });
    await student.cancel(other.id);
    await new LeaveService(a.as.teacher).decide({ id, decision: "approved" });
    await expect(student.edit({ id, fromDate: d(0), toDate: d(1), reason: "Late change" })).rejects.toBeInstanceOf(ValidationError);
    expect((await student.mine()).find((x) => x.id === id)).toMatchObject({ canEdit: false });
  });

  it("the approver reverses an approval: the leave days it marked are cleared, the requester is told, the audit log keeps the trail", async () => {
    expect(await leaveDays(fx.studentUserKid, d(0), d(4))).toEqual([d(0), d(1), d(2), d(3), d(4)]);
    const teacher = new LeaveService(a.as.teacher);
    expect((await teacher.inbox("decided")).find((r) => r.id === id)).toMatchObject({ canReverse: true, status: "approved" });
    const res = await teacher.reverse({ id, note: "Wrong dates" });
    expect(res).toMatchObject({ status: "rejected", days: 5 });
    expect(await leaveDays(fx.studentUserKid, d(0), d(4))).toEqual([]);
    const [row] = await withSchool(a.id, (tx) => tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)));
    expect(row).toMatchObject({ status: "rejected", note: "Wrong dates", reversedBy: a.users.teacher });
    expect(row!.reversedAt).toBeTruthy();
    expect((await notes(a, a.users.student)).some((t) => t.includes("now not approved"))).toBe(true);
    expect(await actions("Leave request", id)).toEqual(["apply", "update", "approve", "reverse"]);
  });

  it("reversing a rejection re-marks the days, but never over a day marked present, and never over a clashing request", async () => {
    const admin = new StudentAttendanceService(a.as.admin);
    await admin.mark({ sectionId: fx.own, date: d(1), entries: [{ studentId: fx.studentUserKid, status: "present" }] }, { alerts: false });
    const svc = new LeaveService(a.as.admin);
    // A new request over the same days is allowed while this one is rejected; the reversal must then be refused.
    const clash = await new LeaveService(a.as.student).apply({ fromDate: d(3), toDate: d(3), reason: "Appointment" });
    await expect(svc.reverse({ id })).rejects.toMatchObject({ fieldErrors: { fromDate: expect.any(String) } });
    await new LeaveService(a.as.student).cancel(clash.id);
    expect(await svc.reverse({ id })).toMatchObject({ status: "approved", days: 4 });
    expect(await leaveDays(fx.studentUserKid, d(0), d(4))).toEqual([d(0), d(2), d(3), d(4)]);
    expect((await admin.studentMonth(fx.studentUserKid, d(1).slice(0, 7))).marks[d(1)]).toBe("present");
  });

  it("a day marked leave by hand survives a reversal; undecided requests, strangers and other schools cannot reverse", async () => {
    await new StudentAttendanceService(a.as.admin).mark({ sectionId: fx.own, date: d(2), entries: [{ studentId: fx.studentUserKid, status: "leave", note: "Doctor's visit" }] }, { alerts: false });
    expect(await new LeaveService(a.as.admin).reverse({ id })).toMatchObject({ status: "rejected", days: 3 });
    expect(await leaveDays(fx.studentUserKid, d(0), d(4))).toEqual([d(2)]);

    const pending = await new LeaveService(a.as.student).apply({ fromDate: d(10), toDate: d(10), reason: "Wedding" });
    await expect(new LeaveService(a.as.admin).reverse({ id: pending.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(new LeaveService(a.as.student).reverse({ id })).rejects.toBeInstanceOf(ForbiddenError);
    // A teacher who is not class teacher of the student's section may not reverse.
    await withSchool(a.id, async (tx) => {
      await tx.update(leaveRequests).set({ status: "approved" }).where(eq(leaveRequests.id, pending.id));
      await tx.update(sections).set({ classTeacherId: null }).where(eq(sections.id, fx.own));
    });
    await expect(new LeaveService(a.as.teacher).reverse({ id: pending.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new LeaveService(b.as.admin).reverse({ id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new LeaveService(b.as.admin).edit({ id: pending.id, fromDate: d(10), toDate: d(10), reason: "Nothing" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("condonations: edit", () => {
  it("the admin changes the reason and note; the document stays; teachers and school B cannot", async () => {
    const svc = new EligibilityService(a.as.admin);
    const file = { name: "cert.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([37, 80, 68, 70]) };
    const { row } = await svc.addCondonation({ studentId: fx.kids[2], reason: "medical", note: "Surgery" }, file);
    expect(await svc.updateCondonation({ id: row.id, reason: "sports", note: "State camp" })).toMatchObject({ reason: "sports", note: "State camp", fileName: "cert.pdf" });
    expect(await svc.updateCondonation({ id: row.id, reason: "other" })).toMatchObject({ reason: "other", note: null });
    await expect(svc.updateCondonation({ id: row.id, reason: "bogus" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new EligibilityService(a.as.teacher).updateCondonation({ id: row.id, reason: "sports" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EligibilityService(b.as.admin).updateCondonation({ id: row.id, reason: "sports" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await actions("Attendance condonation", row.id)).sort()).toEqual(["condone", "update", "update"]);
    await svc.removeCondonation(row.id);
    expect(await withSchool(a.id, (tx) => tx.select().from(attendanceCondonations).where(eq(attendanceCondonations.id, row.id)))).toEqual([]);
  });
});

describe("holidays: edit, and a guard where history matters", () => {
  it("refuses a holiday on a day somebody already marked; edits and deletes the rest; one holiday per date", async () => {
    const svc = new HolidayService(a.as.admin);
    await new StudentAttendanceService(a.as.admin).mark({ sectionId: fx.own, date: before(20), entries: [{ studentId: fx.kids[0], status: "present" }] }, { alerts: false });
    await expect(svc.create({ date: before(20), name: "Founders day" })).rejects.toMatchObject({ fieldErrors: { date: expect.stringContaining("already marked") } });
    const h = await svc.create({ date: before(21), name: "Founders day" });
    expect(await svc.update(h.id, { date: before(21), name: "Founders Day" })).toMatchObject({ name: "Founders Day" });
    await expect(svc.update(h.id, { date: before(20), name: "Founders Day" })).rejects.toBeInstanceOf(ValidationError);
    const h2 = await svc.create({ date: before(22), name: "Other" });
    await expect(svc.update(h2.id, { date: before(21), name: "Other" })).rejects.toBeInstanceOf(ConflictError);
    expect(await svc.update(h2.id, { date: before(23), name: "Other" })).toMatchObject({ date: before(23) });
    await svc.remove(h.id);
    await expect(svc.get(h.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new HolidayService(a.as.teacher).update(h2.id, { date: before(24), name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HolidayService(b.as.admin).update(h2.id, { date: before(24), name: "Nope" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("staff attendance: correct a past day", () => {
  it("the admin edits any past day and a second mark replaces the first; a teacher cannot; school B is separate", async () => {
    const admin = new StaffAttendanceService(a.as.admin);
    const day = before(30);
    await admin.mark({ date: day, entries: [{ userId: a.users.teacher, status: "absent" }] });
    expect((await admin.staffSheet(day)).rows.find((r) => r.userId === a.users.teacher)?.status).toBe("absent");
    await admin.mark({ date: day, entries: [{ userId: a.users.teacher, status: "half_day", note: "Left at noon" }] });
    expect((await admin.staffSheet(day)).rows.find((r) => r.userId === a.users.teacher)).toMatchObject({ status: "half_day", note: "Left at noon" });
    await expect(new StaffAttendanceService(a.as.teacher).mark({ date: day, entries: [{ userId: a.users.teacher, status: "present" }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StaffAttendanceService(b.as.admin).mark({ date: day, entries: [{ userId: a.users.teacher, status: "present" }] })).rejects.toBeInstanceOf(ValidationError);
    expect((await new StaffAttendanceService(b.as.admin).staffSheet(day)).rows.every((r) => r.status === null)).toBe(true);
  });
});

describe("settings", () => {
  it("are per school and validated; leaving a field out keeps its value", async () => {
    const svc = new EligibilityService(a.as.admin);
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 70, mode: "period", rollupPercent: 60 });
    await svc.updateSettings({ alertsEnabled: false, thresholdPercent: 70 });
    expect(await svc.settings()).toEqual({ alertsEnabled: false, thresholdPercent: 70, mode: "period", rollupPercent: 60 });
    await expect(svc.updateSettings({ alertsEnabled: true, thresholdPercent: 70, mode: "weekly" })).rejects.toBeInstanceOf(ValidationError);
    expect(await new EligibilityService(b.as.admin).settings()).toEqual({ alertsEnabled: true, thresholdPercent: 75, mode: "daily", rollupPercent: 50 });
  });
});
