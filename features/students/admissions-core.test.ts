// Admissions wave 0 (docs/ADMISSIONS-PRD.md 2.2): joining, leaving, duplicates, age, two guardians, PEN. Each A-test fails on the old code.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, users, withConsole, withSchool, schools, auditLogs } from "@smw/db";
import { createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import academicsFeature from "@smw/feature-academics/feature";
import { notifications } from "@smw/feature-notifications/schema";
import studentsFeature from "./feature";
import { GuardianService, ImportService, LifecycleService, PromotionService, StudentService } from "./service";
import { guardians, studentEnrollments, students, WITHDREW_BEFORE_JOINING } from "./schema";
import { addDays, today } from "./util";

const FEATURES = ["academics", "students", "notifications"];
let a: TestSchool, b: TestSchool;
let yearNow: string, yearNext: string, c4: string, c5: string, s4A: string, s12A: string, s5next: string, s4next: string, s4B: string;

async function setup(school: TestSchool, teacher?: string) {
  const schoolId = school.id;
  return withSchool(schoolId, async (tx) => {
    const [y1] = await tx.insert(academicYears).values({ schoolId, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [y2] = await tx.insert(academicYears).values({ schoolId, name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: false }).returning();
    const cls = await tx.insert(classes).values([{ schoolId, name: "Class 4", grade: 4 }, { schoolId, name: "Class 5", grade: 5 }, { schoolId, name: "Class 12", grade: 12 }]).returning();
    const sec = (classId: string, yearId: string, name = "A", classTeacherId?: string) => ({ schoolId, classId, yearId, name, classTeacherId });
    const [x4, x12, y5, y4, x4b] = await tx.insert(sections).values([
      sec(cls[0]!.id, y1!.id, "A", teacher), sec(cls[2]!.id, y1!.id), sec(cls[1]!.id, y2!.id), sec(cls[0]!.id, y2!.id), sec(cls[0]!.id, y1!.id, "B"),
    ]).returning();
    return { yearNow: y1!.id, yearNext: y2!.id, c4: cls[0]!.id, c5: cls[1]!.id, c12: cls[2]!.id, s4A: x4!.id, s12A: x12!.id, s5next: y5!.id, s4next: y4!.id, s4B: x4b!.id };
  });
}

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  await registerFeatures([academicsFeature, studentsFeature]);
  a = await createTestSchool("admcorea", FEATURES);
  b = await createTestSchool("admcoreb", FEATURES);
  ({ yearNow, yearNext, c4, c5, s4A, s12A, s5next, s4next, s4B } = await setup(a, a.users.teacher));
  await setup(b);
});
afterAll(closeDb);

const svc = (s = a) => new StudentService(s.as.admin);
const life = (s = a) => new LifecycleService(s.as.admin);
const row = (id: string, s = a) => withSchool(s.id, async (tx) => (await tx.select().from(students).where(eq(students.id, id)))[0]!);
const login = (userId: string, s = a) => withSchool(s.id, async (tx) => (await tx.select().from(users).where(eq(users.id, userId)))[0]!);
const enrol = (id: string, s = a) => withSchool(s.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, id)));
const active = async (s = a) => (await svc(s).capacity()).active;
const tomorrow = () => addDays(today(), 1);
const joiner = (name: string, extra: Record<string, unknown> = {}) => svc().create({ name, sectionId: s5next, ...extra });
/** The joining day has come: a later year cannot be given a past day, so the day is moved back in the table the way time would. */
const due = async (id: string, back = 1, s = a) => { await withSchool(s.id, (tx) => tx.update(students).set({ joinsOn: addDays(today(), -back), admissionDate: addDays(today(), -back) }).where(eq(students.id, id))); return id; };

describe("A1 and A2: starting later", () => {
  it("A1: a child can be admitted into next year's section and is joining, not active", async () => {
    const before = await active();
    const s = await joiner("Next Year Kid", { dob: "2015-08-01" });
    expect(s).toMatchObject({ status: "joining", classId: c5, sectionId: null, rollNo: null, joinsYearId: yearNext, joinsSectionId: s5next, joinsOn: "2027-04-01" });
    expect(s.admissionNo).toMatch(/^AD\d{4}$/);
    expect((await login(s.userId!)).status).toBe("disabled");
    expect(await enrol(s.id)).toMatchObject([{ yearId: yearNext, sectionId: null, classId: c5, outcome: "studying" }]);
    expect(await active()).toBe(before);
  });

  it("A2: a joining day after today in this year is joining, not counted in this year's plan or section", async () => {
    const before = await active();
    const s = await svc().create({ name: "Later This Year", classId: c4, sectionId: s4A, joinsOn: tomorrow() });
    expect(s).toMatchObject({ status: "joining", sectionId: null, joinsSectionId: s4A, joinsYearId: yearNow, classId: c4 });
    expect((await enrol(s.id))[0]).toMatchObject({ yearId: yearNow, sectionId: null });
    expect(await active()).toBe(before);
    expect((await svc().list({ filters: { sectionId: s4A } })).rows.map((r) => r.id)).not.toContain(s.id);
    const view = await svc().listView({ filters: { status: "joining" } });
    expect(view.rows.find((r) => r.id === s.id)).toMatchObject({ classSection: "4-A", joinsOn: tomorrow() });
  });

  it("a date today or earlier in this year is an ordinary admission", async () => {
    const s = await svc().create({ name: "Starts Today", sectionId: s4A, joinsOn: today() });
    expect(s).toMatchObject({ status: "active", sectionId: s4A, joinsOn: null });
    expect((await login(s.userId!)).status).toBe("active");
  });

  it("asks for a class, a year that exists and a section of that year", async () => {
    await expect(svc().create({ name: "No Class", joinsOn: tomorrow() })).rejects.toMatchObject({ fieldErrors: { classId: expect.any(String) } });
    await expect(svc().create({ name: "Past Year", joinsYearId: "7b0f2a2e-0000-4000-8000-000000000000", classId: c4 })).rejects.toMatchObject({ fieldErrors: { joinsYearId: expect.any(String) } });
    await expect(svc().create({ name: "Wrong Plan", classId: c4, joinsYearId: yearNext, joinsSectionId: s4A })).rejects.toMatchObject({ fieldErrors: { joinsSectionId: expect.any(String) } });
    const noSection = await svc().create({ name: "No Plan Yet", classId: c4, joinsYearId: yearNext });
    expect(noSection).toMatchObject({ status: "joining", joinsSectionId: null, classId: c4 });
  });

  it("the lookups name the years and say when next year has no sections", async () => {
    const look = await svc().lookups();
    expect(look.joining.years.map((y) => y.name)).toEqual(["2026-27", "2027-28"]);
    expect(look.joining.notice).toBeNull();
    const c = await createTestSchool("admcorec", FEATURES);
    await withSchool(c.id, async (tx) => { await tx.insert(academicYears).values([{ schoolId: c.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }, { schoolId: c.id, name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31" }]); });
    expect((await svc(c).lookups()).joining.notice).toMatch(/2027-28 has no sections/);
  });
});

describe("join day", () => {
  it("makes the child active on the day, once: section, roll number, enrolment, login, audit, class teacher told; a second run changes nothing", async () => {
    const s = await svc().create({ name: "Joins Tomorrow", classId: c4, sectionId: s4A, joinsOn: tomorrow() });
    expect((await life().joinDue()).joined).toBe(0); // not yet
    expect((await row(s.id)).status).toBe("joining");
    const first = await life().joinDue(tomorrow());
    expect(first.joined).toBeGreaterThanOrEqual(1);
    const now = await row(s.id);
    expect(now).toMatchObject({ status: "active", sectionId: s4A, classId: c4 });
    expect(now.rollNo).toBeGreaterThan(0);
    expect((await login(s.userId!)).status).toBe("active");
    expect((await enrol(s.id))[0]).toMatchObject({ sectionId: s4A, rollNo: now.rollNo, outcome: "studying" });
    const told = await withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.subjectId, s.id), eq(notifications.userId, a.users.teacher))));
    expect(told).toHaveLength(1);
    const logged = async () => (await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.entityId, s.id), eq(auditLogs.action, "join"))))).length;
    expect(await logged()).toBe(1);
    expect((await life().joinDue(tomorrow())).joined).toBe(0);
    expect(await logged()).toBe(1);
    expect((await row(s.id)).rollNo).toBe(now.rollNo);
  });

  it("works for next year's child before the school switches the current year", async () => {
    const s = await joiner("Early Next Year");
    await due(s.id);
    const r = await life().joinDue();
    expect(r.joined).toBeGreaterThanOrEqual(1);
    expect(await row(s.id)).toMatchObject({ status: "active", sectionId: s5next, classId: c5 });
    expect((await enrol(s.id))[0]).toMatchObject({ yearId: yearNext, sectionId: s5next, outcome: "studying" });
  });

  it("waits with a reason when no section is planned, and tells the admins once even after two nights", async () => {
    const s = await svc().create({ name: "Needs Section", classId: c4, joinsYearId: yearNext });
    await due(s.id, 2);
    const r1 = await life().joinDue(), r2 = await life().joinDue();
    expect(r1.waiting).toBeGreaterThanOrEqual(1);
    expect(r2.waiting).toBeGreaterThanOrEqual(1);
    expect((await row(s.id)).status).toBe("joining");
    const told = await withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.subjectId, s.id), eq(notifications.userId, a.users.admin))));
    expect(told).toHaveLength(1);
    expect(told[0]!.count).toBe(1);
    await expect(life().startNow(s.id)).rejects.toThrow(/no planned section/);
    // Planning a section lets the next run start them.
    await life().setJoiningDay(s.id, { joinsOn: "2027-04-01", joinsSectionId: s4next });
    await due(s.id, 2);
    expect((await life().joinDue()).joined).toBeGreaterThanOrEqual(1);
    expect(await row(s.id)).toMatchObject({ status: "active", sectionId: s4next });
  });

  it("waits when the plan is full and starts once there is room", async () => {
    const c = await createTestSchool("admcorecap", FEATURES);
    const ids = await setup(c);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 1 }).where(eq(schools.id, c.id)));
    await svc(c).create({ name: "Only Seat", sectionId: ids.s4A });
    const j = await svc(c).create({ name: "No Room", sectionId: ids.s5next });
    await due(j.id, 1, c);
    expect((await life(c).joinDue()).waiting).toBe(1);
    expect((await row(j.id, c)).status).toBe("joining");
    await expect(life(c).startNow(j.id)).rejects.toThrow(/plan allows 1/);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 10 }).where(eq(schools.id, c.id)));
    expect((await life(c).joinDue()).joined).toBe(1);
  });

  it("one child that fails does not stop the others", async () => {
    const x = await due(( await joiner("Fails Tonight")).id), y = await due((await joiner("Starts Tonight")).id);
    const real = (LifecycleService.prototype as unknown as { joinOne: (...p: unknown[]) => Promise<unknown> }).joinOne;
    const spy = vi.spyOn(LifecycleService.prototype as unknown as { joinOne: typeof real }, "joinOne").mockImplementation(async function (this: unknown, id: unknown, ...rest: unknown[]) {
      if (id === x) throw new Error("boom");
      return real.call(this, id, ...rest);
    });
    const r = await life().joinDue();
    spy.mockRestore();
    expect(r.failed).toBe(1);
    expect((await row(y)).status).toBe("active");
    expect((await row(x)).status).toBe("joining");
  });

  it("start now, change the day, and withdraw before joining", async () => {
    const s = await joiner("Starts Now");
    await life().startNow(s.id);
    expect(await row(s.id)).toMatchObject({ status: "active", sectionId: s5next });
    await expect(life().startNow(s.id)).rejects.toThrow(/not waiting/);

    const t = await joiner("Moves Day");
    await expect(life().setJoiningDay(t.id, { joinsOn: addDays(today(), -3) })).rejects.toMatchObject({ fieldErrors: { joinsOn: expect.any(String) } });
    expect((await life().setJoiningDay(t.id, { joinsOn: "2027-04-10" })).joinsOn).toBe("2027-04-10");

    const w = await joiner("Never Came");
    await life().withdraw(w.id, { reason: "Family moved abroad" });
    const gone = await row(w.id);
    expect(gone).toMatchObject({ status: "left", leftReason: WITHDREW_BEFORE_JOINING, admissionNo: w.admissionNo });
    expect(WITHDREW_BEFORE_JOINING).toBe("withdrew before joining");
    expect((await enrol(w.id))[0]!.outcome).toBe("left");
    expect((await login(w.userId!)).status).toBe("disabled");
    // The number is never reused: the next admission gets a later one.
    expect((await svc().create({ name: "After Withdrawn" })).admissionNo).not.toBe(w.admissionNo);
    await expect(life().withdraw(w.id, { reason: "again" })).rejects.toThrow(/not waiting/);
  });
});

describe("A3 and A4: leaving", () => {
  it("A3: marking left closes the enrolment, keeps the section, sets the reason and the last day; reads by section ask for active", async () => {
    const s = await svc().create({ name: "Leaver One", sectionId: s4A });
    const before = await active();
    await life().markLeft(s.id, { reason: "moved_city", lastDay: addDays(today(), -5) });
    const gone = await row(s.id);
    expect(gone).toMatchObject({ status: "left", sectionId: s4A, leftOn: addDays(today(), -5), leftReason: "moved_city" });
    expect((await enrol(s.id))[0]).toMatchObject({ outcome: "left", sectionId: s4A });
    expect(await active()).toBe(before - 1);
    expect((await svc().list({ filters: { sectionId: s4A } })).rows.map((r) => r.id)).not.toContain(s.id);
    expect((await svc().list({ filters: { sectionId: s4A, status: "left" } })).rows.map((r) => r.id)).toContain(s.id);
    expect((await svc().overview(s.id)).leftReason).toBe("Moved to another city");
  });

  it("A4: the last day is today by default, may be past up to a year, never future; Other needs words", async () => {
    const s = await svc().create({ name: "Leaver Two", sectionId: s4A });
    await expect(life().markLeft(s.id, { reason: "fees", lastDay: tomorrow() })).rejects.toMatchObject({ fieldErrors: { lastDay: expect.any(String) } });
    await expect(life().markLeft(s.id, { reason: "fees", lastDay: addDays(today(), -400) })).rejects.toMatchObject({ fieldErrors: { lastDay: expect.any(String) } });
    await expect(life().markLeft(s.id, { reason: "other" })).rejects.toMatchObject({ fieldErrors: { note: expect.any(String) } });
    await expect(life().markLeft(s.id, {})).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await life().markLeft(s.id, { reason: "other", note: "Moved abroad" });
    expect(await row(s.id)).toMatchObject({ leftOn: today(), leftReason: "other", leftNote: "Moved abroad" });
    await expect(life().markLeft(s.id, { reason: "fees" })).rejects.toThrow(/already left/);
  });

  it("status is not an edit field any more", async () => {
    const s = await svc().create({ name: "Edit Status", sectionId: s4A });
    expect((await svc().update(s.id, { name: "Edit Status", status: "left" })).status).toBe("active");
  });

  it("bring back checks the plan, asks for a section of this year, reopens the enrolment and switches the login on", async () => {
    const s = await svc().create({ name: "Comes Back", sectionId: s4A });
    await life().markLeft(s.id, { reason: "changed_school" });
    await expect(life().bringBack(s.id, { sectionId: s5next })).rejects.toMatchObject({ fieldErrors: { sectionId: expect.any(String) } });
    await life().bringBack(s.id, { sectionId: s4B });
    expect(await row(s.id)).toMatchObject({ status: "active", sectionId: s4B, leftOn: null, leftReason: null });
    expect((await enrol(s.id))[0]).toMatchObject({ outcome: "studying", sectionId: s4B });
    expect((await login(s.userId!)).status).toBe("active");
    await expect(life().bringBack(s.id, { sectionId: s4B })).rejects.toThrow(/Only a student who left/);
  });

  it("promotion: counts joining children planned into the target, graduates as completed, and leaving carries a reason", async () => {
    const c = await createTestSchool("admcoreprom", FEATURES);
    const ids = await setup(c);
    const p = new PromotionService(c.as.admin);
    const stay = await svc(c).create({ name: "Moves Up", sectionId: ids.s4A });
    const out = await svc(c).create({ name: "Leaves Now", sectionId: ids.s4A });
    await svc(c).create({ name: "Planned In", sectionId: ids.s4next });
    const preview = await p.preview(ids.s4A);
    expect(preview.retainTargets.find((t) => t.id === ids.s4next)).toMatchObject({ now: 0, joining: 1 });
    const done = await p.promote({ fromSectionId: ids.s4A, retainedIds: [], retainSectionId: undefined, leftIds: [out.id], leftReason: "fees", toSectionId: ids.s5next });
    expect(done).toMatchObject({ promoted: 1, left: 1, target: { now: 1, joining: 0 } });
    expect(await row(out.id, c)).toMatchObject({ status: "left", leftReason: "fees" });
    expect((await enrol(out.id, c)).find((e) => e.yearId === ids.yearNow)!.outcome).toBe("left");
    expect((await row(stay.id, c)).sectionId).toBe(ids.s5next);
    const grad = await svc(c).create({ name: "Graduates", sectionId: ids.s12A });
    await p.promote({ fromSectionId: ids.s12A });
    expect(await row(grad.id, c)).toMatchObject({ status: "alumni", leftReason: "completed" });
    expect((await enrol(grad.id, c))[0]!.outcome).toBe("graduated");
  });
});

describe("A5, A6, A10, A12", () => {
  it("A5: the same name and birth date is refused with the first child's name and number; case and spaces do not matter", async () => {
    const first = await svc().create({ name: "Meera  Kapoor", dob: "2014-03-09", sectionId: s4A });
    const err = await svc().create({ name: "meera kapoor", dob: "2014-03-09", sectionId: s4A }).catch((e) => e);
    expect(err.message).toContain(first.admissionNo);
    expect(err.message).toContain("Meera  Kapoor");
    expect(err.fieldErrors).toMatchObject({ allowDuplicate: expect.any(String), _open: `/app/students/${first.id}` });
    await svc().create({ name: "Meera Kapoor", dob: "2014-03-10", sectionId: s4A }); // another birth date: fine
  });

  it("A5: a left match is refused too and offers their record; ticking different child allows it and writes the audit log", async () => {
    const first = await svc().create({ name: "Rohan Left", dob: "2013-01-01", sectionId: s4A });
    await life().markLeft(first.id, { reason: "changed_school" });
    await expect(svc().create({ name: "Rohan Left", dob: "2013-01-01" })).rejects.toMatchObject({ fieldErrors: { _open: `/app/students/${first.id}` } });
    const twin = await svc().create({ name: "Rohan Left", dob: "2013-01-01", allowDuplicate: "true" });
    const logs = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.entityId, twin.id), eq(auditLogs.action, "allow_duplicate"))));
    expect(logs).toHaveLength(1);
  });

  it("A5: editing a child is not a duplicate of themselves, but renaming into another child is", async () => {
    const x = await svc().create({ name: "Edit Self", dob: "2012-02-02", sectionId: s4A, pen: "ab123456789" });
    expect((await svc().update(x.id, { name: "Edit Self", dob: "2012-02-02", phone: "9800000001" })).phone).toBe("9800000001");
    await svc().create({ name: "Edit Other", dob: "2012-02-02", sectionId: s4A });
    await expect(svc().update(x.id, { name: "Edit Other" })).rejects.toMatchObject({ fieldErrors: { allowDuplicate: expect.any(String) } });
  });

  it("A5: two admissions of the same child at once make one", async () => {
    const make = () => svc().create({ name: "Parallel Child", dob: "2014-05-05", sectionId: s4A }).then(() => "ok", (e) => e.fieldErrors?.allowDuplicate ? "refused" : String(e));
    const results = await Promise.all([make(), make()]);
    expect(results.sort()).toEqual(["ok", "refused"]);
    expect((await svc().list({ q: "Parallel Child" })).total).toBe(1);
  });

  it("A6: a birth date in the future and an age outside 2 to 25 are refused; the class age is only a hint", async () => {
    await expect(svc().create({ name: "Future Baby", dob: addDays(today(), 30), sectionId: s4A })).rejects.toMatchObject({ fieldErrors: { dob: expect.stringContaining("future") } });
    await expect(svc().create({ name: "Newborn Twelve", dob: addDays(today(), -30), sectionId: s12A })).rejects.toMatchObject({ fieldErrors: { dob: expect.any(String) } });
    await expect(svc().create({ name: "Too Old", dob: "1990-01-01", sectionId: s12A })).rejects.toMatchObject({ fieldErrors: { dob: expect.any(String) } });
    const odd = await svc().admit({ name: "Young In Twelve", dob: "2018-01-01", sectionId: s12A });
    expect(odd.student.status).toBe("active");
    expect(odd.warnings[0]).toMatch(/Class 12 is usually for ages 15 to 19/);
    expect((await svc().admit({ name: "Right Age Four", dob: "2017-01-01", sectionId: s4A })).warnings).toEqual([]);
  });

  it("A6: age is taken on the joining day", async () => {
    await expect(svc().create({ name: "Not Yet Two", dob: "2026-06-01", sectionId: s5next })).rejects.toMatchObject({ fieldErrors: { dob: expect.any(String) } });
    expect((await svc().create({ name: "Two By Then", dob: "2025-01-01", classId: c4, joinsYearId: yearNext })).status).toBe("joining");
  });

  it("A10: two guardians on the admission form; one phone for both is linked once", async () => {
    const s = await svc().create({ name: "Two Parents", sectionId: s4A, guardianName: "Papa", guardianPhone: "9811200001", guardianRelation: "father", guardian2Name: "Mama", guardian2Phone: "9811200002", guardian2Relation: "mother" });
    const list = await new GuardianService(a.as.admin).forStudent(s.id);
    expect(list.map((g) => [g.name, g.isPrimary])).toEqual([["Papa", true], ["Mama", false]]);
    const same = await svc().create({ name: "One Phone", sectionId: s4A, guardianName: "Papa", guardianPhone: "9811200001", guardian2Name: "Mama", guardian2Phone: "+919811200001" });
    expect(await new GuardianService(a.as.admin).forStudent(same.id)).toHaveLength(1);
    await expect(svc().create({ name: "Half Second", guardian2Name: "Mama" })).rejects.toMatchObject({ fieldErrors: { guardian2Phone: expect.any(String) } });
  });

  it("A12: PEN is stored in capitals, checked for shape, kept out of the audit text, and erased with the rest", async () => {
    const s = await svc().create({ name: "Pen Child", sectionId: s4A, pen: "ab1 2345 6789" });
    expect(s.pen).toBe("AB123456789");
    await expect(svc().create({ name: "Bad Pen", pen: "123" })).rejects.toMatchObject({ fieldErrors: { pen: expect.any(String) } });
    expect((await svc().update(s.id, { name: "Pen Child", pen: "ZZ123456789" })).pen).toBe("ZZ123456789");
    const logged = JSON.stringify(await withSchool(a.id, (tx) => tx.select({ m: auditLogs.meta }).from(auditLogs).where(eq(auditLogs.entityId, s.id))));
    expect(logged).not.toContain("ZZ123456789");
    await expect(svc().eraseOptional(s.id, "Parent asked for it")).rejects.toThrow(/Mark the student as left/);
    await life().markLeft(s.id, { reason: "other", note: "Private reason words" });
    await svc().eraseOptional(s.id, "Parent asked for it");
    expect(await row(s.id)).toMatchObject({ pen: null, leftReason: null, status: "left" });
  });
});

describe("import", () => {
  const HEAD = "name,dob,class,section,joins_on,joins_year,pen,allow_duplicate,guardian2_name,guardian2_phone\n";
  it("takes the joining and PEN columns, the second guardian, and refuses a duplicate row unless allow_duplicate is yes", async () => {
    await svc().create({ name: "Already Here", dob: "2014-04-04", sectionId: s4A });
    const csv = HEAD + [
      "Imp Joiner,2015-01-01,Class 5,A,2027-04-01,2027-28,ab123456789,,Imp Mum,9811300001",
      "Imp Now,2015-01-02,Class 4,A,,,,,,",
      "already  here,2014-04-04,Class 4,A,,,,,,",
      "Already Here,2014-04-04,Class 4,A,,,,yes,,",
      "Imp Newborn,2026-10-01,Class 4,A,,,,,,",
      "Imp Twin,2015-03-03,Class 4,A,,,,,,",
      "imp twin,2015-03-03,Class 4,A,,,,,,",
    ].join("\n");
    const report = await new ImportService(a.as.admin).dryRun(csv);
    const msgs = report.rows.map((r) => r.errors.join(" | "));
    expect(msgs[0]).toBe("");
    expect(report.rows[0]!.classSection).toContain("joins");
    expect(msgs[1]).toBe("");
    expect(msgs[2]).toContain("already has this name and birth date");
    expect(msgs[3]).toBe("");
    expect(msgs[4]).toContain("dob:");
    expect(msgs[6]).toContain("same name and birth date as line");
    const good = csv.split("\n").slice(0, 3).join("\n").replace(/\nalready.*$/, "") + "\nAlready Here,2014-04-04,Class 4,A,,,,yes,,";
    await new ImportService(a.as.admin).commit(good);
    const [joiner] = (await svc().list({ q: "Imp Joiner" })).rows;
    expect(joiner).toMatchObject({ status: "joining", pen: "AB123456789", joinsSectionId: s5next, classId: c5 });
    expect(await new GuardianService(a.as.admin).forStudent(joiner!.id)).toHaveLength(1);
    expect((await svc().list({ q: "Imp Now" })).rows[0]!.status).toBe("active");
  });
});

describe("isolation and permission", () => {
  it("school B cannot start, withdraw, leave or bring back A's student, and its job does not touch A", async () => {
    const j = await joiner("Isolated Joiner");
    await due(j.id);
    for (const call of [() => life(b).startNow(j.id), () => life(b).withdraw(j.id, { reason: "no way" }), () => life(b).markLeft(j.id, { reason: "fees" }), () => life(b).bringBack(j.id, { sectionId: s4A })]) {
      await expect(call()).rejects.toBeTruthy();
    }
    await life(b).joinDue();
    expect((await row(j.id)).status).toBe("joining");
    expect((await svc(b).list({ q: "Isolated" })).total).toBe(0);
  });

  it("a custom role without students:write cannot admit later, start, leave or bring back", async () => {
    const s = await svc().create({ name: "Guarded", sectionId: s4A });
    const reader = { ...a.as.teacher, grants: new Set(["students:read"]) };
    const l = new LifecycleService(reader);
    await expect(l.markLeft(s.id, { reason: "fees" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(l.bringBack(s.id, { sectionId: s4A })).rejects.toMatchObject({ code: "forbidden" });
    await expect(l.startNow(s.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(l.joinDue()).rejects.toMatchObject({ code: "forbidden" });
    await expect(new StudentService(reader).create({ name: "Nope", sectionId: s5next })).rejects.toMatchObject({ code: "forbidden" });
    expect((await row(s.id)).status).toBe("active");
  });

  it("guardians of a joining child count as another child when erasing a sibling", async () => {
    const sib = await svc().create({ name: "Sib Joining", sectionId: s5next, guardianName: "Shared Parent", guardianPhone: "9811400001" });
    const old = await svc().create({ name: "Sib Leaving", sectionId: s4A, guardianName: "Shared Parent", guardianPhone: "9811400001" });
    await life().markLeft(old.id, { reason: "changed_school" });
    const preview = await svc().erasePreview(old.id);
    expect(preview.guardians[0]).toMatchObject({ blanked: false });
    expect(sib.status).toBe("joining");
    const [g] = await withSchool(a.id, (tx) => tx.select().from(guardians).where(eq(guardians.phone, "9811400001")));
    expect(g).toBeTruthy();
  });
});
