import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, users, withConsole, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { academicYears, classes, studentSubjects, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { periods, substitutions, timetableSlots, ttBlockOptions, ttBlockSlots, ttBlocks, ttVersions } from "@smw/feature-timetable/schema";
import { buildSchoolData, type Fixture } from "./test-fixture";
import { EligibilityService } from "./eligibility";
import { PeriodAttendanceService, type PeriodRef } from "./period-service";
import { periodAttendance } from "./schema";
import { StudentAttendanceService } from "./service";
import { subjectCsv } from "./register-export";
import { addDays, isSunday, rollupStatus, todayIST } from "./stats";
import { sendDueAlerts } from "./alerts";

let a: TestSchool, b: TestSchool;
let fx: Fixture;
let tt: Awaited<ReturnType<typeof buildTimetable>>;
const mail = new MemoryEmailSender();
const today = todayIST();
// Slots sit on today's weekday (Monday on a Sunday, when the teacher-today tests skip); past days are the same weekday, a week or two back.
const day = isSunday(today) ? 1 : new Date(`${today}T00:00:00Z`).getUTCDay();
const sameWeekday = (n: number) => { let d = addDays(today, -7 * n); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== day) d = addDays(d, -1); return d; };
const past1 = sameWeekday(1), past2 = sameWeekday(2);

/** Three periods and an elective block on one weekday: P1 Maths (teacher), P2 English (t2), P3 Maths (t2), P4 Hindi (teacher) / French (t2). */
async function buildTimetable(s: TestSchool, f: Fixture) {
  const [t2] = await withConsole((tx) => tx.insert(users).values({ schoolId: s.id, role: "teacher", loginId: `t2-${s.slug}`, name: "Second Teacher" }).returning());
  return withSchool(s.id, async (tx) => {
    const schoolId = s.id;
    const [p1, p2, p3, p4] = await tx.insert(periods).values(["P1", "P2", "P3", "P4"].map((name, i) => ({ schoolId, name, startsAt: `0${8 + i}:00`, endsAt: `0${8 + i}:40`, sortOrder: i }))).returning();
    const [v] = await tx.insert(ttVersions).values({ schoolId, name: "Live", status: "live" }).returning();
    const [maths] = await tx.select().from(subjects);
    const [english, hindi, french] = await tx.insert(subjects).values(["English", "Hindi", "French"].map((name) => ({ schoolId, name }))).returning();
    const [s1, s2, s3] = await tx.insert(timetableSlots).values([
      { schoolId, versionId: v!.id, sectionId: f.own, dayOfWeek: day, periodId: p1!.id, subjectId: maths!.id, teacherId: s.users.teacher },
      { schoolId, versionId: v!.id, sectionId: f.own, dayOfWeek: day, periodId: p2!.id, subjectId: english!.id, teacherId: t2!.id },
      { schoolId, versionId: v!.id, sectionId: f.own, dayOfWeek: day, periodId: p3!.id, subjectId: maths!.id, teacherId: t2!.id },
    ]).returning();
    const [cls] = await tx.select().from(classes);
    const [year] = await tx.select().from(academicYears);
    const [blk] = await tx.insert(ttBlocks).values({ schoolId, classId: cls!.id, name: "Second language", periodsPerWeek: 1 }).returning();
    const [oHindi, oFrench] = await tx.insert(ttBlockOptions).values([
      { schoolId, blockId: blk!.id, subjectId: hindi!.id, teacherId: s.users.teacher },
      { schoolId, blockId: blk!.id, subjectId: french!.id, teacherId: t2!.id },
    ]).returning();
    const [bs] = await tx.insert(ttBlockSlots).values({ schoolId, versionId: v!.id, blockId: blk!.id, dayOfWeek: day, periodId: p4!.id }).returning();
    const [rohan] = await tx.select().from(students).where(eq(students.sectionId, f.other));
    // Hindi: two from section A and Rohan from section B; French: one from section A.
    await tx.insert(studentSubjects).values([f.kids[0]!, f.kids[1]!, rohan!.id].map((studentId) => ({ schoolId, studentId, yearId: year!.id, subjectId: hindi!.id })).concat({ schoolId, studentId: f.kids[2]!, yearId: year!.id, subjectId: french!.id }));
    return {
      t2: { ...s.as.teacher, userId: t2!.id, name: t2!.name }, rohan: rohan!.id, p: [p1!.id, p2!.id, p3!.id, p4!.id],
      maths: maths!.id, english: english!.id, slot: [s1!.id, s2!.id, s3!.id] as [string, string, string],
      block: { blockSlotId: bs!.id, hindi: oHindi!.id, french: oFrench!.id },
    };
  });
}

const ref = (i: 0 | 1 | 2): PeriodRef => ({ slotId: tt.slot[i] });
const hindi = (): PeriodRef => ({ blockSlotId: tt.block.blockSlotId, optionId: tt.block.hindi });
const french = (): PeriodRef => ({ blockSlotId: tt.block.blockSlotId, optionId: tt.block.french });
const entries = (ids: string[], status: "present" | "absent" | "late" | "leave" = "present") => ids.map((studentId) => ({ studentId, status }));
const dailyOf = async (who: TestSchool["as"]["admin"], section: string, date: string, studentId: string) =>
  (await new StudentAttendanceService(who).sectionSheet(section, date)).rows.find((r) => r.studentId === studentId)?.status ?? null;
const notes = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => `${n.title} | ${n.body ?? ""}`));

beforeAll(async () => {
  useServices({ email: mail, storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(["students", "academics", "timetable", "attendance", "notifications"], "pa"));
  fx = await buildSchoolData(a);
  await buildSchoolData(b);
  tt = await buildTimetable(a, fx);
});
afterAll(closeDb);

describe("roll-up rule", () => {
  it("present or late in at least the share of periods that count; leave is excused", () => {
    expect(rollupStatus(["present", "absent"], 50)).toBe("present"); // exactly half
    expect(rollupStatus(["present", "absent", "absent"], 50)).toBe("absent");
    expect(rollupStatus(["late", "absent", "absent"], 30)).toBe("present");
    expect(rollupStatus(["absent", "leave", "leave"], 50)).toBe("absent");
    expect(rollupStatus(["present", "leave"], 100)).toBe("present");
    expect(rollupStatus(["leave", "leave"], 50)).toBe("leave");
  });
});

describe("period mode is a school setting", () => {
  it("is off by default: period marks are refused until the admin turns it on; only then do teachers lose the daily sheet", async () => {
    const admin = new PeriodAttendanceService(a.as.admin);
    expect(await admin.mode()).toBe("daily");
    await expect(admin.markPeriod({ date: past1, ...ref(0), entries: entries(fx.kids) })).rejects.toMatchObject({ fieldErrors: { date: expect.any(String) } });
    await expect(new EligibilityService(a.as.teacher).updateSettings({ alertsEnabled: true, thresholdPercent: 75, mode: "period" })).rejects.toBeInstanceOf(ForbiddenError);
    await new EligibilityService(a.as.admin).updateSettings({ alertsEnabled: true, thresholdPercent: 75, mode: "period" });
    expect(await admin.mode()).toBe("period");
    expect(await new EligibilityService(a.as.admin).settings()).toMatchObject({ mode: "period", rollupPercent: 50, thresholdPercent: 75 });
    // The daily sheet: hidden for teachers, kept for the admin.
    await expect(new StudentAttendanceService(a.as.teacher).mark({ sectionId: fx.own, date: today, entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentAttendanceService(a.as.admin).mark({ sectionId: fx.own, date: past2, entries: entries(fx.kids) }, { alerts: false })).resolves.toMatchObject({ total: 4 });
  });
});

describe("a school without the timetable module", () => {
  it("stays daily: period mode is refused, reads as daily and the period list is refused", async () => {
    const noTt = { ...a.as.admin, features: new Set([...a.as.admin.features].filter((f) => f !== "timetable")) };
    await expect(new EligibilityService(noTt).updateSettings({ alertsEnabled: "true", thresholdPercent: "75", mode: "period", rollupPercent: "50" })).rejects.toBeInstanceOf(ValidationError);
    expect(await new PeriodAttendanceService(noTt).mode()).toBe("daily");
    await expect(new PeriodAttendanceService(noTt).periods(new Date().toISOString().slice(0, 10), "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the teacher flow", () => {
  it.skipIf(isSunday(today))("lists my periods today, marks my own, and the day's attendance follows", async () => {
    const teacher = new PeriodAttendanceService(a.as.teacher);
    const mine = await teacher.periods(today);
    expect(mine.map((p) => p.name)).toEqual(["P1", "P4"]); // P2 and P3 are the other teacher's
    expect(mine.every((p) => p.marked === 0)).toBe(true);

    const sheet = await teacher.periodSheet(ref(0), today);
    expect(sheet).toMatchObject({ canMark: true, subject: "Maths", periodName: "P1" });
    expect(sheet.rows).toHaveLength(4);
    const done = await teacher.markPeriod({ date: today, ...ref(0), entries: JSON.stringify([...entries(fx.kids.slice(0, 3)), { studentId: fx.kids[3], status: "absent" }]) });
    expect(done).toMatchObject({ present: 3, absent: 1, total: 4, days: 4 });
    expect((await teacher.periods(today)).find((p) => p.name === "P1")?.marked).toBe(4);
    expect(await dailyOf(a.as.admin, fx.own, today, fx.kids[0]!)).toBe("present");
    expect(await dailyOf(a.as.admin, fx.own, today, fx.kids[3]!)).toBe("absent"); // one period, none attended
  });

  it.skipIf(isSunday(today))("refuses another teacher's period, for the sheet and for marking", async () => {
    const teacher = new PeriodAttendanceService(a.as.teacher);
    await expect(teacher.markPeriod({ date: today, ...ref(1), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.periodSheet(ref(1), today)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PeriodAttendanceService(a.as.student).markPeriod({ date: today, ...ref(0), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PeriodAttendanceService(a.as.accountant).markPeriod({ date: today, ...ref(0), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.skipIf(isSunday(today))("a cover teacher marks the period they cover, today", async () => {
    const teacher = new PeriodAttendanceService(a.as.teacher);
    await expect(teacher.markPeriod({ date: today, ...ref(2), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await withSchool(a.id, (tx) => tx.insert(substitutions).values({ schoolId: a.id, date: today, slotId: tt.slot[2], absentTeacherId: tt.t2.userId, coverTeacherId: a.users.teacher }));
    const row = (await teacher.periods(today)).find((p) => p.name === "P3");
    expect(row).toMatchObject({ cover: "covering", subject: "Maths" });
    await expect(teacher.markPeriod({ date: today, ...ref(2), entries: entries(fx.kids) })).resolves.toMatchObject({ present: 4 });
    // The teacher whose period it was cannot see it as theirs to take today.
    expect((await new PeriodAttendanceService(tt.t2).periods(today)).find((p) => p.name === "P3")?.cover).toBe("away");
  });

  it("teachers mark only today; the admin corrects a past day", async () => {
    const teacher = new PeriodAttendanceService(a.as.teacher);
    await expect(teacher.markPeriod({ date: past1, ...ref(0), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.periods(past1)).rejects.toBeInstanceOf(ForbiddenError);
    const admin = new PeriodAttendanceService(a.as.admin);
    expect((await admin.periods(past1, fx.own)).map((p) => p.name)).toEqual(["P1", "P2", "P3", "P4", "P4"]); // the block lists both options
    await expect(admin.markPeriod({ date: past1, ...ref(0), entries: entries(fx.kids) })).resolves.toMatchObject({ present: 4 });
    await expect(admin.markPeriod({ date: past1, ...ref(0), entries: [{ studentId: fx.kids[0], status: "absent" }] })).resolves.toMatchObject({ absent: 1 });
    expect((await admin.periodSheet(ref(0), past1)).rows.find((r) => r.studentId === fx.kids[0])?.status).toBe("absent");
    await expect(admin.markPeriod({ date: addDays(today, 1), ...ref(0), entries: entries(fx.kids) })).rejects.toBeInstanceOf(ValidationError);
    await expect(admin.markPeriod({ date: addDays(past1, 1), ...ref(0), entries: entries(fx.kids) })).rejects.toMatchObject({ fieldErrors: { date: "This period does not run on that day" } });
  });
});

describe("block periods", () => {
  it("list the students who chose the subject across every section; the day lands in each student's own section", async () => {
    const admin = new PeriodAttendanceService(a.as.admin);
    const h = await admin.periodSheet(hindi(), past1);
    expect(h.rows.map((r) => r.name).sort()).toEqual(["Aarav Sharma", "Diya Patel", "Rohan Gupta"]);
    expect(h.rows.find((r) => r.name === "Rohan Gupta")?.section).toBe("Class 5-B");
    expect((await admin.periodSheet(french(), past1)).rows.map((r) => r.name)).toEqual(["Kabir Singh"]);

    await expect(admin.markPeriod({ date: past1, ...hindi(), entries: [...entries([fx.kids[1]!], "absent"), ...entries([tt.rohan])] })).resolves.toMatchObject({ total: 2 });
    expect(await dailyOf(a.as.admin, fx.other, past1, tt.rohan)).toBe("present");
    await expect(admin.markPeriod({ date: past1, ...hindi(), entries: entries([fx.kids[2]!]) })).rejects.toMatchObject({ fieldErrors: { entries: expect.any(String) } }); // chose French
  });

  it.skipIf(isSunday(today))("only their teacher takes them", async () => {
    const teacher = new PeriodAttendanceService(a.as.teacher);
    await expect(teacher.markPeriod({ date: today, ...hindi(), entries: entries([fx.kids[0]!]) })).resolves.toMatchObject({ total: 1 });
    await expect(teacher.markPeriod({ date: today, ...french(), entries: entries([fx.kids[2]!]) })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await teacher.periods(today)).filter((p) => p.name === "P4")).toHaveLength(1);
  });
});

describe("roll-up to daily", () => {
  const k = () => fx.kids[2]!;
  const mark = (i: 0 | 1 | 2, date: string, status: "present" | "absent" | "late" | "leave") => new PeriodAttendanceService(a.as.admin).markPeriod({ date, ...ref(i), entries: entries([k()], status) });

  it("is present at half the periods, absent below; the school can move the threshold", async () => {
    await mark(0, past2, "present");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("present");
    await mark(1, past2, "absent");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("present"); // 1 of 2
    await mark(2, past2, "absent");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("absent"); // 1 of 3
    const svc = new EligibilityService(a.as.admin);
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 75, rollupPercent: 30 });
    await mark(2, past2, "absent");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("present"); // 33% is enough at 30
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 75, rollupPercent: 80 });
    await mark(2, past2, "late");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("absent"); // present, absent, late = 67%
    await svc.updateSettings({ alertsEnabled: true, thresholdPercent: 75, rollupPercent: 50 });
    await mark(2, past2, "late");
    expect(await dailyOf(a.as.admin, fx.own, past2, k())).toBe("present");
    await expect(svc.updateSettings({ alertsEnabled: true, thresholdPercent: 75, rollupPercent: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the register, percentages and the daily summary read the rolled-up day unchanged", async () => {
    const reg = await new StudentAttendanceService(a.as.admin).monthlyRegister(fx.own, past2.slice(0, 7));
    expect(reg.rows.find((r) => r.studentId === k())?.marks[past2]).toBe("present");
    expect((await new StudentAttendanceService(a.as.admin).studentSummary(k(), past2, past2))).toMatchObject({ present: 1, pct: 100 });
  });

  it("a day of approved leave stays leave", async () => {
    const day3 = sameWeekday(3);
    await new StudentAttendanceService(a.as.admin).mark({ sectionId: fx.own, date: day3, entries: entries([fx.kids[3]!], "leave") }, { alerts: false });
    await withSchool(a.id, async (tx) => { const { studentAttendance } = await import("./schema"); await tx.update(studentAttendance).set({ note: "On approved leave" }).where(eq(studentAttendance.date, day3)); });
    await new PeriodAttendanceService(a.as.admin).markPeriod({ date: day3, ...ref(0), entries: entries([fx.kids[3]!], "absent") });
    expect(await dailyOf(a.as.admin, fx.own, day3, fx.kids[3]!)).toBe("leave");
  });

  it.skipIf(isSunday(today))("the absence alert fires once per day, on the rolled-up day, and not for a single missed period", async () => {
    const kid = fx.studentUserKid, when = today; // the student login; alerts skip days before yesterday
    const svc = new PeriodAttendanceService(a.as.admin);
    const title = (n: string[]) => n.filter((t) => t.includes(when));
    const before = title(await notes(a, a.users.student)).length;
    await withSchool(a.id, (tx) => tx.delete(periodAttendance).where(eq(periodAttendance.date, when)));
    const sendAfterWindow = async () => withSchool(a.id, (tx) => sendDueAlerts(tx, a.id, new Date(Date.now() + 31 * 60_000)));
    await svc.markPeriod({ date: when, ...ref(0), entries: entries([kid], "absent") });
    expect(await dailyOf(a.as.admin, fx.own, when, kid)).toBe("absent");
    await sendAfterWindow();
    expect(title(await notes(a, a.users.student))).toHaveLength(before); // one missed period: no alert
    await svc.markPeriod({ date: when, ...ref(1), entries: entries([kid], "absent") });
    await sendAfterWindow();
    expect(title(await notes(a, a.users.student))).toHaveLength(before + 1);
    await svc.markPeriod({ date: when, ...ref(1), entries: entries([kid], "absent") });
    await svc.markPeriod({ date: when, ...ref(2), entries: entries([kid], "absent") });
    await sendAfterWindow();
    expect(title(await notes(a, a.users.student))).toHaveLength(before + 1);
  });
});

describe("subject-wise attendance", () => {
  it("counts attended over held periods per subject, for the section", async () => {
    const admin = new PeriodAttendanceService(a.as.admin);
    const d1 = sameWeekday(4), d2 = sameWeekday(5), k = fx.kids[1]!;
    // Maths (P1 and P3): present, absent, late, absent -> 2 of 4. English (P2): present, present.
    await admin.markPeriod({ date: d1, ...ref(0), entries: entries([k], "present") });
    await admin.markPeriod({ date: d1, ...ref(2), entries: entries([k], "absent") });
    await admin.markPeriod({ date: d2, ...ref(0), entries: entries([k], "late") });
    await admin.markPeriod({ date: d2, ...ref(2), entries: entries([k], "absent") });
    await admin.markPeriod({ date: d1, ...ref(1), entries: entries([k], "present") });
    await admin.markPeriod({ date: d2, ...ref(1), entries: entries([k], "present") });
    await admin.markPeriod({ date: d2, ...ref(0), entries: entries([fx.kids[3]!], "leave") }); // leave: excused

    await expect(admin.subjectReport(fx.own, today, past2)).rejects.toBeInstanceOf(ValidationError);
    const range = await admin.subjectReport(fx.own, d2 < d1 ? d2 : d1, d2 < d1 ? d1 : d2);
    const row = range.rows.find((r) => r.studentId === k)!;
    expect(row.bySubject[tt.maths]).toEqual({ attended: 2, total: 4, pct: 50 });
    expect(row.bySubject[tt.english]).toEqual({ attended: 2, total: 2, pct: 100 });
    expect(row.overall).toBe(66.7);
    expect(range.rows.find((r) => r.studentId === fx.kids[3])?.bySubject[tt.maths]).toEqual({ attended: 0, total: 0, pct: null });
    const csv = subjectCsv(range);
    expect(csv.split("\n")[0]).toContain("Maths %");
    expect(csv).toContain("2,Diya Patel,2,2,100,2,4,50,66.7");
  });

  it("a teacher sees only their own sections; others are refused", async () => {
    const t = new PeriodAttendanceService(a.as.teacher);
    await expect(t.subjectReport(fx.other, past2, past1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t.subjectReport(fx.own, past2, past1)).resolves.toBeDefined();
    await expect(new PeriodAttendanceService(a.as.student).subjectReport(fx.own, past2, past1)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("isolation", () => {
  it("school B sees none of A's periods, marks or sections", async () => {
    const bAdmin = new PeriodAttendanceService(b.as.admin);
    await expect(bAdmin.periodSheet(ref(0), past1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.markPeriod({ date: past1, ...ref(0), entries: entries(fx.kids) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.subjectReport(fx.own, past2, past1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(b.id, (tx) => tx.select().from(periodAttendance))).toEqual([]);
    expect(await bAdmin.mode()).toBe("daily");
    expect(await withSchool(a.id, (tx) => tx.select().from(periodAttendance))).not.toEqual([]);
  });
});
