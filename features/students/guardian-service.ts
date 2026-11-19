import { asc, desc, eq, ilike, inArray, or, count } from "drizzle-orm";
import { NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { StudentRecordService } from "./access";
import { guardianInput, guardianLinkInput } from "./inputs";
import { ParentAccounts } from "./parent-accounts";
import { classes, sections } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "./schema";
import { sectionLabel } from "./util";

/** Guardians of a student, and the parent logins behind them. */
export class GuardianService extends StudentRecordService {
  private readonly parents = new ParentAccounts(this.ctx.schoolId);

  /** Guardians of one student, primary first. */
  async forStudent(studentId: string) {
    return this.read("read", async (tx) => {
      await this.visibleStudent(tx, studentId);
      return tx.select({
        id: guardians.id, name: guardians.name, relation: guardians.relation, phone: guardians.phone, email: guardians.email,
        occupation: guardians.occupation, userId: guardians.userId, isPrimary: studentGuardians.isPrimary,
      }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(eq(studentGuardians.studentId, studentId)).orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));
    });
  }

  /** Add a guardian to a student; creates the parent login (phone number) unless the phone is already a parent here. */
  async add(input: unknown) {
    const d = this.parse(guardianInput, input);
    return this.write("write", async (tx) => {
      await this.visibleStudent(tx, d.studentId);
      const { guardian } = await this.parents.link(tx, d.studentId, d, d.isPrimary || undefined);
      return guardian;
    }, (g) => ({ action: "add_guardian", entity: "Guardian", entityId: g.id, summary: `Linked guardian ${g.name}` }));
  }

  async setPrimary(input: unknown) {
    const d = this.parse(guardianLinkInput, input);
    return this.write("write", async (tx) => {
      await this.visibleStudent(tx, d.studentId);
      if (!(await this.parents.makePrimary(tx, d.studentId, d.guardianId))) throw new NotFoundError("Guardian");
      return d;
    }, (r) => ({ action: "set_primary_guardian", entity: "Guardian", entityId: r.guardianId, summary: "Changed the primary guardian" }));
  }

  async remove(input: unknown) {
    const d = this.parse(guardianLinkInput, input);
    return this.write("write", async (tx) => {
      await this.visibleStudent(tx, d.studentId);
      if (!(await this.parents.unlink(tx, d.studentId, d.guardianId))) throw new NotFoundError("Guardian");
      return d;
    }, (r) => ({ action: "remove_guardian", entity: "Guardian", entityId: r.guardianId, summary: "Removed a guardian from a student" }));
  }

  /** Staff list of parents, each with their children. */
  async listParents(query: ListQuery = {}) {
    this.access.requireStaff();
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = q.q ? or(ilike(guardians.name, `%${q.q}%`), ilike(guardians.phone, `%${q.q}%`)) : undefined;
      const [rows, [total]] = await Promise.all([
        tx.select().from(guardians).where(where).orderBy(asc(guardians.name), asc(guardians.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(guardians).where(where),
      ]);
      const kids = rows.length === 0 ? [] : await tx.select({
        guardianId: studentGuardians.guardianId, id: students.id, name: students.name, className: classes.name, section: sections.name,
      }).from(studentGuardians).innerJoin(students, eq(students.id, studentGuardians.studentId))
        .leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, sections.classId))
        .where(inArray(studentGuardians.guardianId, rows.map((r) => r.id))).orderBy(asc(students.name));
      const view = rows.map((g) => {
        const children = kids.filter((k) => k.guardianId === g.id)
          .map((k) => ({ id: k.id, name: k.name, classSection: k.className && k.section ? sectionLabel(k.className, k.section) : null }));
        return { ...g, children };
      });
      return toPage(view, Number(total?.n ?? 0), q);
    });
  }
}
