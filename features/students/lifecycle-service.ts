import { and, asc, eq, lte } from "drizzle-orm";
import type { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ConflictError, LimitError, ValidationError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { notifications } from "@smw/feature-notifications/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { StudentRecordService } from "./access";
import { capacityOf, currentYearSection, lockSchool, lockSections, nextRollIn } from "./capacity";
import { billsOfYear, booksOut, busOf, feesHref, moneyOf, type Bus, type Money } from "./guarded";
import { bringBackInput, joiningDayInput, leaveInput, withdrawInput } from "./inputs";
import { closeRecord } from "./leave";
import { studentEnrollments, students, WITHDREW_BEFORE_JOINING } from "./schema";
import { addDays, dayInYear, planDay, sectionLabel, today } from "./util";

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
      // Lock order: the school (plan count), the section (roll number), then the child. The plan is read before the child is locked, so it is checked again after.
      const [peek] = await tx.select({ planned: students.joinsSectionId }).from(students).where(eq(students.id, id)).limit(1);
      if (!peek) return { state: "skipped" };
      await lockSchool(tx, this.ctx.schoolId);
      await lockSections(tx, peek.planned);
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s || s.status !== "joining" || !s.joinsOn || (!force && s.joinsOn > onDay)) return { state: "skipped" };
      if (s.joinsSectionId !== peek.planned) {
        if (force) throw new ConflictError(`${s.name} was changed a moment ago. Open the record and try again.`);
        return { state: "skipped" };
      }
      const b = await this.blocker(tx, s);
      if (!("section" in b)) {
        if (!force) await this.tellWaiting(tx, s, b.reason, b.message);
        return { state: "waiting", reason: b.reason, message: b.message };
      }
      const section = b.section;
      const rollNo = await nextRollIn(tx, section.id);
      // The admission date is the first day: the planned day, or today when the office starts them early.
      await tx.update(students).set({ status: "active", classId: section.classId, sectionId: section.id, rollNo, admissionDate: force ? onDay : s.joinsOn }).where(eq(students.id, s.id));
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

  /**
   * Change the joining day, and with it the year, the planned section and the class (the class follows the section, or is chosen).
   * Bills already made for the joining year are checked first: a new day only asks the office to look at them, a new class or year is refused until they are cancelled or credited.
   */
  async setJoiningDay(id: string, input: unknown) {
    const d = this.parse(joiningDayInput, input);
    const given = (input ?? {}) as Record<string, unknown>;
    return this.write("write", async (tx) => {
      const s = await this.joiningStudent(tx, id);
      const now = today();
      if (d.joinsOn < now) throw new ValidationError({ joinsOn: "Choose today or a later day. To start now, use Start now." });
      const yearId = d.joinsYearId ?? s.joinsYearId!;
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
      if (!year) throw new ValidationError({ joinsYearId: "Choose a year that exists" });
      const [current] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (current && !year.isCurrent && year.startsOn < current.startsOn) throw new ValidationError({ joinsYearId: "Choose the current year or a later one" });
      const dayError = dayInYear(year, d.joinsOn);
      if (dayError) throw new ValidationError({ joinsOn: dayError });
      const yearChanged = yearId !== s.joinsYearId;
      // A key that is left out keeps the plan, unless the year changed (a section belongs to one year).
      const planned = "joinsSectionId" in given ? d.joinsSectionId ?? null : yearChanged ? null : s.joinsSectionId;
      let classId = d.classId ?? s.classId;
      if (planned) {
        const [section] = await tx.select().from(sections).where(eq(sections.id, planned)).limit(1);
        if (!section || section.yearId !== year.id) throw new ValidationError({ joinsSectionId: `Choose a section of ${year.name}` });
        classId = section.classId;
      } else if (d.classId) {
        const [c] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, d.classId)).limit(1);
        if (!c) throw new ValidationError({ classId: "Choose a class" });
      }
      const bills = await billsOfYear(tx, this.ctx.schoolId, s.id, s.joinsYearId!);
      const [oldYear] = await tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, s.joinsYearId!)).limit(1);
      const billsNote = bills ? billsMessage(bills, oldYear?.name ?? "the joining year") : null;
      if (bills && (yearChanged || (classId ?? null) !== (s.classId ?? null))) {
        const why = `${billsNote}. The class and the year cannot change until those bills are cancelled or credited.`;
        throw new ValidationError({ [yearChanged ? "joinsYearId" : "joinsSectionId"]: why, _open: feesHref(s.id) }, why);
      }
      // The one enrolment follows the year: moved to the new year, or merged into a closed row that year already has.
      const rows = await tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, s.id));
      const old = rows.find((r) => r.yearId === s.joinsYearId), other = rows.find((r) => r.yearId === year.id && r.id !== old?.id);
      if (yearChanged && other) {
        if (old) await tx.delete(studentEnrollments).where(eq(studentEnrollments.id, old.id));
        await tx.update(studentEnrollments).set({ classId: classId ?? null, sectionId: null, rollNo: null, outcome: "studying" }).where(eq(studentEnrollments.id, other.id));
      } else if (old) await tx.update(studentEnrollments).set({ yearId: year.id, classId: classId ?? null }).where(eq(studentEnrollments.id, old.id));
      await tx.update(students).set({ joinsOn: d.joinsOn, joinsYearId: year.id, joinsSectionId: planned, classId: classId ?? null, admissionDate: d.joinsOn }).where(eq(students.id, s.id));
      await this.audit(tx, { action: "change_joining_day", entity: "Student", entityId: s.id, summary: `Changed the joining day of ${s.name} (${s.admissionNo}) to ${d.joinsOn}`, meta: { joinsOn: [s.joinsOn, d.joinsOn], joinsYearId: [s.joinsYearId, year.id], joinsSectionId: [s.joinsSectionId, planned], classId: [s.classId, classId ?? null] } });
      return { id: s.id, joinsOn: d.joinsOn, billsNote };
    });
  }

  /** The child will not come. They become "left" with that reason (the words go in the note); the enrolment closes, the login stays off, and the number is never used again. */
  async withdraw(id: string, input: unknown) {
    const d = this.parse(withdrawInput, input);
    return this.write("write", async (tx) => {
      const s = await this.joiningStudent(tx, id);
      await tx.update(students).set({ status: "left", leftOn: null, leftReason: WITHDREW_BEFORE_JOINING, leftNote: d.reason, accessUntil: null }).where(eq(students.id, s.id));
      await tx.update(studentEnrollments).set({ outcome: "left" }).where(and(eq(studentEnrollments.studentId, s.id), eq(studentEnrollments.outcome, "studying")));
      await this.audit(tx, { action: "withdraw", entity: "Student", entityId: s.id, summary: `${s.name} (${s.admissionNo}) withdrew before joining`, meta: { reason: d.reason } });
      return { id: s.id, name: s.name };
    });
  }

  // ---------- what the dialogs say before a button is pressed ----------

  /** For a child who is joining: the bills already made for the year, and why starting them now would be refused (or null). */
  async joiningInfo(id: string) {
    return this.read("write", async (tx) => {
      const s = await this.visibleStudent(tx, id);
      if (s.status !== "joining") return { bills: 0, yearName: null as string | null, feesHref: feesHref(id), startBlocked: null as string | null, hasSection: false };
      const [year] = s.joinsYearId ? await tx.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.id, s.joinsYearId)).limit(1) : [];
      const b = await this.blocker(tx, s);
      return { bills: s.joinsYearId ? await billsOfYear(tx, this.ctx.schoolId, id, s.joinsYearId) : 0, yearName: year?.name ?? null, feesHref: feesHref(id), startBlocked: "section" in b ? null : b.message, hasSection: !!s.joinsSectionId };
    });
  }

  /** What is still open for a child who is about to leave, or who withdraws. The people who own each thing still handle it: nothing here blocks. */
  async openItems(id: string): Promise<OpenItems> {
    return this.read("write", async (tx) => {
      const s = await this.visibleStudent(tx, id);
      return { money: await moneyOf(tx, this.ctx.schoolId, s.id), books: await booksOut(tx, this.ctx.schoolId, s.id), bus: await busOf(tx, this.ctx.schoolId, s.id), feesHref: feesHref(s.id) };
    });
  }

  /** Why a child cannot be brought back into this year right now (null when they can). */
  async bringBackBlocked(): Promise<string | null> {
    return this.read("write", async (tx) => {
      const cap = await capacityOf(tx, this.ctx.schoolId);
      return cap.active + 1 > cap.hardLimit ? `Your plan allows ${cap.cap} students and admissions stop at ${cap.hardLimit}. Upgrade the plan to bring this student back into this year.` : null;
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
      await closeRecord(tx, s.id, "left", lastDay, d.reason, d.note);
      await this.audit(tx, { action: "leave", entity: "Student", entityId: s.id, summary: `${s.name} (${s.admissionNo}) left the school (last day ${lastDay})`, meta: { lastDay, reason: d.reason } });
      return { id: s.id, name: s.name, lastDay };
    });
  }

  /**
   * Bring back a student who left (or graduated). Into this year: a section of the current year, the plan must have room, the login is on again.
   * For a later day and year: they become joining again, with no plan check until their day. Either way the admission number stays, the old closed
   * enrolment of that year is reused, and the reason and words for leaving are cleared into the audit log.
   */
  async bringBack(id: string, input: unknown) {
    const d = this.parse(bringBackInput, input);
    return this.write("write", async (tx) => {
      const [peek] = await tx.select().from(students).where(eq(students.id, id)).limit(1);
      if (!peek) throw new ConflictError("Student not found.");
      if (peek.status !== "left" && peek.status !== "alumni") throw new ConflictError("Only a student who left can be brought back.");
      const [login] = peek.userId ? await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, peek.userId)).limit(1) : [];
      if (login?.loginId.startsWith("erased-")) throw new ConflictError("This student's details were erased, so they cannot be brought back.");
      const now = today();
      const [current] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      const later = (!!d.joinsYearId && d.joinsYearId !== current?.id) || (!!d.joinsOn && d.joinsOn > now);
      if (later) return this.bringBackLater(tx, peek, d, current);
      if (!d.sectionId) throw new ValidationError({ sectionId: "Choose a class and section" });
      await lockSchool(tx, this.ctx.schoolId);
      const cap = await capacityOf(tx, this.ctx.schoolId);
      if (cap.active + 1 > cap.hardLimit) throw new LimitError(`Your plan allows ${cap.cap} students and admissions stop at ${cap.hardLimit}. Upgrade the plan to bring this student back.`);
      const section = await currentYearSection(tx, d.sectionId);
      await lockSections(tx, section.id);
      const [s] = await tx.select().from(students).where(eq(students.id, id)).for("update").limit(1);
      if (!s || (s.status !== "left" && s.status !== "alumni")) throw new ConflictError("Only a student who left can be brought back.");
      const rollNo = await nextRollIn(tx, section.id);
      await tx.update(students).set({ status: "active", classId: section.classId, sectionId: section.id, rollNo, leftOn: null, leftReason: null, leftNote: null, accessUntil: null, joinsOn: null, joinsYearId: null, joinsSectionId: null }).where(eq(students.id, s.id));
      await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: s.id, yearId: section.yearId, classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" })
        .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { classId: section.classId, sectionId: section.id, rollNo, outcome: "studying" } });
      if (s.userId) await tx.update(users).set({ status: "active" }).where(eq(users.id, s.userId));
      await this.audit(tx, { action: "bring_back", entity: "Student", entityId: s.id, summary: `Brought ${s.name} (${s.admissionNo}) back`, meta: { sectionId: section.id, cleared: { leftReason: s.leftReason, leftNote: s.leftNote, leftOn: s.leftOn } } });
      return { id: s.id, name: s.name, joining: false, warnings: await this.keptStop(tx, s.id) };
    });
  }

  private async bringBackLater(tx: Tx, peek: Student, d: z.infer<typeof bringBackInput>, current: typeof academicYears.$inferSelect | undefined) {
    const yearId = d.joinsYearId ?? current?.id;
    const [year] = yearId ? await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1) : [];
    if (!year) throw new ValidationError({ joinsYearId: "Choose the academic year they join" });
    if (current && !year.isCurrent && year.startsOn < current.startsOn) throw new ValidationError({ joinsYearId: "Choose the current year or a later one" });
    const plan = planDay(year, year.isCurrent, d.joinsOn);
    if (plan.error) throw new ValidationError({ joinsOn: plan.error });
    if (!plan.joining || !plan.day) throw new ValidationError({ joinsOn: "Choose a day after today, or bring them into this year." });
    const [section] = d.joinsSectionId ? await tx.select().from(sections).where(eq(sections.id, d.joinsSectionId)).limit(1) : [];
    if (d.joinsSectionId && (!section || section.yearId !== year.id)) throw new ValidationError({ joinsSectionId: `Choose a section of ${year.name}` });
    const classId = section?.classId ?? d.classId;
    if (!classId) throw new ValidationError({ classId: "Choose the class they will join" });
    if (!section) { const [c] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).limit(1); if (!c) throw new ValidationError({ classId: "Choose a class" }); }
    const [s] = await tx.select().from(students).where(eq(students.id, peek.id)).for("update").limit(1);
    if (!s || (s.status !== "left" && s.status !== "alumni")) throw new ConflictError("Only a student who left can be brought back.");
    await tx.update(students).set({
      status: "joining", classId, sectionId: null, rollNo: null, leftOn: null, leftReason: null, leftNote: null, accessUntil: null,
      joinsOn: plan.day, joinsYearId: year.id, joinsSectionId: section?.id ?? null, admissionDate: plan.day,
    }).where(eq(students.id, s.id));
    await tx.insert(studentEnrollments).values({ schoolId: this.ctx.schoolId, studentId: s.id, yearId: year.id, classId, sectionId: null, rollNo: null, outcome: "studying" })
      .onConflictDoUpdate({ target: [studentEnrollments.studentId, studentEnrollments.yearId], set: { classId, sectionId: null, rollNo: null, outcome: "studying" } });
    if (s.userId) await tx.update(users).set({ status: "disabled" }).where(eq(users.id, s.userId));
    await this.audit(tx, { action: "bring_back", entity: "Student", entityId: s.id, summary: `Brought ${s.name} (${s.admissionNo}) back to join on ${plan.day}`, meta: { joinsOn: plan.day, joinsYearId: year.id, cleared: { leftReason: s.leftReason, leftNote: s.leftNote, leftOn: s.leftOn } } });
    return { id: s.id, name: s.name, joining: true, warnings: await this.keptStop(tx, s.id) };
  }

  /** A bus stop that was kept while the child was away is never counted silently: the office is told, and told when the bus has no seat left. */
  private async keptStop(tx: Tx, studentId: string): Promise<string[]> {
    const bus = await busOf(tx, this.ctx.schoolId, studentId);
    if (!bus) return [];
    const full = bus.capacity != null && bus.riders + 1 > bus.capacity;
    return [`Their bus stop ${bus.stop} on ${bus.route} was kept.${full ? ` The bus has ${bus.capacity} seats and ${bus.riders} children already ride it, so check the seat with transport.` : " Check it is still right."}`];
  }
}

export interface OpenItems { money: Money; books: number; bus: Bus | null; feesHref: string }

/** "2 bills are already issued for 2027-28, check them". */
export const billsMessage = (n: number, yearName: string) => `${n} ${n === 1 ? "bill is" : "bills are"} already issued for ${yearName}, check ${n === 1 ? "it" : "them"}`;
