import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { finApprovals, finJournals } from "@smw/feature-finance/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { FeesBase, studentTag } from "../base";
import { feeReminderStops } from "../schema";

/**
 * Small reads the fee screens share and no fee service offers: finding a student to bill, the classes and years to
 * pick from, and the ledger entry behind a document. Read-only; every write goes through a fee service.
 */
export class FeesLookup extends FeesBase {
  /** Students matching a name or admission number, for a picker. Staff only. */
  async students(q: string) {
    if (q.trim().length < 2) return [];
    return this.read("read", async (tx) => {
      const like = `%${q.trim()}%`;
      const rows = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, status: students.status, joinsOn: students.joinsOn, leftOn: students.leftOn, leftReason: students.leftReason, classLabel: sql<string>`coalesce(${classes.name} || coalesce('-' || ${sections.name}, ''), '-')` })
        .from(students).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
        .where(or(ilike(students.name, like), ilike(students.admissionNo, like))).orderBy(asc(students.name)).limit(8);
      return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.admissionNo} · ${r.classLabel}${studentTag(r) ? ` · ${studentTag(r)}` : ""}` }));
    });
  }

  /** Does the school have any student yet? Pickers and the counter say so, with a link to add them, instead of an empty search box. */
  async hasStudents() {
    return this.read("read", async (tx) => ((await tx.select({ id: students.id }).from(students).limit(1)).length > 0));
  }

  /** Transport routes, when the transport module is installed (its table may not exist). */
  async routes() {
    return this.read("read", async (tx) => {
      const [t] = [...(await tx.execute<{ r: string | null }>(sql`select to_regclass('routes') r`))];
      return t?.r ? [...(await tx.execute<{ id: string; name: string }>(sql`select id, name from routes order by name`))] : [];
    });
  }

  /** Why this student's reminders are stopped, or null when they are not. */
  async reminderStop(studentId: string) {
    return this.read("read", async (tx) => (await tx.select({ reason: feeReminderStops.reason }).from(feeReminderStops).where(eq(feeReminderStops.studentId, studentId)))[0]?.reason ?? null);
  }

  /** One student as a picker option, or null when the id is not a student of this school. */
  async studentOption(studentId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(studentId)) return null;
    return this.read("read", async (tx) => { const [s] = await this.studentLines(tx, eq(students.id, studentId)); return s ? { id: s.id, label: s.name, meta: `${s.admissionNo} · ${s.classLabel}${studentTag(s) ? ` · ${studentTag(s)}` : ""}` } : null; });
  }

  /** Classes with their sections, for the filters and for billing a whole class. */
  async classes() {
    return this.read("read", async (tx) => {
      const year = await this.currentYear(tx);
      const [cls, secs] = await Promise.all([
        tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.grade)),
        tx.select({ id: sections.id, classId: sections.classId, name: sections.name }).from(sections).where(eq(sections.yearId, year.id)).orderBy(asc(sections.name)),
      ]);
      return cls.map((c) => ({ ...c, sections: secs.filter((s) => s.classId === c.id).map((s) => ({ id: s.id, name: s.name })) }));
    });
  }

  /** Active students of a class (and section): who a group bill would reach. */
  async group(classId: string, sectionId?: string) {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo }).from(students)
        .where(and(eq(students.classId, classId), eq(students.status, "active"), sectionId ? eq(students.sectionId, sectionId) : undefined)).orderBy(asc(students.name)).limit(500);
      return rows;
    });
  }

  async years() {
    return this.read("read", async (tx) => (await tx.select({ id: academicYears.id, name: academicYears.name, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn, isCurrent: academicYears.isCurrent }).from(academicYears).orderBy(desc(academicYears.startsOn))));
  }

  /** The ledger entry a bill, receipt or note posted, by its source key. */
  async journalIds(sourceKeys: string[]) {
    return this.read("read", async (tx) => new Map((await tx.select({ id: finJournals.id, key: finJournals.sourceKey }).from(finJournals).where(and(inArray(finJournals.sourceKey, sourceKeys), sql`${finJournals.reversesId} is null`))).map((j) => [j.key, j.id])));
  }

  /** How many fee requests wait for a decision, for the dashboard. */
  async pendingRequests() {
    return this.read("read", async (tx) => Number((await tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(and(eq(finApprovals.status, "pending"), sql`${finApprovals.kind} like 'fees.%'`)))[0]?.n ?? 0));
  }
}
