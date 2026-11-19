import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createTestSchool } from "@smw/feature-kit/testing";
import academicsSeed from "@smw/feature-academics/seed";
import { students } from "@smw/feature-students/schema";
import seed from "./seed";
import { ExamService, ResultService } from "./service";

afterAll(closeDb);

// The students seed belongs to another feature; this test gives every class a few students directly.
async function seeded(slug: string) {
  const school = await createTestSchool(slug, ["academics", "students", "exams"]);
  const state: Record<string, unknown> = {};
  await academicsSeed(school.as.admin, state);
  const sections = state.sections as { id: string; classId: string }[];
  const rows = await withSchool(school.id, (tx) => tx.insert(students).values(
    (state.classes as { id: string }[]).flatMap((c, i) => Array.from({ length: 6 }, (_, k) => ({
      schoolId: school.id, admissionNo: `${slug}-${i}-${k}`, name: `Student ${i}-${k}`, classId: c.id, sectionId: sections.find((s) => s.classId === c.id)!.id, rollNo: k + 1,
    }))),
  ).returning());
  state.students = rows.map((r) => ({ id: r.id, name: r.name, classId: r.classId, sectionId: r.sectionId, userId: null, guardianUserId: null }));
  await seed(school.as.admin, state);
  return { school, state };
}

describe("exams seed", () => {
  it("greenvalley: Unit Test 1 and the Half-Yearly are both published, with real results", async () => {
    const { school, state } = await seeded("greenvalley");
    const list = state.exams as { id: string; name: string }[];
    expect(list.map((e) => e.name)).toEqual(["Unit Test 1", "Half-Yearly Exam"]);
    const exams = new ExamService(school.as.admin);
    for (const e of list) expect((await exams.get(e.id)).status).toBe("published");

    const half = (await exams.detail(list[1]!.id)).papers;
    expect(half.every((p) => p.entered === p.students && p.students > 0)).toBe(true);
    expect(new Set(half.filter((p) => p.className.startsWith("Class ") && Number(p.className.slice(6)) >= 6).map((p) => `${p.maxMarks}/${p.passMarks}`))).toEqual(new Set(["80/27"]));
    expect(new Set(half.filter((p) => p.className === "Class 3").map((p) => `${p.maxMarks}/${p.passMarks}`))).toEqual(new Set(["50/17"]));

    const sec = (state.sections as { id: string; classId: string; name: string }[]).find((s) => s.name === "A")!;
    const klass = await new ResultService(school.as.admin).classResult(list[1]!.id, sec.id);
    expect(klass.results).toHaveLength(6);
    expect(klass.results.every((r) => r.result !== "pending")).toBe(true);
    expect(klass.summary.averagePercent).toBeGreaterThan(40);
  });

  it("sunrise: the Half-Yearly is still open for marks, marks all in", async () => {
    const { school, state } = await seeded("sunrise");
    const list = state.exams as { id: string }[];
    const exams = new ExamService(school.as.admin);
    expect((await exams.get(list[0]!.id)).status).toBe("published");
    expect((await exams.get(list[1]!.id)).status).toBe("marks_open");
    expect((await exams.detail(list[1]!.id)).totals.missing).toBe(0);
  });
});
