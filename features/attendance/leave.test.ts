import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { buildSchoolData, type Fixture } from "./test-fixture";
import { EligibilityService } from "./eligibility";
import { LeaveService } from "./leave-service";
import { LeaveTypeService } from "./leave-types";
import { HolidayService, StaffAttendanceService, StudentAttendanceService } from "./service";
import { registerCsv, registerPdf } from "./register-export";
import { absenceAlerts, attendanceSettings } from "./schema";
import { addDays, todayIST } from "./stats";
import { sendDueAlerts, sendMails } from "./alerts";

let a: TestSchool, b: TestSchool;
let fx: Fixture;
const mail = new MemoryEmailSender();
// Dates are relative to today so the 30-day back-dating rule never ages the tests: a Monday at least 14 days back.
const base = (() => { let x = addDays(todayIST(), -14); while (new Date(`${x}T00:00:00Z`).getUTCDay() !== 1) x = addDays(x, -1); return x; })();
const d = (n: number) => addDays(base, n);
const M = d(2).slice(0, 7);

/** Staff must pick a leave type; Casual is one of the defaults. */
const casual = async () => (await new LeaveTypeService(a.as.admin).all()).find((t) => t.code === "CL")!.id;
const notes = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.title));

beforeAll(async () => {
  useServices({ email: mail, storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(["students", "academics", "attendance", "notifications"], "lv"));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
});
afterAll(closeDb);

describe("absence alert", () => {
  const today = todayIST();
  const kid = () => fx.studentUserKid;

  /** What the worker does every 10 minutes, run as if `minutes` had passed. */
  const sendAfter = async (minutes: number) => sendMails(await withSchool(a.id, (tx) => sendDueAlerts(tx, a.id, new Date(Date.now() + minutes * 60_000))));
  const rows = () => withSchool(a.id, (tx) => tx.select().from(absenceAlerts).where(eq(absenceAlerts.studentId, kid())));

  it("queues one alert per student and date however often the day is saved, and sends it once after the grace window", async () => {
    const svc = new StudentAttendanceService(a.as.teacher);
    const before = mail.sent.length;
    await svc.mark({ sectionId: fx.own, date: today, entries: [{ studentId: kid(), status: "absent" }] });
    await svc.mark({ sectionId: fx.own, date: today, entries: [{ studentId: kid(), status: "absent" }] });
    await svc.mark({ sectionId: fx.own, date: today, entries: [{ studentId: kid(), status: "late" }] });
    expect((await notes(a, a.users.student)).filter((t) => t.includes(today))).toHaveLength(0); // nothing until the window passes
    await sendAfter(5);
    expect((await notes(a, a.users.student)).filter((t) => t.includes(today))).toHaveLength(0);
    await sendAfter(31);
    await sendAfter(31); // a second run sends nothing more
    expect((await notes(a, a.users.student)).filter((t) => t.includes(today))).toEqual([expect.stringContaining("marked late")]);
    expect(mail.sent.slice(before).filter((m) => m.to === `student@${a.slug}.test`)).toHaveLength(1);
    expect((await rows()).filter((r) => r.date === today)).toMatchObject([{ sentAt: expect.any(Date) }]);
  });

  it("a mark corrected inside the window never reaches the family", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const day = addDays(today, -1), n = (await notes(a, a.users.student)).length;
    await svc.mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "absent" }] });
    await svc.mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "present" }] });
    await sendAfter(31);
    expect((await notes(a, a.users.student)).length).toBe(n);
    expect((await rows()).filter((r) => r.date === day)).toHaveLength(0); // dropped, so a later real absence can still alert
  });

  it("does not queue for present, for students without a login, for old days, or when the school turns alerts off", async () => {
    const svc = new StudentAttendanceService(a.as.admin);
    const day = addDays(today, -1), n = (await notes(a, a.users.student)).length;
    await svc.mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "present" }, { studentId: fx.kids[1], status: "absent" }] });
    // Before `base`, so it never lands on a day the leave tests below expect to be unmarked.
    await svc.mark({ sectionId: fx.own, date: addDays(today, -25), entries: [{ studentId: kid(), status: "absent" }] });
    await withSchool(a.id, (tx) => tx.insert(attendanceSettings).values({ schoolId: a.id, alertsEnabled: false, thresholdPercent: 75 }));
    await svc.mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "absent" }] });
    await sendAfter(31);
    expect((await notes(a, a.users.student)).length).toBe(n);
    expect(await withSchool(a.id, (tx) => tx.select().from(absenceAlerts).where(eq(absenceAlerts.date, day)))).toHaveLength(0);
    await withSchool(a.id, (tx) => tx.delete(attendanceSettings));
    await svc.mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "present" }] });
  });

  it("a failing email never fails the mark or the run", async () => {
    const day = addDays(todayIST(), -1);
    await expect(new StudentAttendanceService(a.as.admin).mark({ sectionId: fx.own, date: day, entries: [{ studentId: kid(), status: "late" }] })).resolves.toMatchObject({ late: 1 });
    useServices({ email: { send: async () => { throw new Error("smtp down"); } } });
    await expect(sendAfter(31)).resolves.toBeUndefined();
    useServices({ email: mail });
  });

  it("only the admin changes the settings; school B's alerts are its own", async () => {
    await expect(new EligibilityService(a.as.teacher).updateSettings({ alertsEnabled: false, thresholdPercent: 75 })).rejects.toBeInstanceOf(ForbiddenError);
    await new EligibilityService(b.as.admin).updateSettings({ alertsEnabled: false, thresholdPercent: 60 });
    expect(await new EligibilityService(a.as.admin).settings()).toEqual({ alertsEnabled: true, thresholdPercent: 75, mode: "daily", rollupPercent: 50 });
    expect(await new EligibilityService(b.as.admin).settings()).toEqual({ alertsEnabled: false, thresholdPercent: 60, mode: "daily", rollupPercent: 50 });
  });
});

describe("leave requests", () => {
  // Monday to the next Monday: d(2) is made a holiday, d(6) is a Sunday.
  const range = { fromDate: d(0), toDate: d(7), reason: "Family wedding" };
  let id: string;

  it("a student applies; the class teacher approves; days become leave, skipping holiday, Sunday and present days", async () => {
    await new HolidayService(a.as.admin).create({ date: d(2), name: "School day off" });
    const admin = new StudentAttendanceService(a.as.admin);
    await admin.mark({ sectionId: fx.own, date: d(1), entries: [{ studentId: fx.studentUserKid, status: "present" }] }, { alerts: false });
    await admin.mark({ sectionId: fx.own, date: d(3), entries: [{ studentId: fx.studentUserKid, status: "absent" }] }, { alerts: false });

    const req = await new LeaveService(a.as.student).apply(range);
    id = req.id;
    expect(req).toMatchObject({ kind: "student", status: "pending", studentId: fx.studentUserKid });
    expect(await new LeaveService(a.as.student).mine()).toHaveLength(1);
    expect((await new LeaveService(a.as.teacher).inbox("pending")).map((r) => r.id)).toContain(id);

    const res = await new LeaveService(a.as.teacher).decide({ id, decision: "approved", note: "Get well soon" });
    expect(res).toMatchObject({ status: "approved", marked: 5 }); // d(0), d(3), d(4), d(5), d(7): d(1) present, d(2) holiday, d(6) Sunday
    const s = await new StudentAttendanceService(a.as.admin).studentMonth(fx.studentUserKid, M);
    expect(s.marks).toMatchObject({ [d(0)]: "leave", [d(1)]: "present", [d(3)]: "leave", [d(7)]: "leave" });
    expect(s.marks[d(2)]).toBeUndefined();
    expect(s.marks[d(6)]).toBeUndefined();
    expect((await notes(a, a.users.student)).some((t) => t.includes("approved"))).toBe(true);
    expect(mail.sent.some((m) => m.to === `student@${a.slug}.test` && m.subject.includes("approved"))).toBe(true);
    expect((await new LeaveService(a.as.teacher).inbox("decided")).map((r) => r.id)).toContain(id);
  });

  it("a decided request cannot be decided again, and rejecting marks nothing", async () => {
    await expect(new LeaveService(a.as.admin).decide({ id, decision: "rejected" })).rejects.toBeInstanceOf(ValidationError);
    const r = await new LeaveService(a.as.student).apply({ fromDate: d(10), toDate: d(11), reason: "Trip" });
    await new LeaveService(a.as.admin).decide({ id: r.id, decision: "rejected", note: "Exams" });
    expect((await new StudentAttendanceService(a.as.admin).studentMonth(fx.studentUserKid, M)).marks[d(10)]).toBeUndefined();
    expect((await notes(a, a.users.student)).some((t) => t.includes("not approved"))).toBe(true);
  });

  it("overlapping requests, bad dates and withdrawing", async () => {
    const svc = new LeaveService(a.as.student);
    await expect(svc.apply(range)).rejects.toMatchObject({ fieldErrors: { fromDate: expect.any(String) } });
    await expect(svc.apply({ fromDate: d(13), toDate: d(12), reason: "Backwards" })).rejects.toBeInstanceOf(ValidationError);
    const r = await svc.apply({ fromDate: d(14), toDate: d(15), reason: "Appointment" });
    await svc.cancel(r.id);
    expect((await svc.mine()).find((x) => x.id === r.id)?.status).toBe("cancelled");
    await expect(new LeaveService(a.as.admin).cancel(r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a teacher of another section cannot approve; a class teacher cannot decide staff leave", async () => {
    // Move the student into section "other" (class teacher: nobody), keep the teacher of "own" as an outsider.
    await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, name: "Mira", admissionNo: `ADM-${a.slug}-m`, sectionId: fx.other, rollNo: 9, userId: a.users.parent }));
    const parentApply = await new LeaveService({ ...a.as.student, userId: a.users.parent }).apply({ fromDate: d(16), toDate: d(16), reason: "Fever" });
    const teacher = new LeaveService(a.as.teacher);
    expect((await teacher.inbox("pending")).some((r) => r.id === parentApply.id)).toBe(false);
    await expect(teacher.decide({ id: parentApply.id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new LeaveService(a.as.admin).decide({ id: parentApply.id, decision: "approved" })).resolves.toMatchObject({ status: "approved" });

    const staffReq = await new LeaveService(a.as.teacher).apply({ fromDate: d(8), toDate: d(9), reason: "Training", typeId: await casual() });
    expect(staffReq.kind).toBe("staff");
    await expect(teacher.decide({ id: staffReq.id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a staff-base custom role with attendance:approve decides only its own sections' student leave, never staff leave", async () => {
    const custom = { ...a.as.teacher, role: "staff" as const, grants: new Set(["attendance:approve", "attendance:leave"]) };
    const svc = new LeaveService(custom);
    const student = await new LeaveService(a.as.student).apply({ fromDate: d(20), toDate: d(20), reason: "Cold" });
    const staffReq = await new LeaveService(a.as.teacher).apply({ fromDate: d(21), toDate: d(21), reason: "Course", typeId: await casual() });
    const ids = (await svc.inbox("pending")).map((r) => r.id);
    expect(ids).toContain(student.id); // teacher user is class teacher of "own"
    expect(ids).not.toContain(staffReq.id);
    await expect(svc.decide({ id: staffReq.id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    const outsider = new LeaveService({ ...custom, userId: a.users.accountant });
    expect(await outsider.inbox("pending")).toEqual([]);
    await expect(outsider.decide({ id: student.id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    const manager = new LeaveService({ ...custom, userId: a.users.accountant, grants: new Set(["attendance:approve", "attendance:manage"]) });
    await expect(manager.decide({ id: staffReq.id, decision: "rejected" })).resolves.toMatchObject({ status: "rejected" });
  });

  it("two concurrent decisions: exactly one wins, the other gets a conflict", async () => {
    const r = await new LeaveService(a.as.student).apply({ fromDate: d(22), toDate: d(22), reason: "Race" });
    const res = await Promise.allSettled([
      new LeaveService(a.as.admin).decide({ id: r.id, decision: "approved" }),
      new LeaveService(a.as.teacher).decide({ id: r.id, decision: "rejected" }),
    ]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect([ConflictError, ValidationError].some((E) => lost.reason instanceof E)).toBe(true);
  });

  it("refuses a Word file and leaves no orphan when the insert fails", async () => {
    const docx = { name: "n.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    await expect(new LeaveService(a.as.student).apply({ fromDate: d(24), toDate: d(24), reason: "x" }, docx)).rejects.toBeInstanceOf(ValidationError);
    const st = new MemoryStorage();
    useServices({ email: mail, storage: st });
    const pdf = { name: "n.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    await expect(new LeaveService(a.as.student).apply({ fromDate: d(0), toDate: d(0), reason: "clash" }, pdf)).rejects.toBeInstanceOf(ValidationError);
    expect(await st.list("")).toEqual([]);
    useServices({ email: mail, storage: new MemoryStorage() });
  });

  it("staff leave: admin approves, the days become leave without overwriting present", async () => {
    const staff = new StaffAttendanceService(a.as.admin);
    await staff.mark({ date: d(9), entries: [{ userId: a.users.teacher, status: "present" }] });
    const req = (await new LeaveService(a.as.admin).inbox("pending")).find((r) => r.kind === "staff")!;
    expect(req.who).toBe(`teacher ${a.slug}`);
    await expect(new LeaveService(a.as.admin).decide({ id: req.id, decision: "approved" })).resolves.toMatchObject({ marked: 1 });
    expect((await staff.staffSheet(d(8))).rows.find((r) => r.userId === a.users.teacher)?.status).toBe("leave");
    expect((await staff.staffSheet(d(9))).rows.find((r) => r.userId === a.users.teacher)?.status).toBe("present");
  });

  it("staff leave keeps late and half-day marks, only fills absent or unmarked days", async () => {
    const staff = new StaffAttendanceService(a.as.admin);
    await staff.mark({ date: d(10), entries: [{ userId: a.users.teacher, status: "late" }] });
    await staff.mark({ date: d(11), entries: [{ userId: a.users.teacher, status: "absent" }] });
    const req = await new LeaveService(a.as.teacher).apply({ fromDate: d(10), toDate: d(11), reason: "Course", typeId: await casual() });
    await new LeaveService(a.as.admin).decide({ id: req.id, decision: "approved" });
    const on = async (day: string) => (await staff.staffSheet(day)).rows.find((r) => r.userId === a.users.teacher)?.status;
    expect([await on(d(10)), await on(d(11))]).toEqual(["late", "leave"]);
  });

  it("nobody decides their own leave, except the only admin with a reason", async () => {
    const mine = { ...a.as.teacher, grants: new Set(["attendance:approve", "attendance:leave", "attendance:manage"]) };
    const req = await new LeaveService(mine).apply({ fromDate: d(49), toDate: d(49), reason: "Own", typeId: await casual() });
    await expect(new LeaveService(mine).decide({ id: req.id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    const adminReq = await new LeaveService(a.as.admin).apply({ fromDate: d(50), toDate: d(50), reason: "Own", typeId: await casual() });
    await expect(new LeaveService(a.as.admin).decide({ id: adminReq.id, decision: "approved" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new LeaveService(a.as.admin).decide({ id: adminReq.id, decision: "approved", note: "Only admin" })).resolves.toMatchObject({ status: "approved" });
    await expect(new LeaveService(a.as.admin).reverse({ id: adminReq.id })).rejects.toBeInstanceOf(ValidationError);
    await new LeaveService(a.as.admin).decide({ id: req.id, decision: "approved" });
    await expect(new LeaveService(mine).reverse({ id: req.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses staff leave in a month whose salary is already approved", async () => {
    const req = await new LeaveService(a.as.teacher).apply({ fromDate: d(56), toDate: d(56), reason: "Course", typeId: await casual() });
    class PaidMonth extends LeaveService { protected override async payMonthClosed(_tx: Tx, month: string) { return month === d(56).slice(0, 7); } }
    await expect(new PaidMonth(a.as.admin).decide({ id: req.id, decision: "approved" })).rejects.toThrow(/Salary for .* is already approved; ask for a recall or adjust next month/);
    await expect(new PaidMonth(a.as.admin).decide({ id: req.id, decision: "rejected" })).resolves.toMatchObject({ status: "rejected" });
  });

  it("permissions and isolation: accountants cannot approve, school B sees and decides nothing of A's", async () => {
    await expect(new LeaveService(a.as.accountant).inbox("pending")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new LeaveService(a.as.accountant).decide({ id, decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new LeaveService(b.as.admin).inbox("pending")).toEqual([]);
    expect(await new LeaveService(b.as.admin).inbox("decided")).toEqual([]);
    await expect(new LeaveService(b.as.admin).decide({ id, decision: "approved" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("board eligibility", () => {
  let kids: string[] = [];

  beforeAll(async () => {
    // Class 10 section with three students: one below 75%, one fine, one below but later condoned.
    const ids = await withSchool(a.id, async (tx) => {
      const [cls] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 10", grade: 10 }).returning();
      const [own] = await tx.select().from(sections).where(eq(sections.id, fx.own));
      const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: own!.yearId, name: "A" }).returning();
      const rows = await tx.insert(students).values(["Low One", "Fine Two", "Low Three"].map((name, i) => ({ schoolId: a.id, name, admissionNo: `B10-${a.slug}-${i}`, classId: cls!.id, sectionId: sec!.id, rollNo: i + 1 }))).returning();
      return { sec: sec!.id, kids: rows.map((r) => r.id) };
    });
    kids = ids.kids;
    const admin = new StudentAttendanceService(a.as.admin);
    for (const [i, d] of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].entries()) {
      await admin.mark({ sectionId: ids.sec, date: d, entries: [
        { studentId: kids[0]!, status: i === 0 ? "present" : "absent" }, { studentId: kids[1]!, status: "present" }, { studentId: kids[2]!, status: i < 2 ? "present" : "absent" },
      ] }, { alerts: false });
    }
  });

  it("lists only Class 10/12 students below the threshold, over the academic year, with the right status", async () => {
    const svc = new EligibilityService(a.as.admin);
    const r = await svc.eligibility();
    expect(r.threshold).toBe(75);
    expect(r.rows.map((x) => [x.name, x.pct, x.eligible])).toEqual([["Low One", 25, false], ["Low Three", 50, false]]);
    expect(r.rows.some((x) => fx.kids.includes(x.studentId))).toBe(false); // Class 5 is never listed
  });

  it("the admin condones a student: status becomes eligible (condoned), once per year, with a document", async () => {
    const svc = new EligibilityService(a.as.admin);
    const file = { name: "cert.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([37, 80, 68, 70]) };
    await svc.addCondonation({ studentId: kids[2], reason: "medical", note: "Surgery" }, file);
    const row = (await svc.eligibility()).rows.find((x) => x.studentId === kids[2])!;
    expect(row).toMatchObject({ eligible: true, condonation: { reason: "medical", fileName: "cert.pdf" } });
    expect(row.condonation?.fileUrl).toBeTruthy();
    await expect(svc.addCondonation({ studentId: kids[2], reason: "sports" })).rejects.toMatchObject({ code: "conflict" });
    await svc.removeCondonation(row.condonation!.id);
    expect((await svc.eligibility()).rows.find((x) => x.studentId === kids[2])?.eligible).toBe(false);
  });

  it("the threshold setting changes the list; teachers read but cannot condone; B is isolated", async () => {
    const svc = new EligibilityService(a.as.admin);
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 40 });
    expect((await svc.eligibility()).rows.map((x) => x.name)).toEqual(["Low One"]);
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 75 });
    await expect(new EligibilityService(a.as.teacher).addCondonation({ studentId: kids[0], reason: "other" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new EligibilityService(a.as.teacher).eligibility()).rows).toEqual([]); // teacher of other sections sees none of Class 10
    expect((await new EligibilityService(b.as.admin).eligibility()).rows).toEqual([]);
    await expect(new EligibilityService(b.as.admin).addCondonation({ studentId: kids[0], reason: "other" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new EligibilityService(a.as.student).eligibility()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("register export", () => {
  it("CSV and PDF carry the month grid; teachers of other sections are refused; staff register is admin-only", async () => {
    const admin = new StudentAttendanceService(a.as.admin);
    const csv = await admin.registerCsv(fx.own, M);
    const lines = csv.text.trim().split("\n");
    expect(lines[0]).toMatch(/^Roll,Name,1,2,/);
    const aarav = lines.find((l) => l.includes("Aarav"))!;
    expect(aarav).toContain("LV"); // approved leave
    expect(aarav).toContain(",H,"); // holiday or Sunday
    const pdf = await admin.registerPdf(fx.own, M);
    expect(Buffer.from(pdf.bytes.slice(0, 4)).toString()).toBe("%PDF");
    await expect(new StudentAttendanceService(a.as.teacher).registerPdf(fx.other, M)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new StaffAttendanceService(a.as.admin).registerCsv(M)).toMatchObject({ fileName: `staff-register-${M}.csv` });
    await expect(new StaffAttendanceService(a.as.teacher).registerPdf(M)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentAttendanceService(b.as.admin).registerCsv(fx.own, M)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("pure builders handle many pages and quoting", async () => {
    const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, day: i + 1, sunday: false, holiday: null }));
    const people = Array.from({ length: 70 }, (_, i) => ({ name: `Kid, "${i}"`, marks: { "2026-10-01": "present" } }));
    expect(registerCsv({ school: "S", title: "T", subtitle: "x", days, people }).split("\n")[1]).toContain('"Kid, ""0"""');
    expect((await registerPdf({ school: "S", title: "T", subtitle: "x", days, people })).length).toBeGreaterThan(1000);
  });
});
