import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, users, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "../academics/schema";
import { students } from "../students/schema";
import notificationsFeature from "./feature";
import { resolveAudience, teachersOfStudent } from "./audience";
import type { Audience } from "./audience-rules";

let a: TestSchool;
let secId: string, classId: string, left: string, joining: string, active: string;
const aud = (type: "families" | "everyone"): Audience => ({ include: [{ type }], exclude: [] });

beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a } = await createSchoolPair(["notifications"], "j"));
  await withSchool(a.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c] = await tx.insert(classes).values({ schoolId: a.id, name: "5", grade: 5 }).returning();
    const [s] = await tx.insert(sections).values({ schoolId: a.id, classId: c!.id, yearId: y!.id, name: "A", classTeacherId: a.users.teacher }).returning();
    // every child has a working login, so only the status can keep the leaver and the newcomer out
    const login = async (n: string) => (await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: `lj-${n}`, name: n, email: `${n}@x.test`, status: "active" }).returning())[0]!.id;
    const kid = async (name: string, status: "active" | "left" | "joining") => (await tx.insert(students).values({
      schoolId: a.id, admissionNo: `J-${name}`, name, classId: c!.id, sectionId: status === "joining" ? null : s!.id, joinsSectionId: status === "joining" ? s!.id : null, status, userId: await login(name),
    }).returning())[0]!.id;
    [secId, classId] = [s!.id, c!.id];
    active = await kid("Asha", "active"); left = await kid("Laksh", "left"); joining = await kid("Jiya", "joining");
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("are reached by no audience rule", async () => {
    const reach = (au: Audience) => withSchool(a.id, async (tx) => (await resolveAudience(tx, au)).filter((r) => r.studentId).map((r) => r.name));
    expect(await reach(aud("families"))).toEqual(["Asha"]);
    expect(await reach({ include: [{ type: "section", id: secId }], exclude: [] })).toEqual(["Asha"]);
    expect(await reach({ include: [{ type: "class", id: classId }], exclude: [] })).toEqual(["Asha"]);
    expect(await reach({ include: [{ type: "student", id: left }, { type: "student", id: joining }], exclude: [] })).toEqual([]);
  });

  it("are not taught by anyone for the contact lists", async () => {
    const teachers = (id: string) => withSchool(a.id, (tx) => teachersOfStudent(tx, id));
    expect((await teachers(active)).length).toBeGreaterThan(0);
    expect(await teachers(left)).toEqual([]);
    expect(await teachers(joining)).toEqual([]);
  });
});
