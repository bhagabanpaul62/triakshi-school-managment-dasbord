// Review fixes for admissions wave 0 (docs/ADMISSIONS-PRD.md 4.1 and 9.3). One describe per numbered finding; each test fails on the code before the fix.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LEFT_ACCESS_DAYS } from "@smw/auth";
import { auditLogs, closeDb, schools, users, withConsole, withSchool } from "@smw/db";
import { LimitError } from "@smw/feature-kit";
import { createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import academicsFeature from "@smw/feature-academics/feature";
import studentsFeature from "./feature";
import jobs from "./jobs";
import { ImportService, LifecycleService, PromotionService, StudentService } from "./service";
import { studentEnrollments, students, WITHDREW_BEFORE_JOINING } from "./schema";
import { addDays, today } from "./util";
import { StudentService as RawStudentService } from "./student-service";

const FEATURES = ["academics", "students", "notifications"];
interface Ids { yearNow: string; yearNext: string; c4: string; c5: string; s4A: string; s4B: string; s12A: string; s5next: string; s4next: string }
let a: TestSchool, ids: Ids;
const tomorrow = () => addDays(today(), 1);

async function setup(school: TestSchool, teacher?: string): Promise<Ids> {
  const schoolId = school.id;
  return withSchool(schoolId, async (tx) => {
    const [y1] = await tx.insert(academicYears).values({ schoolId, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [y2] = await tx.insert(academicYears).values({ schoolId, name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: false }).returning();
    const cls = await tx.insert(classes).values([{ schoolId, name: "Class 4", grade: 4 }, { schoolId, name: "Class 5", grade: 5 }, { schoolId, name: "Class 12", grade: 12 }]).returning();
    const sec = (classId: string, yearId: string, name = "A", classTeacherId?: string) => ({ schoolId, classId, yearId, name, classTeacherId });
    const [x4, x12, y5, y4, x4b] = await tx.insert(sections).values([
      sec(cls[0]!.id, y1!.id, "A", teacher), sec(cls[2]!.id, y1!.id), sec(cls[1]!.id, y2!.id), sec(cls[0]!.id, y2!.id), sec(cls[0]!.id, y1!.id, "B"),
    ]).returning();
    return { yearNow: y1!.id, yearNext: y2!.id, c4: cls[0]!.id, c5: cls[1]!.id, s4A: x4!.id, s12A: x12!.id, s5next: y5!.id, s4next: y4!.id, s4B: x4b!.id };
  });
}

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  await registerFeatures([academicsFeature, studentsFeature]);
  a = await createTestSchool("admreva", FEATURES);
  ids = await setup(a, a.users.teacher);
});
afterAll(closeDb);

const svc = (s = a) => new StudentService(s.as.admin);
const life = (s = a) => new LifecycleService(s.as.admin);
const row = (id: string, s = a) => withSchool(s.id, async (tx) => (await tx.select().from(students).where(eq(students.id, id)))[0]!);
const login = (userId: string, s = a) => withSchool(s.id, async (tx) => (await tx.select().from(users).where(eq(users.id, userId)))[0]!);
const enrol = (id: string, s = a) => withSchool(s.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, id)));
const run = (s: TestSchool, q: ReturnType<typeof sql>) => withSchool(s.id, (tx) => tx.execute(q));
const joiner = (name: string, extra: Record<string, unknown> = {}, s = a, i = ids) => svc(s).create({ name, sectionId: i.s5next, ...extra });
const due = async (id: string, back = 1, s = a) => { await withSchool(s.id, (tx) => tx.update(students).set({ joinsOn: addDays(today(), -back), admissionDate: addDays(today(), -back) }).where(eq(students.id, id))); return id; };
const SNAP = JSON.stringify({ studentName: "x", admissionNo: "y", classLabel: "z", guardian: null });
const invoice = (s: TestSchool, studentId: string, yearId: string, status: "issued" | "cancelled" | "draft", gross = 100000) => run(s, sql`
  insert into fee_invoices (id, school_id, student_id, year_id, kind, status, label, due_date, snapshot, gross_paise)
  values (gen_random_uuid(), ${s.id}, ${studentId}, ${yearId}, 'custom', ${status}, 'Term 1', '2027-04-10', ${SNAP}::jsonb, ${gross})`);

describe("1: the admission date of a joining child is their joining day", () => {
  it("is set at admission, follows every change of the day, and Start now makes it today", async () => {
    const s = await joiner("Admission Date Kid");
    expect(s).toMatchObject({ joinsOn: "2027-04-01", admissionDate: "2027-04-01" });
    await life().setJoiningDay(s.id, { joinsOn: "2027-05-02" });
    expect((await row(s.id)).admissionDate).toBe("2027-05-02");
    const t = await svc().create({ name: "Admission Date Today", classId: ids.c4, sectionId: ids.s4A, joinsOn: tomorrow(), admissionDate: "2026-04-01" });
    expect(t.admissionDate).toBe(tomorrow());
    await life().startNow(s.id);
    expect(await row(s.id)).toMatchObject({ status: "active", admissionDate: today() });
  });

  it("the nightly job keeps the planned day as the admission date", async () => {
    const s = await joiner("Nightly Date Kid");
    await due(s.id, 3);
    await life().joinDue();
    expect(await row(s.id)).toMatchObject({ status: "active", admissionDate: addDays(today(), -3) });
  });
});

describe("2: one lock order, so roll numbers and the plan count cannot race", () => {
  it("6 starts at once get roll numbers 1 to 6", async () => {
    const c = await createTestSchool("admrevlock", FEATURES);
    const i = await setup(c);
    const kids = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => svc(c).create({ name: `Roll Kid ${n}`, classId: i.c4, sectionId: i.s4A, joinsOn: tomorrow() })));
    const out = await Promise.allSettled(kids.map((k) => life(c).startNow(k.id)));
    expect(out.map((o) => o.status)).toEqual(Array(6).fill("fulfilled"));
    const rolls = (await Promise.all(kids.map((k) => row(k.id, c)))).map((r) => r.rollNo).sort();
    expect(rolls).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("with one place left, 4 starts at once make exactly one active and the rest wait with the reason", async () => {
    const c = await createTestSchool("admrevcap", FEATURES);
    const i = await setup(c);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 1 }).where(eq(schools.id, c.id)));
    const kids = await Promise.all([1, 2, 3, 4].map((n) => svc(c).create({ name: `Cap Kid ${n}`, classId: i.c4, sectionId: i.s4A, joinsOn: tomorrow() })));
    const out = await Promise.allSettled(kids.map((k) => life(c).startNow(k.id)));
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const o of out) if (o.status === "rejected") expect(String(o.reason)).toMatch(/plan allows 1/);
    const states = (await Promise.all(kids.map((k) => row(k.id, c)))).map((r) => r.status).sort();
    expect(states).toEqual(["active", "joining", "joining", "joining"]);
  });

  it("4 admissions at once into the last place make one student, and 6 into a section get 6 different roll numbers", async () => {
    const c = await createTestSchool("admrevadm", FEATURES);
    const i = await setup(c);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 1 }).where(eq(schools.id, c.id)));
    const out = await Promise.allSettled([1, 2, 3, 4].map((n) => svc(c).create({ name: `Adm Cap ${n}`, sectionId: i.s4A })));
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 100 }).where(eq(schools.id, c.id)));
    const more = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => svc(c).create({ name: `Adm Roll ${n}`, sectionId: i.s4B })));
    expect(more.map((m) => m.rollNo).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("bring back and join-due at once take different roll numbers", async () => {
    const c = await createTestSchool("admrevbb", FEATURES);
    const i = await setup(c);
    const gone = await svc(c).create({ name: "Left For Race", sectionId: i.s4A });
    await life(c).markLeft(gone.id, { reason: "fees" });
    const j = await svc(c).create({ name: "Join For Race", classId: i.c4, sectionId: i.s4A, joinsOn: tomorrow() });
    await Promise.all([life(c).bringBack(gone.id, { sectionId: i.s4A }), life(c).startNow(j.id)]);
    const rolls = [(await row(gone.id, c)).rollNo, (await row(j.id, c)).rollNo].sort();
    expect(rolls).toEqual([1, 2]);
  });
});

describe("3: join-due runs for schools in trial, active and past due", () => {
  it("asks every school in those three states and no other", async () => {
    const states = ["trial", "active", "past_due", "read_only", "suspended", "pending", "cancelled"] as const;
    const made = await Promise.all(states.map((st) => createTestSchool(`admrevjob-${st.replace("_", "")}`, FEATURES)));
    await Promise.all(made.map((m, n) => withConsole((tx) => tx.update(schools).set({ status: states[n]! }).where(eq(schools.id, m.id)))));
    const asked = new Set<string>();
    const spy = vi.spyOn(LifecycleService.prototype, "joinDue").mockImplementation(async function (this: unknown) {
      asked.add((this as { ctx: { schoolId: string } }).ctx.schoolId);
      return { joined: 0, waiting: 0, failed: 0, failures: [] };
    });
    await jobs["students.join-due"]();
    spy.mockRestore();
    const got = made.map((m, n) => [states[n], asked.has(m.id)]);
    expect(got).toEqual([["trial", true], ["active", true], ["past_due", true], ["read_only", false], ["suspended", false], ["pending", false], ["cancelled", false]]);
  });
});

describe("4: the joining day is inside its year", () => {
  it("a day past the end of the current year, or before its start, is a field error", async () => {
    await expect(svc().create({ name: "Past End", classId: ids.c4, sectionId: ids.s4A, joinsOn: "2027-04-02" })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.stringContaining("2026-27") } });
    await expect(svc().create({ name: "Before Start", classId: ids.c4, sectionId: ids.s4A, joinsOn: "2026-03-01" })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.any(String) } });
  });

  it("a later year needs a day on or after its start and before its end; today is no ordinary admission there", async () => {
    await expect(joiner("Today In Next", { joinsOn: today() })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.stringContaining("1 Apr 2027") } });
    await expect(joiner("Eve Of Next", { joinsOn: "2027-03-31" })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.any(String) } });
    await expect(joiner("After Next", { joinsOn: "2028-04-01" })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.any(String) } });
    expect((await joiner("First Day Next", { joinsOn: "2027-04-01" })).status).toBe("joining");
    expect((await svc().create({ name: "Last Day Of Now", classId: ids.c4, sectionId: ids.s4A, joinsOn: "2027-03-31" })).status).toBe("joining");
  });

  it("the import says the same, and in the same column", async () => {
    const csv = "name,dob,class,section,joins_on,joins_year\nImp Early,2015-01-01,Class 5,A,2027-03-30,2027-28\nImp Late,2015-01-02,Class 5,A,2028-04-02,2027-28\nImp Ok,2015-01-03,Class 5,A,2027-04-02,2027-28\nImp Over,2015-01-04,Class 4,A,2027-04-02,\n";
    const report = await new ImportService(a.as.admin).dryRun(csv);
    expect(report.rows.map((r) => r.errors.some((e) => e.startsWith("joins_on:")))).toEqual([true, true, false, true]);
    await expect(new ImportService(a.as.admin).commit(csv)).rejects.toMatchObject({ fieldErrors: { file: expect.any(String) } });
  });
});

describe("5: erasure keeps the withdrawn reason and blanks the words", () => {
  it("a child who withdrew keeps left_reason and loses the words and the PEN; any other reason goes", async () => {
    const w = await joiner("Erase Withdrawn", { pen: "AB123456789" });
    await life().withdraw(w.id, { reason: "Family moved far away" });
    expect(await row(w.id)).toMatchObject({ leftReason: WITHDREW_BEFORE_JOINING, leftNote: "Family moved far away" });
    const preview = await svc().erasePreview(w.id);
    expect(preview.blank.find((b) => b.label === "Reason for leaving")!.filled).toBe(false);
    expect(preview.blank.find((b) => b.label === "Words about why they left")!.filled).toBe(true);
    await svc().eraseOptional(w.id, "Parent asked for it");
    expect(await row(w.id)).toMatchObject({ leftReason: WITHDREW_BEFORE_JOINING, leftNote: null, pen: null, status: "left" });

    const l = await svc().create({ name: "Erase Leaver", sectionId: ids.s4A });
    await life().markLeft(l.id, { reason: "other", note: "Private words" });
    await svc().eraseOptional(l.id, "Parent asked for it");
    expect(await row(l.id)).toMatchObject({ leftReason: null, leftNote: null });
  });

  it("refuses a child who is still joining", async () => {
    const j = await joiner("Erase Joining");
    await expect(svc().eraseOptional(j.id, "Parent asked for it")).rejects.toThrow(/about to join/);
  });
});

describe("6: change the joining day", () => {
  it("year, day, section and class change together; the class follows the section; the enrolment follows the year", async () => {
    const s = await joiner("Moves All");
    await life().setJoiningDay(s.id, { joinsOn: addDays(today(), 3), joinsYearId: ids.yearNow, joinsSectionId: ids.s4A });
    expect(await row(s.id)).toMatchObject({ joinsYearId: ids.yearNow, joinsSectionId: ids.s4A, classId: ids.c4, joinsOn: addDays(today(), 3), admissionDate: addDays(today(), 3) });
    expect(await enrol(s.id)).toMatchObject([{ yearId: ids.yearNow, classId: ids.c4, sectionId: null, outcome: "studying" }]);
    // No section: the class is chosen, and the plan is cleared because a section belongs to one year.
    await life().setJoiningDay(s.id, { joinsOn: "2027-04-05", joinsYearId: ids.yearNext, classId: ids.c5 });
    expect(await row(s.id)).toMatchObject({ joinsYearId: ids.yearNext, joinsSectionId: null, classId: ids.c5 });
    expect(await enrol(s.id)).toMatchObject([{ yearId: ids.yearNext, classId: ids.c5 }]);
    // A key left out keeps the plan.
    await life().setJoiningDay(s.id, { joinsOn: "2027-04-06", joinsSectionId: ids.s5next });
    await life().setJoiningDay(s.id, { joinsOn: "2027-04-07" });
    expect(await row(s.id)).toMatchObject({ joinsSectionId: ids.s5next, joinsOn: "2027-04-07" });
  });

  it("a day outside the year, or a section of another year, is a field error", async () => {
    const s = await joiner("Moves Wrong");
    await expect(life().setJoiningDay(s.id, { joinsOn: "2027-03-31" })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.stringContaining("2027-28") } });
    await expect(life().setJoiningDay(s.id, { joinsOn: "2027-04-05", joinsSectionId: ids.s4A })).rejects.toMatchObject({ fieldErrors: { joinsSectionId: expect.any(String) } });
  });

  it("with bills made for the joining year: a new day is allowed and says to check them; a new class or year is refused with a link to fees", async () => {
    const s = await joiner("Has Bills");
    await invoice(a, s.id, ids.yearNext, "issued");
    await invoice(a, s.id, ids.yearNext, "issued", 50000);
    await invoice(a, s.id, ids.yearNext, "cancelled");
    const info = await life().joiningInfo(s.id);
    expect(info).toMatchObject({ bills: 2, yearName: "2027-28", feesHref: `/app/fees/students/${s.id}`, hasSection: true });
    const moved = await life().setJoiningDay(s.id, { joinsOn: "2027-04-09" });
    expect(moved.billsNote).toBe("2 bills are already issued for 2027-28, check them");
    await expect(life().setJoiningDay(s.id, { joinsOn: addDays(today(), 3), joinsYearId: ids.yearNow })).rejects.toMatchObject({ fieldErrors: { joinsYearId: expect.stringContaining("cancelled or credited"), _open: `/app/fees/students/${s.id}` } });
    await expect(life().setJoiningDay(s.id, { joinsOn: "2027-04-09", joinsSectionId: undefined, classId: ids.c4 })).rejects.toMatchObject({ fieldErrors: { _open: `/app/fees/students/${s.id}` } });
    expect(await row(s.id)).toMatchObject({ classId: ids.c5, joinsYearId: ids.yearNext });
    await withSchool(a.id, (tx) => tx.execute(sql`update fee_invoices set status = 'cancelled' where student_id = ${s.id}`));
    await life().setJoiningDay(s.id, { joinsOn: addDays(today(), 3), joinsYearId: ids.yearNow, joinsSectionId: ids.s4A });
    expect(await row(s.id)).toMatchObject({ joinsYearId: ids.yearNow, classId: ids.c4 });
  });
});

describe("7: bring back", () => {
  it("into this year: admission number kept, access and joining cleared, the old closed row reused, the reason cleared into the audit log", async () => {
    const s = await svc().create({ name: "Back Now", sectionId: ids.s4A });
    await life().markLeft(s.id, { reason: "other", note: "Private words here" });
    const [closed] = await enrol(s.id);
    const gone = await row(s.id);
    expect(gone.accessUntil).toBeTruthy();
    await life().bringBack(s.id, { sectionId: ids.s4B });
    const back = await row(s.id);
    expect(back).toMatchObject({ status: "active", admissionNo: gone.admissionNo, sectionId: ids.s4B, accessUntil: null, leftOn: null, leftReason: null, leftNote: null, joinsOn: null, joinsYearId: null, joinsSectionId: null });
    const now = await enrol(s.id);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ id: closed!.id, outcome: "studying", sectionId: ids.s4B });
    expect((await login(s.userId!)).status).toBe("active");
    const [entry] = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.entityId, s.id), eq(auditLogs.action, "bring_back"))));
    expect(JSON.stringify(entry!.meta)).toContain("Private words here");
  });

  it("for a later day and year: joining again, not counted in the plan, login off, the closed row of that year reused", async () => {
    const w = await joiner("Back Later");
    const [closed] = await enrol(w.id);
    await life().withdraw(w.id, { reason: "Not this year" });
    await expect(life().bringBack(w.id, { joinsOn: "2027-04-10", joinsYearId: ids.yearNext })).rejects.toMatchObject({ fieldErrors: { classId: expect.any(String) } });
    await expect(life().bringBack(w.id, { joinsOn: "2027-03-31", joinsYearId: ids.yearNext, joinsSectionId: ids.s5next })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.any(String) } });
    const before = (await svc().capacity()).active;
    await life().bringBack(w.id, { joinsOn: "2027-04-10", joinsYearId: ids.yearNext, joinsSectionId: ids.s5next });
    expect(await row(w.id)).toMatchObject({ status: "joining", sectionId: null, rollNo: null, classId: ids.c5, joinsOn: "2027-04-10", admissionDate: "2027-04-10", joinsYearId: ids.yearNext, joinsSectionId: ids.s5next, leftReason: null, leftNote: null, accessUntil: null });
    expect((await login(w.userId!)).status).toBe("disabled");
    expect(await enrol(w.id)).toMatchObject([{ id: closed!.id, outcome: "studying", sectionId: null }]);
    expect((await svc().capacity()).active).toBe(before);
    await due(w.id);
    await life().joinDue();
    expect(await row(w.id)).toMatchObject({ status: "active", sectionId: ids.s5next });
  });

  it("a kept bus stop is shown as a warning, and says when the bus has no seat left", async () => {
    const c = await createTestSchool("admrevbus", FEATURES);
    const i = await setup(c);
    const [one, two] = await Promise.all([svc(c).create({ name: "Bus Rider One", sectionId: i.s4A }), svc(c).create({ name: "Bus Rider Two", sectionId: i.s4A })]);
    await run(c, sql`insert into vehicles (id, school_id, registration_no, capacity, driver_name, driver_phone) values ('00000000-0000-4000-8000-0000000000a1', ${c.id}, 'AB 01 1234', 1, 'Driver', '9800000000')`);
    await run(c, sql`insert into routes (id, school_id, name, vehicle_id, morning_start, evening_start) values ('00000000-0000-4000-8000-0000000000a2', ${c.id}, 'North', '00000000-0000-4000-8000-0000000000a1', '07:00', '14:00')`);
    await run(c, sql`insert into route_stops (id, school_id, route_id, name, sequence, morning_time, evening_time) values ('00000000-0000-4000-8000-0000000000a3', ${c.id}, '00000000-0000-4000-8000-0000000000a2', 'Market', 1, '07:10', '14:30')`);
    for (const st of [one, two]) await run(c, sql`insert into student_transport (id, school_id, student_id, route_id, stop_id, starts_on) values (gen_random_uuid(), ${c.id}, ${st.id}, '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3', '2026-06-01')`);
    await life(c).markLeft(one.id, { reason: "fees" });
    const out = await life(c).bringBack(one.id, { sectionId: i.s4B });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/bus stop Market on North was kept/);
    expect(out.warnings[0]).toMatch(/1 seats and 1 children already ride/);
  });
});

describe("8: closing the record", () => {
  it("closes every studying row, also of a year to come, and gives the family 90 days from the later of today and the last day", async () => {
    const s = await svc().create({ name: "Closes All", sectionId: ids.s4A });
    await withSchool(a.id, (tx) => tx.insert(studentEnrollments).values({ schoolId: a.id, studentId: s.id, yearId: ids.yearNext, classId: ids.c5, outcome: "studying" }));
    await life().markLeft(s.id, { reason: "changed_school", lastDay: addDays(today(), -5) });
    expect((await enrol(s.id)).map((e) => e.outcome)).toEqual(["left", "left"]);
    expect((await row(s.id)).accessUntil).toBe(addDays(today(), LEFT_ACCESS_DAYS));
    expect(LEFT_ACCESS_DAYS).toBe(90);
  });

  it("keeps the code in left_reason and the words in left_note, and shows both on the record", async () => {
    const s = await svc().create({ name: "Words Kid", sectionId: ids.s4A });
    await life().markLeft(s.id, { reason: "other", note: "Moved to Pune" });
    expect(await row(s.id)).toMatchObject({ leftReason: "other", leftNote: "Moved to Pune" });
    expect(await svc().overview(s.id)).toMatchObject({ leftReason: "Other", leftNote: "Moved to Pune" });
  });

  it("withdraw before joining: the reason is exact, the words are in the note, and there is no access", async () => {
    const w = await joiner("Withdraw Words");
    await life().withdraw(w.id, { reason: "Chose another school" });
    expect(await row(w.id)).toMatchObject({ status: "left", leftReason: "withdrew before joining", leftNote: "Chose another school", accessUntil: null, leftOn: null });
  });

  it("a graduate by promotion has access for 90 days too, and leavers by promotion keep their code", async () => {
    const c = await createTestSchool("admrevprom", FEATURES);
    const i = await setup(c);
    const grad = await svc(c).create({ name: "Grad Kid", sectionId: i.s12A });
    await new PromotionService(c.as.admin).promote({ fromSectionId: i.s12A });
    expect(await row(grad.id, c)).toMatchObject({ status: "alumni", leftReason: "completed", leftNote: null, accessUntil: addDays(today(), LEFT_ACCESS_DAYS) });
    const out = await svc(c).create({ name: "Promo Leaver", sectionId: i.s4A });
    await svc(c).create({ name: "Promo Stayer", sectionId: i.s4A });
    await new PromotionService(c.as.admin).promote({ fromSectionId: i.s4A, toSectionId: i.s5next, leftIds: [out.id], leftReason: "fees" });
    expect(await row(out.id, c)).toMatchObject({ status: "left", leftReason: "fees", accessUntil: addDays(today(), LEFT_ACCESS_DAYS) });
  });
});

describe("9 and 10: what the leaving and withdrawing dialogs say", () => {
  it("lists unpaid bills, books out and the bus stop, and the money of a child who withdraws", async () => {
    const c = await createTestSchool("admrevopen", FEATURES);
    const i = await setup(c);
    const s = await svc(c).create({ name: "Open Items Kid", sectionId: i.s4A });
    const none = await life(c).openItems(s.id);
    expect(none).toMatchObject({ money: { bills: 0, unpaidBills: 0, receipts: 0, depositPaise: 0 }, books: 0, bus: null, feesHref: `/app/fees/students/${s.id}` });
    await invoice(c, s.id, i.yearNow, "issued", 120000);
    await invoice(c, s.id, i.yearNow, "cancelled");
    await run(c, sql`insert into fee_receipts (id, school_id, student_id, number, date, amount_paise, snapshot, verify_token) values (gen_random_uuid(), ${c.id}, ${s.id}, 'R-1', '2026-06-01', 5000, ${SNAP}::jsonb, 'tok-open-1')`);
    await run(c, sql`insert into fee_advances (id, school_id, student_id, kind, amount_paise, date) values (gen_random_uuid(), ${c.id}, ${s.id}, 'deposit', 250000, '2026-06-01')`);
    await run(c, sql`insert into books (id, school_id, title, author, category) values ('00000000-0000-4000-8000-0000000000b1', ${c.id}, 'Book', 'Author', 'Story')`);
    await run(c, sql`insert into book_copies (id, school_id, book_id, accession_no) values ('00000000-0000-4000-8000-0000000000b2', ${c.id}, '00000000-0000-4000-8000-0000000000b1', 1)`);
    await run(c, sql`insert into loans (id, school_id, copy_id, borrower_kind, student_id, issued_on, due_on) values (gen_random_uuid(), ${c.id}, '00000000-0000-4000-8000-0000000000b2', 'student', ${s.id}, '2026-11-01', '2026-11-15')`);
    const some = await life(c).openItems(s.id);
    expect(some.money).toMatchObject({ bills: 1, unpaidBills: 1, unpaidPaise: 120000, receipts: 1, depositPaise: 250000 });
    expect(some.books).toBe(1);
  });
});

describe("11: Start now says why it cannot before it is pressed", () => {
  it("no planned section, and a full plan, are said up front", async () => {
    const noPlan = await svc().create({ name: "No Plan Start", classId: ids.c4, joinsYearId: ids.yearNext });
    expect(await life().joiningInfo(noPlan.id)).toMatchObject({ hasSection: false, startBlocked: expect.stringMatching(/no planned section/) });
    const c = await createTestSchool("admrevfull", FEATURES);
    const i = await setup(c);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 1 }).where(eq(schools.id, c.id)));
    await svc(c).create({ name: "Only Seat Taken", sectionId: i.s4A });
    const j = await svc(c).create({ name: "Full Start", classId: i.c4, sectionId: i.s4A, joinsOn: tomorrow() });
    expect(await life(c).joiningInfo(j.id)).toMatchObject({ hasSection: true, startBlocked: expect.stringMatching(/plan allows 1/) });
    expect(await life(c).bringBackBlocked()).toMatch(/plan allows 1/);
    expect(await life().bringBackBlocked()).toBeNull();
  });
});

describe("12: import", () => {
  const HEAD = "name,dob,class,section,allow_duplicate,guardian_name,guardian_phone\n";
  it("a row after one that allowed a duplicate is checked against it, and the check and the commit agree", async () => {
    const csv = HEAD + ["Agree Twin,2014-02-02,Class 4,A,yes,,", "agree  twin,2014-02-02,Class 4,A,,,"].join("\n");
    const report = await new ImportService(a.as.admin).dryRun(csv);
    expect(report.rows.map((r) => r.errors.length > 0)).toEqual([false, true]);
    expect(report.rows[1]!.errors[0]).toContain("same name and birth date as line 2");
    await expect(new ImportService(a.as.admin).commit(csv)).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("1 of 2") } });
    expect((await svc().list({ q: "Agree Twin" })).total).toBe(0);
  });

  it("a row with no birth date matches by name and guardian phone, in the file, against the school, and on the form", async () => {
    await svc().create({ name: "Phone Match", sectionId: ids.s4A, guardianName: "Parent", guardianPhone: "9811500001" });
    const csv = HEAD + ["phone  match,,Class 4,A,,Parent,9811500001", "Fresh Name,,Class 4,A,,Parent,9811500002", "fresh name,,Class 4,A,,Parent,9811500002", "Other Name,,Class 4,A,,Parent,9811500003"].join("\n");
    const report = await new ImportService(a.as.admin).dryRun(csv);
    const errs = report.rows.map((r) => r.errors.join(" | "));
    expect(errs[0]).toContain("guardian phone");
    expect(errs[1]).toBe("");
    expect(errs[2]).toContain("same name and guardian phone as line 3");
    expect(errs[3]).toBe("");
    await expect(svc().create({ name: "Phone Match", sectionId: ids.s4A, guardianName: "Parent", guardianPhone: "9811500001" })).rejects.toMatchObject({ fieldErrors: { allowDuplicate: expect.stringContaining("guardian phone") } });
    expect((await svc().create({ name: "Phone Match", sectionId: ids.s4A, guardianName: "Parent", guardianPhone: "9811500001", allowDuplicate: "true" })).status).toBe("active");
  });

  it("holds one lock for the whole import, not one per row", async () => {
    const c = await createTestSchool("admrevimp", FEATURES);
    const i = await setup(c);
    const csv = HEAD + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Lock Row ${n},201${n % 10}-03-0${n},Class 4,A,,,`).join("\n");
    let most = 0;
    const real = RawStudentService.prototype.admitWithin;
    const spy = vi.spyOn(RawStudentService.prototype, "admitWithin").mockImplementation(async function (this: unknown, tx, data) {
      const out = await real.call(this, tx, data);
      const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`);
      most = Math.max(most, Number(r?.n));
      return out;
    });
    await new ImportService(c.as.admin).commit(csv);
    spy.mockRestore();
    expect(i.s4A).toBeTruthy();
    expect(most).toBeLessThanOrEqual(3);
  });

  it("a file over the plan limit is refused with the sentence the check shows", async () => {
    const c = await createTestSchool("admrevlim", FEATURES);
    await setup(c);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 2 }).where(eq(schools.id, c.id)));
    const csv = HEAD + ["Lim A,2014-01-01,Class 4,A,,,", "Lim B,2014-01-02,Class 4,A,,,", "Lim C,2014-01-03,Class 4,A,,,"].join("\n");
    const report = await new ImportService(c.as.admin).dryRun(csv);
    expect(report.limitMessage).toBeTruthy();
    const err = await new ImportService(c.as.admin).commit(csv).catch((e) => e);
    expect(err).toBeInstanceOf(LimitError);
    expect(err.message).toBe(report.limitMessage);
  });
});

describe("13: a teacher sees medical notes only for active students of their sections", () => {
  it("a child who left, or who is joining into the section, is blank for the class teacher", async () => {
    const mk = (name: string, extra: Record<string, unknown> = {}) => svc().create({ name, sectionId: ids.s4A, medicalNotes: "Peanut allergy", emergencyName: "Uncle Ram", emergencyPhone: "9877700001", ...extra });
    const stays = await mk("Teacher Sees"), leaves = await mk("Teacher Not Left");
    const joins = await svc().create({ name: "Teacher Not Joining", classId: ids.c4, sectionId: ids.s4A, joinsOn: tomorrow(), medicalNotes: "Peanut allergy" });
    await life().markLeft(leaves.id, { reason: "fees" });
    const t = new StudentService(a.as.teacher);
    const seen = (await t.list({ q: "Teacher" })).rows;
    const by = (n: string) => seen.find((r) => r.name === n)!;
    expect(by("Teacher Sees").medicalNotes).toBe("Peanut allergy");
    expect(by("Teacher Not Left")).toMatchObject({ medicalNotes: null, emergencyName: null, emergencyPhone: null });
    expect(by("Teacher Not Joining").medicalNotes).toBeNull();
    expect((await t.overview(leaves.id)).student.medicalNotes).toBeNull();
    expect((await t.medical(stays.id)).medicalNotes).toBe("Peanut allergy");
    await expect(t.medical(leaves.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(t.medical(joins.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc().overview(leaves.id)).student.medicalNotes).toBe("Peanut allergy");
  });
});

describe("14: join-due, start now, withdraw and a new day on the same child at once", () => {
  it("always ends in one consistent state", async () => {
    for (let n = 0; n < 6; n++) {
      const s = await svc().create({ name: `Race Kid ${n}`, classId: ids.c4, sectionId: ids.s4A, joinsOn: tomorrow() });
      await Promise.allSettled([life().joinDue(tomorrow()), life().startNow(s.id), life().withdraw(s.id, { reason: "Race words" }), life().setJoiningDay(s.id, { joinsOn: addDays(today(), 2) })]);
      const r = await row(s.id), e = await enrol(s.id), l = await login(s.userId!);
      expect(["active", "left"]).toContain(r.status);
      if (r.status === "active") {
        expect(r).toMatchObject({ sectionId: ids.s4A, leftReason: null, accessUntil: null });
        expect(r.rollNo).toBeGreaterThan(0);
        expect(e).toMatchObject([{ outcome: "studying", sectionId: ids.s4A, rollNo: r.rollNo }]);
        expect(l.status).toBe("active");
        expect([today(), r.joinsOn]).toContain(r.admissionDate);
      } else {
        expect(r).toMatchObject({ sectionId: null, rollNo: null, leftReason: WITHDREW_BEFORE_JOINING, leftNote: "Race words", accessUntil: null });
        expect(e).toMatchObject([{ outcome: "left", sectionId: null }]);
        expect(l.status).toBe("disabled");
      }
    }
  });
});
