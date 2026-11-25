import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, supportMessages, supportTickets, users, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import type { Ctx } from "@smw/feature-kit";
import { publishNow } from "@smw/feature-announcements/quick";
import { FeedService } from "@smw/feature-announcements/service";
import { StudentAttendanceService } from "@smw/feature-attendance/service";
import { attendanceHolidays } from "@smw/feature-attendance/schema";
import { addDays as addDay, isSunday, todayIST } from "@smw/feature-attendance/stats";
import { buildSchoolData, type Fixture } from "@smw/feature-attendance/test-fixture";
import { academicYears, sections, terms } from "@smw/feature-academics/schema";
import { feeReceiptMethods, feeReceipts } from "@smw/feature-fees/schema";
import { DuesService, ReceiptService } from "@smw/feature-fees/service";
import { ExamService } from "@smw/feature-exams/service";
import { DayService } from "@smw/feature-meetings/service";
import { EnquiryService } from "@smw/feature-website/service";
import { EventService } from "@smw/feature-events/service";
import { SupportService } from "@smw/feature-support/service";
import { finApprovals } from "@smw/feature-finance/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { staffProfiles } from "@smw/feature-staff/schema";
import { HomeService, type PanelData, type Slot } from "./home-service";
import type { PanelKey } from "./panels";
import { changePct, receiptsHref } from "./rules";

const FEATURES = ["home", "students", "staff", "academics", "attendance", "fees", "finance", "exams", "timetable", "assignments", "announcements", "events", "website", "support", "notifications", "setup", "library", "transport", "payroll", "messages", "meetings", "settings"];
// A Wednesday in the past: deterministic, and attendance may be marked on it.
const WED = "2026-11-11";
const wed = () => new Date(`${WED}T10:00:00+05:30`);
const EVERYONE = { include: [{ type: "everyone" }], exclude: [] };
const SUN = () => new Date("2026-11-15T10:00:00+05:30");

let a: TestSchool, b: TestSchool;
let fx: Fixture;

const ok = <T,>(s: Slot<T>): T => { expect(s.state, JSON.stringify(s)).toBe("ok"); return (s as { data: T }).data; };
const get = async <K extends PanelKey>(svc: HomeService, key: K): Promise<PanelData[K]> => ok(await svc.panel(key));
const mark = (svc: StudentAttendanceService, date: string, sectionId: string, ids: string[], absent: string[] = []) =>
  svc.mark({ sectionId, date, entries: ids.map((studentId) => ({ studentId, status: absent.includes(studentId) ? "absent" : "present" })) });
/** A custom role: `role` is the base, the grants are all it may do. */
const custom = (s: TestSchool, role: "staff" | "teacher" | "accountant", grants: string[]): Ctx => ({ ...s.as.accountant, role, grants: new Set(["home:view", ...grants]) });

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
});
afterAll(closeDb);

describe("header", () => {
  it("greets by first name and says the day and the running term", async () => {
    await withSchool(a.id, async (tx) => {
      const [year] = await tx.select().from(academicYears);
      await tx.insert(terms).values({ schoolId: a.id, yearId: year!.id, name: "Term 2", startsOn: "2026-10-01", endsOn: "2026-12-20" });
    });
    const h = await new HomeService(a.as.admin, wed).header();
    expect(h.greeting).toBe("Good morning, admin");
    expect(h.line).toBe("Wednesday, 11 Nov · Term 2");
  });

  it("falls back to the academic year outside any term, and skips it when academics is off", async () => {
    expect((await new HomeService(a.as.admin, () => new Date("2027-02-03T10:00:00+05:30")).header()).line).toBe("Wednesday, 3 Feb · 2026-27");
    const off = { ...a.as.admin, features: new Set(["home"]) };
    expect((await new HomeService(off, wed).header()).line).toBe("Wednesday, 11 Nov");
  });
});

describe("admin panels", () => {
  it("answers 'what needs me': a section not marked, a support reply waiting; notices pinned first; other panels still load", async () => {
    const att = new StudentAttendanceService(a.as.admin);
    const [rohan] = await withSchool(a.id, (tx) => tx.select({ id: students.id }).from(students).where(eq(students.sectionId, fx.other)));
    await mark(att, WED, fx.other, [rohan!.id]); // the 'other' section is marked; 'own' (4 students) is not; 'taught' has no students
    await withSchool(a.id, async (tx) => {
      const staff = "00000000-0000-0000-0000-0000000000aa";
      const [t, open] = await tx.insert(supportTickets).values([{ schoolId: a.id, subject: "Invoice question", status: "pending" }, { schoolId: a.id, subject: "Still with the team", status: "open" }]).returning();
      await tx.insert(supportMessages).values([{ schoolId: a.id, ticketId: t!.id, authorStaffId: staff, body: "We have fixed it." }, { schoolId: a.id, ticketId: open!.id, authorStaffId: staff, body: "Looking." }]);
    });
    await publishNow(a.as.admin, { title: "Regular notice", body: "x", audience: EVERYONE });
    await publishNow(a.as.admin, { title: "Pinned notice", body: "x", audience: EVERYONE, pinnedUntil: new Date(Date.now() + 86_400_000).toISOString() });

    const home = new HomeService(a.as.admin, wed);
    const { items, unchecked } = await get(home, "attention");
    expect(unchecked).toEqual([]);
    expect(items.find((i) => i.key === "attendance")).toMatchObject({ count: 1, href: "/app/attendance" });
    expect(items.find((i) => i.key === "support")).toMatchObject({ count: 1, href: "/app/support?status=pending" });
    // The count and the list it opens are the same thing: tickets waiting for the school's reply.
    expect((await new SupportService(a.as.admin).list({ filters: { status: "pending" } })).total).toBe(1);
    expect(items.find((i) => i.key === "fees")).toBeUndefined(); // nobody owes anything yet
    const notices = await get(home, "notices");
    expect(notices.map((r) => r.title)).toEqual(["Pinned notice", "Regular notice"]);
    expect(notices[0]).toMatchObject({ href: `/app/announcements/${notices[0]!.id}`, excerpt: "x" });
    expect(await get(home, "needs-action")).toEqual([]);
    expect((await home.panel("requests")).state).toBe("off"); // this school has no requests module
    expect(await get(home, "plan")).toMatchObject({ active: 5, cap: 300, percent: 2, warning: false });
    expect((await get(home, "money-trend")).trend).toHaveLength(6);
  });

  it("the attendance week carries the trend and the sections not marked, linked to the sheet", async () => {
    const week = await get(new HomeService(a.as.admin, wed), "attendance-week");
    expect(week.unmarked).toEqual([{ id: fx.own, label: "Class 5-A", students: 4, marked: false }]);
    expect(week.sections).toBe(2);
    expect(week.dayOff).toBeNull();
  });

  it("the today strip says school day, then a day off with the next school day in words, then the closures coming", async () => {
    const day = (d: string) => new HomeService(a.as.admin, () => new Date(`${d}T10:00:00+05:30`));
    await withSchool(a.id, (tx) => tx.insert(attendanceHolidays).values([
      { schoolId: a.id, date: "2026-11-13", name: "Founders day" }, { schoolId: a.id, date: "2026-11-23", name: "Diwali break" },
    ]));
    const normal = await get(day("2026-11-11"), "today");
    expect(normal.dayOff).toBeNull();
    expect(normal.closures).toEqual([{ date: "2026-11-13", label: "Friday", name: "Founders day" }, { date: "2026-11-23", label: "Monday, 23 Nov", name: "Diwali break" }]);
    const sunday = await get(day("2026-11-15"), "today");
    expect(sunday.dayOff).toEqual({ name: "Sunday", next: "Monday" });
    expect(sunday.staffAway).toBeNull();
    const shut = await get(day("2026-11-13"), "today");
    expect(shut.dayOff).toEqual({ name: "Founders day", next: "Saturday" }); // Saturday is a school day here
    const before = await get(day("2026-11-22"), "today");
    expect(before.dayOff).toEqual({ name: "Sunday", next: "Tuesday" }); // Monday 23 is the break
  });

  // Attendance and fee figures read the real "today", so this test builds its data from it. A Sunday is a day off, which the next test covers.
  it.skipIf(isSunday(todayIST()))("four numbers: present today against the last four same weekdays, collected against the same days last month, dues, open enquiries (H4)", async () => {
    const T = todayIST(), att = new StudentAttendanceService(a.as.admin);
    // Four earlier same weekdays: 100%, 100%, 75%, 75% present = 87.5% on average; today 4 of 4 marked, one absent = 75%.
    const back = (k: number) => addDay(T, -7 * k);
    for (const [k, absent] of [[1, []], [2, []], [3, [fx.kids[1]!]], [4, [fx.kids[2]!]]] as [number, string[]][]) await mark(att, back(k), fx.own, fx.kids, absent);
    await mark(att, T, fx.own, fx.kids, [fx.kids[3]!]);
    const month = T.slice(0, 7), dd = Number(T.slice(8, 10)), lastStart = addDay(`${month}-01`, -1).slice(0, 7);
    await withSchool(a.id, async (tx) => {
      const snapshot = { studentName: "Home Student", admissionNo: "H1", classLabel: "5-A", guardian: null };
      const row = (n: string, date: string, amountPaise: number) => ({ schoolId: a.id, number: n, studentId: fx.kids[0]!, date, amountPaise, status: "valid" as const, snapshot, verifyToken: `t-${n}` });
      const made = await tx.insert(feeReceipts).values([row("N-1", `${month}-01`, 300_000), row("N-2", `${lastStart}-01`, 200_000), row("N-3", `${lastStart}-28`, 5_000_000)]).returning();
      await tx.insert(feeReceiptMethods).values(made.map((r) => ({ schoolId: a.id, receiptId: r.id, method: "cash" as const, amountPaise: r.amountPaise })));
    });
    const cards = await get(new HomeService(a.as.admin), "numbers");
    expect(cards.map((c) => c.key)).toEqual(["present", "collected", "dues", "enquiries"]);
    const [present, collected, dues, enquiries] = cards;
    expect(present).toMatchObject({ value: 75, href: "/app/attendance" });
    // 75 against 88 (the average 87.5 as shown): 13 points, never the 12 that rounding the difference would give.
    expect(present!.change).toEqual({ text: "13 pts", direction: "down", tone: "danger" });
    expect(present!.meta).toContain("vs 88%");
    // Last month's 28th counts as "the same days" only once this month has reached its 28th.
    const same = 200_000 + (dd >= 28 ? 5_000_000 : 0);
    expect(collected!.value).toBeGreaterThanOrEqual(300_000);
    expect(collected!.change).toEqual(changePct(collected!.value!, same));
    // The card opens the register for the same days, and the register's total is the card's number.
    expect(collected!.href).toBe(receiptsHref(`${month}-01`, T));
    expect((await new ReceiptService(a.as.admin).register({ filters: { from: `${month}-01`, to: T } })).totalPaise).toBe(collected!.value);
    expect(dues).toMatchObject({ value: 0, href: "/app/fees/dues" });
    expect(enquiries).toMatchObject({ value: 0, href: "/app/enquiries?view=list&stage=open", change: null });
  });

  it("the numbers have no comparison on a day off or before anything is marked, and say why", async () => {
    const sunday = await get(new HomeService(a.as.admin, SUN), "numbers");
    expect(sunday[0]).toMatchObject({ key: "present", value: null, change: null, meta: "Sunday, no classes. Next school day: Monday" });
    const fresh = await get(new HomeService(b.as.admin, wed), "numbers");
    expect(fresh[0]).toMatchObject({ value: null, change: null, meta: "Not marked yet" });
  });

  it("getting started shows the school's card", async () => {
    const g = await get(new HomeService(a.as.admin, wed), "getting-started");
    expect(g.card).toMatchObject({ percent: expect.any(Number), left: expect.any(Number) });
    const off = { ...a.as.admin, features: new Set(FEATURES.filter((f) => f !== "setup")) };
    expect((await new HomeService(off, wed).panel("getting-started")).state).toBe("off");
  });

  it("birthdays today: students and staff, active only", async () => {
    await withSchool(a.id, async (tx) => {
      await tx.update(students).set({ dob: "2014-11-11" }).where(eq(students.id, fx.kids[0]!));
      await tx.update(students).set({ dob: "2013-11-11", status: "left" }).where(eq(students.id, fx.kids[1]!));
      await tx.update(students).set({ dob: "2013-11-12" }).where(eq(students.id, fx.kids[2]!));
      await tx.insert(staffProfiles).values({ schoolId: a.id, userId: a.users.teacher, employeeId: "T-1", dob: "1990-11-11", status: "active" });
    });
    const b1 = await get(new HomeService(a.as.admin, wed), "birthdays");
    expect(b1.students).toEqual([{ id: fx.kids[0]!, name: "Aarav Sharma", label: "Class 5-A", age: 12 }]);
    expect(b1.staff).toEqual([{ id: a.users.teacher, name: expect.any(String), age: 36 }]);
    await withSchool(a.id, (tx) => tx.update(staffProfiles).set({ status: "left" }).where(eq(staffProfiles.userId, a.users.teacher)));
    expect((await get(new HomeService(a.as.admin, wed), "birthdays")).staff).toEqual([]);
  });

  it("approvals, leave and the rest answer for a quiet school without erroring", async () => {
    const home = new HomeService(a.as.admin, wed);
    expect(await get(home, "approvals")).toEqual({ pending: 0, rows: [] });
    expect(await get(home, "leave")).toEqual({ away: [], pending: 0 });
    expect((await get(home, "funnel")).total).toBe(0);
  });

  it("a module that is off gives an off panel, not an error", async () => {
    const lean = { ...a.as.admin, features: new Set(["home", "students"]) };
    const home = new HomeService(lean, wed);
    expect((await home.panel("money-trend")).state).toBe("off");
    expect((await home.panel("attendance-week")).state).toBe("off");
    expect((await home.panel("notices")).state).toBe("off");
    expect((await home.panel("plan")).state).toBe("off"); // plan usage needs the settings module too
    expect((await get(home, "today")).dayOff).toBeNull();
    expect(await get(home, "numbers")).toEqual([]);
  });

  it("one failing panel is an error for that panel only, and 'all clear' is not claimed for it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    class FeesDown extends HomeService { protected feeSummary(): never { throw new Error("db down"); } }
    const home = new FeesDown(a.as.admin, wed);
    const cards = await get(home, "numbers");
    expect(cards.find((c) => c.key === "dues")).toMatchObject({ failed: true, value: null, meta: "Could not load" });
    expect(cards.find((c) => c.key === "present")?.failed).toBeUndefined();
    expect((await get(home, "attention")).unchecked).toEqual(["fees"]);
    expect((await home.panel("notices")).state).toBe("ok");
    vi.restoreAllMocks();
  });

  it("isolation: school B sees none of school A's numbers", async () => {
    const home = new HomeService(b.as.admin, wed);
    expect(await get(home, "notices")).toEqual([]);
    const { items } = await get(home, "attention");
    expect(items.find((i) => i.key === "support")).toBeUndefined();
    expect(items.find((i) => i.key === "attendance")?.count).toBe(2); // B's own sections: nothing marked
    expect((await get(home, "birthdays")).students).toEqual([]);
    expect((await get(home, "money-trend")).thisMonth).toBe(0);
  });
});

describe("a school with no students", () => {
  it("is told so, so Home shows setup and not six empty boxes", async () => {
    const empty = { ...b.as.admin };
    await withSchool(b.id, (tx) => tx.delete(students));
    expect(await new HomeService(empty, wed).emptySchool()).toBe(true);
    expect(await new HomeService(a.as.admin, wed).emptySchool()).toBe(false);
    expect(await new HomeService(a.as.teacher, wed).emptySchool()).toBe(false); // only the admin is sent to setup
  });
});

describe("teacher panels", () => {
  it("lists the sections they are class teacher of and flips to marked", async () => {
    const day = () => new Date("2026-11-09T10:00:00+05:30");
    const t = new HomeService(a.as.teacher, day);
    const [row] = (await get(t, "to-mark")).rows;
    expect(row).toMatchObject({ id: fx.own, label: "Class 5-A", marked: false });
    await mark(new StudentAttendanceService(a.as.teacher), "2026-11-09", fx.own, fx.kids, [fx.kids[3]!]);
    expect((await get(new HomeService(a.as.teacher, day), "to-mark")).rows[0]).toMatchObject({ marked: true, students: row!.students });
  });

  it("my class today: who is absent with the guardian's number, who has a birthday; no number for a role that may not see phones", async () => {
    await withSchool(a.id, async (tx) => {
      const [g] = await tx.insert(guardians).values({ schoolId: a.id, name: "Mr Singh", relation: "father", phone: "9820011122" }).returning();
      await tx.insert(studentGuardians).values({ schoolId: a.id, studentId: fx.kids[3]!, guardianId: g!.id, isPrimary: true });
      await tx.update(students).set({ dob: "2013-11-09" }).where(eq(students.id, fx.kids[0]!));
    });
    const day = () => new Date("2026-11-09T10:00:00+05:30");
    const mine = await get(new HomeService(a.as.teacher, day), "my-class");
    expect(mine.canCall).toBe(true);
    expect(mine.sections).toEqual([{ id: fx.own, label: "Class 5-A", marked: true, absent: [{ id: fx.kids[3]!, name: "Ananya Iyer", phone: "9820011122" }], birthdays: [{ id: fx.kids[0]!, name: "Aarav Sharma" }] }]);
    const noPhones = { ...a.as.teacher, role: "teacher" as const, grants: new Set(["home:view", "attendance:mark", "attendance:read"]) };
    const blind = await get(new HomeService(noPhones, day), "my-class");
    expect(blind.canCall).toBe(false);
    expect(blind.sections[0]!.absent).toEqual([{ id: fx.kids[3]!, name: "Ananya Iyer", phone: null }]);
  });

  it("has an empty timetable, nothing to grade and no marks pending on a fresh school", async () => {
    const home = new HomeService(a.as.teacher, wed);
    expect(await get(home, "now-next")).toMatchObject({ day: 3, rows: [] });
    expect(await get(home, "to-grade")).toEqual({ toGrade: 0, rows: [] });
    expect(await get(home, "marks")).toEqual([]);
    expect(await get(home, "homework")).toEqual({ rows: [] });
  });

  it("no register on a Sunday, and the day off says when school is next open", async () => {
    expect(await get(new HomeService(a.as.teacher, SUN), "to-mark")).toEqual({ dayOff: { name: "Sunday", next: "Monday" }, rows: [] });
  });

  it("a closure of chosen classes takes only those sections off the register; one for everyone names the day; a working Sunday opens it", async () => {
    const on = (date: string, who: Ctx = a.as.teacher) => new HomeService(who, () => new Date(`${date}T10:00:00+05:30`));
    const hol = (date: string, name: string, over: Partial<typeof attendanceHolidays.$inferInsert> = {}) => withSchool(a.id, (tx) => tx.insert(attendanceHolidays).values({ schoolId: a.id, date, name, ...over }));
    const [sec] = await withSchool(a.id, (tx) => tx.select({ classId: sections.classId }).from(sections).where(eq(sections.id, fx.own)));
    await hol("2026-12-01", "Class 5 trip", { appliesTo: "classes", classIds: [sec!.classId] });
    expect(await get(on("2026-12-01"), "to-mark")).toEqual({ dayOff: null, rows: [] });
    await hol("2026-12-02", "Founders day");
    expect((await get(on("2026-12-02"), "to-mark")).dayOff).toEqual({ name: "Founders day", next: "Thursday" });
    await hol("2026-12-06", "Make-up Sunday", { kind: "working" });
    expect((await get(on("2026-12-06"), "to-mark")).rows).toHaveLength(1);
    expect((await get(on("2026-12-06", a.as.admin), "today")).dayOff).toBeNull();
    expect((await get(on("2026-12-02", a.as.admin), "attendance-week")).dayOff).toMatchObject({ name: "Founders day" });
  });
});

describe("H3: batch loads, and each shared load runs once", () => {
  it("marks and the exam coordinator come from one pendingPapers call, never one detail per exam", async () => {
    const detail = vi.spyOn(ExamService.prototype, "detail");
    const pending = vi.spyOn(ExamService.prototype, "pendingPapers");
    const home = new HomeService(custom(a, "teacher", ["exams:read", "exams:marks", "exams:manage"]), wed);
    await get(home, "marks");
    await get(home, "exam-coordinator");
    expect(detail).not.toHaveBeenCalled();
    expect(pending).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("dues by class is one query, not a full dues report per class", async () => {
    const report = vi.spyOn(DuesService.prototype, "report");
    const byClass = vi.spyOn(DuesService.prototype, "dueByClass");
    await get(new HomeService(a.as.accountant, wed), "dues-by-class");
    expect(byClass).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("the fee numbers are read once however many panels use them", async () => {
    const summary = vi.spyOn(DuesService.prototype, "summary");
    const home = new HomeService(a.as.admin, wed);
    await Promise.all([get(home, "numbers"), get(home, "attention")]);
    expect(summary).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    const fin = vi.spyOn(DuesService.prototype, "summary");
    const acc = new HomeService(a.as.accountant, wed);
    await Promise.all([get(acc, "fin-numbers"), get(acc, "fin-numbers")]);
    expect(fin).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("accountant and money panels", () => {
  it("counts today's valid receipts only and lists the newest payments with a receipt link id", async () => {
    const today = todayIST();
    await withSchool(a.id, async (tx) => {
      const snapshot = { studentName: "Home Student", admissionNo: "H1", classLabel: "5-A", guardian: null };
      const row = (number: string, amountPaise: number, status: "valid" | "reversed") => ({ schoolId: a.id, number, studentId: fx.kids[0]!, date: today, amountPaise, status, snapshot, verifyToken: `tok-${number}` });
      const made = await tx.insert(feeReceipts).values([row("R-1", 2_500_000, "valid"), row("R-2", 100_000, "valid"), row("R-3", 999_900, "reversed")]).returning();
      await tx.insert(feeReceiptMethods).values(made.map((r) => ({ schoolId: a.id, receiptId: r.id, method: "upi" as const, amountPaise: r.amountPaise })));
    });
    const home = new HomeService(a.as.accountant);
    expect(await get(home, "fin-numbers")).toMatchObject({ collectedToday: { paise: 2_600_000, count: 2 }, counter: { open: false } });
    const recent = await get(home, "receipts");
    expect(recent.map((r) => r.receiptNo)).toEqual(expect.arrayContaining(["R-1", "R-2"]));
    expect(recent.map((r) => r.receiptNo)).not.toContain("R-3"); // reversed
    expect(recent[0]).toMatchObject({ student: expect.any(String), method: "upi" });
    expect(await get(home, "overdue")).toMatchObject({ total: 0, rows: [] });
    expect(await get(home, "dues-by-class")).toEqual([]); // no fee structure yet
    expect(await get(home, "cheques")).toEqual({ received: { count: 0, paise: 0 }, deposited: { count: 0, paise: 0 }, bounced: { count: 0, paise: 0 } });
  });

  it("a cashier gets the counter and cheques, an auditor does not; neither gets approvals without finance:approve", async () => {
    const cashier = custom(a, "staff", ["fees:read", "fees:collect", "students:read"]);
    const auditor = custom(a, "staff", ["finance:read", "fees:read", "payroll:read"]);
    expect((await get(new HomeService(cashier), "fin-numbers")).counter).toEqual({ open: false, expectedPaise: 0, receipts: 0 });
    expect((await get(new HomeService(auditor), "fin-numbers")).counter).toBeNull();
    expect((await new HomeService(auditor).panel("cheques")).state).toBe("off");
    expect((await new HomeService(cashier).panel("approvals")).state).toBe("off");
    expect(await get(new HomeService(custom(a, "staff", ["finance:read", "finance:approve"])), "approvals")).toEqual({ pending: 0, rows: [] });
  });

  it("isolation: school B's accountant sees no payments", async () => {
    const home = new HomeService(b.as.accountant);
    expect(await get(home, "receipts")).toEqual([]);
    expect((await get(home, "fin-numbers")).collectedToday.paise).toBe(0);
  });
});

describe("custom roles (H2): a panel for each thing the grants allow", () => {
  it("front office, library, transport, exam coordinator, cover, website and safeguarding each load", async () => {
    const role = custom(a, "staff", ["website:enquiries", "library:read", "transport:read", "exams:read", "exams:manage", "timetable:manage", "timetable:read", "website:read", "website:manage", "messages:safeguard", "attendance:read"]);
    const home = new HomeService(role, wed);
    expect(await get(home, "front-office")).toEqual({ calls: 0, visits: 0, fresh: 0, rows: [] });
    expect(await get(home, "library")).toEqual({ dueToday: 0, overdue: 0, issued: 0, holdsWaiting: 0, holdsReady: 0 });
    expect(await get(home, "transport")).toMatchObject({ dayOff: null, expired: 0, expiring: [], routes: [] });
    expect(await get(home, "exam-coordinator")).toEqual({ papers: 0, missing: 0, exams: [] });
    expect(await get(home, "cover")).toMatchObject({ absent: 0, open: 0, dayOff: null });
    expect(await get(home, "website")).toMatchObject({ state: "never" });
    expect(await get(home, "safeguarding")).toEqual({ reports: 0 });
  });

  it("library: a book due today is counted, and the count opens the list that proves it", async () => {
    const librarian = custom(a, "teacher", ["library:read", "library:manage"]);
    const { BookService, LoanService } = await import("@smw/feature-library/service");
    const book = await new BookService(a.as.admin).create({ title: "Home Book", author: "Some Author", category: "Fiction", copies: 1 });
    const copy = (await new BookService(a.as.admin).detail(book.id)).copies[0]!;
    const loan = await new LoanService(a.as.admin).issue({ copyId: copy.id, studentId: fx.kids[0]! });
    const { loans } = await import("@smw/feature-library/schema");
    await withSchool(a.id, (tx) => tx.update(loans).set({ dueOn: todayIST() }).where(eq(loans.id, loan.id)));
    const desk = await get(new HomeService(librarian, wed), "library");
    expect(desk).toMatchObject({ dueToday: 1, issued: 1 });
    expect((await new LoanService(librarian).list({ filters: { status: "due-today" } })).rows.map((r) => r.id)).toEqual([loan.id]);
  });

  it("a panel outside the grants is off, however it is asked for", async () => {
    const nobody = custom(a, "staff", []);
    for (const k of ["fin-numbers", "library", "transport", "front-office", "numbers", "leave", "birthdays", "approvals"] as PanelKey[]) expect((await new HomeService(nobody, wed).panel(k)).state, k).toBe("off");
    expect((await new HomeService(a.as.teacher, wed).panel("numbers")).state).toBe("off"); // a teacher's home has no admin numbers
    expect((await new HomeService(a.as.admin, wed).panel("my-class")).state).toBe("off");
  });

  it("greets and links only to the modules the custom role allows", async () => {
    const svc = new HomeService({ ...a.as.accountant, role: "staff", name: "Sita Rao", grants: new Set(["home:view", "students:read", "fees:read"]) });
    expect((await svc.header()).greeting).toContain("Sita");
    const hrefs = (await get(svc, "links")).map((l) => l.href);
    expect(hrefs).toContain("/app/students");
    expect(hrefs).toContain("/app/fees");
    expect(hrefs).not.toContain("/app/exams");
    expect(hrefs).not.toContain("/app/attendance");
    expect(svc.layout().map((p) => p.key)).toEqual(["fin-numbers", "dues-by-class", "overdue", "receipts", "links"]);
  });

  it("a role with no module grants gets an empty link list, not a crash", async () => {
    const svc = new HomeService({ ...a.as.accountant, role: "staff", grants: new Set(["home:view"]) });
    expect(await get(svc, "links")).toEqual([]);
  });
});

describe("support sessions see nothing private", () => {
  it("no panel that shows names, children, messages or notices of a person, even if asked for by key", async () => {
    const support = { ...a.as.admin, supportStaffId: "00000000-0000-0000-0000-0000000000aa" };
    const home = new HomeService(support, wed);
    const keys = home.layout().map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["today", "numbers", "attention"]));
    for (const k of ["birthdays", "needs-action", "leave", "my-class", "messages", "front-office", "safeguarding", "my-setup", "overdue", "receipts", "approvals", "my-approvals"] as PanelKey[]) {
      expect(keys).not.toContain(k);
      expect((await home.panel(k)).state, k).toBe("off");
    }
    const sTeacher = { ...a.as.teacher, supportStaffId: support.supportStaffId };
    expect((await new HomeService(sTeacher, wed).panel("my-class")).state).toBe("off");
  });
});

describe("student and family panels", () => {
  it("a student sees their own attendance this month", async () => {
    const today = todayIST();
    await mark(new StudentAttendanceService(a.as.admin), today, fx.own, [fx.studentUserKid], []);
    const home = new HomeService(a.as.student);
    expect(await get(home, "family-attendance")).toMatchObject({ pct: 100 });
    expect(await get(home, "family-homework")).toEqual({ rows: [], todo: 0, overdue: 0 });
    expect(await get(home, "family-result")).toBeNull();
    expect(await get(home, "family-dues")).toBeNull();
    expect(await get(home, "family-exam")).toBeNull();
    expect(await get(home, "family-meeting")).toBeNull();
    expect(await get(home, "family-bus")).toBeNull();
    expect(await get(home, "family-library")).toEqual({ out: 1, overdue: 0, dueSoon: 1, titles: ["Home Book"] }); // the book the library test above lent to this student
    expect((await home.children())[0]).toMatchObject({ id: fx.studentUserKid, sectionLabel: "Class 5-A" });
  });

  it("a legacy parent login has no home", () => {
    expect(() => new HomeService(a.as.parent).layout()).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("a login with no linked student gets off panels, not a crash", async () => {
    await withSchool(b.id, (tx) => tx.delete(students));
    const home = new HomeService(b.as.student);
    expect((await home.panel("family-attendance")).state).toBe("off");
    expect(await home.children()).toEqual([]);
  });

  it("lists the notice that needs an answer first, with a link to it", async () => {
    await publishNow(a.as.admin, { title: "Plain news", body: "Just so you know", audience: EVERYONE });
    await publishNow(a.as.admin, { title: "Trip consent", body: "Please answer", audience: EVERYONE, response: { kind: "consent", reasonForNo: false } });
    const home = new HomeService(a.as.student);
    const rows = await get(home, "notices");
    expect(rows[0]).toMatchObject({ title: "Trip consent", needsAnswer: true, href: expect.stringMatching(/^\/app\/announcements\/[0-9a-f-]{36}$/) });
    expect(rows.find((r) => r.title === "Plain news")?.needsAnswer).toBe(false);
    expect((await new FeedService(a.as.student).feed()).rows.length).toBe(rows.length);
    expect((await get(home, "family-answer")).notices.map((n) => n.title)).toEqual(["Trip consent"]);
  });

  it("the next exam is the first scheduled paper of the child's class from today", async () => {
    const { examPapers, exams } = await import("@smw/feature-exams/schema");
    const { classes, subjects } = await import("@smw/feature-academics/schema");
    await withSchool(a.id, async (tx) => {
      const [year] = await tx.select().from(academicYears);
      const [cls] = await tx.select().from(classes);
      const [sub] = await tx.select().from(subjects).where(eq(subjects.name, "Maths"));
      const [sci] = await tx.insert(subjects).values({ schoolId: a.id, name: "Science" }).returning();
      const [ex] = await tx.insert(exams).values({ schoolId: a.id, yearId: year!.id, name: "Half Yearly", kind: "half_yearly", startsOn: "2026-11-20", endsOn: "2026-11-30", status: "scheduled" }).returning();
      await tx.insert(examPapers).values([
        { schoolId: a.id, examId: ex!.id, classId: cls!.id, subjectId: sub!.id, date: "2026-11-25", maxMarks: 80, passMarks: 27 },
        { schoolId: a.id, examId: ex!.id, classId: cls!.id, subjectId: sci!.id, date: "2026-11-05", maxMarks: 80, passMarks: 27 }, // already past
      ]);
    });
    expect(await get(new HomeService(a.as.student, wed), "family-exam")).toMatchObject({ examName: "Half Yearly", subject: "Maths", date: "2026-11-25", more: 0 });
  });
});

describe("users table is read through the school scope", () => {
  it("staff birthdays never leak across schools", async () => {
    await withSchool(b.id, async (tx) => {
      await tx.insert(staffProfiles).values({ schoolId: b.id, userId: b.users.teacher, employeeId: "T-B", dob: "1991-11-11", status: "active" });
      expect((await tx.select({ id: users.id }).from(users)).length).toBeGreaterThan(0);
    });
    const mine = await get(new HomeService(a.as.admin, wed), "birthdays");
    expect(mine.staff.map((s) => s.id)).not.toContain(b.users.teacher);
  });
});

describe("review fixes", () => {
  it("meetings: one read that marks nothing seen, and a failure is the panel's error, not an empty list", async () => {
    const day = vi.spyOn(DayService.prototype, "day");
    const mine = vi.spyOn(DayService.prototype, "mineOn").mockResolvedValueOnce([{ slotId: "s1", meetingId: "m1", meetingTitle: "Term meet", startsAt: new Date(), studentName: "Aarav", studentLabel: "5-A", visit: null }]);
    const home = new HomeService(a.as.teacher, wed);
    expect((await get(home, "meetings")).map((m) => m.studentName)).toEqual(["Aarav"]);
    expect(day).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mine.mockRejectedValueOnce(new Error("db down"));
    expect(await new HomeService(a.as.teacher, wed).panel("meetings")).toEqual({ state: "error", message: "Could not load this. Try again in a moment." });
    vi.restoreAllMocks();
  });

  it("enquiry counts and upcoming events are read once however many panels use them", async () => {
    const counts = vi.spyOn(EnquiryService.prototype, "counts");
    const upcoming = vi.spyOn(EventService.prototype, "upcoming");
    const home = new HomeService(a.as.admin, wed);
    await Promise.all([get(home, "numbers"), get(home, "attention"), get(home, "funnel"), get(home, "today"), get(home, "events")]);
    expect(counts).toHaveBeenCalledTimes(1);
    expect(upcoming).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("an accountant sees what they asked for and is still waiting on; an approver sees no such panel", async () => {
    await withSchool(a.id, (tx) => tx.insert(finApprovals).values([
      { schoolId: a.id, kind: "fees.reversal", refType: "receipt", refId: "00000000-0000-0000-0000-0000000000b1", title: "Reverse receipt R-9", amountPaise: 50_000, reason: "Wrong student", requestedBy: a.users.accountant, status: "pending" },
      { schoolId: a.id, kind: "fees.reversal", refType: "receipt", refId: "00000000-0000-0000-0000-0000000000b2", title: "Someone else's request", amountPaise: 1, reason: "x", requestedBy: a.users.admin, status: "pending" },
    ]));
    const mine = await get(new HomeService(a.as.accountant, wed), "my-approvals");
    expect(mine.rows.map((r) => r.title)).toEqual(["Reverse receipt R-9"]);
    expect(mine.rows[0]).toMatchObject({ amountPaise: 50_000 });
    const approver = { ...a.as.accountant, role: "staff" as const, grants: new Set(["home:view", "fees:read", "fees:collect", "finance:approve"]) };
    expect((await new HomeService(approver, wed).panel("my-approvals")).state).toBe("off");
    expect((await get(new HomeService(approver, wed), "approvals")).pending).toBe(2);
  });

  it("the overdue list carries a call link only for a role that may see phones", async () => {
    vi.spyOn(DuesService.prototype, "worstOverdue").mockResolvedValue([{ id: "x", name: "Riya", classLabel: "5-A", overdue: 100, nextDueDate: null, phone: "9820000001" }]);
    const may = { ...a.as.accountant, role: "staff" as const, grants: new Set(["home:view", "fees:read", "students:read"]) };
    const may2 = await get(new HomeService(may), "overdue");
    expect(may2.rows[0]!.phone).toBe("9820000001");
    const mayNot = { ...may, grants: new Set(["home:view", "fees:read"]) };
    expect((await get(new HomeService(mayNot), "overdue")).rows[0]!.phone).toBeNull();
    vi.restoreAllMocks();
  });

  it("front office: visits first, then calls due (new enquiries and follow-ups), with counts of each", async () => {
    const at = new Date("2026-11-11T05:00:00Z");
    const row = (id: string, kind: string, taskId: string | null) => ({ taskId, enquiryId: id, ref: id, studentName: `S${id}`, parentName: `P${id}`, phone: "x", kind, title: null, at, late: false, status: "new" });
    vi.spyOn(EnquiryService.prototype, "today").mockResolvedValue({ visits: [row("v", "visit", "t1")], due: [row("d", "call", "t2")], fresh: [row("f", "call", null)] } as never);
    const f = await get(new HomeService(custom(a, "staff", ["website:enquiries"]), wed), "front-office");
    expect(f).toMatchObject({ calls: 2, visits: 1, fresh: 1 });
    expect(f.rows.map((r) => r.label)).toEqual(["Visit", "First call", "Follow-up call"]);
    vi.restoreAllMocks();
  });

  it("a missing academic year is said as it is, with the link that fixes it", async () => {
    const noYear = { ...b.as.admin };
    await withSchool(b.id, (tx) => tx.delete(academicYears));
    const cards = await get(new HomeService(noYear, wed), "numbers");
    const dues = cards.find((c) => c.key === "dues");
    expect(dues).toMatchObject({ failed: true, href: "/app/academics/years" });
    expect(dues!.meta).toMatch(/academic year/i);
  });
});
