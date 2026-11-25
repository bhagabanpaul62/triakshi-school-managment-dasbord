// Two schools for the messages tests. Test-only: never imported by the app.
import { schoolRoles, users, withSchool } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export const FEATURES = ["academics", "students", "messages", "notifications"];

/** An extra user in a school (the fixture gives one per role). `grants` makes a custom-role login. */
export async function addUser(school: TestSchool, role: Ctx["role"], n: string, grants?: string[]): Promise<Ctx> {
  return withSchool(school.id, async (tx) => {
    const roleId = grants ? (await tx.insert(schoolRoles).values({ schoolId: school.id, name: `role ${n}`, base: role === "teacher" ? "teacher" : "staff", grants }).returning())[0]!.id : undefined;
    const [u] = await tx.insert(users).values({ schoolId: school.id, role, loginId: `${role}-${n}`, name: `${role} ${n}`, email: `${role}${n}@x.test`, roleId }).returning();
    return { ...school.as.admin, role, userId: u!.id, name: u!.name, grants: grants ? new Set(grants) : undefined };
  });
}

export async function build(suffix: string) {
  const { a, b } = await createSchoolPair(FEATURES, suffix);
  const own = a.as.teacher;
  const [form, other, far, student2, student3, student4] = await Promise.all([
    addUser(a, "teacher", `form${suffix}`), addUser(a, "teacher", `other${suffix}`), addUser(a, "teacher", `far${suffix}`),
    addUser(a, "student", `two${suffix}`), addUser(a, "student", `three${suffix}`), addUser(a, "student", `four${suffix}`),
  ]);
  const ids = await withSchool(a.id, async (tx) => {
    const sid = a.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 5", grade: 5 }).returning();
    const [s1] = await tx.insert(sections).values({ schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: form.userId }).returning();
    const [s2] = await tx.insert(sections).values({ schoolId: sid, classId: cls!.id, yearId: year!.id, name: "B" }).returning();
    const [maths, art] = await tx.insert(subjects).values([{ schoolId: sid, name: "Maths" }, { schoolId: sid, name: "Art" }]).returning();
    await tx.insert(sectionTeachers).values([
      { schoolId: sid, sectionId: s1!.id, subjectId: maths!.id, teacherId: own.userId },
      { schoolId: sid, sectionId: s2!.id, subjectId: art!.id, teacherId: far.userId },
    ]);
    const kids = await tx.insert(students).values([
      { schoolId: sid, admissionNo: `A1${suffix}`, name: "Aarav", classId: cls!.id, sectionId: s1!.id, userId: a.as.student.userId },
      { schoolId: sid, admissionNo: `A2${suffix}`, name: "Diya", classId: cls!.id, sectionId: s1!.id, userId: student2.userId },
      { schoolId: sid, admissionNo: `A3${suffix}`, name: "Kabir", classId: cls!.id, sectionId: s2!.id, userId: student3.userId },
      { schoolId: sid, admissionNo: `A4${suffix}`, name: "Meera", classId: cls!.id, sectionId: s1!.id, userId: null }, // no login
      { schoolId: sid, admissionNo: `A5${suffix}`, name: "Nikhil", classId: cls!.id, sectionId: s1!.id, userId: student4.userId },
    ]).returning();
    return { s1: s1!.id, s2: s2!.id, kids };
  });
  const [st1, st2, st3, st4, st5] = ids.kids;
  return { a, b, own, form, other, far, student2, student3, student4, s1: ids.s1, s2: ids.s2, st1: st1!, st2: st2!, st3: st3!, st4: st4!, st5: st5! };
}
