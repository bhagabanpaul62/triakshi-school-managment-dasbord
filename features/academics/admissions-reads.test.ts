import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { AcademicYearService, ClassService, ClassSubjectService, HouseService, SectionService, SubjectGroupService, SubjectService, withJoining } from "./service";

let a: TestSchool;
let cls: string, sec: string, maths: string, art: string, active: string, joining: string, left: string, red: string;

const add = (name: string, status: "active" | "joining" | "left") => {
  const id = uuidv7();
  const inSection = status !== "joining";
  return withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, joins_section_id, status, left_on)
    values (${id}, ${a.id}, ${"A" + id.slice(-6)}, ${name}, ${cls}, ${inSection ? sec : null}, ${inSection ? null : sec}, ${status}, ${status === "left" ? "2026-09-10" : null})`)).then(() => id);
};

beforeAll(async () => {
  ({ a } = await createSchoolPair(["academics", "students"], "j"));
  await new AcademicYearService(a.as.admin).create({ name: "2026-27" });
  cls = (await new ClassService(a.as.admin).create({ name: "Class 7", grade: 7 })).id;
  sec = (await new SectionService(a.as.admin).create({ classId: cls, name: "A", capacity: 40 })).id;
  const subs = new SubjectService(a.as.admin);
  maths = (await subs.create({ name: "Maths" })).id;
  art = (await subs.create({ name: "Art" })).id;
  await new ClassSubjectService(a.as.admin).assign({ classId: cls, subjectIds: [maths, art] });
  active = await add("Active Asha", "active");
  joining = await add("Joining Jiya", "joining");
  left = await add("Left Laksh", "left");
  red = (await new HouseService(a.as.admin).create({ name: "Red" })).id;
  await withSchool(a.id, (tx) => tx.execute(sql`insert into student_houses (id, school_id, student_id, house_id) values (${uuidv7()}, ${a.id}, ${active}, ${red}), (${uuidv7()}, ${a.id}, ${left}, ${red})`));
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("strength counts active children; planned joiners show beside it", async () => {
    const [row] = await new SectionService(a.as.admin).forClass(cls);
    expect(row).toMatchObject({ students: 1, joining: 1 });
    expect((await new ClassService(a.as.admin).stats([cls]))[cls]).toMatchObject({ students: 1, joining: 1 });
    expect(withJoining(32, 3)).toBe("32 + 3 joining");
    expect(withJoining(32, 0)).toBe("32");
  });

  it("are in no house count, roster, electives or choice", async () => {
    const h = new HouseService(a.as.admin);
    expect((await h.standings()).find((x) => x.id === red)!.members).toBe(1);
    expect((await h.roster(sec)).map((r) => r.id)).toEqual([active]);
    expect((await new SubjectGroupService(a.as.admin).roster(sec)).map((r) => r.id)).toEqual([active]);
    for (const id of [joining, left]) {
      await expect(h.assign({ studentId: id, houseId: red })).rejects.toBeInstanceOf(ValidationError);
      await expect(new SubjectGroupService(a.as.admin).setChoices({ studentId: id, subjectIds: [] })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("keep a left child's subject list readable", async () => {
    expect((await new SubjectGroupService(a.as.admin).subjectsForStudent(left)).map((s) => s.name).sort()).toEqual(["Art", "Maths"]);
  });
});
