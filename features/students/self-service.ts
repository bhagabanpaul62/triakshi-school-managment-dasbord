import { asc, desc, eq } from "drizzle-orm";
import { classes, sections } from "@smw/feature-academics/schema";
import { NotFoundError } from "@smw/feature-kit";
import { StudentRecordService } from "./access";
import { myContactInput } from "./inputs";
import { guardians, studentGuardians, students } from "./schema";
import { normalizePhone, sectionLabel } from "./util";

const FIELDS = ["phone", "altPhone", "address", "emergencyName", "emergencyPhone", "medicalNotes"] as const;

/** A student reading and keeping up their own record. Only the student login may use it. */
export class StudentSelfService extends StudentRecordService {
  async myRecord() {
    return this.read("self", async (tx) => {
      const [student] = await tx.select().from(students).where(eq(students.userId, this.ctx.userId)).limit(1);
      if (!student) throw new NotFoundError("Student");
      const [place] = student.sectionId
        ? await tx.select({ section: sections.name, className: classes.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.id, student.sectionId)).limit(1)
        : [];
      const guardianRows = await tx.select({ id: guardians.id, name: guardians.name, relation: guardians.relation, phone: guardians.phone })
        .from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(eq(studentGuardians.studentId, student.id)).orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));
      return { student, classSection: place ? sectionLabel(place.className, place.section) : null, guardians: guardianRows };
    });
  }

  /** Change the contact, emergency and medical fields. Applied at once; the audit entry names the fields, never the values. */
  async updateMyContact(input: unknown) {
    this.authorize("self", "write");
    const data = this.parse(myContactInput, input);
    return this.write("self", async (tx) => {
      const [existing] = await tx.select().from(students).where(eq(students.userId, this.ctx.userId)).limit(1);
      if (!existing) throw new NotFoundError("Student");
      const next = Object.fromEntries(FIELDS.map((k) => {
        const v = data[k];
        return [k, v === undefined ? null : k.endsWith("hone") ? normalizePhone(v) : v];
      })) as Record<(typeof FIELDS)[number], string | null>;
      const changed = FIELDS.filter((k) => (existing[k] ?? null) !== next[k]);
      if (changed.length) await tx.update(students).set(next).where(eq(students.id, existing.id));
      return { id: existing.id, name: existing.name, changed };
    }, (r) => ({
      action: "update", entity: "Student", entityId: r.id,
      summary: `${r.name} updated their own ${r.changed.length ? r.changed.join(", ") : "contact details (no change)"}`,
      meta: { self: true, fields: r.changed },
    }));
  }
}
