import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, supportMessages, supportTickets, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { publishNow } from "@smw/feature-announcements/quick";
import { FeedService } from "@smw/feature-announcements/service";
import { StudentAttendanceService } from "@smw/feature-attendance/service";
import { attendanceHolidays } from "@smw/feature-attendance/schema";
import { todayIST } from "@smw/feature-attendance/stats";
import { buildSchoolData, type Fixture } from "@smw/feature-attendance/test-fixture";
import { academicYears, sections, terms } from "@smw/feature-academics/schema";
import { feeReceiptMethods, feeReceipts } from "@smw/feature-fees/schema";
import { students } from "@smw/feature-students/schema";
import { HomeService, type Slot } from "./home-service";

const FEATURES = ["home", "students", "academics", "attendance", "fees", "exams", "timetable", "assignments", "announcements", "events", "website", "support", "notifications"];
// A Wednesday in the past: deterministic, and attendance may be marked on it.
const WED = "2026-11-11";
const wed = () => new Date(`${WED}T10:00:00+05:30`);
const EVERYONE = { include: [{ type: "everyone" }], exclude: [] };
const SUN = () => new Date("2026-11-15T10:00:00+05:30");

let a: TestSchool, b: TestSchool;
let fx: Fixture;

const ok = <T,>(s: Slot<T>): T => { expect(s.state).toBe("ok"); return (s as { data: T }).data; };
const mark = (svc: StudentAttendanceService, date: string, sectionId: string, ids: string[], absent: string[] = []) =>
  svc.mark({ sectionId, date, entries: ids.map((studentId) => ({ studentId, status: absent.includes(studentId) ? "absent" : "present" })) });

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

describe("admin home", () => {
  it("answers 'what needs me': sections not marked, a support reply waiting; other panels still load", async () => {
    const att = new StudentAttendanceService(a.as.admin);
    const [rohan] = await withSchool(a.id, (tx) => tx.select({ id: students.id }).from(students).where(eq(students.sectionId, fx.other)));
    await mark(att, WED, fx.other, [rohan!.id]); // the 'other' section is marked; 'own' (4 students) is not; 'taught' has no students
    await withSchool(a.id, async (tx) => {
      const [t] = await tx.insert(supportTickets).values({ schoolId: a.id, subject: "Invoice question", status: "open" }).returning();
      await tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t!.id, authorStaffId: "00000000-0000-0000-0000-0000000000aa", body: "We have fixed it." });
    });
    await publishNow(a.as.admin, { title: "Regular notice", body: "x", audience: EVERYONE });
    await publishNow(a.as.admin, { title: "Pinned notice", body: "x", audience: EVERYONE, pinnedUntil: new Date(Date.now() + 86_400_000).toISOString() });

    const home = await new HomeService(a.as.admin, wed).admin();
    const { items, unchecked } = ok(home.attention);
    expect(unchecked).toEqual([]);
    expect(items.find((i) => i.key === "attendance")).toMatchObject({ count: 1, href: "/app/attendance" });
    expect(items.find((i) => i.key === "support")).toMatchObject({ count: 1, href: "/app/support" });
    expect(items.find((i) => i.key === "fees")).toBeUndefined(); // nobody owes anything yet
    const notices = ok(home.announcements);
    expect(notices.map((r) => r.title)).toEqual(["Pinned notice", "Regular notice"]);
    expect(notices[0]).toMatchObject({ href: `/app/announcements/${notices[0]!.id}`, excerpt: "x" });
    expect(ok(home.needsAction)).toEqual([]);
    expect(home.requests.state).toBe("off"); // this package's test database has no requests tables
    expect(ok(home.capacity)).toMatchObject({ active: 5, cap: 300, percent: 2, warning: false });
    expect(ok(home.fees).summary).toMatchObject({ collectedThisMonth: 0, outstanding: 0 });
    expect(ok(home.fees).trend).toHaveLength(6);
  });

  it("shows today's school-wide attendance from the attendance module", async () => {
    const today = todayIST();
    await mark(new StudentAttendanceService(a.as.admin), today, fx.own, fx.kids, [fx.kids[3]!]);
    const att = ok((await new HomeService(a.as.admin).admin()).attendance);
    expect(att).toMatchObject({ date: today, marked: 4, absent: 1, present: 3, pct: 75, students: 5 });
  });

  it("a sunday has no sections to mark", async () => {
    const m = ok((await new HomeService(a.as.admin, SUN).admin()).attention);
    expect(m.items.find((i) => i.key === "attendance")).toBeUndefined();
  });

  it("a module that is off gives an off slot, not an error", async () => {
    const lean = { ...a.as.admin, features: new Set(["home", "students"]) };
    const home = await new HomeService(lean, wed).admin();
    expect(home.fees.state).toBe("off");
    expect(home.attendance.state).toBe("off");
    expect(home.announcements.state).toBe("off");
    expect(home.capacity.state).toBe("ok");
    expect(ok(home.attention).items).toEqual([]);
  });

  it("one failing panel is an error for that panel only, and 'all clear' is not claimed for it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    class FeesDown extends HomeService { protected feeSummary(): never { throw new Error("db down"); } }
    const home = await new FeesDown(a.as.admin, wed).admin();
    expect(home.fees).toEqual({ state: "error", message: "Could not load this. Try again in a moment." });
    expect(home.capacity.state).toBe("ok");
    expect(home.announcements.state).toBe("ok");
    expect(ok(home.attention).unchecked).toEqual(["fees"]);
    vi.restoreAllMocks();
  });

  it("isolation: school B sees none of school A's numbers", async () => {
    const home = await new HomeService(b.as.admin, wed).admin();
    expect(ok(home.announcements)).toEqual([]);
    const { items } = ok(home.attention);
    expect(items.find((i) => i.key === "support")).toBeUndefined();
    expect(items.find((i) => i.key === "attendance")?.count).toBe(2); // B's own sections: nothing marked
  });
});

describe("teacher home", () => {
  it("lists the sections they are class teacher of, flips to marked, and gives the class percentage", async () => {
    const t = new HomeService(a.as.teacher, wed);
    const before = ok((await t.teacher()).toMark);
    expect(before.rows).toEqual([{ id: fx.own, label: "Class 5-A", students: 4, marked: false }]);

    await mark(new StudentAttendanceService(a.as.teacher), WED, fx.own, fx.kids, [fx.kids[3]!]);
    const home = await t.teacher();
    expect(ok(home.toMark).rows[0]).toMatchObject({ marked: true });
    expect(ok(home.classMonth)).toEqual([{ sectionId: fx.own, label: "Class 5-A", pct: 75, students: 4 }]);
  });

  it("has an empty timetable, nothing to grade and no marks pending on a fresh school", async () => {
    const home = await new HomeService(a.as.teacher, wed).teacher();
    expect(ok(home.today)).toMatchObject({ day: 3, rows: [] });
    expect(ok(home.grading)).toEqual({ toGrade: 0, rows: [] });
    expect(ok(home.marks)).toEqual([]);
  });

  it("no register on a Sunday", async () => {
    expect(ok((await new HomeService(a.as.teacher, SUN).teacher()).toMark)).toEqual({ dayOff: "Sunday", rows: [] });
  });
});

describe("teacher home on closed and open days", () => {
  const on = (date: string) => new HomeService(a.as.teacher, () => new Date(`${date}T10:00:00+05:30`));
  const hol = (date: string, name: string, over: Partial<typeof attendanceHolidays.$inferInsert> = {}) =>
    withSchool(a.id, (tx) => tx.insert(attendanceHolidays).values({ schoolId: a.id, date, name, ...over }));

  it("a closure of chosen classes takes only those sections off the register; one for everyone names the day; a working Sunday opens it", async () => {
    const [sec] = await withSchool(a.id, (tx) => tx.select({ classId: sections.classId }).from(sections).where(eq(sections.id, fx.own)));
    await hol("2026-11-12", "Class 5 trip", { appliesTo: "classes", classIds: [sec!.classId] });
    expect(ok((await on("2026-11-12").teacher()).toMark)).toEqual({ dayOff: null, rows: [] });
    await hol("2026-11-13", "Founders day");
    expect(ok((await on("2026-11-13").teacher()).toMark)).toEqual({ dayOff: "Founders day", rows: [] });
    await hol("2026-11-15", "Make-up Sunday", { kind: "working" });
    expect(ok((await on("2026-11-15").teacher()).toMark).rows).toHaveLength(1);
    // The admin's tile and the timetable say "Sunday" only when it is a day off.
    const day = (date: string) => new HomeService(a.as.admin, () => new Date(`${date}T10:00:00+05:30`));
    expect(ok((await day("2026-11-15").admin()).attendance).dayOff).toBeNull();
    expect(ok((await day("2026-11-13").admin()).attendance).dayOff).toBe("Founders day");
    expect(ok((await day("2026-11-22").admin()).attendance).dayOff).toBe("Sunday");
  });
});

describe("accountant home", () => {
  it("counts today's valid receipts only and lists the newest payments with a receipt link id", async () => {
    const today = todayIST();
    await withSchool(a.id, async (tx) => {
      const snapshot = { studentName: "Home Student", admissionNo: "H1", classLabel: "5-A", guardian: null };
      const row = (number: string, amountPaise: number, status: "valid" | "reversed") => ({ schoolId: a.id, number, studentId: fx.kids[0]!, date: today, amountPaise, status, snapshot, verifyToken: `tok-${number}` });
      const made = await tx.insert(feeReceipts).values([row("R-1", 2_500_000, "valid"), row("R-2", 100_000, "valid"), row("R-3", 999_900, "reversed")]).returning();
      await tx.insert(feeReceiptMethods).values(made.map((r) => ({ schoolId: a.id, receiptId: r.id, method: "upi" as const, amountPaise: r.amountPaise })));
    });
    const home = await new HomeService(a.as.accountant).accountant();
    const money = ok(home.money);
    expect(money).toMatchObject({ todayPaise: 2_600_000, todayCount: 2 });
    expect(money.summary.collectedThisMonth).toBeGreaterThanOrEqual(2_600_000);
    const recent = ok(home.recent);
    expect(recent.map((r) => r.receiptNo).sort()).toEqual(["R-1", "R-2"]);
    expect(recent[0]).toMatchObject({ student: expect.any(String), method: "upi" });
    expect(ok(home.overdue)).toMatchObject({ total: 0, rows: [] });
    expect(ok(home.dueByClass)).toEqual([]); // no fee structure yet
  });

  it("isolation: school B's accountant sees no payments", async () => {
    const home = await new HomeService(b.as.accountant).accountant();
    expect(ok(home.recent)).toEqual([]);
    expect(ok(home.money).todayPaise).toBe(0);
  });
});

describe("staff home", () => {
  const staff = (grants: string[]) => ({ ...a.as.accountant, role: "staff" as const, name: "Sita Rao", grants: new Set(grants) });

  it("greets and links only to the modules the custom role allows", async () => {
    const home = await new HomeService(staff(["home:view", "students:read", "fees:read"])).forRole();
    expect(home.role).toBe("staff");
    if (home.role !== "staff") return;
    expect(home.data.header.greeting).toContain("Sita");
    const hrefs = home.data.links.map((l) => l.href);
    expect(hrefs).toContain("/app/students");
    expect(hrefs).toContain("/app/fees");
    expect(hrefs).not.toContain("/app/exams");
    expect(hrefs).not.toContain("/app/attendance");
  });

  it("a role with no module grants gets an empty link list, not a crash", async () => {
    const home = await new HomeService(staff(["home:view"])).forRole();
    if (home.role !== "staff") throw new Error("expected staff home");
    expect(home.data.links).toEqual([]);
  });
});

describe("student home", () => {
  it("a student sees their own attendance this month", async () => {
    const today = todayIST();
    await mark(new StudentAttendanceService(a.as.admin), today, fx.own, [fx.studentUserKid], []);
    const home = await new HomeService(a.as.student).student();
    expect(home.child).toMatchObject({ id: fx.studentUserKid, sectionLabel: "Class 5-A" });
    expect(ok(home.attendance)).toMatchObject({ pct: 100 });
    expect(ok(home.assignments)).toEqual({ rows: [], todo: 0, overdue: 0 });
    expect(ok(home.results)).toBeNull();
    expect(ok(home.fees)).toBeNull();
  });

  it("a legacy parent login has no home", async () => {
    await expect(new HomeService(a.as.parent).forRole()).rejects.toMatchObject({ status: 403 });
  });

  it("a login with no linked student gets an empty home, not a crash", async () => {
    await withSchool(b.id, (tx) => tx.delete(students));
    const home = await new HomeService(b.as.student).student();
    expect(home.child).toBeNull();
    expect(home.attendance.state).toBe("off");
  });
});

describe("family home", () => {
  it("lists the notice that needs an answer first, with a link to it", async () => {
    await publishNow(a.as.admin, { title: "Plain news", body: "Just so you know", audience: EVERYONE });
    await publishNow(a.as.admin, { title: "Trip consent", body: "Please answer", audience: EVERYONE, response: { kind: "consent", reasonForNo: false } });
    const home = await new HomeService(a.as.student).student();
    const rows = ok(home.announcements);
    expect(rows[0]).toMatchObject({ title: "Trip consent", needsAnswer: true, href: expect.stringMatching(/^\/app\/announcements\/[0-9a-f-]{36}$/) });
    expect(rows.find((r) => r.title === "Plain news")?.needsAnswer).toBe(false);
    expect((await new FeedService(a.as.student).feed()).rows.length).toBe(rows.length);
  });
});
