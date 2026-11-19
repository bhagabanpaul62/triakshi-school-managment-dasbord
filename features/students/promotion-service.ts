import { and, asc, count, eq, gt, max } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { promoteInput } from "./inputs";
import { studentEnrollments, students } from "./schema";
import { sectionLabel, today } from "./util";

interface SectionInfo { id: string; classId: string; yearId: string; name: string; className: string; grade: number; yearName: string; yearStart: string }

/** Year-end: move a whole section up to the next year, hold some back, let some leave, and graduate the last class. */
export class PromotionService extends StudentRecordService {
  private async section(tx: Tx, id: string, field: string): Promise<SectionInfo> {
    const [s] = await tx.select({
      id: sections.id, classId: sections.classId, yearId: sections.yearId, name: sections.name, className: classes.name, grade: classes.grade,
      yearName: academicYears.name, yearStart: academicYears.startsOn,
    }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId))
      .where(eq(sections.id, id)).limit(1);
    if (!s) throw new ValidationError({ [field]: "Choose a section" });
    return s;
  }

  private async topGrade(tx: Tx) {
    const [r] = await tx.select({ top: max(classes.grade) }).from(classes);
    return r?.top ?? 0;
  }

  /** Sections of the current year with their active student counts: where a promotion starts. */
  async sources() {
    return this.read("write", async (tx) => {
      const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      const rows = await tx.select({ id: sections.id, name: sections.name, className: classes.name, n: count(students.id) }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).leftJoin(students, and(eq(students.sectionId, sections.id), eq(students.status, "active")))
        .where(year ? eq(sections.yearId, year.id) : undefined).groupBy(sections.id, classes.id).orderBy(asc(classes.grade), asc(sections.name));
      return rows.map((r) => ({ id: r.id, label: sectionLabel(r.className, r.name), students: Number(r.n) }));
    });
  }

  /** What promoting this section would involve: its students and where they can go. */
  async preview(fromSectionId: string) {
    return this.read("write", async (tx) => {
      const from = await this.section(tx, fromSectionId, "fromSectionId");
      const topGrade = await this.topGrade(tx);
      const people = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, rollNo: students.rollNo }).from(students)
        .where(and(eq(students.sectionId, from.id), eq(students.status, "active"))).orderBy(asc(students.name));
      const later = await tx.select({
        id: sections.id, name: sections.name, classId: sections.classId, className: classes.name, grade: classes.grade, yearName: academicYears.name,
      }).from(sections).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(academicYears, eq(academicYears.id, sections.yearId))
        .where(gt(academicYears.startsOn, from.yearStart)).orderBy(asc(classes.grade), asc(sections.name));
      const option = (s: (typeof later)[number]) => ({ id: s.id, label: `${sectionLabel(s.className, s.name)} (${s.yearName})` });
      return {
        from: { id: from.id, label: sectionLabel(from.className, from.name), yearName: from.yearName },
        students: people,
        graduating: from.grade >= topGrade,
        promoteTargets: later.filter((s) => s.grade > from.grade).map(option),
        retainTargets: later.filter((s) => s.classId === from.classId).map(option),
      };
    });
  }

  /**
   * Promote the active students of one section. Everyone moves to `toSectionId` (a later year's section of a higher class)
   * except the `retainedIds` (to `retainSectionId`, same class) and the `leftIds`. In the last class everyone graduates
   * and becomes an alumnus. Enrolment history is written for both years.
   */
  async promote(input: unknown) {
    const d = this.parse(promoteInput, input);
    return this.write("write", async (tx) => {
      const from = await this.section(tx, d.fromSectionId, "fromSectionId");
      const graduating = from.grade >= (await this.topGrade(tx));
      const people = await tx.select({ id: students.id }).from(students)
        .where(and(eq(students.sectionId, from.id), eq(students.status, "active"))).orderBy(asc(students.name));
      if (people.length === 0) throw new ValidationError({ fromSectionId: "This section has no active students" });
      const mine = new Set(people.map((p) => p.id));
      for (const id of [...d.retainedIds, ...d.leftIds]) if (!mine.has(id)) throw new ValidationError({ retainedIds: "Some students are not in this section" });
      if (d.retainedIds.some((id) => d.leftIds.includes(id))) throw new ValidationError({ leftIds: "A student cannot both repeat and leave" });

      const target = graduating ? null : await this.later(tx, d.toSectionId, "toSectionId", from, (t) => t.grade > from.grade, "Choose a section of a higher class in a later year");
      if (!graduating && !target) throw new ValidationError({ toSectionId: "Choose where this class moves to" });
      const retainTo = d.retainedIds.length
        ? await this.later(tx, d.retainSectionId, "retainSectionId", from, (t) => t.classId === from.classId, "Choose this class's section in the later year")
        : null;
      if (d.retainedIds.length && !retainTo) throw new ValidationError({ retainSectionId: "Choose where students who repeat the year go" });

      const tally = { promoted: 0, retained: 0, left: 0, graduated: 0 };
      const nextRoll = new Map<string, number>();
      const rollIn = async (sectionId: string) => {
        if (!nextRoll.has(sectionId)) {
          const [r] = await tx.select({ top: max(students.rollNo) }).from(students).where(and(eq(students.sectionId, sectionId), eq(students.status, "active")));
          nextRoll.set(sectionId, r?.top ?? 0);
        }
        const n = nextRoll.get(sectionId)! + 1;
        nextRoll.set(sectionId, n);
        return n;
      };
      const closeOld = (studentId: string, outcome: "promoted" | "retained" | "left" | "graduated") =>
        tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId, yearId: from.yearId, classId: from.classId, sectionId: from.id, outcome })
          .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { outcome } });

      for (const { id } of people) {
        if (d.leftIds.includes(id)) {
          await closeOld(id, "left");
          await tx.update(students).set({ status: "left", leftOn: today() }).where(eq(students.id, id));
          tally.left++;
        } else if (graduating && !d.retainedIds.includes(id)) {
          await closeOld(id, "graduated");
          await tx.update(students).set({ status: "alumni", leftOn: today() }).where(eq(students.id, id));
          tally.graduated++;
        } else {
          const retained = d.retainedIds.includes(id);
          const dest = (retained ? retainTo : target)!;
          const rollNo = await rollIn(dest.id);
          await closeOld(id, retained ? "retained" : "promoted");
          await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: id, yearId: dest.yearId, classId: dest.classId, sectionId: dest.id, rollNo, outcome: "studying" })
            .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { classId: dest.classId, sectionId: dest.id, rollNo, outcome: "studying" } });
          await tx.update(students).set({ classId: dest.classId, sectionId: dest.id, rollNo }).where(eq(students.id, id));
          tally[retained ? "retained" : "promoted"]++;
        }
      }
      return { ...tally, from: sectionLabel(from.className, from.name) };
    }, (r) => ({
      action: "promote", entity: "Student",
      summary: `Promoted ${r.from}: ${r.promoted} moved up, ${r.retained} repeat, ${r.left} left, ${r.graduated} graduated`, meta: { ...r },
    }));
  }

  /** A section in a later year than `from` that passes `rule`, or a field error. */
  private async later(tx: Tx, id: string | undefined, field: string, from: SectionInfo, rule: (t: SectionInfo) => boolean, message: string) {
    if (!id) return null;
    const t = await this.section(tx, id, field);
    if (t.yearStart <= from.yearStart || !rule(t)) throw new ValidationError({ [field]: message });
    return t;
  }
}
