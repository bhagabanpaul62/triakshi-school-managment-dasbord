// The calendar layers live in the app (apps/school/src/lib/calendar-layers.ts); they are tested here, against the real tables.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "@smw/feature-notifications/feature";
import { calendarItems, layersFor } from "../../apps/school/src/lib/calendar-layers";
import { academicYears, subjects } from "../academics/schema";
import { assignments } from "../assignments/schema";
import { attendanceHolidays } from "../attendance/schema";
import { examPapers, exams } from "../exams/schema";
import { meetingDays, meetingSlots, meetingWindows } from "../meetings/schema";
import { addDays, istDay, parseIst } from "./dates";
import eventsFeature from "./feature";
import { EventService } from "./service";
import { asUser, fixture, type Fixture } from "./test-fixture";

const ALL = ["events", "notifications", "attendance", "exams", "assignments", "timetable", "meetings", "fees"];
let a: TestSchool, b: TestSchool, fx: Fixture;
const today = istDay(new Date());
const d = (n: number) => addDays(today, n);
const range = [new Date(Date.now() - 5 * 864e5), new Date(Date.now() + 60 * 864e5)] as const;
const ids = { exam: "", cls: "" };
const titles = async (userId: string, role: "student" | "teacher" | "admin" | "accountant", school = a) => (await calendarItems(asUser(school, userId, role, ALL), ...range)).map((i) => `${i.layer}:${i.title}`);

beforeAll(async () => {
  await registerFeatures([eventsFeature, notificationsFeature]);
  ({ a, b } = await createSchoolPair(ALL, "l"));
  fx = await fixture(a);
  await withSchool(a.id, async (tx) => {
    const [year] = await tx.select().from(academicYears);
    const [cls] = await tx.execute(sql`select class_id::text as c from sections where id = ${fx.own}::uuid`) as unknown as { c: string }[];
    ids.cls = cls!.c;
    const [math] = await tx.insert(subjects).values({ schoolId: a.id, name: "Maths" }).returning();
    await tx.insert(attendanceHolidays).values([
      { schoolId: a.id, date: d(10), name: "Diwali", kind: "national", spanId: crypto.randomUUID() },
      { schoolId: a.id, date: d(11), name: "Diwali", kind: "national" },
      { schoolId: a.id, date: d(20), name: "Students only day", kind: "other", appliesTo: "students" },
      { schoolId: a.id, date: d(21), name: "Class closure", kind: "other", appliesTo: "classes", classIds: ["00000000-0000-4000-8000-000000000001"] },
      { schoolId: a.id, date: d(22), name: "Working Sunday", kind: "working" },
    ]);
    const [ex, draft] = await tx.insert(exams).values([
      { schoolId: a.id, yearId: year!.id, name: "Half-yearly", startsOn: d(30), endsOn: d(34), status: "scheduled" },
      { schoolId: a.id, yearId: year!.id, name: "Secret draft exam", startsOn: d(35), endsOn: d(36), status: "draft" },
    ]).returning();
    await tx.insert(examPapers).values({ schoolId: a.id, examId: ex!.id, classId: ids.cls, subjectId: math!.id, date: d(30), maxMarks: 100, passMarks: 33 });
    void draft;
    await tx.insert(assignments).values([
      { schoolId: a.id, sectionId: fx.own, subjectId: math!.id, title: "Fractions sheet", dueAt: parseIst(`${d(5)}T09:00`)!, createdBy: a.users.teacher },
      { schoolId: a.id, sectionId: fx.other, subjectId: math!.id, title: "Other section sheet", dueAt: parseIst(`${d(5)}T09:00`)!, createdBy: a.users.admin },
    ]);
    await tx.execute(sql`insert into tt_day_overrides (id, school_id, date, label) values (gen_random_uuid(), ${a.id}, ${d(8)}::date, 'Half day')`);
    const [md] = await tx.insert(meetingDays).values({ schoolId: a.id, title: "PTM", state: "open", audience: { include: [{ type: "families" }], exclude: [] }, opensAt: new Date(), closesAt: new Date(Date.now() + 9e8) }).returning();
    const start = parseIst(`${d(12)}T10:00`)!, end = parseIst(`${d(12)}T10:10`)!;
    const [w] = await tx.insert(meetingWindows).values({ schoolId: a.id, meetingId: md!.id, teacherId: a.users.teacher, day: d(12), startsAt: start, endsAt: parseIst(`${d(12)}T12:00`)! }).returning();
    await tx.insert(meetingSlots).values([
      { schoolId: a.id, meetingId: md!.id, windowId: w!.id, teacherId: a.users.teacher, startsAt: start, endsAt: end, state: "booked", studentId: fx.ann, bookedBy: a.users.student },
      { schoolId: a.id, meetingId: md!.id, windowId: w!.id, teacherId: a.users.teacher, startsAt: end, endsAt: parseIst(`${d(12)}T10:20`)!, state: "booked", studentId: fx.cy, bookedBy: fx.cyUser },
    ]);
    const bill = (sid: string, due: string, label: string, paid = 0) => tx.execute(sql`insert into fee_invoices (id, school_id, student_id, year_id, kind, status, label, due_date, snapshot, gross_paise, paid_paise)
      values (gen_random_uuid(), ${a.id}, ${sid}::uuid, ${year!.id}, 'custom', 'issued', ${label}, ${due}::date, '{"studentName":"x","admissionNo":"x","classLabel":"x","guardian":null}'::jsonb, 100000, ${paid})`);
    await bill(fx.ann, d(6), "Term 2 fee"); await bill(fx.ann, d(7), "Paid bill", 100000); await bill(fx.cy, d(6), "Cy fee");
  });
  await new EventService(asUser(a, a.users.admin, "admin", ALL)).create({ title: "Sports day", startsAt: `${d(3)}T09:00`, audience: JSON.stringify({ include: [{ type: "families" }], exclude: [] }), notify: "false" });
});
afterAll(closeDb);

describe("layers", () => {
  it("a family sees its own section's homework, its own meeting and bill, the exam for its class, and holidays that concern it", async () => {
    const t = await titles(fx.annUser, "student");
    expect(t).toEqual(expect.arrayContaining(["events:Sports day", "holidays:Diwali", "holidays:Students only day", "exams:Half-yearly", "homework:Due: Fractions sheet", "timetable:Half day", "fees:Fee due: Term 2 fee"]));
    expect(t.some((x) => x.startsWith("meetings:"))).toBe(true);
    for (const no of ["holidays:Class closure", "holidays:Working Sunday", "exams:Secret draft exam", "homework:Due: Other section sheet", "fees:Fee due: Paid bill", "fees:Fee due: Cy fee"]) expect(t).not.toContain(no);
    expect(t.filter((x) => x === "holidays:Diwali")).toHaveLength(1); // two days, one span
  });

  it("a teacher sees what they set and teach, never fee dates; the office sees every holiday", async () => {
    const t = await titles(a.users.teacher, "teacher");
    expect(t).toContain("homework:Due: Fractions sheet");
    expect(t).not.toContain("homework:Due: Other section sheet");
    expect(t.some((x) => x.startsWith("fees:"))).toBe(false);
    expect(t.filter((x) => x.startsWith("meetings:"))).toHaveLength(2); // both bookings are with this teacher
    const office = await titles(a.users.admin, "admin");
    expect(office).toEqual(expect.arrayContaining(["holidays:Students only day", "holidays:Class closure", "homework:Due: Other section sheet"]));
    expect(layersFor(asUser(a, a.users.teacher, "teacher", ALL))).not.toContain("fees");
  });

  it("layers can be switched off, and a module that is off has no layer", async () => {
    const only = await calendarItems(asUser(a, fx.annUser, "student", ALL), ...range, ["holidays"]);
    expect(new Set(only.map((i) => i.layer))).toEqual(new Set(["holidays"]));
    const noExams = await calendarItems(asUser(a, fx.annUser, "student", ["events", "attendance", "notifications"]), ...range);
    expect(noExams.map((i) => i.layer)).not.toContain("exams");
    expect(noExams.map((i) => i.layer)).not.toContain("fees");
  });

  it("every item says where it opens, and exam, holiday and homework items are read only (they link away from events)", async () => {
    const items = await calendarItems(asUser(a, fx.annUser, "student", ALL), ...range);
    for (const i of items) expect(i.href).toMatch(i.layer === "events" ? /^\/app\/events\// : /^\/app\//);
    expect(items.find((i) => i.layer === "holidays")!.href).toBe("/app/attendance/holidays");
  });

  it("school B sees none of school A", async () => {
    expect(await titles(b.users.admin, "admin", b)).toEqual([]);
    expect(await titles(b.users.student, "student", b)).toEqual([]);
  });
});
