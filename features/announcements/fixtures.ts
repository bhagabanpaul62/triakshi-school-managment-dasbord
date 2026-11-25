// Test fixtures: a school with a current year, two classes, five sections of people and logins. Test only.
import { sql } from "drizzle-orm";
import { users, withSchool, type SchoolRole } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "../academics/schema";
import { students } from "../students/schema";

export interface Fx {
  school: TestSchool;
  ids: Record<string, string>;
  /** A context for any user of the school. */
  as: (userId: string, role?: SchoolRole, extra?: Partial<Ctx>) => Ctx;
}
const FEATURES = ["announcements", "notifications", "students", "academics"];

export async function build(slug: string, o: { features?: string[] } = {}): Promise<Fx> {
  const school = await createTestSchool(slug, o.features ?? FEATURES);
  const ids: Record<string, string> = {};
  await withSchool(school.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: school.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c5, c6] = await tx.insert(classes).values([{ schoolId: school.id, name: "5", grade: 5 }, { schoolId: school.id, name: "6", grade: 6 }]).returning();
    const [s5a, s5b, s6a] = await tx.insert(sections).values([
      { schoolId: school.id, classId: c5!.id, yearId: y!.id, name: "A", classTeacherId: school.users.teacher },
      { schoolId: school.id, classId: c5!.id, yearId: y!.id, name: "B" },
      { schoolId: school.id, classId: c6!.id, yearId: y!.id, name: "A" },
    ]).returning();
    Object.assign(ids, { year: y!.id, c5: c5!.id, c6: c6!.id, s5a: s5a!.id, s5b: s5b!.id, s6a: s6a!.id });
    const login = async (name: string) => (await tx.insert(users).values({ schoolId: school.id, role: "student", loginId: `l-${name}`, name: `Login ${name}`, email: `${name}@x.test` }).returning())[0]!.id;
    const kid = async (name: string, s: typeof s5a, userId: string | null, status: "active" | "left" = "active") =>
      (await tx.insert(students).values({ schoolId: school.id, admissionNo: `S-${name}`, name, classId: s!.classId, sectionId: s!.id, userId, status }).returning())[0]!.id;
    // Ann is the family login the base fixture calls "student".
    ids.ann = await kid("Ann", s5a, school.users.student);
    ids.bobUser = await login("bob"); ids.bob = await kid("Bob", s5a, ids.bobUser);
    ids.cyUser = await login("cy"); ids.cy = await kid("Cy", s5b, ids.cyUser);
    ids.nolo = await kid("Nolo", s6a, null);
    ids.leaverUser = await login("leaver"); ids.leaver = await kid("Leaver", s5a, ids.leaverUser, "left");
    const [t2] = await tx.insert(users).values({ schoolId: school.id, role: "teacher", loginId: "t2", name: "Teacher Two", email: "t2@x.test" }).returning();
    ids.teacher2 = t2!.id;
  });
  const as = (userId: string, role: SchoolRole = "student", extra: Partial<Ctx> = {}): Ctx => ({ ...school.as.admin, userId, role, name: "x", ...extra });
  return { school, ids, as };
}

/** n families with logins in section 6A, set based so thousands are quick. */
export async function addBulkFamilies(fx: Fx, n: number) {
  await withSchool(fx.school.id, async (tx) => {
    await tx.execute(sql`insert into users (id, school_id, role, login_id, name, status) select gen_random_uuid(), ${fx.school.id}::uuid, 'student', 'bulk' || g, 'Bulk ' || g, 'active' from generate_series(1, ${n}) g`);
    await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id) select gen_random_uuid(), ${fx.school.id}::uuid, 'B-' || u.login_id, u.name, ${fx.ids.c6}::uuid, ${fx.ids.s6a}::uuid, 'active', u.id from users u where u.school_id = ${fx.school.id}::uuid and u.login_id like 'bulk%'`);
  });
}
