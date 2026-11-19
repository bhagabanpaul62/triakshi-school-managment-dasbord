import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth } from "@smw/auth";
import { closeDb, eq, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, classSubjects, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import seed from "./seed";

let a: TestSchool;
beforeAll(async () => { ({ a } = await createSchoolPair(["academics", "staff"], "seed")); });
afterAll(closeDb);

describe("staff seed", () => {
  it("creates 12 teachers who can log in, class teachers and round-robin subject teachers", async () => {
    const state: Record<string, unknown> = {};
    await withSchool(a.id, async (tx) => {
      const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      const [c] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 6", grade: 6 }).returning();
      const secs = await tx.insert(sections).values(["A", "B"].map((name) => ({ schoolId: a.id, classId: c!.id, yearId: y!.id, name }))).returning();
      const subs = await tx.insert(subjects).values(["English", "Maths", "Science"].map((name) => ({ schoolId: a.id, name }))).returning();
      await tx.insert(classSubjects).values(subs.slice(0, 2).map((s) => ({ schoolId: a.id, classId: c!.id, subjectId: s.id })));
      state.sections = secs.map((s) => ({ id: s.id, classId: s.classId, name: s.name }));
      state.subjects = subs.map((s) => ({ id: s.id, name: s.name }));
    });

    await seed(a.as.admin, state);

    expect(state.teachers).toHaveLength(12);
    expect((await new SchoolAuth(a.id).login("priya", "demo1234")).token).toBeTruthy();
    const rows = await withSchool(a.id, async (tx) => ({
      secs: await tx.select().from(sections),
      st: await tx.select().from(sectionTeachers).where(eq(sectionTeachers.schoolId, a.id)),
    }));
    expect(rows.secs.every((s) => s.classTeacherId)).toBe(true);
    expect(rows.st).toHaveLength(4); // 2 sections x the 2 mapped subjects
    expect(new Set(rows.st.map((r) => r.teacherId)).size).toBe(4);
  });
});
