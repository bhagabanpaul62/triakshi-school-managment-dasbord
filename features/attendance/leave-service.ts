import { and, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import attendanceFeature from "./feature";
import { notice, sendMails, type AlertMail } from "./alerts";
import { FileStore, type StoredRef, type UploadedFile } from "./files";
import { leaveApplyInput, leaveDecisionInput, leaveEditInput, leaveReverseInput } from "./inputs";
import { attendanceHolidays, leaveRequests, staffAttendance, studentAttendance } from "./schema";
import { addDays, isDate, isSunday, todayIST } from "./stats";

type Perm = keyof typeof attendanceFeature.permissions;
export type LeaveRow = {
  id: string; kind: "student" | "staff"; who: string; section: string | null; fromDate: string; toDate: string; reason: string;
  status: (typeof leaveRequests.$inferSelect)["status"]; note: string | null; decidedAt: Date | null; fileName: string | null; fileUrl: string | null; canDecide: boolean;
  /** A decided request the caller may turn around. */
  canReverse: boolean;
  /** The requester may still change a waiting request. */
  canEdit: boolean;
};

const MAX_DAYS = 60;
const BACKDATE_DAYS = 30;
/** The note on the daily rows an approval wrote, so a reversal removes only those. */
const LEAVE_NOTE = "On approved leave";

/** Leave requests: a student or staff member applies, the class teacher or the admin decides, approval marks the days as leave. */
export class LeaveService extends SchoolService<Perm> {
  protected feature = attendanceFeature;
  private readonly files = new FileStore(this.ctx.schoolId, "leave");

  constructor(ctx: Ctx) { super(ctx); }

  private myStudentIds(tx: Tx) {
    return tx.select({ id: students.id, name: students.name }).from(students).where(eq(students.userId, this.ctx.userId)).orderBy(students.name);
  }

  /** For a student login: the students it may apply for. Empty for staff. */
  async applicants(): Promise<{ id: string; name: string }[]> {
    return this.read("leave", (tx) => (this.ctx.role === "student" ? this.myStudentIds(tx) : Promise.resolve([])));
  }

  async apply(input: unknown, upload?: UploadedFile) {
    this.authorize("leave", "write");
    const data = this.parse(leaveApplyInput, input);
    this.assertRange(data);

    const ref = upload ? await this.files.put(upload) : null;
    try {
      return await this.applyTx(data, ref);
    } catch (e) { await this.files.remove(ref?.fileKey ?? null); throw e; }
  }

  /** The dates a request may cover: real, in order, not too far back, not too long. Shared by apply and edit. */
  private assertRange(data: { fromDate: string; toDate: string }) {
    if (!isDate(data.fromDate) || !isDate(data.toDate)) throw new ValidationError({ fromDate: "Pick valid dates" });
    if (data.toDate < data.fromDate) throw new ValidationError({ toDate: "The last day cannot be before the first day" });
    if (data.fromDate < addDays(todayIST(), -BACKDATE_DAYS)) throw new ValidationError({ fromDate: `Leave can start at most ${BACKDATE_DAYS} days back` });
    if (data.toDate > addDays(data.fromDate, MAX_DAYS - 1)) throw new ValidationError({ toDate: `Ask for at most ${MAX_DAYS} days at a time` });
  }

  /** One person cannot have two live requests (waiting or approved) over the same days. */
  private async assertNoClash(tx: Tx, who: { studentId: string | null; userId: string | null }, from: string, to: string, exceptId?: string) {
    const clash = await tx.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
      who.studentId ? eq(leaveRequests.studentId, who.studentId) : eq(leaveRequests.userId, who.userId!),
      inArray(leaveRequests.status, ["pending", "approved"]), lte(leaveRequests.fromDate, to), gte(leaveRequests.toDate, from),
      exceptId ? ne(leaveRequests.id, exceptId) : undefined)).limit(1);
    if (clash.length) throw new ValidationError({ fromDate: "A request for these days already exists" });
  }

  private applyTx(data: ReturnType<typeof leaveApplyInput.parse>, ref: StoredRef | null) {
    return this.write("leave", async (tx) => {
      let studentId: string | null = null, userId: string | null = null;
      if (this.ctx.role === "student") {
        const mine = await this.myStudentIds(tx);
        if (mine.length === 0) throw new NotFoundError("Student");
        const pick = data.studentId ?? (mine.length === 1 ? mine[0]!.id : undefined);
        if (!pick) throw new ValidationError({ studentId: "Pick the student" });
        if (!mine.some((m) => m.id === pick)) throw new NotFoundError("Student");
        studentId = pick;
      } else userId = this.ctx.userId;

      await this.assertNoClash(tx, { studentId, userId }, data.fromDate, data.toDate);

      const [row] = await tx.insert(leaveRequests).values({
        schoolId: this.ctx.schoolId, kind: studentId ? "student" : "staff", studentId, userId, requestedBy: this.ctx.userId,
        fromDate: data.fromDate, toDate: data.toDate, reason: data.reason, fileKey: ref?.fileKey ?? null, fileName: ref?.fileName ?? null,
      }).returning();
      return row!;
    }, (r) => ({ action: "apply", entity: "Leave request", entityId: r.id, summary: `Leave ${r.fromDate} to ${r.toDate}` }));
  }

  /** The requester withdraws a request nobody has decided yet. */
  async cancel(id: string) {
    this.authorize("leave", "write");
    return this.write("leave", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.requestedBy, this.ctx.userId))).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "pending") throw new ValidationError({ id: "Only a waiting request can be withdrawn" });
      await tx.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, id));
      return r;
    }, (r) => ({ action: "cancel", entity: "Leave request", entityId: r.id, summary: `Withdrew leave ${r.fromDate} to ${r.toDate}` }));
  }

  /** The requester changes the dates or reason of a request nobody has decided yet. */
  async edit(input: unknown) {
    this.authorize("leave", "write");
    const data = this.parse(leaveEditInput, input);
    this.assertRange(data);
    return this.write("leave", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.id, data.id), eq(leaveRequests.requestedBy, this.ctx.userId))).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "pending") throw new ValidationError({ id: "Only a waiting request can be changed" });
      await this.assertNoClash(tx, r, data.fromDate, data.toDate, r.id);
      const [row] = await tx.update(leaveRequests).set({ fromDate: data.fromDate, toDate: data.toDate, reason: data.reason }).where(eq(leaveRequests.id, r.id)).returning();
      return row!;
    }, (r) => ({ action: "update", entity: "Leave request", entityId: r.id, summary: `Changed leave to ${r.fromDate} to ${r.toDate}` }));
  }

  private async rows(tx: Tx, where: SQL | undefined, canAct: (r: { kind: string; sectionId: string | null }) => boolean): Promise<LeaveRow[]> {
    const rows = await tx.select({
      r: leaveRequests, student: students.name, sectionId: students.sectionId, section: sections.name, cls: classes.name, staff: users.name,
    }).from(leaveRequests)
      .leftJoin(students, eq(students.id, leaveRequests.studentId))
      .leftJoin(sections, eq(sections.id, students.sectionId))
      .leftJoin(classes, eq(classes.id, sections.classId))
      .leftJoin(users, eq(users.id, leaveRequests.userId))
      .where(where).orderBy(desc(leaveRequests.createdAt)).limit(200);
    return Promise.all(rows.map(async (x) => ({
      id: x.r.id, kind: x.r.kind, who: x.student ?? x.staff ?? "-", section: x.section ? `${x.cls}-${x.section}` : null,
      fromDate: x.r.fromDate, toDate: x.r.toDate, reason: x.r.reason, status: x.r.status, note: x.r.note, decidedAt: x.r.decidedAt,
      fileName: x.r.fileName, fileUrl: await this.files.url(x.r.fileKey),
      canDecide: x.r.status === "pending" && canAct({ kind: x.r.kind, sectionId: x.sectionId }),
      canReverse: (x.r.status === "approved" || x.r.status === "rejected") && canAct({ kind: x.r.kind, sectionId: x.sectionId }), canEdit: false,
    })));
  }

  /** Your own requests, newest first. */
  async mine(): Promise<LeaveRow[]> {
    return this.read("leave", async (tx) => (await this.rows(tx, eq(leaveRequests.requestedBy, this.ctx.userId), () => false)).map((r) => ({ ...r, canEdit: r.status === "pending" })));
  }

  /** Sections this teacher is class teacher of. Only they may decide for those students. */
  private async ownSectionIds(tx: Tx): Promise<string[]> {
    return (await tx.select({ id: sections.id }).from(sections).where(eq(sections.classTeacherId, this.ctx.userId))).map((s) => s.id);
  }

  /** Admin or an attendance:manage holder decides school-wide; any other approver, whatever the base role, only for sections they are class teacher of. */
  private get wide() { return this.ctx.role === "admin" || this.can("manage"); }

  /** Requests the caller may decide: school-wide approvers see all; everyone else sees their own sections' students. */
  async inbox(tab: "pending" | "decided"): Promise<LeaveRow[]> {
    return this.read("approve", async (tx) => {
      const teacher = !this.wide;
      const own = teacher ? await this.ownSectionIds(tx) : [];
      if (teacher && own.length === 0) return [];
      const status = tab === "pending" ? eq(leaveRequests.status, "pending") : inArray(leaveRequests.status, ["approved", "rejected"]);
      const scope = teacher ? and(eq(leaveRequests.kind, "student"), inArray(students.sectionId, own)) : undefined;
      return this.rows(tx, and(status, scope), (r) => !teacher || (r.kind === "student" && !!r.sectionId && own.includes(r.sectionId)));
    });
  }

  async decide(input: unknown) {
    this.authorize("approve", "write");
    const data = this.parse(leaveDecisionInput, input);
    const mails: AlertMail[] = [];
    const out = await this.write("approve", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, data.id)).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "pending") throw new ValidationError({ id: "This request is already decided" });
      await this.assertCanDecide(tx, r);
      // The status guard makes two concurrent decisions race on the row lock; the loser gets no row back.
      const won = await tx.update(leaveRequests).set({ status: data.decision, decidedBy: this.ctx.userId, decidedAt: new Date(), note: data.note ?? null })
        .where(and(eq(leaveRequests.id, r.id), eq(leaveRequests.status, "pending"))).returning({ id: leaveRequests.id });
      if (won.length === 0) throw new ConflictError("This request was just decided by someone else");
      const marked = data.decision === "approved" ? await this.markDays(tx, r) : 0;

      const verdict = data.decision === "approved" ? "approved" : "not approved";
      const title = `Leave ${r.fromDate} to ${r.toDate} ${verdict}`;
      const body = data.note ? `${title}. ${data.note}` : title;
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: r.requestedBy, kind: "system", title, body: data.note ?? undefined, href: "/app/attendance/my-leave" }]);
      const [who] = await tx.select({ email: users.email }).from(users).where(eq(users.id, r.requestedBy)).limit(1);
      const mail = notice(who?.email ?? null, title, body);
      if (mail) mails.push(mail);
      return { request: r, marked };
    }, (o) => ({ action: data.decision === "approved" ? "approve" : "reject", entity: "Leave request", entityId: o.request.id, summary: `${data.decision} leave ${o.request.fromDate} to ${o.request.toDate}, ${o.marked} days marked` }));
    await sendMails(mails);
    return { id: out.request.id, status: data.decision, marked: out.marked };
  }

  /**
   * Turn a decision around: approved becomes rejected (the days it marked as leave are cleared), rejected becomes approved
   * (the days are marked). Same people as decide. The requester is told; the audit log keeps who, when and the before and after.
   */
  async reverse(input: unknown) {
    this.authorize("approve", "write");
    const data = this.parse(leaveReverseInput, input);
    const mails: AlertMail[] = [];
    const out = await this.write("approve", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, data.id)).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "approved" && r.status !== "rejected") throw new ValidationError({ id: "Only a decided request can be reversed" });
      await this.assertCanDecide(tx, r);
      const to = r.status === "approved" ? "rejected" : "approved";
      if (to === "approved") await this.assertNoClash(tx, r, r.fromDate, r.toDate, r.id);
      const now = new Date();
      const won = await tx.update(leaveRequests).set({ status: to, decidedBy: this.ctx.userId, decidedAt: now, reversedBy: this.ctx.userId, reversedAt: now, note: data.note ?? null })
        .where(and(eq(leaveRequests.id, r.id), eq(leaveRequests.status, r.status))).returning({ id: leaveRequests.id });
      if (won.length === 0) throw new ConflictError("This request was just changed by someone else");
      const days = to === "approved" ? await this.markDays(tx, r) : await this.clearDays(tx, r);

      const title = `Leave ${r.fromDate} to ${r.toDate} is now ${to === "approved" ? "approved" : "not approved"}`;
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: r.requestedBy, kind: "system", title, body: data.note ?? undefined, href: "/app/attendance/my-leave" }]);
      const [who] = await tx.select({ email: users.email }).from(users).where(eq(users.id, r.requestedBy)).limit(1);
      const mail = notice(who?.email ?? null, title, data.note ? `${title}. ${data.note}` : title);
      if (mail) mails.push(mail);
      return { request: r, from: r.status, to, days };
    }, (o) => ({ action: "reverse", entity: "Leave request", entityId: o.request.id, summary: `Reversed leave ${o.request.fromDate} to ${o.request.toDate}: ${o.from} to ${o.to}, ${o.days} days ${o.to === "approved" ? "marked" : "cleared"}`, meta: { from: o.from, to: o.to } }));
    await sendMails(mails);
    return { id: out.request.id, status: out.to, days: out.days };
  }

  /** Remove the leave days an approval wrote (only those: a day a teacher marked another way stays). */
  private async clearDays(tx: Tx, r: typeof leaveRequests.$inferSelect): Promise<number> {
    const same = (t: typeof staffAttendance | typeof studentAttendance) => and(eq(t.status, "leave"), eq(t.note, LEAVE_NOTE), gte(t.date, r.fromDate), lte(t.date, r.toDate));
    const gone = r.kind === "staff"
      ? await tx.delete(staffAttendance).where(and(eq(staffAttendance.userId, r.userId!), same(staffAttendance))).returning({ id: staffAttendance.id })
      : await tx.delete(studentAttendance).where(and(eq(studentAttendance.studentId, r.studentId!), same(studentAttendance))).returning({ id: studentAttendance.id });
    return gone.length;
  }

  /** Outside the school-wide approvers, decide only for students of own sections; staff leave is theirs. */
  private async assertCanDecide(tx: Tx, r: typeof leaveRequests.$inferSelect) {
    if (this.wide) return;
    if (r.kind === "staff" || !r.studentId) throw new ForbiddenError("Only the admin decides staff leave.");
    const [s] = await tx.select({ sectionId: students.sectionId }).from(students).where(eq(students.id, r.studentId)).limit(1);
    if (!s?.sectionId || !(await this.ownSectionIds(tx)).includes(s.sectionId)) throw new ForbiddenError("Only the class teacher or the admin can decide this.");
  }

  /** Mark each school day of the request as leave: skips holidays and Sundays, never overwrites a day marked present. */
  private async markDays(tx: Tx, r: typeof leaveRequests.$inferSelect): Promise<number> {
    const holidays = new Set((await tx.select({ date: attendanceHolidays.date }).from(attendanceHolidays)
      .where(and(gte(attendanceHolidays.date, r.fromDate), lte(attendanceHolidays.date, r.toDate)))).map((h) => h.date));
    const days: string[] = [];
    for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) if (!holidays.has(d) && !isSunday(d)) days.push(d);
    if (days.length === 0) return 0;
    const note = LEAVE_NOTE;

    if (r.kind === "staff") {
      const done = await tx.insert(staffAttendance).values(days.map((date) => ({ schoolId: this.ctx.schoolId, userId: r.userId!, date, status: "leave" as const, note, markedBy: this.ctx.userId })))
        .onConflictDoUpdate({ target: [staffAttendance.userId, staffAttendance.date], set: { status: "leave", note, markedBy: this.ctx.userId, updatedAt: sql`now()` }, setWhere: sql`${staffAttendance.status} <> 'present'` })
        .returning({ id: staffAttendance.id });
      return done.length;
    }
    const [s] = await tx.select({ sectionId: students.sectionId }).from(students).where(eq(students.id, r.studentId!)).limit(1);
    if (!s?.sectionId) return 0;
    const done = await tx.insert(studentAttendance).values(days.map((date) => ({ schoolId: this.ctx.schoolId, studentId: r.studentId!, sectionId: s.sectionId!, date, status: "leave" as const, note, markedBy: this.ctx.userId })))
      .onConflictDoUpdate({ target: [studentAttendance.studentId, studentAttendance.date], set: { status: "leave", sectionId: s.sectionId, note, markedBy: this.ctx.userId, updatedAt: sql`now()` }, setWhere: sql`${studentAttendance.status} <> 'present'` })
      .returning({ id: studentAttendance.id });
    return done.length;
  }
}
