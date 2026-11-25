import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { fixture } from "./test-fixture";
import { AssignmentService, SubmissionService } from "./service";

let a: TestSchool;
let ids: Awaited<ReturnType<typeof fixture>>;
let left: string;

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  ({ a } = await createSchoolPair(["students", "academics", "assignments"], "j"));
  ids = await fixture(a);
  left = uuidv7();
  await withSchool(a.id, async (tx) => {
    await tx.execute(sql`insert into students (id, school_id, admission_no, name, status, class_id, section_id, roll_no) select ${left}, ${a.id}, 'L1', 'Laksh Left', 'left', class_id, section_id, 9 from students where id = ${ids.aarav}`);
    await tx.execute(sql`insert into students (id, school_id, admission_no, name, status, class_id, joins_section_id) select ${uuidv7()}, ${a.id}, 'J1', 'Jiya Joining', 'joining', class_id, section_id from students where id = ${ids.aarav}`);
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("are on no homework roster and in no class size", async () => {
    const x = await new AssignmentService(a.as.teacher).create({ sectionId: ids.sec1, subjectId: ids.maths, title: "Fractions", instructions: "Do it.", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), maxMarks: "20" });
    const rows = await new SubmissionService(a.as.teacher).roster(x.id);
    expect(rows.map((r) => r.student.name).sort()).toEqual(["Aarav Sharma", "Diya Patel", "Kabir Singh"]);
    expect((await new SubmissionService(a.as.teacher).progress(x.id)).total).toBe(3);
  });
});
