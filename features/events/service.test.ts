import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { classes } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { istDay, toInputValue } from "./dates";
import { EventService } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["events"])); });
afterAll(closeDb);

const admin = () => new EventService(a.as.admin);
const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const stamp = (d: Date) => toInputValue(d);

describe("EventService", () => {
  it("staff write; students and parents cannot", async () => {
    await expect(new EventService(a.as.teacher).create({ title: "Quiz", startsAt: stamp(future(3)) })).resolves.toMatchObject({ title: "Quiz" });
    await expect(new EventService(a.as.student).create({ title: "Hello", startsAt: stamp(future(1)) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EventService(a.as.parent).create({ title: "Hello", startsAt: stamp(future(1)) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("students and parents see their audience and every holiday, not staff-only events", async () => {
    await admin().create({ title: "Staff retreat", startsAt: stamp(future(5)), audience: "staff" });
    await admin().create({ title: "Parents evening", startsAt: stamp(future(5)), audience: "parents" });
    await admin().create({ title: "Staff-only holiday", startsAt: stamp(future(6)), audience: "staff", isHoliday: "true" });
    const student = (await new EventService(a.as.student).list({ pageSize: 100 })).rows.map((r) => r.title);
    expect(student).not.toContain("Staff retreat");
    expect(student).not.toContain("Parents evening");
    expect(student).toContain("Staff-only holiday");
    const parent = (await new EventService(a.as.parent).list({ pageSize: 100 })).rows.map((r) => r.title);
    expect(parent).toContain("Parents evening");
  });

  it("validates class audience and end before start", async () => {
    await expect(admin().create({ title: "Class trip", startsAt: stamp(future(2)), audience: "class" })).rejects.toMatchObject({ fieldErrors: { classId: expect.any(String) } });
    await expect(admin().create({ title: "Backwards", startsAt: stamp(future(4)), endsAt: stamp(future(2)) })).rejects.toMatchObject({ fieldErrors: { endsAt: expect.any(String) } });
    await expect(admin().create({ title: "No date" })).rejects.toMatchObject({ fieldErrors: { startsAt: expect.any(String) } });
  });

  it("a holiday is all-day and a multi-day span covers whole IST days", async () => {
    const h = await admin().create({ title: "Winter break", startsAt: "2027-01-02T15:30", endsAt: "2027-01-04T01:00", isHoliday: "true" });
    expect(h.allDay).toBe(true);
    expect(istDay(h.startsAt)).toBe("2027-01-02");
    expect(istDay(h.endsAt!)).toBe("2027-01-04");
    expect(toInputValue(h.startsAt)).toBe("2027-01-02T00:00");
    expect(toInputValue(h.endsAt!)).toBe("2027-01-04T23:59");
  });

  it("month() returns what touches the month, holidays() only holidays in range", async () => {
    await admin().create({ title: "Mar sports", startsAt: "2027-03-10T09:00", endsAt: "2027-03-10T12:00" });
    await admin().create({ title: "Mar spanning", startsAt: "2027-02-27", endsAt: "2027-03-02", allDay: "true" });
    await admin().create({ title: "Mar holiday", startsAt: "2027-03-14", isHoliday: "true" });
    await admin().create({ title: "April event", startsAt: "2027-04-01T09:00" });
    const titles = (await admin().month("2027-03")).map((e) => e.title);
    expect(titles).toEqual(expect.arrayContaining(["Mar sports", "Mar spanning", "Mar holiday"]));
    expect(titles).not.toContain("April event");
    const hol = (await admin().holidays("2027-03-01", "2027-03-31")).map((e) => e.title);
    expect(hol).toEqual(["Mar holiday"]);
    await expect(admin().month("2027-13")).rejects.toMatchObject({ code: expect.any(String) });
  });

  it("upcoming() skips past events and is soonest first", async () => {
    await admin().create({ title: "Long ago", startsAt: "2020-01-01T09:00" });
    await admin().create({ title: "Next week", startsAt: stamp(future(7)) });
    await admin().create({ title: "Tomorrow", startsAt: stamp(future(1)) });
    const titles = (await admin().upcoming(50)).map((e) => e.title);
    expect(titles).not.toContain("Long ago");
    expect(titles.indexOf("Tomorrow")).toBeLessThan(titles.indexOf("Next week"));
  });

  it("publicEvents() lists only public upcoming events", async () => {
    await admin().create({ title: "Open day", startsAt: stamp(future(9)), isPublic: "true" });
    await admin().create({ title: "Private day", startsAt: stamp(future(9)) });
    const titles = (await admin().publicEvents()).map((e) => e.title);
    expect(titles).toContain("Open day");
    expect(titles).not.toContain("Private day");
  });

  it("a class event drops its class when the audience changes", async () => {
    const classId = "0190f3a0-0000-7000-8000-000000000001";
    const e = await admin().create({ title: "Class 5 trip", startsAt: stamp(future(3)), audience: "class", classId });
    expect(e.classId).toBe(classId);
    const u = await admin().update(e.id, { title: "Class 5 trip", startsAt: stamp(future(3)), audience: "all", classId });
    expect(u.classId).toBeNull();
  });

  it("isolation: school B cannot see or change school A's events", async () => {
    const x = await admin().create({ title: "A only", startsAt: stamp(future(2)) });
    const bSvc = new EventService(b.as.admin);
    expect((await bSvc.list({ pageSize: 100 })).rows.some((r) => r.id === x.id)).toBe(false);
    expect((await bSvc.month(istDay(x.startsAt).slice(0, 7))).some((r) => r.id === x.id)).toBe(false);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(x.id, { title: "Hacked", startsAt: stamp(future(2)) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("class events", () => {
  it("reach only that class's students and guardians", async () => {
    const [c5, c6] = await withSchool(a.id, async (tx) => {
      const cs = await tx.insert(classes).values([{ schoolId: a.id, name: "Class 5", grade: 5 }, { schoolId: a.id, name: "Class 6", grade: 6 }]).returning();
      const [kid] = await tx.insert(students).values({ schoolId: a.id, admissionNo: "E1", name: "Aarav", classId: cs[0]!.id, userId: a.users.student }).returning();
      const [g] = await tx.insert(guardians).values({ schoolId: a.id, name: "Parent", userId: a.users.parent }).returning();
      await tx.insert(studentGuardians).values({ schoolId: a.id, studentId: kid!.id, guardianId: g!.id });
      return cs.map((c) => c.id);
    });
    await admin().create({ title: "Class 5 picnic", startsAt: stamp(future(4)), audience: "class", classId: c5 });
    await admin().create({ title: "Class 6 picnic", startsAt: stamp(future(4)), audience: "class", classId: c6 });
    for (const who of [a.as.student, a.as.parent]) {
      const seen = (await new EventService(who).list({ pageSize: 100 })).rows.map((r) => r.title);
      expect(seen).toContain("Class 5 picnic");
      expect(seen).not.toContain("Class 6 picnic");
    }
    expect((await new EventService(a.as.teacher).list({ pageSize: 100 })).rows.map((r) => r.title)).toEqual(expect.arrayContaining(["Class 5 picnic", "Class 6 picnic"]));
  });

  it("the class picker lists this school's classes by name and nobody else's", async () => {
    const names = (await admin().classOptions()).map((c) => c.label);
    expect(names).toEqual(expect.arrayContaining(["Class 5", "Class 6"]));
    expect(await new EventService(b.as.admin).classOptions()).toEqual([]);
  });
});
