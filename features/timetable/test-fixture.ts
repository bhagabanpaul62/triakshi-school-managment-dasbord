// Test-only: a small academic structure for one test school (year, two classes, four sections, two subjects, two teachers, a student and a parent).
import { sql } from "drizzle-orm";
import { users, withConsole } from "@smw/db";
import type { TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sectionTeachers, sections, subjects } from "@smw/feature-academics/schema";

/**
 * s1 = Class 5-A (Maths t1, English t2; holds the school's student and parent), s2 = Class 5-B (Maths t1),
 * s3 = Class 6-A (Maths t1, English t2), s4 = Class 6-B (no teachers).
 */
export class AcademicsFixture {
  private constructor(
    readonly s1: string, readonly s2: string, readonly s3: string, readonly s4: string,
    readonly maths: string, readonly english: string, readonly t1: string, readonly t2: string,
  ) {}

  static async create(school: TestSchool): Promise<AcademicsFixture> {
    const schoolId = school.id;
    return withConsole(async (tx) => {
      const [year] = await tx.insert(academicYears).values({ schoolId, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      const [c5, c6] = await tx.insert(classes).values([{ schoolId, name: "Class 5", grade: 5 }, { schoolId, name: "Class 6", grade: 6 }]).returning();
      const [s1, s2, s3, s4] = await tx.insert(sections).values([
        { schoolId, yearId: year!.id, classId: c5!.id, name: "A", room: "Room 5A" },
        { schoolId, yearId: year!.id, classId: c5!.id, name: "B" },
        { schoolId, yearId: year!.id, classId: c6!.id, name: "A" },
        { schoolId, yearId: year!.id, classId: c6!.id, name: "B" },
      ]).returning();
      const [maths, english] = await tx.insert(subjects).values([{ schoolId, name: "Maths" }, { schoolId, name: "English" }]).returning();
      const [t1, t2] = await tx.insert(users).values([
        { schoolId, role: "teacher", loginId: `t1-${school.slug}`, name: "Anita Verma" },
        { schoolId, role: "teacher", loginId: `t2-${school.slug}`, name: "Rahul Nair" },
      ]).returning();
      await tx.insert(sectionTeachers).values([
        { schoolId, sectionId: s1!.id, subjectId: maths!.id, teacherId: t1!.id },
        { schoolId, sectionId: s1!.id, subjectId: english!.id, teacherId: t2!.id },
        { schoolId, sectionId: s2!.id, subjectId: maths!.id, teacherId: t1!.id },
        { schoolId, sectionId: s3!.id, subjectId: maths!.id, teacherId: t1!.id },
        { schoolId, sectionId: s3!.id, subjectId: english!.id, teacherId: t2!.id },
      ]);
      // The students module owns these tables; plain SQL keeps this feature free of that dependency.
      const [student] = [...(await tx.execute(sql`insert into students (id, school_id, admission_no, name, section_id, user_id)
        values (gen_random_uuid(), ${schoolId}, 'T-1', 'Riya Sharma', ${s1!.id}, ${school.users.student}) returning id`))] as { id: string }[];
      const [guardian] = [...(await tx.execute(sql`insert into guardians (id, school_id, name, relation, user_id)
        values (gen_random_uuid(), ${schoolId}, 'Meena Sharma', 'mother', ${school.users.parent}) returning id`))] as { id: string }[];
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id, is_primary)
        values (gen_random_uuid(), ${schoolId}, ${student!.id}, ${guardian!.id}, true)`);
      return new AcademicsFixture(s1!.id, s2!.id, s3!.id, s4!.id, maths!.id, english!.id, t1!.id, t2!.id);
    });
  }
}
