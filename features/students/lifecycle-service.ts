import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, LimitError, ValidationError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { notifications } from "@smw/feature-notifications/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { capacityOf, currentYearSection, nextRollIn } from "./capacity";
import { bringBackInput, joiningDayInput, leaveInput, withdrawInput } from "./inputs";
import { studentEnrollments, students, WITHDREW_BEFORE_JOINING } from "./schema";
import { addDays, leftReasonCode, sectionLabel, today } from "./util";

type Student = typeof students.$inferSelect;
export interface JoinTally { joined: number; waiting: number; failed: number; failures: string[] }
type JoinResult =
  | { state: "skipped" }
  | { state: "waiting"; reason: WaitReason; message: string }
  | { state: "joined"; id: string; name: string; label: string };
type WaitReason = "no_section" | "plan_full";

/** The last day attended may be today or in the past, up to a year back. */
const LAST_DAY_YEARS_BACK = 365;

/**
 * A child's life in the school after admission: starting on the joining day, changing or cancelling it, leaving, and coming back.
 * Each method is one transaction that changes the student, the year's enrolment and the login together.
 */
export class LifecycleService extends StudentRecordService {
  // ---------- joining ----------

  /**
   * Make every child whose joining day has come an active student. Safe to run again: a child who already started is skipped.
   * Each child is its own transaction, so one failure never stops the rest. Works on the child's own year, whether or not the school has switched the current year.
   */
  async joinDue(onDay = today()): Promise<JoinTally> {
    const due = await this.read("write", (tx) => tx.select({ id: students.id }).from(students)
      .where(and(eq(students.status, "joining"), lte(students.joinsOn, onDay))).orderBy(asc(students.joinsOn), asc(students.createdAt)));
    const tally: JoinTally = { joined: 0, waiting: 0, failed: 0, failures: [] };
    for (const { id } of due) {
      try {
        const r = await this.joinOne(id, onDay, false);
        if (r.state === "joined") tally.joined++;
        else if (r.state === "waiting") tally.waiting++;
      } catch (err) {
        tally.failed++;
        tally.failures.push(`${id}: ${String(err)}`);
        console.error(JSON.stringify({ level: "error", msg: "student could not join", schoolId: this.ctx.schoolId, studentId: id, err: String(err) }));
      }
    }
    return tally;
  }

  /** The office starts a child before their day. Refused, with the reason, when there is no section or no room. */
  async startNow(id: string) {
    const r = await this.joinOne(id, today(), true);
    if (r.state === "skipped") throw new ConflictError("This child is not waiting to join.");
    if (r.state === "waiting") throw new ConflictError(r.message);
    return r;
  }

  /** The planned section, or the reason this child cannot start. */
  private async blocker(tx: Tx, s: Student): Promise<{ section: typeof sections.$inferSelect } | { reason: WaitReason; message: string }> {
    const [section] = s.joinsSectionId ? await tx.select().from(sections).where(eq(sections.id, s.joinsSectionId)).limit(1) : [];
    if (!section || section.yearId !== s.joinsYearId) return { reason: "no_section", message: `${s.name} has no planned section. Choose one on the student's page, then start them.` };
    const cap = await capacityOf(tx, this.ctx.schoolId);
    if (cap.active + 1 > cap.hardLimit) return { reason: "plan_full", message: `Your plan allows ${cap.cap} students and starting stops at ${cap.hardLimit}. Upgrade the plan to start ${s.name}.` };
    return { section };
  }

  private joinOne(id: string, onDay: string, force: boolean): Promise<JoinResult> {
    return this.write("write", async (tx): Promise<JoinResult> => {
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s || s.status !== "joining" || !s.joinsOn || (!force && s.joinsOn > onDay)) return { state: "skipped" };
      const b = await this.blocker(tx, s);
      if (!("section" in b)) {
        if (!force) await this.tellWaiting(tx, s, b.reason, b.message);
        return { state: "waiting", reason: b.reason, message: b.message };
      }
      const section = b.section;
      const rollNo = await nextRollIn(tx, section.id);
      await tx.update(students).set({ status: "active", classId: section.classId, sectionId: section.id, rollNo }).where(eq(students.id, s.id));
      await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: s.id, yearId: s.joinsYearId!, classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" })
        .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" } });
      if (s.userId) await tx.update(users).set({ status: "active" }).where(eq(users.id, s.userId));
      const [klass] = await tx.select({ name: classes.name }).from(classes).where(eq(classes.id, section.classId)).limit(1);
      const label = sectionLabel(klass?.name ?? "", section.name);
      await this.audit(tx, { action: "join", entity: "Student", entityId: s.id, summary: `${s.name} (${s.admissionNo}) joined ${label}`, meta: { joinsOn: s.joinsOn, early: s.joinsOn > onDay } });
      if (this.ctx.features.has("notifications") && section.classTeacherId) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{
          userId: section.classTeacherId, topic: "work.update", title: `${s.name} joined your class`, body: `${label}, roll number ${rollNo}.`,
          href: `/app/students/${s.id}`, subject: { type: "student", id: s.id }, groupKey: `student-joined:${s.id}`, privateBody: true,
        }]);
      }
      return { state: "joined", id: s.id, name: s.name, label };
    });
  }

  /** The office hears of a child who cannot start, once per reason. The job runs every night, so the row is looked up before it is written. */
  private async tellWaiting(tx: Tx, s: Student, reason: WaitReason, message: string) {
    if (!this.ctx.features.has("notifications")) return;
    const groupKey = `student-join-waits:${s.id}:${reason}`;
    const [told] = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.subjectId, s.id), eq(notifications.groupKey, groupKey))).limit(1);
    if (told) return;
    const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, this.ctx.schoolId), eq(users.role, "admin"), eq(users.status, "active")));
    await NotificationWriter.insert(tx, this.ctx.schoolId, admins.map((a) => ({
      userId: a.id, topic: "work.update" as const, title: `${s.name} cannot start yet`, body: message, href: `/app/students/${s.id}`,
      subject: { type: "student", id: s.id }, groupKey, action: true, privateBody: true,
    })));
  }

  /** A new joining day (today or later) and, if wanted, another planned section of the year they join. */
  async setJoiningDay(id: string, input: unknown) {
    const d = this.parse(joiningDayInput, input);
    return this.write("write", async (tx) => {
      const s = await this.joiningStudent(tx, id);
      if (d.joinsOn < today()) throw new ValidationError({ joinsOn: "Choose today or a later day. To start now, use Start now." });
      let planned = s.joinsSectionId;
      if (d.joinsSectionId && d.joinsSectionId !== planned) {
        const [section] = await tx.select().from(sections).where(eq(sections.id, d.joinsSectionId)).limit(1);
        if (!section || section.yearId !== s.joinsYearId) throw new ValidationError({ joinsSectionId: "Choose a section of the year they join" });
        planned = section.id;
        await tx.update(studentEnrollments).set({ classId: section.classId }).where(and(eq(studentEnrollments.studentId, s.id), eq(studentEnrollments.yearId, section.yearId)));
        await tx.update(students).set({ classId: section.classId }).where(eq(students.id, s.id));
      }
      await tx.update(students).set({ joinsOn: d.joinsOn, joinsSectionId: planned }).where(eq(students.id, s.id));
      await this.audit(tx, { action: "change_joining_day", entity: "Student", entityId: s.id, summary: `Changed the joining day of ${s.name} (${s.admissionNo}) to ${d.joinsOn}`, meta: { joinsOn: [s.joinsOn, d.joinsOn], joinsSectionId: [s.joinsSectionId, planned] } });
      return { id: s.id, joinsOn: d.joinsOn };
    });
  }

  /** The child will not come. They become "left" with that reason; the enrolment closes, the login stays off, and the number is never used again. */
  async withdraw(id: string, input: unknown) {
    const d = this.parse(withdrawInput, input);
    return this.write("write", async (tx) => {
      const s = await this.joiningStudent(tx, id);
      await tx.update(students).set({ status: "left", leftOn: null, leftReason: WITHDREW_BEFORE_JOINING }).where(eq(students.id, s.id));
      await tx.update(studentEnrollments).set({ outcome: "left" }).where(and(eq(studentEnrollments.studentId, s.id), eq(studentEnrollments.outcome, "studying")));
      await this.audit(tx, { action: "withdraw", entity: "Student", entityId: s.id, summary: `${s.name} (${s.admissionNo}) withdrew before joining`, meta: { reason: d.reason } });
      return { id: s.id, name: s.name };
    });
  }

  private async joiningStudent(tx: Tx, id: string): Promise<Student> {
    const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
    if (!s) throw new ConflictError("Student not found.");
    if (s.status !== "joining") throw new ConflictError("This child is not waiting to join.");
    return s;
  }

  // ---------- leaving ----------

  /**
   * Mark an active student as left on the last day they attended (today, or up to a year ago). The year's enrolment closes as "left",
   * the last section stays on the record for papers, and the plan count and every register stop counting them.
   */
  async markLeft(id: string, input: unknown) {
    const d = this.parse(leaveInput, input);
    return this.write("write", async (tx) => {
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s) throw new ConflictError("Student not found.");
      if (s.status === "joining") throw new ConflictError("This child has not started yet. Use Withdraw before joining.");
      if (s.status !== "active") throw new ConflictError("This student has already left.");
      const now = today();
      const lastDay = d.lastDay ?? now;
      if (lastDay > now) throw new ValidationError({ lastDay: "The last day cannot be in the future" });
      if (lastDay < addDays(now, -LAST_DAY_YEARS_BACK)) throw new ValidationError({ lastDay: "The last day can be at most a year ago" });
      await this.closeRecord(tx, s.id, "left", lastDay, leftReasonCode(d.reason, d.note));
      await this.audit(tx, { action: "leave", entity: "Student", entityId: s.id, summary: `${s.name} (${s.admissionNo}) left the school (last day ${lastDay})`, meta: { lastDay, reason: d.reason } });
      return { id: s.id, name: s.name, lastDay };
    });
  }

  /** What leaving (or graduating) does to the record, also used by promotion. Keeps `section_id`. */
  async closeRecord(tx: Tx, id: string, outcome: "left" | "graduated", lastDay: string, reason: string) {
    await tx.update(students).set({ status: outcome === "graduated" ? "alumni" : "left", leftOn: lastDay, leftReason: reason }).where(eq(students.id, id));
    // Only years that have begun: a year still to come is no part of this child's schooling.
    await tx.update(studentEnrollments).set({ outcome }).where(and(eq(studentEnrollments.studentId, id), eq(studentEnrollments.outcome, "studying"),
      inArray(studentEnrollments.yearId, tx.select({ id: academicYears.id }).from(academicYears).where(lte(academicYears.startsOn, today())))));
  }

  /** Bring a student who left (or graduated) back: the plan must have room, they get a section of the current year, and their login is on again. */
  async bringBack(id: string, input: unknown) {
    const d = this.parse(bringBackInput, input);
    return this.write("write", async (tx) => {
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s) throw new ConflictError("Student not found.");
      if (s.status !== "left" && s.status !== "alumni") throw new ConflictError("Only a student who left can be brought back.");
      const [login] = s.userId ? await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, s.userId)).limit(1) : [];
      if (login?.loginId.startsWith("erased-")) throw new ConflictError("This student's details were erased, so they cannot be brought back.");
      const cap = await capacityOf(tx, this.ctx.schoolId);
      if (cap.active + 1 > cap.hardLimit) throw new LimitError(`Your plan allows ${cap.cap} students and admissions stop at ${cap.hardLimit}. Upgrade the plan to bring this student back.`);
      const section = await currentYearSection(tx, d.sectionId);
      const rollNo = await nextRollIn(tx, section.id);
      await tx.update(students).set({ status: "active", classId: section.classId, sectionId: section.id, rollNo, leftOn: null, leftReason: null }).where(eq(students.id, s.id));
      await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: s.id, yearId: section.yearId, classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" })
        .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" } });
      if (s.userId) await tx.update(users).set({ status: "active" }).where(eq(users.id, s.userId));
      await this.audit(tx, { action: "bring_back", entity: "Student", entityId: s.id, summary: `Brought ${s.name} (${s.admissionNo}) back`, meta: { sectionId: section.id } });
      return { id: s.id, name: s.name };
    });
  }
}
