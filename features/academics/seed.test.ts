import { afterAll, beforeAll, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import seed from "./seed";
import { ClassSubjectService, SectionService } from "./service";

let a: TestSchool;
beforeAll(async () => { ({ a } = await createSchoolPair(["academics"], "-seed")); });
afterAll(closeDb);

it("the demo seed builds a full school and fills the shared state", async () => {
  const state: Record<string, unknown> = {};
  await seed(a.as.admin, state);
  const classes = state.classes as { id: string; name: string; grade: number }[];
  const sections = state.sections as { classId: string }[];
  expect(classes.map((c) => c.name)).toEqual(["Nursery", "LKG", "UKG", ...Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`)]);
  expect(sections).toHaveLength(13 + 5); // A for every class, plus B for Class 1-5
  expect(state.termIds).toHaveLength(2);
  expect(typeof state.yearId).toBe("string");
  expect((await new SectionService(a.as.admin).options()).map((o) => o.label)).toContain("Class 5 - B");
  const class7 = classes.find((c) => c.name === "Class 7")!;
  expect((await new ClassSubjectService(a.as.admin).forClass(class7.id)).map((s) => s.name)).toContain("Sanskrit");
});
