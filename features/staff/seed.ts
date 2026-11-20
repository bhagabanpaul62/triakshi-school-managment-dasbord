import { Passwords } from "@smw/auth";
import { eq, schools, users, withSchool } from "@smw/db";
import type { FeatureSeed } from "@smw/feature-kit";
import { sections, sectionTeachers, subjects as subjectsTable, classSubjects } from "@smw/feature-academics/schema";
import { staffProfiles } from "./schema";
import { StaffService } from "./service";

/** [name, designation, department, qualification, gender, joined] */
const TEACHERS = [
  ["Priya Sharma", "PGT", "Mathematics", "M.Sc. Mathematics, B.Ed.", "female", "2016-06-15"],
  ["Rahul Verma", "PGT", "Physics", "M.Sc. Physics, B.Ed.", "male", "2014-04-01"],
  ["Anjali Gupta", "PGT", "English", "M.A. English, B.Ed.", "female", "2018-07-02"],
  ["Suresh Iyer", "TGT", "Science", "B.Sc., B.Ed.", "male", "2019-06-10"],
  ["Meena Kumari", "TGT", "Hindi", "M.A. Hindi, B.Ed.", "female", "2017-04-05"],
  ["Vikram Singh", "TGT", "Social Science", "M.A. History, B.Ed.", "male", "2015-06-20"],
  ["Kavita Nair", "PRT", "Primary", "B.A., D.El.Ed.", "female", "2020-07-01"],
  ["Deepak Joshi", "PGT", "Computer Science", "MCA, B.Ed.", "male", "2021-04-12"],
  ["Sunita Patel", "PRT", "Primary", "B.Sc., B.El.Ed.", "female", "2019-08-01"],
  ["Arjun Reddy", "TGT", "Physical Education", "B.P.Ed.", "male", "2022-06-06"],
  ["Farah Khan", "TGT", "English", "M.A. English, B.Ed.", "female", "2018-06-18"],
  ["Manoj Tiwari", "TGT", "Mathematics", "M.Sc. Mathematics, B.Ed.", "male", "2016-07-11"],
] as const;

/**
 * 12 teachers who can log in (loginId = first name, shared demo password), class teachers for every section,
 * and subject teachers handed out round-robin. Invites are skipped: nobody is waiting for an email.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const svc = new StaffService(ctx);
  const hash = typeof state.passwordHash === "string" ? state.passwordHash : await Passwords.hash("demo1234");
  const slug = await withSchool(ctx.schoolId, async (tx) => (await tx.select({ s: schools.slug }).from(schools).where(eq(schools.id, ctx.schoolId)))[0]!.s);

  const teachers: { userId: string; name: string }[] = [];
  let i = 0;
  for (const [name, designation, department, qualification, gender, joiningDate] of TEACHERS) {
    const [first, last] = name.split(" ") as [string, string];
    i++;
    const s = await svc.create({
      role: "teacher", name, employeeId: `T${String(i).padStart(3, "0")}`, email: `${first}.${last}@${slug}.example`.toLowerCase(),
      phone: `98765${String(43000 + i * 7)}`, designation, department, qualification, gender, joiningDate,
      dob: `${1975 + (i % 15)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      address: `${10 + i}, Gandhi Nagar, ${slug === "sunrise" ? "Jaipur" : "Pune"}`,
    }, { invite: false });
    await withSchool(ctx.schoolId, (tx) => tx.update(users).set({ passwordHash: hash, status: "active", loginId: first.toLowerCase() }).where(eq(users.id, s.id)));
    teachers.push({ userId: s.id, name });
  }
  // The documented demo login `teacher` (created by the app seed) must own a class, or the first thing a demo
  // teacher opens, Attendance, says "No sections to mark". Put it first so it gets section 1 and subject turns.
  const [demo] = await withSchool(ctx.schoolId, (tx) => tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.loginId, "teacher")).limit(1));
  if (demo) {
    teachers.unshift({ userId: demo.id, name: demo.name });
    // ...and appear in the Staff directory with a record of their own, like every other teacher.
    await withSchool(ctx.schoolId, (tx) => tx.insert(staffProfiles).values({ schoolId: ctx.schoolId, userId: demo.id, employeeId: "T000", designation: "TGT", department: "English" }).onConflictDoNothing());
  }
  state.teachers = teachers;

  const secs = (state.sections ?? []) as { id: string; classId: string; name: string }[];
  const allSubjects = (state.subjects ?? []) as { id: string; name: string }[];
  if (!secs.length) return;

  await withSchool(ctx.schoolId, async (tx) => {
    // Each class studies its mapped subjects; fall back to every subject when none are mapped.
    const mapped = await tx.select().from(classSubjects);
    const known = new Set((await tx.select({ id: subjectsTable.id }).from(subjectsTable)).map((r) => r.id));
    let turn = 0;
    for (const [n, sec] of secs.entries()) {
      await tx.update(sections).set({ classTeacherId: teachers[n % teachers.length]!.userId }).where(eq(sections.id, sec.id));
      const ids = mapped.filter((m) => m.classId === sec.classId).map((m) => m.subjectId);
      const subjectIds = (ids.length ? ids : allSubjects.map((s) => s.id)).filter((id) => known.has(id));
      for (const subjectId of subjectIds) {
        await tx.insert(sectionTeachers).values({ schoolId: ctx.schoolId, sectionId: sec.id, subjectId, teacherId: teachers[turn++ % teachers.length]!.userId }).onConflictDoNothing();
      }
    }
  });
};
export default seed;
