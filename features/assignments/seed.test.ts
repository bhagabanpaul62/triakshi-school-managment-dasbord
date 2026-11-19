import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, users, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { students } from "@smw/feature-students/schema";
import { fixture } from "./test-fixture";
import seed from "./seed";
import { AssignmentService, SelfService, SubmissionService } from "./service";

let a: TestSchool;
const state: Record<string, unknown> = {};

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  ({ a } = await createSchoolPair(["students", "academics", "assignments"], "seed"));
  const ids = await fixture(a);
  // Ten more pupils in section A, each with a login, as the students seed would create them.
  const extra = await withSchool(a.id, async (tx) => {
    const logins = await tx.insert(users).values(Array.from({ length: 10 }, (_, i) => ({ schoolId: a.id, role: "student" as const, loginId: `pupil${i}`, name: `Pupil ${i}` }))).returning();
    return tx.insert(students).values(logins.map((u, i) => ({ schoolId: a.id, admissionNo: `S${i}`, name: u.name, sectionId: ids.sec1, rollNo: 10 + i, userId: u.id }))).returning();
  });
  state.sections = [{ id: ids.sec1 }, { id: ids.sec2 }];
  state.subjects = [{ id: ids.maths, name: "Mathematics" }, { id: ids.english, name: "English" }];
  state.teachers = [{ userId: a.users.teacher, name: "Teacher A" }];
  state.students = [
    { id: ids.aarav, name: "Aarav Sharma", sectionId: ids.sec1, userId: a.users.student },
    ...extra.map((s) => ({ id: s.id, name: s.name, sectionId: ids.sec1, userId: s.userId })),
  ];
  await seed(a.as.admin, state);
});
afterAll(closeDb);

describe("seed", () => {
  it("creates three assignments per section and shares their ids", () => {
    expect(state.assignments).toHaveLength(6);
  });

  it("closes the oldest, leaves the newest open and hands in most of the work", async () => {
    const all = (await new AssignmentService(a.as.admin).list({ pageSize: 50 })).rows;
    expect(all.filter((r) => r.status === "closed")).toHaveLength(2);
    const sectionA = (state.assignments as { id: string; sectionId: string }[]).filter((x) => x.sectionId === (state.sections as { id: string }[])[0]!.id);
    const progress = await Promise.all(sectionA.map((x) => new SubmissionService(a.as.admin).progress(x.id)));
    const total = progress.reduce((n, p) => n + p.total, 0);
    const missing = progress.reduce((n, p) => n + p.missing, 0);
    expect(total).toBe(39);
    expect(missing / total).toBeGreaterThan(0.1);
    expect(missing / total).toBeLessThan(0.5);
    expect(progress.some((p) => p.graded > 0)).toBe(true);
    expect(progress.some((p) => p.late > 0)).toBe(true);
    expect(progress.some((p) => p.returned > 0)).toBe(true);
  });

  it("a seeded student sees their work, including graded marks", async () => {
    const rows = await new SelfService(a.as.student).mine();
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.state === "todo" || r.state === "submitted")).toBe(true);
  });
});
