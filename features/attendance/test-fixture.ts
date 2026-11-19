import { withSchool } from "@smw/db";
import type { TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";

export type Fixture = { own: string; other: string; taught: string; kids: string[]; studentUserKid: string; parentKid: string };

/** One class with three sections: teacher is class teacher of "own", teaches "taught", has nothing to do with "other". */
export async function buildSchoolData(s: TestSchool): Promise<Fixture> {
  return withSchool(s.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: s.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: s.id, name: "Class 5", grade: 5 }).returning();
    const mk = (name: string, classTeacherId?: string) => tx.insert(sections).values({ schoolId: s.id, classId: cls!.id, yearId: year!.id, name, classTeacherId }).returning().then((r) => r[0]!.id);
    const own = await mk("A", s.users.teacher), other = await mk("B"), taught = await mk("C");
    const [subject] = await tx.insert(subjects).values({ schoolId: s.id, name: "Maths" }).returning();
    await tx.insert(sectionTeachers).values({ schoolId: s.id, sectionId: taught, subjectId: subject!.id, teacherId: s.users.teacher });
    const names = ["Aarav Sharma", "Diya Patel", "Kabir Singh", "Ananya Iyer"];
    const kids = await tx.insert(students).values(names.map((name, i) => ({
      schoolId: s.id, name, admissionNo: `ADM-${s.slug}-${i}`, classId: cls!.id, sectionId: own, rollNo: i + 1,
      userId: i === 0 ? s.users.student : null,
    }))).returning();
    await tx.insert(students).values({ schoolId: s.id, name: "Rohan Gupta", admissionNo: `ADM-${s.slug}-x`, sectionId: other, rollNo: 1 });
    const [g] = await tx.insert(guardians).values({ schoolId: s.id, name: "Meera Patel", relation: "mother", userId: s.users.parent }).returning();
    await tx.insert(studentGuardians).values({ schoolId: s.id, studentId: kids[1]!.id, guardianId: g!.id, isPrimary: true });
    return { own, other, taught, kids: kids.map((k) => k.id), studentUserKid: kids[0]!.id, parentKid: kids[1]!.id };
  });
}

