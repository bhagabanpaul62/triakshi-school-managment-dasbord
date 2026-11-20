// Shared test data: a class with two sections, two subjects, four students and one teacher.
import { withSchool } from "@smw/db";
import type { TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

/** Aarav has the student login; the teacher teaches Mathematics to section A only. */
export async function fixture(s: TestSchool) {
  return withSchool(s.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: s.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: s.id, name: "Class 5", grade: 5 }).returning();
    const secs = await tx.insert(sections).values([
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "A" },
      { schoolId: s.id, classId: cls!.id, yearId: year!.id, name: "B" },
    ]).returning();
    const subs = await tx.insert(subjects).values([{ schoolId: s.id, name: "Mathematics" }, { schoolId: s.id, name: "English" }]).returning();
    await tx.insert(sectionTeachers).values({ schoolId: s.id, sectionId: secs[0]!.id, subjectId: subs[0]!.id, teacherId: s.users.teacher });
    const kids = await tx.insert(students).values([
      { schoolId: s.id, admissionNo: "A1", name: "Aarav Sharma", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 1, userId: s.users.student },
      { schoolId: s.id, admissionNo: "A2", name: "Diya Patel", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 2 },
      { schoolId: s.id, admissionNo: "A3", name: "Kabir Singh", sectionId: secs[0]!.id, classId: cls!.id, rollNo: 3 },
      { schoolId: s.id, admissionNo: "B1", name: "Meera Iyer", sectionId: secs[1]!.id, classId: cls!.id, rollNo: 1 },
    ]).returning();
    return { sec1: secs[0]!.id, sec2: secs[1]!.id, maths: subs[0]!.id, english: subs[1]!.id, aarav: kids[0]!.id, diya: kids[1]!.id, kabir: kids[2]!.id };
  });
}
