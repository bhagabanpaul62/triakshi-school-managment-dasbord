import { and, asc, eq, isNull } from "drizzle-orm";
import { Passwords } from "@smw/auth";
import { schools, sessions, users } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { students } from "./schema";
import { firstPassword, sectionLabel } from "./util";

/** Student logins: the printable first-password slips and the per-student "reset login". */
export class CredentialService extends StudentRecordService {
  /**
   * Slips for the active students of one class who have never signed in. The first password is only
   * shown while the account still must change it and still has it: after that the office no longer knows it.
   */
  async slips(classId: string) {
    return this.read("write", async (tx) => {
      const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      const rows = await tx.select({
        id: students.id, name: students.name, admissionNo: students.admissionNo, dob: students.dob, rollNo: students.rollNo,
        className: classes.name, section: sections.name, mustChange: users.mustChangePassword, hash: users.passwordHash,
      }).from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, students.classId))
        .where(and(eq(students.classId, classId), eq(students.status, "active"), isNull(users.lastLoginAt), eq(users.status, "active")))
        .orderBy(asc(sections.name), asc(students.rollNo), asc(students.name));
      return {
        schoolName: school?.name ?? "",
        // Print the first password only while the stored hash still is that password: an admin's temporary one is not on the list.
        // shortcut: one Argon2 check per row, fine for a class; batch or cache if a slip run ever covers a whole school.
        slips: await Promise.all(rows.map(async (r) => {
          const first = firstPassword(r.dob, r.admissionNo);
          return {
            id: r.id, name: r.name, classSection: r.className && r.section ? sectionLabel(r.className, r.section) : (r.className ?? ""),
            loginId: r.admissionNo, password: r.mustChange && await Passwords.verify(r.hash, first) ? first : null,
          };
        })),
      };
    });
  }

  /** Never signed in / last sign-in / disabled, for the record page. */
  async loginStatus(studentId: string) {
    return this.read("write", async (tx) => {
      const s = await this.visibleStudent(tx, studentId);
      const [u] = s.userId ? await tx.select({ status: users.status, lastLoginAt: users.lastLoginAt, mustChange: users.mustChangePassword }).from(users).where(eq(users.id, s.userId)).limit(1) : [];
      return u ? { loginId: s.admissionNo, status: u.status, lastLoginAt: u.lastLoginAt, mustChange: u.mustChange } : null;
    });
  }

  /** Back to the first-password rule, must change at next sign-in, every session ended. */
  async resetLogin(studentId: string) {
    return this.write("write", async (tx) => {
      const s = await this.visibleStudent(tx, studentId);
      if (!s.userId) throw new NotFoundError("Student login");
      await tx.update(users).set({ passwordHash: await Passwords.hash(firstPassword(s.dob, s.admissionNo)), mustChangePassword: true }).where(eq(users.id, s.userId));
      await tx.delete(sessions).where(eq(sessions.userId, s.userId));
      return s;
    }, (s) => ({ action: "reset_student_login", entity: "Student", entityId: s.id, summary: `Reset the login of ${s.name} (${s.admissionNo})` }));
  }
}
