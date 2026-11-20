// Every academics entity: its new fields, update and delete paths, the "in use" guards, the closed-year rule and isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import {
  AcademicYearService, ClassService, ClassSubjectService, HouseService, SectionService, SectionTeacherService, SubjectGroupService, SubjectService, TermService, YearRolloverService,
} from "./service";
import { stageOf } from "./presets";

let a: TestSchool, b: TestSchool;
let year: string;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["academics", "students"], "c"));
  year = (await new AcademicYearService(a.as.admin).create({ name: "2026-27" })).id;
  await new AcademicYearService(b.as.admin).create({ name: "2026-27" });
});
afterAll(closeDb);

const addStudent = async (school: TestSchool, classId: string, sectionId: string) => {
  const id = uuidv7();
  await withSchool(school.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id) values (${id}, ${school.id}, ${"C" + id.slice(-6)}, 'Kid', ${classId}, ${sectionId})`));
  return id;
};

describe("years", () => {
  it("has a status, and a closed year is read-only until reopened", async () => {
    const svc = new AcademicYearService(a.as.admin);
    const y = await svc.create({ name: "2027-28" });
    expect(y.status).toBe("active");
    const terms = new TermService(a.as.admin);
    const t = await terms.create({ yearId: y.id, name: "Term 1", startsOn: "2027-04-01", endsOn: "2027-09-30" });
    const cls = await new ClassService(a.as.admin).create({ name: "Class 3", grade: 3 });
    const sec = await new SectionService(a.as.admin).create({ classId: cls.id, yearId: y.id, name: "A" });

    const closed = await svc.update(y.id, { name: "2027-28", status: "closed" });
    expect(closed.status).toBe("closed");
    await expect(svc.update(y.id, { name: "2027-28", startsOn: "2027-04-02" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.setCurrent(y.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(terms.create({ yearId: y.id, name: "Term 2", startsOn: "2027-10-01", endsOn: "2028-03-31" })).rejects.toBeInstanceOf(ConflictError);
    await expect(terms.update(t.id, { name: "Renamed", startsOn: "2027-04-01", endsOn: "2027-09-30" })).rejects.toBeInstanceOf(ConflictError);
    await expect(terms.remove(t.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(terms.addDefaults(y.id)).rejects.toBeInstanceOf(ConflictError);
    const sections = new SectionService(a.as.admin);
    await expect(sections.create({ classId: cls.id, yearId: y.id, name: "B" })).rejects.toBeInstanceOf(ConflictError);
    await expect(sections.update(sec.id, { name: "A", capacity: "30" })).rejects.toBeInstanceOf(ConflictError);
    await expect(sections.assignClassTeacher({ sectionId: sec.id, teacherId: a.users.teacher })).rejects.toBeInstanceOf(ConflictError);
    await expect(sections.remove(sec.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(new SectionTeacherService(a.as.admin).remove(sec.id)).rejects.toBeInstanceOf(NotFoundError);

    await svc.update(y.id, { name: "2027-28", status: "active" }); // reopen
    await sections.update(sec.id, { name: "A", capacity: "30" });
    await terms.remove(t.id);
    await sections.remove(sec.id);
    await svc.remove(y.id);
  });

  it("cannot close the current year, and rollover starts the new year in planning", async () => {
    const svc = new AcademicYearService(a.as.admin);
    await expect(svc.update(year, { name: "2026-27", status: "closed" })).rejects.toBeInstanceOf(ConflictError);
    const r = await new YearRolloverService(a.as.admin).rollForward("2030-31");
    expect(r.year.status).toBe("planning");
    expect((await svc.list({ filters: { status: "planning" } })).rows.map((y) => y.name)).toEqual(["2030-31"]);
    await expect(svc.update(r.year.id, { name: "2030-31", status: "dormant" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to delete a year that has history, and says to close it", async () => {
    const svc = new AcademicYearService(a.as.admin);
    const y = await svc.create({ name: "2028-29" });
    const cls = await new ClassService(a.as.admin).create({ name: "Class 4", grade: 4 });
    const sec = await new SectionService(a.as.admin).create({ classId: cls.id, yearId: y.id, name: "A" });
    const stu = await addStudent(a, cls.id, sec.id);
    await withSchool(a.id, (tx) => tx.execute(sql`insert into student_enrollments (id, school_id, student_id, year_id, class_id, section_id) values (${uuidv7()}, ${a.id}, ${stu}, ${y.id}, ${cls.id}, ${sec.id})`));
    await expect(svc.remove(y.id)).rejects.toThrow(/in use \(1 student enrolments\)/);
  });
});

describe("terms", () => {
  it("get an order: next by default, editable, listed by it", async () => {
    const terms = new TermService(a.as.admin);
    const y = await new AcademicYearService(a.as.admin).create({ name: "2031-32" });
    const t1 = await terms.create({ yearId: y.id, name: "Second", startsOn: "2031-10-01", endsOn: "2032-03-31" });
    const t2 = await terms.create({ yearId: y.id, name: "First", startsOn: "2031-04-01", endsOn: "2031-09-30", sortOrder: "0" });
    expect([t1.sortOrder, t2.sortOrder]).toEqual([1, 0]);
    await terms.update(t1.id, { name: "Second", startsOn: "2031-10-01", endsOn: "2032-03-31", sortOrder: "5" });
    expect((await terms.list({ filters: { yearId: y.id }, sort: "sortOrder", dir: "asc" })).rows.map((t) => t.name)).toEqual(["First", "Second"]);
    expect((await terms.list({ q: "first" })).rows.map((t) => t.name)).toEqual(["First"]);
    await terms.remove(t1.id);
  });
});

describe("classes", () => {
  it("keep display order, stage and board override; the stage derives from the grade", async () => {
    const svc = new ClassService(a.as.admin);
    const c = await svc.create({ name: "Class 11 Sci", grade: 11 });
    expect(c).toMatchObject({ displayOrder: 11, stage: null, boardOverride: null });
    expect([-2, 0, 1, 5, 6, 8, 9, 10, 11, 12].map(stageOf)).toEqual(["pre_primary", "pre_primary", "primary", "primary", "middle", "middle", "secondary", "secondary", "senior_secondary", "senior_secondary"]);
    const u = await svc.update(c.id, { name: "Class 11 Sci", grade: "11", displayOrder: "1", stage: "secondary", boardOverride: "ICSE" });
    expect(u).toMatchObject({ displayOrder: 1, stage: "secondary", boardOverride: "ICSE" });
    expect((await svc.list({ filters: { stage: "secondary" } })).rows.map((x) => x.id)).toContain(c.id);
    const cleared = await svc.update(c.id, { name: "Class 11 Sci", grade: "11", stage: "", boardOverride: "" });
    expect(cleared).toMatchObject({ stage: null, boardOverride: null, displayOrder: 1 }); // order kept when the form leaves it blank
    await expect(svc.update(c.id, { name: "x", grade: "11", stage: "college" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.update(c.id, { name: "x", grade: "11", boardOverride: "IB" })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.options()).map((o) => o.label).indexOf("Class 11 Sci")).toBeLessThan((await svc.options()).map((o) => o.label).indexOf("Class 3"));
  });

  it("cannot be deleted while it has sections, students or exam papers", async () => {
    const svc = new ClassService(a.as.admin);
    const c = await svc.create({ name: "Class 9", grade: 9 });
    const sec = await new SectionService(a.as.admin).create({ classId: c.id, name: "A" });
    await expect(svc.remove(c.id)).rejects.toThrow(/in use \(1 sections\)/);
    await addStudent(a, c.id, sec.id);
    await expect(new SectionService(a.as.admin).remove(sec.id)).rejects.toThrow(/in use \(1 students\)/);
    const empty = await svc.create({ name: "Class 8", grade: 8 });
    await svc.remove(empty.id);
  });
});

describe("sections", () => {
  it("keep medium, shift and stream label, and the class-teacher shortcut touches only the teacher", async () => {
    const cls = await new ClassService(a.as.admin).create({ name: "Class 12", grade: 12 });
    const svc = new SectionService(a.as.admin);
    const s = await svc.create({ classId: cls.id, name: "A", room: "R2", medium: "Hindi", shift: "afternoon", streamLabel: "Commerce" });
    expect(s).toMatchObject({ medium: "Hindi", shift: "afternoon", streamLabel: "Commerce" });
    const t = await svc.assignClassTeacher({ sectionId: s.id, teacherId: a.users.teacher });
    expect(t).toMatchObject({ classTeacherId: a.users.teacher, medium: "Hindi", shift: "afternoon", streamLabel: "Commerce", room: "R2" });
    await expect(svc.update(s.id, { name: "A", shift: "night" })).rejects.toBeInstanceOf(ValidationError);
    const cleared = await svc.update(s.id, { name: "A", capacity: "35", medium: "", shift: "", streamLabel: "" });
    expect(cleared).toMatchObject({ capacity: 35, medium: null, shift: null, streamLabel: null, room: null, classTeacherId: null });
    await svc.update(s.id, { name: "A", shift: "morning" });
    expect((await svc.list({ filters: { shift: "morning" } })).rows.map((x) => x.id)).toEqual([s.id]);
    expect((await svc.list({ q: "morning" })).total).toBe(0); // search covers name, room, medium and stream, not shift
    await svc.update(s.id, { name: "A", medium: "Bengali" });
    expect((await svc.list({ q: "benga" })).rows.map((x) => x.id)).toEqual([s.id]);
    await expect(svc.assignClassTeacher({ sectionId: s.id, teacherId: a.users.accountant })).rejects.toBeInstanceOf(ValidationError);
    expect((await new SectionService(a.as.admin).forClass(cls.id))[0]).toMatchObject({ medium: "Bengali" });
    await svc.remove(s.id);
  });
});

describe("subjects", () => {
  it("keep the extra fields and check marks against the type", async () => {
    const svc = new SubjectService(a.as.admin);
    const s = await svc.create({ name: "Physics", code: "PHY", shortName: "Phy", type: "both", maxMarksTheory: "70", maxMarksPractical: "30", boardCode: "042", tone: "info", isLanguage: "false" });
    expect(s).toMatchObject({ shortName: "Phy", type: "both", maxMarksTheory: 70, maxMarksPractical: 30, boardCode: "042", tone: "info", isLanguage: false });
    const plain = await svc.create({ name: "Hindi" });
    expect(plain).toMatchObject({ type: "theory", tone: null, isLanguage: false, maxMarksTheory: null });
    const lang = await svc.update(plain.id, { name: "Hindi", isLanguage: "true", maxMarksTheory: "100", tone: "success" });
    expect(lang).toMatchObject({ isLanguage: true, maxMarksTheory: 100, tone: "success" });
    await expect(svc.update(plain.id, { name: "Hindi", maxMarksPractical: "20" })).rejects.toMatchObject({ fieldErrors: { maxMarksPractical: expect.any(String) } });
    await expect(svc.create({ name: "Lab", type: "practical", maxMarksTheory: "10" })).rejects.toMatchObject({ fieldErrors: { maxMarksTheory: expect.any(String) } });
    await expect(svc.create({ name: "Bad", tone: "purple" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "Bad", maxMarksTheory: "5000" })).rejects.toBeInstanceOf(ValidationError);
    const cleared = await svc.update(s.id, { name: "Physics", type: "theory" });
    expect(cleared).toMatchObject({ shortName: null, boardCode: null, tone: null, maxMarksTheory: null, maxMarksPractical: null, code: null });
    expect((await svc.list({ filters: { type: "theory" }, q: "phys" })).rows.map((x) => x.name)).toEqual(["Physics"]);
    expect((await svc.list({ q: "Hi" })).rows.map((x) => x.name)).toContain("Hindi");
  });

  it("cannot be deleted while a class studies it", async () => {
    const svc = new SubjectService(a.as.admin);
    const s = await svc.create({ name: "Civics" });
    const cls = await new ClassService(a.as.admin).create({ name: "Class 7", grade: 7 });
    const links = new ClassSubjectService(a.as.admin);
    await links.assign({ classId: cls.id, subjectIds: [s.id] });
    await expect(svc.remove(s.id)).rejects.toThrow(/in use \(1 classes\)/);
    await links.remove((await links.forClass(cls.id))[0]!.id);
    await svc.remove(s.id);
  });
});

describe("subject groups", () => {
  it("rename and change their subjects; students gain and lose subjects with them", async () => {
    const cls = await new ClassService(a.as.admin).create({ name: "Class 11 Arts", grade: 11 });
    const sec = await new SectionService(a.as.admin).create({ classId: cls.id, name: "A" });
    const subs = new SubjectService(a.as.admin);
    const [h, e, p] = await Promise.all(["History", "Economics", "Pol Sci"].map((name) => subs.create({ name })));
    const links = new ClassSubjectService(a.as.admin);
    await links.assign({ classId: cls.id, subjectIds: [h!.id, e!.id, p!.id] });
    for (const r of await links.forClass(cls.id)) await links.setElective({ id: r.id, isElective: "true" });
    const g = new SubjectGroupService(a.as.admin);
    const grp = await g.create({ classId: cls.id, name: "Humanities", subjectIds: [h!.id, e!.id] });
    const stu = await addStudent(a, cls.id, sec.id);
    await g.assign({ studentId: stu, groupId: grp.id });
    const names = async () => (await g.subjectsForStudent(stu)).map((s) => s.name);
    expect(await names()).toEqual(["Economics", "History"]);

    await g.update(grp.id, { name: "Arts", subjectIds: [e!.id, p!.id] });
    expect((await g.forClass(cls.id))[0]).toMatchObject({ name: "Arts", subjects: [{ name: "Economics" }, { name: "Pol Sci" }] });
    expect(await names()).toEqual(["Economics", "Pol Sci"]);
    await expect(g.update(grp.id, { name: "Arts", subjectIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(g.update(grp.id, { name: "Arts", subjectIds: [uuidv7()] })).rejects.toBeInstanceOf(ValidationError);
    await g.create({ classId: cls.id, name: "Other", subjectIds: [h!.id] });
    await expect(g.update(grp.id, { name: "Other", subjectIds: [e!.id] })).rejects.toBeInstanceOf(ConflictError);
    expect((await g.list({ filters: { classId: cls.id }, q: "oth" })).rows.map((x) => x.name)).toEqual(["Other"]);

    // a student's own picks, outside any group
    const stu2 = await addStudent(a, cls.id, sec.id);
    expect(await g.setChoices({ studentId: stu2, subjectIds: [h!.id] })).toMatchObject({ count: 1 });
    expect((await g.subjectsForStudent(stu2)).map((s) => s.name)).toEqual(["History"]);
    await g.setChoices({ studentId: stu2, subjectIds: [p!.id, e!.id] });
    expect((await g.subjectsForStudent(stu2)).map((s) => s.name)).toEqual(["Economics", "Pol Sci"]);
    // the class page roster shows the group and the own picks separately
    const rows = new Map((await g.roster(sec.id)).map((r) => [r.id, r]));
    expect(rows.get(stu)).toMatchObject({ groupId: grp.id, picks: [] });
    expect([...rows.get(stu2)!.picks].sort()).toEqual([p!.id, e!.id].sort());
    await g.setChoices({ studentId: stu2, subjectIds: [] });
    expect(await g.subjectsForStudent(stu2)).toEqual([]);
    const compulsory = await subs.create({ name: "Games" });
    await expect(g.setChoices({ studentId: stu2, subjectIds: [compulsory.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(g.setChoices({ studentId: stu2, subjectIds: [uuidv7()] })).rejects.toBeInstanceOf(ValidationError);
    await expect(g.setChoices({ studentId: uuidv7(), subjectIds: [] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubjectGroupService(a.as.teacher).setChoices({ studentId: stu2, subjectIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SubjectGroupService(a.as.teacher).update(grp.id, { name: "X", subjectIds: [e!.id] })).rejects.toBeInstanceOf(ForbiddenError);

    // school B can neither see nor change them
    const gb = new SubjectGroupService(b.as.admin);
    await expect(gb.update(grp.id, { name: "Mine", subjectIds: [e!.id] })).rejects.toBeInstanceOf(NotFoundError);
    expect((await gb.list()).total).toBe(0);
    await expect(gb.setChoices({ studentId: stu2, subjectIds: [] })).rejects.toBeInstanceOf(NotFoundError);

    await g.remove(grp.id);
    expect(await names()).toEqual([]);
  });
});

describe("class subjects and subject teachers", () => {
  it("edit the teacher, and a class subject with exam papers is in use", async () => {
    const cls = await new ClassService(a.as.admin).create({ name: "Class 6", grade: 6 });
    const sec = await new SectionService(a.as.admin).create({ classId: cls.id, name: "A" });
    const sub = await new SubjectService(a.as.admin).create({ name: "Geography" });
    await new ClassSubjectService(a.as.admin).assign({ classId: cls.id, subjectIds: [sub.id] });
    const st = new SectionTeacherService(a.as.admin);
    const row = await st.create({ sectionId: sec.id, subjectId: sub.id, teacherId: a.users.teacher });
    expect((await st.list({ filters: { teacherId: a.users.teacher } })).total).toBeGreaterThan(0);
    await expect(st.update(row.id, { teacherId: a.users.accountant })).rejects.toBeInstanceOf(ValidationError);
    await st.remove(row.id);
    await expect(new SectionTeacherService(b.as.admin).remove(row.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("houses", () => {
  it("list with search, edit a captain and clear it, and correct or delete a points entry", async () => {
    const h = new HouseService(a.as.admin);
    const green = await h.create({ name: "Green", tone: "success" });
    expect((await h.list({ q: "gre" })).rows.map((x) => x.name)).toEqual(["Green"]);
    await expect(h.update(green.id, { name: "Green", captainStudentId: uuidv7() })).rejects.toBeInstanceOf(NotFoundError);
    const u = await h.update(green.id, { name: "Emerald", tone: "warning", captainStudentId: "" });
    expect(u).toMatchObject({ name: "Emerald", tone: "warning", captainStudentId: null });
    const p = await h.award({ houseId: green.id, points: "10", reason: "Quiz" });
    await expect(h.remove(green.id)).rejects.toThrow(/in use \(1 points entries\)/);
    await expect(new HouseService(a.as.teacher).updatePoints(p.id, { points: "5", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HouseService(a.as.teacher).removePoints(p.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HouseService(b.as.admin).updatePoints(p.id, { points: "5", reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new HouseService(b.as.admin).removePoints(p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.updatePoints(p.id, { points: "0", reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await h.updatePoints(p.id, { points: "-4", reason: "Fixed" });
    expect((await h.log(green.id))[0]).toMatchObject({ points: -4, reason: "Fixed" });
    await h.removePoints(p.id);
    await h.remove(green.id);
  });
});

describe("isolation of the new paths", () => {
  it("school B cannot update or delete A's rows, or read A's by id", async () => {
    const cls = await new ClassService(a.as.admin).create({ name: "Class 2", grade: 2 });
    const sub = await new SubjectService(a.as.admin).create({ name: "Rhymes" });
    await expect(new ClassService(b.as.admin).update(cls.id, { name: "Mine", grade: "2" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubjectService(b.as.admin).update(sub.id, { name: "Mine" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AcademicYearService(b.as.admin).update(year, { name: "2026-27", status: "closed" })).rejects.toBeInstanceOf(NotFoundError);
    for (const who of [a.as.teacher, a.as.student, a.as.accountant]) {
      await expect(new SubjectService(who).update(sub.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ClassService(who).remove(cls.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
