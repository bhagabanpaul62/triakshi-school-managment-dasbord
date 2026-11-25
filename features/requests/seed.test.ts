import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, users, withSchool } from "@smw/db";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import seed from "./seed";
import { RequestService } from "./service";

let a: TestSchool, kid2User: string;
afterAll(closeDb);

beforeAll(async () => {
  a = await createTestSchool("seedrq", ["academics", "students", "messages", "requests"]);
  await withSchool(a.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 5", grade: 5 }).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: a.as.teacher.userId }).returning();
    const [kid2] = await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: "kid2", name: "Kid Two" }).returning();
    kid2User = kid2!.id;
    await tx.insert(students).values([
      { schoolId: a.id, admissionNo: "S1", name: "Kid One", classId: cls!.id, sectionId: sec!.id, userId: a.as.student.userId },
      { schoolId: a.id, admissionNo: "S2", name: "Kid Two", classId: cls!.id, sectionId: sec!.id, userId: kid2!.id },
    ]);
  });
});

describe("seed", () => {
  it("makes a request in every state, one escalated, one overdue and a complaint about a teacher", async () => {
    await seed(a.as.admin, { teachers: [{ userId: a.as.teacher.userId, name: "Teacher" }], students: [{ userId: a.as.student.userId, name: "Kid One" }, { name: "Kid Two", userId: kid2User }] });
    const all = await new RequestService(a.as.admin).list({ pageSize: 100 });
    const states = new Set(all.rows.map((r) => r.state));
    for (const s of ["new", "assigned", "in_progress", "waiting", "resolved", "closed"] as const) expect(states.has(s), s).toBe(true);
    expect(all.rows.some((r) => r.overdue)).toBe(true);
    expect(all.rows.some((r) => r.level > 0)).toBe(true);
    const hidden = await new RequestService(a.as.teacher).list({ pageSize: 100 });
    expect(hidden.rows.some((r) => r.categoryName === "Complaint")).toBe(false);
  });
});
