// Test data for the events suites: one class with two sections, a teacher of one, four families.
import { users, withSchool } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import type { TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export const FEATURES = ["events", "notifications", "attendance"];

export interface Fixture { own: string; other: string; ann: string; bob: string; cy: string; nolo: string; annUser: string; bobUser: string; cyUser: string; teacher2: string }

export const asUser = (s: TestSchool, userId: string, role: Ctx["role"], features = FEATURES): Ctx => ({ ...s.as[role], userId, role, features: new Set(features) });

export async function fixture(s: TestSchool): Promise<Fixture> {
  return withSchool(s.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: s.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: s.id, name: "Class 5", grade: 5 }).returning();
    const [own, other] = await tx.insert(sections).values([
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: s.users.teacher },
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "B" },
    ]).returning();
    const login = async (name: string, role: "student" | "teacher" = "student") => (await tx.insert(users).values({ schoolId: s.id, role, loginId: `${name}-${s.slug}`, name: `${name} family`, email: `${name}@${s.slug}.test` }).returning())[0]!.id;
    const [bobUser, cyUser, teacher2] = [await login("bob"), await login("cy"), await login("teacher2", "teacher")];
    const kid = async (name: string, sectionId: string, userId: string | null) => (await tx.insert(students).values({ schoolId: s.id, name, admissionNo: `E-${s.slug}-${name}`, classId: cls!.id, sectionId, userId }).returning())[0]!.id;
    return { own: own!.id, other: other!.id, ann: await kid("Ann", own!.id, s.users.student), bob: await kid("Bob", own!.id, bobUser), cy: await kid("Cy", other!.id, cyUser), nolo: await kid("Nolo", own!.id, null), annUser: s.users.student, bobUser, cyUser, teacher2 };
  });
}
