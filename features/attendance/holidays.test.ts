import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, closeDb, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices, type SheetRows } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { notifications } from "@smw/feature-notifications/schema";
import { deliverDue } from "@smw/feature-notifications/delivery";
import { activeClosures, closedDays, closedFrom, closedSet, isClosed, nationalDaysIn, openSundays, workingDayReport, type HolidayRow } from "./holidays";
import { HolidayService } from "./holiday-service";
import { checkSheet, copyProposals } from "./holiday-import";
import { holidayInput } from "./holiday-inputs";
import { monthDays } from "./leave-api";
import { requestMonths } from "./leave-ledger";
import { LeaveService } from "./leave-service";
import { StaffAttendanceService, StudentAttendanceService } from "./service";
import { attendanceHolidays, leaveRequests, studentAttendance } from "./schema";
import { addDays, isSunday, todayIST } from "./stats";
import { buildSchoolData, type Fixture } from "./test-fixture";

const C5 = "00000000-0000-4000-8000-000000000005", C7 = "00000000-0000-4000-8000-000000000007";
const row = (date: string, over: Partial<HolidayRow> = {}): HolidayRow => ({ date, name: "Day off", kind: "other", appliesTo: "all", classIds: [], ...over });
const csv = (text: string) => ({ name: "holidays.csv", bytes: new TextEncoder().encode(text) });

// March 2026: Sundays are the 1st, 8th, 15th, 22nd and 29th. Everything below is in the past, so marks are allowed.
const MARCH = "2026-03";

let a: TestSchool, b: TestSchool;
let fx: Fixture;
let class6: { classId: string; sectionId: string; kid: string };
let class5Id: string;
const admin = () => new HolidayService(a.as.admin);

beforeAll(async () => {
  useServices({ email: new MemoryEmailSender(), storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(["students", "academics", "timetable", "attendance", "notifications"], "hol"));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
  class5Id = (await withSchool(a.id, (tx) => tx.select({ id: classes.id }).from(classes).where(eq(classes.name, "Class 5"))))[0]!.id;
  class6 = await withSchool(a.id, async (tx) => {
    const [cls] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 6", grade: 6 }).returning();
    const [year] = await tx.select().from(academicYears).limit(1);
    const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: year!.id, name: "A" }).returning();
    const [kid] = await tx.insert(students).values({ schoolId: a.id, name: "Meera Rao", admissionNo: "ADM-hol-6", classId: cls!.id, sectionId: sec!.id, rollNo: 1 }).returning();
    return { classId: cls!.id, sectionId: sec!.id, kid: kid!.id };
  });
});
afterAll(closeDb);

describe("closedFrom: who is off on which day", () => {
  it("closes Sundays; a working row opens a Sunday only for the people it covers", () => {
    const sun = "2026-03-08";
    expect([...closedFrom([], "2026-03-07", "2026-03-09", { staff: true }).keys()]).toEqual([sun]);
    expect(closedFrom([row(sun, { kind: "working" })], sun, sun, { staff: true }).size).toBe(0);
    const forC5 = [row(sun, { kind: "working", appliesTo: "classes", classIds: [C5] })];
    expect(closedFrom(forC5, sun, sun, { classId: C5 }).size).toBe(0);
    expect(closedFrom(forC5, sun, sun, { classId: C7 }).get(sun)).toEqual({ name: "Sunday", kind: "sunday" });
    expect(closedFrom(forC5, sun, sun, { staff: true }).size).toBe(1);
  });

  it("everyone, students only, chosen classes: staff are off only for everyone", () => {
    const d = "2026-03-10";
    const all = [row(d)], kids = [row(d, { appliesTo: "students" })], some = [row(d, { appliesTo: "classes", classIds: [C5] })];
    const off = (rows: HolidayRow[], who: Parameters<typeof closedFrom>[3]) => closedFrom(rows, d, d, who).has(d);
    expect([off(all, { staff: true }), off(all, { classId: C5 }), off(all, { classId: null })]).toEqual([true, true, true]);
    expect([off(kids, { staff: true }), off(kids, { classId: C5 }), off(kids, { classId: null })]).toEqual([false, true, true]);
    expect([off(some, { staff: true }), off(some, { classId: C5 }), off(some, { classId: C7 }), off(some, { classId: null })]).toEqual([false, true, false, false]);
  });

  it("a working row on a weekday closes nothing, and a holiday on a Sunday stays the weekly off", () => {
    expect(closedFrom([row("2026-03-10", { kind: "working" })], "2026-03-10", "2026-03-10", { staff: true }).size).toBe(0);
    expect(closedFrom([row("2026-03-08", { name: "Holi" })], "2026-03-08", "2026-03-08", { staff: true }).get("2026-03-08")?.name).toBe("Sunday");
  });
});

describe("teaching days, the ready list, copy and sheet checks (pure)", () => {
  const year = { startsOn: "2026-04-01", endsOn: "2027-03-31" };
  const yearDays = Array.from({ length: 365 }, (_, i) => addDays(year.startsOn, i));
  const open = yearDays.filter((d) => !isSunday(d));
  const classRows = [{ id: C5, grade: 5 }, { id: C7, grade: 7 }, { id: "x", grade: 10 }];

  it("counts per term and band; a closure of chosen classes costs only those classes; warns under 200 and 220", () => {
    const terms = [{ name: "Term 1", startsOn: "2026-04-01", endsOn: "2026-09-30" }, { name: "Term 2", startsOn: "2026-10-01", endsOn: "2027-03-31" }];
    const rows = [row(open[3]!), row(open[4]!, { appliesTo: "classes", classIds: [C7] }), row(open[5]!, { appliesTo: "students" })];
    const [primary, upper, ...rest] = workingDayReport(rows, year, terms, classRows);
    expect(rest).toEqual([]);
    expect(primary).toMatchObject({ key: "primary", year: open.length - 2, short: false });
    expect(upper).toMatchObject({ key: "upper", year: open.length - 3, short: false });
    expect(primary!.terms.map((t) => t.days).reduce((x, y) => x + y)).toBe(primary!.year);
    const many = open.slice(0, 120).map((d) => row(d));
    const [p2, u2] = workingDayReport(many, year, [], classRows);
    expect([p2!.year, p2!.short, u2!.year, u2!.short]).toEqual([open.length - 120, open.length - 120 < 200, open.length - 120, open.length - 120 < 220]);
    expect(workingDayReport([], year, [], [{ id: "k", grade: 11 }])).toEqual([]);
  });

  it("lists the three fixed national days inside the year, across New Year", () => {
    expect(nationalDaysIn(year)).toEqual([{ name: "Independence Day", date: "2026-08-15" }, { name: "Gandhi Jayanti", date: "2026-10-02" }, { name: "Republic Day", date: "2027-01-26" }]);
  });

  it("copies last year's days a year on; fixed ones are marked, moving ones are not, working Sundays are left out", () => {
    const old = [
      { from: "2026-01-26", to: "2026-01-26", name: "Republic Day", kind: "national" as const, appliesTo: "all" as const, classIds: [], note: null },
      { from: "2025-10-20", to: "2025-10-24", name: "Diwali break", kind: "vacation" as const, appliesTo: "all" as const, classIds: [], note: "Reopens Monday" },
      { from: "2026-03-08", to: "2026-03-08", name: "Working Sunday", kind: "working" as const, appliesTo: "all" as const, classIds: [], note: null },
    ];
    const out = copyProposals(old, new Map([["2026-10-20", "Old thing"]]));
    expect(out.map((o) => [o.data.name, o.data.from, o.data.to, o.fixed, o.clash])).toEqual([["Republic Day", "2027-01-26", "2027-01-26", true, null], ["Diwali break", "2026-10-20", "2026-10-24", false, "Old thing"]]);
  });

  it("checks a sheet row by row: date formats, kinds, clashes with the school and with the file", () => {
    const sheet: SheetRows = {
      columns: ["date", "to", "name", "kind"], lines: [2, 3, 4, 5, 6, 7],
      rows: [
        { date: "26-01-2027", to: "", name: "Republic Day", kind: "National holiday" },
        { date: "2026-11-08", to: "2026-11-10", name: "Diwali", kind: "vacation" },
        { date: "31-02-2026", to: "", name: "Nope", kind: "" },
        { date: "2026-12-25", to: "", name: "Christmas", kind: "sparkle" },
        { date: "2026-11-10", to: "", name: "Overlaps line 3", kind: "" },
        { date: "2026-05-01", to: "", name: "Labour Day", kind: "" },
      ],
    };
    const { report, items } = checkSheet(sheet, new Map([["2026-05-01", "May Day"]]));
    expect(report).toMatchObject({ total: 6, valid: 2, failed: 4 });
    expect(items.map((i) => [i.line, i.data.from, i.data.to, i.data.kind])).toEqual([[2, "2027-01-26", "2027-01-26", "national"], [3, "2026-11-08", "2026-11-10", "vacation"]]);
    expect(report.rows.filter((r) => r.errors.length).map((r) => [r.line, r.errors[0]!.column])).toEqual([[4, "date"], [5, "kind"], [6, "date"], [7, "date"]]);
    expect(report.rows[4]!.errors[0]!.message).toContain("line 3");
    expect(checkSheet({ columns: ["name"], rows: [{ name: "x" }], lines: [2] }, new Map()).sheetError).toContain("date");
  });

  it("refuses a break longer than 100 days, a last day before the first, and chosen classes with no class", () => {
    const ok = { from: "2026-03-10", name: "Break" };
    expect(holidayInput.safeParse({ ...ok, to: "2026-03-09" }).success).toBe(false);
    expect(holidayInput.safeParse({ ...ok, to: "2026-07-01" }).success).toBe(false);
    expect(holidayInput.safeParse({ ...ok, appliesTo: "classes" }).success).toBe(false);
    expect(holidayInput.parse({ ...ok })).toMatchObject({ to: "2026-03-10", kind: "other", appliesTo: "all", classIds: [] });
  });
});

describe("HolidayService: spans", () => {
  it("a break is one row per day under one span; edit moves it; delete removes every day; an audit line each time", async () => {
    const made = await admin().create({ from: "2026-02-10", to: "2026-02-12", name: "Winter break", kind: "vacation", note: "Reopens Friday" });
    expect(made.dates).toEqual(["2026-02-10", "2026-02-11", "2026-02-12"]);
    const rows = await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays).where(eq(attendanceHolidays.spanId, made.id)));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.spanId)).size).toBe(1);
    expect(rows[0]).toMatchObject({ kind: "vacation", appliesTo: "all", note: "Reopens Friday", createdBy: a.users.admin });
    expect((await admin().get(made.id))).toMatchObject({ from: "2026-02-10", to: "2026-02-12" });

    const edited = await admin().update(made.id, { from: "2026-02-11", to: "2026-02-13", name: "Winter break", kind: "vacation" });
    expect(edited).toMatchObject({ id: made.id, dates: ["2026-02-11", "2026-02-12", "2026-02-13"] });
    expect((await admin().spans({ from: "2026-02-01", to: "2026-02-28" })).filter((s) => s.id === made.id)).toHaveLength(1);

    await admin().remove(made.id);
    await expect(admin().get(made.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays).where(eq(attendanceHolidays.spanId, made.id)))).toHaveLength(0);
    const log = await withSchool(a.id, (tx) => tx.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entity, "Holiday"), eq(auditLogs.entityId, made.id))).orderBy(auditLogs.createdAt));
    expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
  });

  it("refuses a day that already has a holiday, and a class that does not exist; one row per date still holds", async () => {
    const one = await admin().create({ from: "2026-02-16", name: "Founders day" });
    await expect(admin().create({ from: "2026-02-15", to: "2026-02-16", name: "Clash" })).rejects.toBeInstanceOf(ConflictError);
    await expect(admin().create({ from: "2026-02-17", name: "Bad class", appliesTo: "classes", classIds: [C5] })).rejects.toMatchObject({ fieldErrors: { classIds: expect.any(String) } });
    await admin().remove(one.id);
  });

  it("only the admin writes; school B sees nothing and cannot touch it", async () => {
    const h = await admin().create({ from: "2026-02-18", name: "Isolated" });
    await expect(new HolidayService(a.as.teacher).create({ from: "2026-02-19", name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HolidayService(a.as.teacher).remove(h.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new HolidayService(a.as.teacher).spans()).some((s) => s.id === h.id)).toBe(true);
    const bSvc = new HolidayService(b.as.admin);
    expect((await bSvc.spans()).some((s) => s.id === h.id)).toBe(false);
    await expect(bSvc.get(h.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(h.id, { from: "2026-02-18", name: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(h.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(b.id, (tx) => closedSet(tx, "2026-02-18", "2026-02-18", { staff: true }))).toEqual(new Set());
    await admin().remove(h.id);
  });

  it("a working day can be set only for a Sunday", async () => {
    await expect(admin().create({ from: "2026-03-09", name: "Extra", kind: "working" })).rejects.toMatchObject({ fieldErrors: { from: expect.stringContaining("Sunday") } });
    await expect(admin().create({ from: "2026-03-07", to: "2026-03-08", name: "Extra", kind: "working" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("HolidayService: marks already made", () => {
  const mark = (sectionId: string, date: string, kid: string) => new StudentAttendanceService(a.as.admin).mark({ sectionId, date, entries: [{ studentId: kid, status: "present" }] }, { alerts: false });

  it("a closure for today, when today is marked, says in how many sections and what to do instead", async () => {
    const today = todayIST();
    if (isSunday(today)) return; // nobody marks on a Sunday
    await mark(fx.own, today, fx.kids[0]!);
    try {
      expect(await admin().markedToday()).toBe(1);
      await expect(admin().create({ from: today, name: "Flood", kind: "emergency" })).rejects.toMatchObject({
        fieldErrors: { from: expect.stringMatching(/already marked on .*, in 1 section\. .*urgent alert.*clear today's marks in the register/) },
      });
    } finally {
      await withSchool(a.id, (tx) => tx.delete(studentAttendance).where(eq(studentAttendance.date, today)));
    }
  });

  it("lists the marked days and writes nothing; chosen classes look only at their own marks; students-only ignores staff marks", async () => {
    await mark(fx.own, "2026-01-12", fx.kids[0]!);
    await mark(fx.own, "2026-01-13", fx.kids[0]!);
    await new StaffAttendanceService(a.as.admin).mark({ date: "2026-01-14", entries: [{ userId: a.users.teacher, status: "present" }] });

    await expect(admin().create({ from: "2026-01-12", to: "2026-01-13", name: "Closed" })).rejects.toMatchObject({ fieldErrors: { from: expect.stringMatching(/already marked on 12 Jan 2026, 13 Jan 2026/) } });
    expect(await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays).where(sql`${attendanceHolidays.date} between '2026-01-12' and '2026-01-13'`))).toHaveLength(0);

    const c6 = await admin().create({ from: "2026-01-12", name: "Class 6 trip", appliesTo: "classes", classIds: [class6.classId] });
    await expect(admin().create({ from: "2026-01-13", name: "Both trip", appliesTo: "classes", classIds: [class6.classId, class5Id] })).rejects.toBeInstanceOf(ValidationError);
    await admin().remove(c6.id);

    const kidsOnly = await admin().create({ from: "2026-01-14", name: "Students only", appliesTo: "students" });
    await admin().remove(kidsOnly.id);
    await expect(admin().create({ from: "2026-01-14", name: "Everyone", appliesTo: "all" })).rejects.toMatchObject({ fieldErrors: { from: expect.stringContaining("14 Jan 2026") } });
  });
});

describe("what a closure does to marking, leave, registers and pay", () => {
  it("marking: a class closure blocks that class and not another; students-only blocks every class and not staff; everyone blocks both", async () => {
    const kids = new StudentAttendanceService(a.as.admin), staff = new StaffAttendanceService(a.as.admin);
    const m = (sectionId: string, kid: string, date: string) => kids.mark({ sectionId, date, entries: [{ studentId: kid, status: "present" }] }, { alerts: false });
    const s = (date: string) => staff.mark({ date, entries: [{ userId: a.users.teacher, status: "present" }] });

    const onlyFive = await admin().create({ from: "2026-02-02", name: "Class 5 picnic", appliesTo: "classes", classIds: [class5Id] });
    await expect(m(fx.own, fx.kids[0]!, "2026-02-02")).rejects.toMatchObject({ fieldErrors: { date: "Class 5 picnic is a holiday" } });
    await m(class6.sectionId, class6.kid, "2026-02-02");
    await s("2026-02-02");
    expect((await kids.sectionSheet(fx.own, "2026-02-02")).holiday).toBe("Class 5 picnic");
    expect((await kids.sectionSheet(class6.sectionId, "2026-02-02")).holiday).toBeNull();

    await admin().create({ from: "2026-02-03", name: "Exam prep", appliesTo: "students" });
    await expect(m(fx.own, fx.kids[0]!, "2026-02-03")).rejects.toBeInstanceOf(ValidationError);
    await expect(m(class6.sectionId, class6.kid, "2026-02-03")).rejects.toBeInstanceOf(ValidationError);
    await s("2026-02-03");
    expect((await staff.staffSheet("2026-02-03")).holiday).toBeNull();

    await admin().create({ from: "2026-02-04", name: "Strike", appliesTo: "all" });
    await expect(s("2026-02-04")).rejects.toMatchObject({ fieldErrors: { date: "Strike is a holiday" } });
    await expect(m(class6.sectionId, class6.kid, "2026-02-04")).rejects.toBeInstanceOf(ValidationError);
    expect((await staff.staffSheet("2026-02-04")).holiday).toBe("Strike");
    await admin().remove(onlyFive.id);
  });

  it("registers: a closure shows on the staff register for everyone-closures only, and the student register for its class; a working Sunday is not shaded", async () => {
    const staffReg = await new StaffAttendanceService(a.as.admin).monthlyRegister("2026-02");
    const day = (d: number) => staffReg.days[d - 1]!;
    expect(day(3).holiday).toBeNull();
    expect(day(4).holiday).toBe("Strike");
    expect(day(1)).toMatchObject({ sunday: true });

    await admin().create({ from: "2026-02-08", name: "Make-up day", kind: "working" });
    const again = await new StaffAttendanceService(a.as.admin).monthlyRegister("2026-02");
    expect(again.days[7]).toMatchObject({ sunday: false, holiday: null });
    const reg = await new StudentAttendanceService(a.as.admin).monthlyRegister(fx.own, "2026-02");
    expect(reg.days[2]).toMatchObject({ holiday: "Exam prep" });
    expect(reg.days[7]).toMatchObject({ sunday: false });
    const one = await new StudentAttendanceService(a.as.admin).studentMonth(fx.kids[0]!, "2026-02");
    expect(one.holidays["2026-02-03"]).toBe("Exam prep");
    expect(one.sundays).toContain("2026-02-01");
    expect(one.sundays).not.toContain("2026-02-08");
  });

  it("pay month days and leave days: only closures for everyone and Sundays that stay Sundays come off the staff days", async () => {
    const before = (await withSchool(a.id, (tx) => monthDays(tx, [a.users.teacher], MARCH)))[a.users.teacher]!;
    expect(before).toMatchObject({ sundays: 5, holidays: 0, workingDays: 26 });

    await admin().create({ from: "2026-03-04", to: "2026-03-05", name: "Span", kind: "state" });                                  // 2 days for everyone
    await admin().create({ from: "2026-03-10", name: "Students only", appliesTo: "students" });                                     // staff work
    await admin().create({ from: "2026-03-11", name: "Class 5 only", appliesTo: "classes", classIds: [class5Id] });                 // staff work
    await admin().create({ from: "2026-03-08", name: "Working Sunday", kind: "working" });                                          // a Sunday staff work
    const after = (await withSchool(a.id, (tx) => monthDays(tx, [a.users.teacher], MARCH)))[a.users.teacher]!;
    expect(after).toMatchObject({ sundays: 4, holidays: 2, workingDays: 26 - 2 + 1 });
    expect(await withSchool(a.id, (tx) => openSundays(tx, "2026-03-01", "2026-03-31"))).toEqual(["2026-03-08"]);

    // Staff leave from Wed 4 to Wed 11 March: Saturdays count, the working Sunday counts, the students-only and class days are staff days.
    const months = await withSchool(a.id, (tx) => requestMonths(tx, { fromDate: "2026-03-04", toDate: "2026-03-11", halfDay: null }));
    expect(months).toEqual([{ month: MARCH, first: "2026-03-06", halfDays: 12 }]);
    expect([...(await withSchool(a.id, (tx) => closedSet(tx, "2026-03-04", "2026-03-11", { classId: class5Id })))]).toEqual(["2026-03-04", "2026-03-05", "2026-03-10", "2026-03-11"]);
    expect([...(await withSchool(a.id, (tx) => closedSet(tx, "2026-03-04", "2026-03-11", { classId: class6.classId })))]).toEqual(["2026-03-04", "2026-03-05", "2026-03-10"]);
  });

  it("a student's approved leave skips the days their class is closed", async () => {
    const todayBase = (() => { let x = addDays(todayIST(), -14); while (new Date(`${x}T00:00:00Z`).getUTCDay() !== 1) x = addDays(x, -1); return x; })();
    const day = (n: number) => addDays(todayBase, n);
    await admin().create({ from: day(1), name: "Class 5 trip", appliesTo: "classes", classIds: [class5Id] });
    const req = await new LeaveService(a.as.student).apply({ fromDate: day(0), toDate: day(2), reason: "Fever" });
    await new LeaveService(a.as.teacher).decide({ id: req.id, decision: "approved" });
    const marked = await withSchool(a.id, async (tx) => (await tx.select().from(studentAttendance).where(and(eq(studentAttendance.studentId, fx.studentUserKid), eq(studentAttendance.status, "leave")))).map((r) => r.date).sort());
    expect(marked).toEqual([day(0), day(2)]);
    expect(await withSchool(a.id, (tx) => tx.select().from(leaveRequests).where(eq(leaveRequests.id, req.id)))).toHaveLength(1);
  });
});

describe("closedDays and isClosed read the same rows", () => {
  it("a single day and a range agree", async () => {
    await withSchool(a.id, async (tx) => {
      expect(await isClosed(tx, "2026-03-04", { staff: true })).toEqual({ name: "Span", kind: "state" });
      expect(await isClosed(tx, "2026-03-06", { staff: true })).toBeNull();
      expect([...(await closedDays(tx, "2026-03-04", "2026-03-08", { staff: true })).keys()]).toEqual(["2026-03-04", "2026-03-05"]);
    });
  });
});

describe("notifying", () => {
  const titles = (userId: string) => withSchool(a.id, async (tx) => (await tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.topic, "holiday.declared")))).map((n) => n.title));
  const future = addDays(todayIST(), 30);

  it("tells everyone for a school closure, only families for students-only, and nobody when the box is not ticked or the day is past", async () => {
    await admin().create({ from: future, name: "Founders week", notify: true });
    expect(await titles(a.users.student)).toEqual(["Founders week: school is closed"]);
    expect(await titles(a.users.teacher)).toEqual(["Founders week: school is closed"]);
    expect(await titles(b.users.student)).toEqual([]);

    await admin().create({ from: addDays(future, 3), name: "Exam leave", appliesTo: "students", notify: true });
    expect(await titles(a.users.student)).toContain("Exam leave: no school for students");
    expect(await titles(a.users.teacher)).not.toContain("Exam leave: no school for students");

    await admin().create({ from: addDays(future, 5), name: "Quiet one" });
    await admin().create({ from: "2026-03-20", name: "Past one", notify: true });
    expect((await titles(a.users.student)).some((t) => t.startsWith("Quiet one") || t.startsWith("Past one"))).toBe(false);
  });

  it("declaring tells people and says how many; today, tomorrow and emergencies are told even with the box unticked; a far one is not", async () => {
    const today = todayIST();
    const near = await admin().create({ from: today, name: "Storm day", kind: "other" });
    expect(near.told).toBeGreaterThan(1);
    const stormTitles = () => withSchool(a.id, async (tx) => (await tx.select().from(notifications).where(and(eq(notifications.userId, a.users.student), eq(notifications.subjectId, near.id)))).map((n) => n.title));
    expect(await stormTitles()).toEqual(["Storm day: school is closed"]);
    const far = await admin().create({ from: addDays(today, 70), name: "Far quiet break", kind: "other" });
    expect(far.told).toBe(0);
    const emergency = await admin().create({ from: addDays(today, 71), name: "Far emergency", kind: "emergency" });
    expect(emergency.told).toBe(near.told);
    expect((await admin().update(near.id, { from: today, name: "Storm day", kind: "other" })).told).toBe(0);
  });

  it("activeClosures lists today's and tomorrow's emergency closures for the people they concern", async () => {
    const today = addDays(todayIST(), 4);
    await admin().create({ from: addDays(today, 1), name: "Class 5 flood", kind: "emergency", appliesTo: "classes", classIds: [class5Id] });
    await admin().create({ from: today, name: "Quiet closure", kind: "other" });
    const seen = (who: Parameters<typeof activeClosures>[1]) => withSchool(a.id, (tx) => activeClosures(tx, who, today)).then((r) => r.map((c) => `${c.name}:${c.when}`));
    expect(await seen({ classId: class5Id })).toContain("Class 5 flood:tomorrow");
    expect(await seen({ classId: class6.classId })).not.toContain("Class 5 flood:tomorrow");
    expect(await seen({ staff: true })).not.toContain("Class 5 flood:tomorrow");
    expect(await seen({ staff: true })).not.toContain("Quiet closure:today");
  });

  it("opening the list reads the holiday notices", async () => {
    const h = await admin().create({ from: addDays(todayIST(), 90), name: "Open to read", kind: "other", notify: true });
    const unread = () => withSchool(a.id, async (tx) => (await tx.select().from(notifications).where(and(eq(notifications.subjectId, h.id), eq(notifications.userId, a.users.teacher))))[0]!.readAt);
    expect(await unread()).toBeNull();
    await new HolidayService(a.as.teacher).seeDeclared([h.id]);
    expect(await unread()).not.toBeNull();
  });

  it("an emergency closure, or one that starts today or tomorrow, is urgent and is mailed at 06:32 in quiet hours; a distant one is not", async () => {
    const mail = new MemoryEmailSender();
    useServices({ email: mail });
    await withSchool(a.id, (tx) => tx.update(users).set({ email: `fam-${a.slug}@example.test` }).where(eq(users.id, a.users.student)));
    const today = todayIST();
    await admin().create({ from: addDays(future, 20), name: "Far away break", notify: true });
    await admin().create({ from: addDays(today, 1), name: "Flood closure", kind: "emergency", notify: true });
    await admin().create({ from: addDays(today, 2), name: "Not urgent yet", kind: "other", notify: true });
    const rows = await withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, a.users.student), sql`${notifications.title} like any (array['Flood%', 'Far away%', 'Not urgent%'])`)));
    const by = (n: string) => rows.find((r) => r.title.startsWith(n))!;
    expect([by("Flood").urgent, by("Flood").topic]).toEqual([true, "urgent.alert"]);
    expect([by("Far away").urgent, by("Not urgent").urgent]).toEqual([false, false]);
    // The job runs at 06:32 India time the next morning: quiet hours, so only what is urgent may go.
    await deliverDue({ schoolId: a.id, now: new Date(`${addDays(today, 1)}T06:32:00+05:30`) });
    expect(mail.sent.filter((m) => m.to === `fam-${a.slug}@example.test`).map((m) => m.subject).filter((s) => /Flood closure/.test(s))).toHaveLength(1);
    expect(mail.sent.some((m) => /Far away|Not urgent/.test(m.subject))).toBe(false);
  });
});

describe("working days, copy and import through the service", () => {
  it("counts the year's teaching days and warns when a band is short", async () => {
    const before = await admin().workingDays();
    expect(before.year?.name).toBe("2026-27");
    const primary = before.bands.find((x) => x.key === "primary")!;
    expect(primary).toMatchObject({ minimum: 200, short: false });
    const cut = await admin().create({ from: "2026-05-01", to: "2026-08-08", name: "Long vacation", kind: "vacation" });
    const after = (await admin().workingDays()).bands;
    expect(after.map((x) => x.key)).toEqual(["primary", "upper"]);
    expect(after[0]!.year).toBeLessThan(primary.year);
    expect(after.find((x) => x.key === "upper")!.short).toBe(after.find((x) => x.key === "upper")!.year < 220);
    await admin().remove(cut.id);
  });

  it("offers last year's holidays and the national days; a day already taken is shown, not offered twice", async () => {
    await admin().create({ from: "2026-01-26", name: "Republic Day", kind: "national" });
    const ideas = await admin().suggestions();
    expect(ideas.national.map((n) => [n.data.name, n.clash])).toEqual([["Independence Day", null], ["Gandhi Jayanti", null], ["Republic Day", null]]);
    const copied = ideas.copy.find((c) => c.data.name === "Republic Day");
    expect(copied).toBeUndefined(); // shown once, in the national list
    await admin().addMany({ items: JSON.stringify(ideas.national.map((n) => n.data)), notify: "" });
    expect((await admin().suggestions()).national.every((n) => n.clash)).toBe(true);
  });

  it("dry run writes nothing; one bad row stops the commit and nothing is added; a clean file adds every row", async () => {
    const good = "date,to,name,kind\n2026-03-23,2026-03-24,Sports days,other\n2026-03-25,,Ram Navami,state\n";
    const bad = good + "2026-03-26,,Working Monday,working\n2026-03-27,,Marked day,other\n";
    await new StaffAttendanceService(a.as.admin).mark({ date: "2026-03-27", entries: [{ userId: a.users.teacher, status: "present" }] });
    const report = await admin().importCheck(csv(bad));
    expect(report).toMatchObject({ total: 4, valid: 2, failed: 2 });
    expect(report.rows.filter((r) => r.errors.length).map((r) => r.line)).toEqual([4, 5]);
    expect(await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays).where(eq(attendanceHolidays.name, "Sports days")))).toHaveLength(0);
    await expect(admin().importCommit(csv(bad))).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("2 rows") } });
    expect(await withSchool(a.id, (tx) => tx.select().from(attendanceHolidays).where(eq(attendanceHolidays.name, "Ram Navami")))).toHaveLength(0);

    expect(await admin().importCommit(csv(good))).toEqual({ imported: 2, days: 3 });
    expect((await admin().spans({ from: "2026-03-23", to: "2026-03-25" })).map((s) => [s.name, s.dates.length])).toEqual([["Sports days", 2], ["Ram Navami", 1]]);
    await expect(admin().importCommit(csv(good))).rejects.toBeInstanceOf(ValidationError); // the days are taken now
    await expect(new HolidayService(a.as.teacher).importCheck(csv(good))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin().importCheck(csv("when,what\n1,2\n"))).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("name") } });
  });
});

describe("pay runs that are already approved or paid", () => {
  const run = (month: string, status: string) => withSchool(a.id, (tx) => tx.execute(sql`insert into pay_runs (id, school_id, kind, month, label, status) values (gen_random_uuid(), ${a.id}, 'monthly', ${month}, ${month}, ${status})`));

  it("refuse a change that would alter staff days, in plain words; students-only changes and Sunday closures pass", async () => {
    await run("2025-12-01", "paid");
    await run("2025-11-01", "draft");
    await expect(admin().create({ from: "2025-12-10", name: "Late closure" })).rejects.toMatchObject({ fieldErrors: { from: expect.stringContaining("December 2025 is already paid") } });
    await admin().create({ from: "2025-11-10", name: "Draft month is fine" });
    const kids = await admin().create({ from: "2025-12-11", name: "Students only", appliesTo: "students" });
    await admin().create({ from: "2025-12-14", name: "A Sunday is already off" });
    await expect(admin().create({ from: "2025-12-21", name: "Working Sunday", kind: "working" })).rejects.toMatchObject({ fieldErrors: { from: expect.stringContaining("December 2025") } });
    await admin().remove(kids.id);
    await withSchool(a.id, (tx) => tx.execute(sql`update pay_runs set status = 'approved' where month = '2025-11-01'`));
    const draftMonth = (await admin().spans({ from: "2025-11-10", to: "2025-11-10" }))[0]!;
    await expect(admin().remove(draftMonth.id)).rejects.toMatchObject({ fieldErrors: { from: expect.stringContaining("November 2025 is already approved") } });
    await withSchool(a.id, (tx) => tx.execute(sql`delete from pay_runs`));
  });
});
