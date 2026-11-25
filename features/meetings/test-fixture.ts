// Shared test data: one class with sections A and B, three teachers, siblings Aarav and Riya, and extra families.
import { users, withSchool } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import type { TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";

export const FEATURES = ["students", "academics", "meetings"];
export const IST_DAY = 86_400_000;

/** Aarav has the school's student login. T1 is class teacher of A and teaches Maths to A; T2 teaches English to A; T3 teaches only B. */
export async function fixture(s: TestSchool) {
  return withSchool(s.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: s.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: s.id, name: "Class 5", grade: 5 }).returning();
    const staff = await tx.insert(users).values(["t2", "t3"].map((k) => ({ schoolId: s.id, role: "teacher" as const, loginId: `${k}-${s.slug}`, name: `Teacher ${k.toUpperCase()}` }))).returning();
    const [t2, t3] = staff;
    const secs = await tx.insert(sections).values([
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: s.users.teacher },
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "B" },
    ]).returning();
    const subs = await tx.insert(subjects).values([{ schoolId: s.id, name: "Mathematics" }, { schoolId: s.id, name: "English" }]).returning();
    await tx.insert(sectionTeachers).values([
      { schoolId: s.id, sectionId: secs[0]!.id, subjectId: subs[0]!.id, teacherId: s.users.teacher },
      { schoolId: s.id, sectionId: secs[0]!.id, subjectId: subs[1]!.id, teacherId: t2!.id },
      { schoolId: s.id, sectionId: secs[1]!.id, subjectId: subs[1]!.id, teacherId: t3!.id },
    ]);
    const login = async (name: string) => (await tx.insert(users).values({ schoolId: s.id, role: "student", loginId: `${name.toLowerCase().replace(/\W/g, "")}-${s.slug}`, name, passwordHash: "x" }).returning())[0]!;
    const riyaLogin = await login("Riya Sharma"), kabirLogin = await login("Kabir Singh"), meeraLogin = await login("Meera Iyer");
    const kids = await tx.insert(students).values([
      { schoolId: s.id, admissionNo: "A1", name: "Aarav Sharma", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 1, userId: s.users.student },
      { schoolId: s.id, admissionNo: "A2", name: "Riya Sharma", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 2, userId: riyaLogin.id },
      { schoolId: s.id, admissionNo: "A3", name: "Kabir Singh", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 3, userId: kabirLogin.id },
      { schoolId: s.id, admissionNo: "B1", name: "Meera Iyer", sectionId: secs[1]!.id, classId: cls!.id, rollNo: 1, userId: meeraLogin.id },
    ]).returning();
    const [guardian] = await tx.insert(guardians).values({ schoolId: s.id, name: "Mr Sharma", relation: "father" }).returning();
    await tx.insert(studentGuardians).values([kids[0]!, kids[1]!].map((k) => ({ schoolId: s.id, studentId: k.id, guardianId: guardian!.id })));
    const as = (u: { id: string; name: string }, role: Ctx["role"], base: Ctx): Ctx => ({ ...base, userId: u.id, name: u.name, role });
    return {
      sectionA: secs[0]!.id, sectionB: secs[1]!.id, t1: s.users.teacher, t2: t2!.id, t3: t3!.id,
      aarav: kids[0]!.id, riya: kids[1]!.id, kabir: kids[2]!.id, meera: kids[3]!.id,
      ctx: { aarav: s.as.student, riya: as(riyaLogin, "student", s.as.student), kabir: as(kabirLogin, "student", s.as.student), meera: as(meeraLogin, "student", s.as.student), t2: as(t2!, "teacher", s.as.teacher), t3: as(t3!, "teacher", s.as.teacher) },
      classId: cls!.id, yearId: year!.id,
    };
  });
}

/** `n` more families in section A, each with a login, for crowd tests. */
export async function crowd(s: TestSchool, ids: Awaited<ReturnType<typeof fixture>>, n: number): Promise<Ctx[]> {
  return withSchool(s.id, async (tx) => {
    const out: Ctx[] = [];
    for (let i = 0; i < n; i++) {
      const [u] = await tx.insert(users).values({ schoolId: s.id, role: "student", loginId: `crowd${i}-${s.slug}`, name: `Crowd ${i}`, passwordHash: "x" }).returning();
      await tx.insert(students).values({ schoolId: s.id, admissionNo: `C${i}`, name: `Crowd ${i}`, sectionId: ids.sectionA, classId: ids.classId, userId: u!.id });
      out.push({ ...s.as.student, userId: u!.id, name: u!.name });
    }
    return out;
  });
}
