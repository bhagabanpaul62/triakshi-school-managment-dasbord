import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import {
  AcademicYearService, ClassService, ClassSubjectService, SectionService, SectionTeacherService,
  SubjectService, TermService, YearRolloverService,
} from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["academics"])); });
afterAll(closeDb);

describe("years and terms", () => {
  it("defaults to April-March, the first year is current, and only one is ever current", async () => {
    const svc = new AcademicYearService(a.as.admin);
    const y1 = await svc.create({ name: "2025-26" });
    expect(y1).toMatchObject({ startsOn: "2025-04-01", endsOn: "2026-03-31", isCurrent: true });
    const y2 = await svc.create({ name: "2026-27", isCurrent: "true" });
    expect((await svc.current())?.id).toBe(y2.id);
    await svc.setCurrent(y1.id);
    const current = (await svc.list()).rows.filter((y) => y.isCurrent);
    expect(current.map((y) => y.name)).toEqual(["2025-26"]);
  });

  it("rejects bad names, duplicates and deleting the current year", async () => {
    const svc = new AcademicYearService(a.as.admin);
    await expect(svc.create({ name: "2026-30" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "2025-26" })).rejects.toBeInstanceOf(ConflictError);
    const cur = (await svc.current())!;
    await expect(svc.remove(cur.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("adds default terms and keeps terms inside the year", async () => {
    const years = new AcademicYearService(a.as.admin);
    const terms = new TermService(a.as.admin);
    const y = (await years.current())!;
    const added = await terms.addDefaults(y.id);
    expect(added.map((t) => [t.name, t.startsOn, t.endsOn])).toEqual([["Term 1", "2025-04-01", "2025-09-30"], ["Term 2", "2025-10-01", "2026-03-31"]]);
    expect(await terms.addDefaults(y.id)).toEqual([]); // names already there are skipped
    expect((await terms.list({ filters: { yearId: y.id } })).total).toBe(2);
    await expect(terms.create({ yearId: y.id, name: "Late", startsOn: "2026-02-01", endsOn: "2026-05-01" })).rejects.toMatchObject({ fieldErrors: { endsOn: expect.any(String) } });
    await expect(terms.create({ yearId: y.id, name: "Backwards", startsOn: "2025-08-01", endsOn: "2025-07-01" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("classes, sections and subjects", () => {
  it("adds the Indian presets once", async () => {
    const svc = new ClassService(a.as.admin);
    expect(await svc.addPresets()).toEqual({ added: 15 });
    expect(await svc.addPresets()).toEqual({ added: 0 });
    const opts = await svc.options();
    expect(opts.map((o) => o.label).slice(0, 4)).toEqual(["Nursery", "LKG", "UKG", "Class 1"]);
    expect(opts.at(-1)?.label).toBe("Class 12");
  });

  it("creates sections for the current year with a teacher-only class teacher", async () => {
    const classes = new ClassService(a.as.admin);
    const five = (await classes.list({ q: "Class 5" })).rows[0]!;
    const svc = new SectionService(a.as.admin);
    const sec = await svc.create({ classId: five.id, name: "A", capacity: "35", classTeacherId: a.users.teacher, room: "R-12" });
    expect(sec).toMatchObject({ capacity: 35, classTeacherId: a.users.teacher });
    await expect(svc.create({ classId: five.id, name: "A" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.create({ classId: five.id, name: "B", classTeacherId: a.users.student })).rejects.toMatchObject({ fieldErrors: { classTeacherId: expect.any(String) } });
    const [row] = await svc.forClass(five.id);
    expect(row?.teacherName).toBe("teacher a");
    expect((await svc.options()).map((o) => o.label)).toContain("Class 5 - A");
    const stats = await classes.stats([five.id]);
    expect(stats[five.id]).toEqual({ sections: 1, capacity: 35, students: 0, subjects: 0, noClassTeacher: 0, unstaffed: 0 });
    // clearing the teacher through the edit form
    const cleared = await svc.update(sec.id, { name: "A", capacity: "35" });
    expect(cleared.classTeacherId).toBeNull();
  });

  it("adds board presets and rejects duplicate subjects", async () => {
    const svc = new SubjectService(a.as.admin);
    expect((await svc.addPreset({ board: "CBSE" })).added).toBe(10);
    expect((await svc.addPreset({ board: "CBSE" })).added).toBe(0);
    await expect(svc.addPreset({ board: "IB" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "English" })).rejects.toBeInstanceOf(ConflictError);
    const art = (await svc.list({ q: "Art" })).rows[0]!;
    expect(art.kind).toBe("co_scholastic");
  });

  it("subject teachers: only teachers, only subjects the class studies, clearable, and removed with the subject", async () => {
    const five = (await new ClassService(a.as.admin).list({ q: "Class 5" })).rows[0]!;
    const english = (await new SubjectService(a.as.admin).list({ q: "English" })).rows[0]!;
    const maths = (await new SubjectService(a.as.admin).list({ q: "Mathematics" })).rows[0]!;
    const sec = (await new SectionService(a.as.admin).forClass(five.id))[0]!;
    const cs = new ClassSubjectService(a.as.admin);
    const st = new SectionTeacherService(a.as.admin);

    await expect(st.assign({ sectionId: sec.id, subjectId: english.id, teacherId: a.users.teacher })).rejects.toBeInstanceOf(ConflictError);
    expect(await cs.assign({ classId: five.id, subjectIds: [english.id, maths.id] })).toEqual({ added: 2 });
    expect(await cs.assign({ classId: five.id, subjectIds: [english.id] })).toEqual({ added: 0 });
    await expect(st.assign({ sectionId: sec.id, subjectId: english.id, teacherId: a.users.accountant })).rejects.toMatchObject({ fieldErrors: { teacherId: expect.any(String) } });

    await st.assign({ sectionId: sec.id, subjectId: english.id, teacherId: a.users.teacher });
    await st.assign({ sectionId: sec.id, subjectId: english.id, teacherId: a.users.teacher }); // again: updates, no duplicate
    expect((await st.matrix(five.id)).cells[`${sec.id}:${english.id}`]).toBe(a.users.teacher);
    await st.assign({ sectionId: sec.id, subjectId: english.id });
    expect((await st.matrix(five.id)).cells).toEqual({});

    await st.assign({ sectionId: sec.id, subjectId: maths.id, teacherId: a.users.teacher });
    const link = (await cs.forClass(five.id)).find((s) => s.subjectId === maths.id)!;
    await cs.remove(link.id);
    const m = await st.matrix(five.id);
    expect(m.subjects.map((s) => s.name)).toEqual(["English"]);
    expect(m.cells).toEqual({});
  });
});

describe("year rollover", () => {
  it("creates the next year with terms and copies sections forward", async () => {
    const roll = new YearRolloverService(a.as.admin);
    await expect(roll.rollForward()).rejects.toBeInstanceOf(ConflictError); // 2026-27 already exists
    const cur = (await new AcademicYearService(a.as.admin).current())!;
    const sections = new SectionService(a.as.admin);
    const old = (await sections.list({ filters: { yearId: cur.id } })).rows;
    const r = await roll.rollForward("2027-28");
    expect(r.year).toMatchObject({ name: "2027-28", isCurrent: false, startsOn: "2027-04-01", endsOn: "2028-03-31" });
    expect(r.sections).toBe(old.length);
    const copied = (await sections.list({ filters: { yearId: r.year.id } })).rows;
    expect(copied.map((s) => [s.classId, s.name, s.capacity])).toEqual(old.map((s) => [s.classId, s.name, s.capacity]));
    expect((await new TermService(a.as.admin).list({ filters: { yearId: r.year.id } })).total).toBe(2);
    expect((await new AcademicYearService(a.as.admin).current())?.id).toBe(cur.id);
  });
});

describe("permissions", () => {
  it("everyone reads, only the admin manages", async () => {
    expect((await new ClassService(a.as.student).list()).total).toBeGreaterThan(0);
    expect((await new SectionService(a.as.teacher).options()).length).toBeGreaterThan(0);
    await expect(new SectionService(a.as.parent).options()).rejects.toBeInstanceOf(ForbiddenError); // legacy parent logins are disabled
    for (const who of [a.as.teacher, a.as.student, a.as.parent, a.as.accountant]) {
      await expect(new ClassService(who).create({ name: "Class 99", grade: 12 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ClassService(who).addPresets()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new AcademicYearService(who).setCurrent(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new YearRolloverService(who).rollForward("2030-31")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SectionTeacherService(who).assign({ sectionId: a.users.admin, subjectId: a.users.admin })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("isolation", () => {
  it("school B cannot list, get, change or delete school A's rows", async () => {
    const aClass = (await new ClassService(a.as.admin).list({ q: "Class 5" })).rows[0]!;
    const aYear = (await new AcademicYearService(a.as.admin).current())!;
    const aSection = (await new SectionService(a.as.admin).forClass(aClass.id))[0]!;
    const aSubject = (await new SubjectService(a.as.admin).list({ q: "English" })).rows[0]!;

    expect((await new ClassService(b.as.admin).list()).total).toBe(0);
    expect(await new AcademicYearService(b.as.admin).current()).toBeNull();
    expect(await new SectionService(b.as.admin).options()).toEqual([]);
    await expect(new ClassService(b.as.admin).get(aClass.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ClassService(b.as.admin).update(aClass.id, { name: "Hacked", grade: 5 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ClassService(b.as.admin).remove(aClass.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AcademicYearService(b.as.admin).setCurrent(aYear.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SectionService(b.as.admin).get(aSection.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubjectService(b.as.admin).remove(aSubject.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SectionService(b.as.admin).create({ classId: aClass.id, name: "Z" })).rejects.toBeInstanceOf(ConflictError); // no current year in B
    expect((await new ClassService(a.as.admin).get(aClass.id)).name).toBe("Class 5");
  });
});

describe("isolation of the remaining services", () => {
  it("school B cannot see, change or link school A's terms, subject links and subject teachers", async () => {
    const aYear = (await new AcademicYearService(a.as.admin).current())!;
    const aClass = (await new ClassService(a.as.admin).list({ q: "Class 5" })).rows[0]!;
    const aSection = (await new SectionService(a.as.admin).forClass(aClass.id))[0]!;
    const aSubject = (await new SubjectService(a.as.admin).list({ q: "English" })).rows[0]!;
    const aTerm = (await new TermService(a.as.admin).list({ filters: { yearId: aYear.id } })).rows[0]!;
    await new ClassSubjectService(a.as.admin).assign({ classId: aClass.id, subjectIds: [aSubject.id] });
    await new SectionTeacherService(a.as.admin).assign({ sectionId: aSection.id, subjectId: aSubject.id, teacherId: a.users.teacher });
    const aLink = (await new ClassSubjectService(a.as.admin).forClass(aClass.id))[0]!;

    const terms = new TermService(b.as.admin), links = new ClassSubjectService(b.as.admin), st = new SectionTeacherService(b.as.admin);
    expect((await terms.list()).total).toBe(0);
    await expect(terms.get(aTerm.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(terms.update(aTerm.id, { name: "x", startsOn: "2026-04-01", endsOn: "2026-05-01" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(terms.remove(aTerm.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(terms.addDefaults(aYear.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await links.forClass(aClass.id)).toEqual([]);
    await expect(links.remove(aLink.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await st.matrix(aClass.id)).cells).toEqual({});
    await expect(st.assign({ sectionId: aSection.id, subjectId: aSubject.id, teacherId: b.users.teacher })).rejects.toBeInstanceOf(NotFoundError);
    expect((await new SectionTeacherService(a.as.admin).matrix(aClass.id)).cells[`${aSection.id}:${aSubject.id}`]).toBe(a.users.teacher);
  });

  it("school B cannot hang its rows on school A's ids (foreign keys skip row-level security)", async () => {
    const aClass = (await new ClassService(a.as.admin).list({ q: "Class 5" })).rows[0]!;
    const aSubject = (await new SubjectService(a.as.admin).list({ q: "English" })).rows[0]!;
    await new AcademicYearService(b.as.admin).create({ name: "2026-27" });
    const bClass = await new ClassService(b.as.admin).create({ name: "Class 1", grade: 1 });
    const bSubject = await new SubjectService(b.as.admin).create({ name: "Maths" });
    await expect(new SectionService(b.as.admin).create({ classId: aClass.id, name: "A" })).rejects.toMatchObject({ fieldErrors: { classId: expect.any(String) } });
    await expect(new ClassSubjectService(b.as.admin).assign({ classId: bClass.id, subjectIds: [aSubject.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ClassSubjectService(b.as.admin).create({ classId: aClass.id, subjectId: bSubject.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ClassSubjectService(b.as.admin).create({ classId: bClass.id, subjectId: aSubject.id })).rejects.toBeInstanceOf(ValidationError);
    expect((await new SectionService(a.as.admin).forClass(aClass.id)).length).toBeGreaterThan(0);
  });
});
