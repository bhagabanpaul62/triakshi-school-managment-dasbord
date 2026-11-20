import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import {
  AcademicYearService, AcademicsExportService, ClassService, ClassSubjectService, HouseService, SectionService, SectionTeacherService,
  SubjectGroupService, SubjectService, YearRolloverService,
} from "./service";

let a: TestSchool, b: TestSchool;
let cls: string, otherCls: string, sec: string, sci: string, maths: string, english: string, phys: string, chem: string, bio: string;
let s1: string, s2: string;

const addStudent = (school: TestSchool, name: string, classId: string, sectionId: string, userId: string | null = null) => {
  const id = uuidv7();
  return withSchool(school.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, user_id) values (${id}, ${school.id}, ${"A" + id.slice(-6)}, ${name}, ${classId}, ${sectionId}, ${userId})`)).then(() => id);
};

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["academics", "students"], "e"));
  await new AcademicYearService(a.as.admin).create({ name: "2026-27" });
  await new AcademicYearService(b.as.admin).create({ name: "2026-27" });
  const classes = new ClassService(a.as.admin);
  cls = (await classes.create({ name: "Class 11", grade: 11 })).id;
  otherCls = (await classes.create({ name: "Class 10", grade: 10 })).id;
  sec = (await new SectionService(a.as.admin).create({ classId: cls, name: "A", room: "R1", classTeacherId: a.users.teacher })).id;
  const subs = new SubjectService(a.as.admin);
  const made: string[] = [];
  for (const name of ["English", "Physics", "Chemistry", "Biology", "Maths"]) made.push((await subs.create({ name })).id);
  [english, phys, chem, bio, maths] = made as [string, string, string, string, string];
  sci = "";
  const links = new ClassSubjectService(a.as.admin);
  await links.assign({ classId: cls, subjectIds: [english, phys, chem, bio, maths] });
  await links.assign({ classId: otherCls, subjectIds: [english, phys] });
  const rows = await links.forClass(cls);
  for (const s of [phys, chem, bio]) await links.setElective({ id: rows.find((r) => r.subjectId === s)!.id, isElective: "true" });
  s1 = await addStudent(a, "Asha", cls, sec, a.users.student);
  s2 = await addStudent(a, "Bala", cls, sec);
});
afterAll(closeDb);

describe("electives and streams", () => {
  it("groups hold only elective subjects of the class", async () => {
    const g = new SubjectGroupService(a.as.admin);
    await expect(g.create({ classId: cls, name: "Bad", subjectIds: [english] })).rejects.toBeInstanceOf(ValidationError); // compulsory
    await expect(g.create({ classId: cls, name: "Empty", subjectIds: [] })).rejects.toBeInstanceOf(ValidationError);
    const pcm = await g.create({ classId: cls, name: "Science PCM", subjectIds: [phys, chem] });
    sci = pcm.id;
    await expect(g.create({ classId: cls, name: "Science PCM", subjectIds: [phys] })).rejects.toBeInstanceOf(ConflictError);
    const [row] = await g.forClass(cls);
    expect(row!.subjects.map((s) => s.name)).toEqual(["Chemistry", "Physics"]);
  });

  it("subjectsForStudent is compulsory subjects plus the chosen group, and changing the group replaces it", async () => {
    const g = new SubjectGroupService(a.as.admin);
    const names = async (id: string) => (await g.subjectsForStudent(id)).map((s) => `${s.name}${s.elective ? "*" : ""}`);
    expect(await names(s1)).toEqual(["English", "Maths"]); // nothing chosen yet
    await g.assign({ studentId: s1, groupId: sci });
    expect(await names(s1)).toEqual(["Chemistry*", "English", "Maths", "Physics*"]);
    const pcb = await g.create({ classId: cls, name: "Science PCB", subjectIds: [phys, chem, bio] });
    await g.assign({ studentId: s1, groupId: pcb.id });
    expect(await names(s1)).toEqual(["Biology*", "Chemistry*", "English", "Maths", "Physics*"]);
    expect((await g.roster(sec)).map((r) => [r.name, r.groupId === pcb.id])).toEqual([["Asha", true], ["Bala", false]]);
    await g.assign({ studentId: s1 });
    expect(await names(s1)).toEqual(["English", "Maths"]);
    await g.assign({ studentId: s1, groupId: pcb.id });
    await g.remove(pcb.id); // students in a deleted group lose its subjects
    expect(await names(s1)).toEqual(["English", "Maths"]);
  });

  it("refuses a group of another class, an unknown student, and un-electiving a grouped subject", async () => {
    const g = new SubjectGroupService(a.as.admin);
    const other = await new ClassSubjectService(a.as.admin).forClass(otherCls);
    await new ClassSubjectService(a.as.admin).setElective({ id: other.find((o) => o.subjectId === phys)!.id, isElective: "true" });
    const tenGroup = await g.create({ classId: otherCls, name: "Ten science", subjectIds: [phys] });
    await expect(g.assign({ studentId: s2, groupId: tenGroup.id })).rejects.toMatchObject({ fieldErrors: { groupId: expect.any(String) } });
    await expect(g.assign({ studentId: uuidv7(), groupId: sci })).rejects.toBeInstanceOf(NotFoundError);
    const links = new ClassSubjectService(a.as.admin);
    const phyLink = (await links.forClass(cls)).find((r) => r.subjectId === phys)!;
    await expect(links.setElective({ id: phyLink.id, isElective: "false" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("dropping a subject from the class takes it out of groups and students' choices", async () => {
    const g = new SubjectGroupService(a.as.admin);
    await g.assign({ studentId: s2, groupId: sci });
    const links = new ClassSubjectService(a.as.admin);
    await links.remove((await links.forClass(cls)).find((r) => r.subjectId === chem)!.id);
    expect((await g.subjectsForStudent(s2)).map((s) => s.name)).toEqual(["English", "Maths", "Physics"]);
    expect((await g.forClass(cls))[0]!.subjects.map((s) => s.name)).toEqual(["Physics"]);
  });

  it("only the admin edits; a student reads only their own subjects", async () => {
    for (const who of [a.as.teacher, a.as.student, a.as.accountant]) {
      await expect(new SubjectGroupService(who).create({ classId: cls, name: "X", subjectIds: [phys] })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SubjectGroupService(who).assign({ studentId: s1, groupId: sci })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ClassSubjectService(who).setElective({ id: sci, isElective: "true" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(new SubjectGroupService(a.as.student).roster(sec)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new SubjectGroupService(a.as.student).subjectsForStudent(s1)).length).toBeGreaterThan(0);
    await expect(new SubjectGroupService(a.as.student).subjectsForStudent(s2)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new SubjectGroupService(a.as.teacher).subjectsForStudent(s2)).length).toBeGreaterThan(0);
  });

  it("school B cannot see or use school A's groups and students", async () => {
    const g = new SubjectGroupService(b.as.admin);
    expect(await g.forClass(cls)).toEqual([]);
    await expect(g.subjectsForStudent(s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(g.assign({ studentId: s1, groupId: sci })).rejects.toBeInstanceOf(NotFoundError);
    await expect(g.remove(sci)).rejects.toBeInstanceOf(NotFoundError);
    await expect(g.roster(sec)).rejects.toBeInstanceOf(NotFoundError);
    await expect(g.create({ classId: cls, name: "Z", subjectIds: [phys] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("rollover copies teachers", () => {
  it("copies class teachers and subject teachers, or skips them", async () => {
    await new SectionTeacherService(a.as.admin).assign({ sectionId: sec, subjectId: english, teacherId: a.users.teacher });
    const roll = new YearRolloverService(a.as.admin);
    const plain = await roll.rollForward("2027-28", false);
    expect(plain.teachers).toBe(0);
    const sections = new SectionService(a.as.admin);
    expect((await sections.list({ filters: { yearId: plain.year.id } })).rows.every((s) => s.classTeacherId === null)).toBe(true);

    const full = await roll.rollForward("2028-29");
    expect(full.teachers).toBe(1);
    const [copied] = (await sections.list({ filters: { yearId: full.year.id, classId: cls } })).rows;
    expect(copied!.classTeacherId).toBe(a.users.teacher);
    const cells = (await new SectionTeacherService(a.as.admin).list({ filters: { sectionId: copied!.id } })).rows;
    expect(cells.map((c) => [c.subjectId, c.teacherId])).toEqual([[english, a.users.teacher]]);
  });

  it("is admin only, and B's rollover never touches A", async () => {
    await expect(new YearRolloverService(a.as.teacher).rollForward("2040-41", false)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await new YearRolloverService(b.as.admin).rollForward("2027-28");
    expect(r.sections).toBe(0);
    expect(r.teachers).toBe(0);
  });
});

describe("houses", () => {
  let red: string, blue: string;

  it("creates houses with a unique name and an active-student captain", async () => {
    const h = new HouseService(a.as.admin);
    red = (await h.create({ name: "Red", tone: "danger", captainStudentId: s1 })).id;
    blue = (await h.create({ name: "Blue", tone: "info" })).id;
    await expect(h.create({ name: "Red" })).rejects.toBeInstanceOf(ConflictError);
    await expect(h.create({ name: "Green", tone: "purple" })).rejects.toBeInstanceOf(ValidationError);
    await expect(h.create({ name: "Green", captainStudentId: uuidv7() })).rejects.toBeInstanceOf(NotFoundError);
    expect((await h.standings()).find((x) => x.id === red)!.captainName).toBe("Asha");
  });

  it("puts a student in one house, moves them, and clears", async () => {
    const h = new HouseService(a.as.admin);
    await h.assign({ studentId: s1, houseId: red });
    await h.assign({ studentId: s2, houseId: red });
    await h.assign({ studentId: s2, houseId: blue }); // move, no duplicate
    const st = await h.standings();
    expect(st.map((x) => [x.name, x.members]).sort()).toEqual([["Blue", 1], ["Red", 1]]);
    expect((await h.roster(sec)).map((r) => r.houseId)).toEqual([red, blue]);
    await expect(new HouseService(a.as.student).roster(sec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new HouseService(a.as.teacher).roster(sec)).resolves.toHaveLength(2);
    await expect(h.assign({ studentId: s1, houseId: uuidv7() })).rejects.toBeInstanceOf(ValidationError);
    await h.assign({ studentId: s2 });
    expect((await h.standings()).find((x) => x.id === blue)!.members).toBe(0);
    await h.assign({ studentId: s2, houseId: blue });
  });

  it("admins and teachers award points; totals, rank, the log and a student's own house follow", async () => {
    await new HouseService(a.as.admin).award({ houseId: red, points: "10", reason: "Won the quiz" });
    await new HouseService(a.as.teacher).award({ houseId: blue, points: "25", reason: "Clean class" });
    await new HouseService(a.as.teacher).award({ houseId: blue, points: "-5", reason: "Late to assembly" });
    const st = await new HouseService(a.as.admin).standings();
    expect(st.map((x) => [x.name, x.points])).toEqual([["Blue", 20], ["Red", 10]]);
    const log = await new HouseService(a.as.student).log();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ reason: "Late to assembly", by: a.as.teacher.name });
    expect(await new HouseService(a.as.student).mine()).toMatchObject({ name: "Red", points: 10, rank: 2, of: 2 });
    expect(await new HouseService(a.as.teacher).mine()).toBeNull();
  });

  it("refuses zero points, a missing reason and callers without the grant", async () => {
    const h = new HouseService(a.as.admin);
    await expect(h.award({ houseId: red, points: "0", reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(h.award({ houseId: red, points: "500", reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(h.award({ houseId: red, points: "5", reason: " " })).rejects.toBeInstanceOf(ValidationError);
    for (const who of [a.as.student, a.as.accountant, a.as.parent]) await expect(new HouseService(who).award({ houseId: red, points: "5", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    for (const who of [a.as.teacher, a.as.student]) {
      await expect(new HouseService(who).create({ name: "Hack" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new HouseService(who).assign({ studentId: s1, houseId: red })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new HouseService(who).remove(red)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("school B cannot see, award, join or delete school A's houses", async () => {
    const h = new HouseService(b.as.admin);
    expect(await h.standings()).toEqual([]);
    expect(await h.log()).toEqual([]);
    await expect(h.award({ houseId: red, points: "5", reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(h.assign({ studentId: s1, houseId: red })).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.update(red, { name: "Mine" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.remove(red)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new HouseService(a.as.admin).standings()).length).toBe(2);
  });

  it("refuses to delete a house with members or points; an emptied house goes", async () => {
    const h = new HouseService(a.as.admin);
    await expect(h.remove(blue)).rejects.toBeInstanceOf(ConflictError);
    await h.assign({ studentId: s2 });
    for (const l of (await h.log(blue)).filter((x) => x.houseName === "Blue")) await h.removePoints(l.id);
    await h.remove(blue);
    expect((await h.standings()).map((x) => x.name)).toEqual(["Red"]);
    expect((await h.log()).every((l) => l.houseName === "Red")).toBe(true);
  });
});

describe("exports", () => {
  it("class list CSV has one row per section, with the student count, and defuses formulas", async () => {
    await new SectionService(a.as.admin).create({ classId: otherCls, name: "=B", room: "+9" });
    const { csv, fileName } = await new AcademicsExportService(a.as.admin).classListCsv();
    expect(fileName).toBe("classes-2026-27.csv");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe('"Class","Section","Class teacher","Students","Capacity","Room"');
    expect(lines).toContain(`"Class 11","A","${a.as.teacher.name}","2","40","R1"`);
    expect(lines.find((l) => l.startsWith('"Class 10"'))).toBe('"Class 10","\'=B","","0","40","\'+9"');
  });

  it("allocation print is an A4 PDF; students and school B are refused", async () => {
    const { bytes, fileName } = await new AcademicsExportService(a.as.admin).allocationPdf();
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(fileName).toBe("subject-allocation-2026-27.pdf");
    await expect(new AcademicsExportService(a.as.student).allocationPdf()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AcademicsExportService(a.as.teacher).classListCsv()).rejects.toBeInstanceOf(ForbiddenError);
    const bCsv = (await new AcademicsExportService(b.as.admin).classListCsv()).csv;
    expect(bCsv.trim().split("\r\n")).toHaveLength(1); // header only: nothing of A's leaks
  });
});
