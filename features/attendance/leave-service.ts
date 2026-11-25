import { and, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, countIn, type Ctx } from "@smw/feature-kit";
import { schoolRoles, users, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import attendanceFeature from "./feature";
import { FileStore, type StoredRef, type UploadedFile } from "./files";
import { leaveApplyInput, leaveDecisionInput, leaveEditInput, leaveReverseInput } from "./inputs";
import { LeaveBalanceService } from "./leave-balances";
import { workingDays } from "./leave-days";
import { closedSet } from "./holidays";
import { assertBalance, ensureCredit, ensureTypes, lockPerson, requestMonths, writeReversed, writeUsed } from "./leave-ledger";
import { leaveRequests, leaveTypes, staffAttendance, studentAttendance } from "./schema";
import { addDays, isDate, todayIST } from "./stats";

type Perm = keyof typeof attendanceFeature.permissions;
export type LeaveRow = {
  id: string; kind: "student" | "staff"; who: string; section: string | null; fromDate: string; toDate: string; reason: string;
  status: (typeof leaveRequests.$inferSelect)["status"]; note: string | null; decidedAt: Date | null; fileName: string | null; fileUrl: string | null; canDecide: boolean;
  /** A decided request the caller may turn around. */
  canReverse: boolean;
  /** The requester may still change a waiting request. */
  canEdit: boolean;
  /** Staff requests: the leave type; null on old ones, which count as paid. */
  typeName: string | null; typeId: string | null; halfDay: "first" | "second" | null;
  /** Who decides a waiting request, in words. */
  waitingFor: string | null;
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
      await ensureTypes(tx, this.ctx.schoolId);
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
      const asked = async (row: typeof leaveRequests.$inferSelect) => { await this.asked(tx, row); return row; };
      const base = { schoolId: this.ctx.schoolId, kind: studentId ? "student" as const : "staff" as const, studentId, userId, requestedBy: this.ctx.userId, reason: data.reason, fileKey: ref?.fileKey ?? null, fileName: ref?.fileName ?? null };
      if (studentId) {
        const [row] = await tx.insert(leaveRequests).values({ ...base, fromDate: data.fromDate, toDate: data.toDate }).returning();
        return asked(row!);
      }

      if (!data.typeId) throw new ValidationError({ typeId: "Pick a leave type" });
      await ensureCredit(tx, this.ctx.schoolId, todayIST(), this.ctx.userId);
      const plan = await LeaveBalanceService.plan(tx, userId!, { typeId: data.typeId, fromDate: data.fromDate, toDate: data.toDate, halfDay: data.halfDay });
      if (plan.needsFile && !ref) throw new ValidationError({ file: `${plan.type.name} leave over ${plan.type.needsFileAfterDays} days needs a note or document` });
      if (plan.unpaidDays.length === 0) {
        const [row] = await tx.insert(leaveRequests).values({ ...base, fromDate: data.fromDate, toDate: data.toDate, typeId: plan.type.id, halfDay: data.halfDay ?? null }).returning();
        return asked(row!);
      }
      // Short of balance: the person must say yes to taking the rest as unpaid, and sees the split before sending.
      const unpaid = await LeaveBalanceService.unpaidType(tx);
      const days = (n: number) => `${n / (data.halfDay ? 1 : 2)} day${n / (data.halfDay ? 1 : 2) === 1 ? "" : "s"}`;
      if (!data.split || !unpaid) throw new ValidationError({ split: unpaid
        ? `You have ${days(plan.halfDays - plan.short)} of ${plan.type.name} leave for these dates. Tick "Take the other ${days(plan.short)} as unpaid leave" to send it in two parts.`
        : `Not enough ${plan.type.name} leave and the school has no unpaid leave type. Ask the admin to add one under Leave types.` });
      const lastPaid = plan.paidDays.at(-1), firstUnpaid = plan.unpaidDays[0]!;
      const paid = lastPaid ? (await tx.insert(leaveRequests).values({ ...base, fromDate: data.fromDate, toDate: lastPaid, typeId: plan.type.id, halfDay: data.halfDay ?? null }).returning())[0] : null;
      const [rest] = await tx.insert(leaveRequests).values({ ...base, fromDate: firstUnpaid, toDate: data.toDate, typeId: unpaid.id, halfDay: data.halfDay ?? null }).returning();
      return asked(paid ?? rest!);
    }, (r) => ({ action: "apply", entity: "Leave request", entityId: r.id, summary: `Leave ${r.fromDate} to ${r.toDate}` }));
  }

  /** A new request: the people who decide it are told (their desk row closes when it is decided). */
  private async asked(tx: Tx, r: typeof leaveRequests.$inferSelect) {
    const [who] = r.kind === "staff"
      ? await tx.select({ name: users.name, sectionId: sql<string | null>`null` }).from(users).where(eq(users.id, r.userId!)).limit(1)
      : await tx.select({ name: students.name, sectionId: students.sectionId }).from(students).where(eq(students.id, r.studentId!)).limit(1);
    const teacher = who?.sectionId ? (await tx.select({ id: sections.classTeacherId }).from(sections).where(eq(sections.id, who.sectionId)).limit(1))[0]?.id : null;
    const wide = await tx.select({ id: users.id }).from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
      .where(and(eq(users.status, "active"), ne(users.id, r.requestedBy), or(eq(users.role, "admin"), sql`${"attendance:manage"} = any(${schoolRoles.grants})`)));
    const ids = new Set([...wide.map((w) => w.id), ...(r.kind === "student" && teacher && teacher !== r.requestedBy ? [teacher] : [])]);
    await NotificationWriter.insert(tx, this.ctx.schoolId, [...ids].map((userId) => ({
      userId, topic: "attendance.leave" as const, action: true, title: `${who?.name ?? "Someone"} asked for leave ${r.fromDate} to ${r.toDate}`,
      body: r.reason, href: "/app/attendance/leave-requests", subject: { type: "leave", id: r.id }, groupKey: `leave:${r.id}`,
    })));
  }

  /** A decision: the approvers' rows close, the asker is told. */
  private async told(tx: Tx, r: typeof leaveRequests.$inferSelect, title: string, note?: string) {
    await NotificationWriter.done(tx, this.ctx.schoolId, { type: "leave", id: r.id });
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: r.requestedBy, topic: "attendance.leave", title, body: note, href: "/app/attendance/my-leave", subject: { type: "leave", id: r.id } }]);
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
      const typeId = r.kind === "staff" ? (data.typeId ?? r.typeId) : null;
      if (r.kind === "staff" && !typeId && !r.typeId) throw new ValidationError({ typeId: "Pick a leave type" });
      if (typeId) {
        const plan = await LeaveBalanceService.plan(tx, r.userId!, { typeId, fromDate: data.fromDate, toDate: data.toDate, halfDay: data.halfDay }, r.id);
        if (plan.unpaidDays.length) throw new ValidationError({ typeId: `Not enough ${plan.type.name} leave for these dates. Send a new request to take the rest as unpaid.` });
      }
      const [row] = await tx.update(leaveRequests).set({ fromDate: data.fromDate, toDate: data.toDate, reason: data.reason, typeId, halfDay: r.kind === "staff" ? data.halfDay ?? null : null }).where(eq(leaveRequests.id, r.id)).returning();
      return row!;
    }, (r) => ({ action: "update", entity: "Leave request", entityId: r.id, summary: `Changed leave to ${r.fromDate} to ${r.toDate}` }));
  }

  private async rows(tx: Tx, where: SQL | undefined, canAct: (r: { kind: string; sectionId: string | null }) => boolean): Promise<LeaveRow[]> {
    const rows = await tx.select({
      r: leaveRequests, student: students.name, sectionId: students.sectionId, section: sections.name, cls: classes.name, staff: users.name, typeName: leaveTypes.name,
    }).from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.typeId))
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
      typeName: x.typeName, typeId: x.r.typeId, halfDay: x.r.halfDay, waitingFor: x.r.status === "pending" ? (x.r.kind === "staff" ? "the admin" : "the class teacher or the admin") : null,
    })));
  }

  /** Opening a request reads its bell row for this person; done() still closes the approver's row when it is decided. */
  private async seenLeave(tx: Tx, rows: { id: string }[]) {
    if (!this.ctx.readOnly && !this.ctx.supportStaffId) for (const r of rows) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "leave", id: r.id }, this.ctx.userId);
  }

  /** Your own requests, newest first. */
  async mine(): Promise<LeaveRow[]> {
    return this.read("leave", async (tx) => {
      const rows = await this.rows(tx, eq(leaveRequests.requestedBy, this.ctx.userId), () => false);
      await this.seenLeave(tx, rows.filter((r) => r.status !== "pending"));
      return rows.map((r) => ({ ...r, canEdit: r.status === "pending" }));
    });
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
      const rows = await this.rows(tx, and(status, scope), (r) => !teacher || (r.kind === "student" && !!r.sectionId && own.includes(r.sectionId)));
      await this.seenLeave(tx, rows);
      return rows;
    });
  }

  async decide(input: unknown) {
    this.authorize("approve", "write");
    const data = this.parse(leaveDecisionInput, input);
    const out = await this.write("approve", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, data.id)).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "pending") throw new ValidationError({ id: "This request is already decided" });
      await this.assertCanDecide(tx, r);
      const own = data.decision === "approved" && await this.assertNotOwn(tx, r, data.note);
      if (data.decision === "approved") await this.assertPayOpen(tx, r);
      // The status guard makes two concurrent decisions race on the row lock; the loser gets no row back.
      const won = await tx.update(leaveRequests).set({ status: data.decision, decidedBy: this.ctx.userId, decidedAt: new Date(), note: data.note ?? null })
        .where(and(eq(leaveRequests.id, r.id), eq(leaveRequests.status, "pending"))).returning({ id: leaveRequests.id });
      if (won.length === 0) throw new ConflictError("This request was just decided by someone else");
      if (data.decision === "approved") await this.useBalance(tx, r);
      const marked = data.decision === "approved" ? await this.markDays(tx, r) : 0;

      const verdict = data.decision === "approved" ? "approved" : "not approved";
      const title = `Leave ${r.fromDate} to ${r.toDate} ${verdict}`;
      await this.told(tx, r, title, data.note);
      return { request: r, marked, own };
    }, (o) => ({ action: data.decision === "approved" ? "approve" : "reject", entity: "Leave request", entityId: o.request.id, summary: `${data.decision} leave ${o.request.fromDate} to ${o.request.toDate}, ${o.marked} days marked${o.own ? " (own leave, only admin)" : ""}` }));
    return { id: out.request.id, status: data.decision, marked: out.marked };
  }

  /**
   * Turn a decision around: approved becomes rejected (the days it marked as leave are cleared), rejected becomes approved
   * (the days are marked). Same people as decide. The requester is told; the audit log keeps who, when and the before and after.
   */
  async reverse(input: unknown) {
    this.authorize("approve", "write");
    const data = this.parse(leaveReverseInput, input);
    const out = await this.write("approve", async (tx) => {
      const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, data.id)).limit(1);
      if (!r) throw new NotFoundError("Leave request");
      if (r.status !== "approved" && r.status !== "rejected") throw new ValidationError({ id: "Only a decided request can be reversed" });
      await this.assertCanDecide(tx, r);
      const own = await this.assertNotOwn(tx, r, data.note);
      await this.assertPayOpen(tx, r);
      const to = r.status === "approved" ? "rejected" : "approved";
      if (to === "approved") await this.assertNoClash(tx, r, r.fromDate, r.toDate, r.id);
      const now = new Date();
      const won = await tx.update(leaveRequests).set({ status: to, decidedBy: this.ctx.userId, decidedAt: now, reversedBy: this.ctx.userId, reversedAt: now, note: data.note ?? null })
        .where(and(eq(leaveRequests.id, r.id), eq(leaveRequests.status, r.status))).returning({ id: leaveRequests.id });
      if (won.length === 0) throw new ConflictError("This request was just changed by someone else");
      if (to === "approved") await this.useBalance(tx, r); else await writeReversed(tx, this.ctx.schoolId, r);
      const days = to === "approved" ? await this.markDays(tx, r) : await this.clearDays(tx, r);

      const title = `Leave ${r.fromDate} to ${r.toDate} is now ${to === "approved" ? "approved" : "not approved"}`;
      await this.told(tx, r, title, data.note);
      return { request: r, from: r.status, to, days, own };
    }, (o) => ({ action: "reverse", entity: "Leave request", entityId: o.request.id, summary: `Reversed leave ${o.request.fromDate} to ${o.request.toDate}: ${o.from} to ${o.to}, ${o.days} days ${o.to === "approved" ? "marked" : "cleared"}${o.own ? " (own leave, only admin)" : ""}`, meta: { from: o.from, to: o.to } }));
    return { id: out.request.id, status: out.to, days: out.days };
  }

  /**
   * Nobody approves or turns around their own leave. The one exception is the only active admin, who must write why.
   * Same rule as the approvals desk in finance; answers true when the exception was used.
   */
  private async assertNotOwn(tx: Tx, r: typeof leaveRequests.$inferSelect, note?: string): Promise<boolean> {
    if (r.requestedBy !== this.ctx.userId && r.userId !== this.ctx.userId) return false;
    const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, this.ctx.userId))).limit(1);
    if (others.length || this.ctx.role !== "admin") throw new ForbiddenError("This is your own leave, so someone else must decide it.");
    if (!note) throw new ValidationError({ note: "You are the only admin, so write why you decide your own leave." });
    return true;
  }

  /** Payroll is another module, so its table is asked by name; a school without payroll has no closed months. */
  protected async payMonthClosed(tx: Tx, month: string) {
    return (await countIn(tx, "pay_runs", sql`kind = 'monthly' and to_char(month, 'YYYY-MM') = ${month} and status in ('approved', 'paid')`)) > 0;
  }

  /** Approving or turning around staff leave changes days that salary is cut from, so a month with an approved run is shut. */
  private async assertPayOpen(tx: Tx, r: typeof leaveRequests.$inferSelect) {
    if (r.kind !== "staff") return;
    for (const { month } of await requestMonths(tx, r)) {
      if (await this.payMonthClosed(tx, month)) throw new ConflictError(`Salary for ${month} is already approved; ask for a recall or adjust next month.`);
    }
  }

  /** A typed staff request takes its days from the balance when approved. The person's lock makes two approvals line up. */
  private async useBalance(tx: Tx, r: typeof leaveRequests.$inferSelect) {
    if (r.kind !== "staff" || !r.typeId || !r.userId) return;
    const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, r.typeId)).limit(1);
    if (!type) return;
    await lockPerson(tx, r.userId, type.id);
    const months = await requestMonths(tx, r);
    await assertBalance(tx, r.userId, type, months, { withHeld: false });
    await writeUsed(tx, this.ctx.schoolId, r, months);
  }

  /** Remove the leave days an approval wrote (only those: a day a teacher marked another way stays). */
  private async clearDays(tx: Tx, r: typeof leaveRequests.$inferSelect): Promise<number> {
    const same = (t: typeof staffAttendance | typeof studentAttendance) => and(inArray(t.status, ["leave", "half_day"]), eq(t.note, LEAVE_NOTE), gte(t.date, r.fromDate), lte(t.date, r.toDate));
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

  /** Mark each school day of the request as leave: skips holidays and Sundays, fills only days that are unmarked or marked absent, so present, late and half-day marks stay. */
  private async markDays(tx: Tx, r: typeof leaveRequests.$inferSelect): Promise<number> {
    const kid = r.kind === "staff" ? null : (await tx.select({ sectionId: students.sectionId, classId: students.classId }).from(students).where(eq(students.id, r.studentId!)).limit(1))[0];
    const days = workingDays(r.fromDate, r.toDate, await closedSet(tx, r.fromDate, r.toDate, kid ? { classId: kid.classId } : { staff: true }));
    if (days.length === 0) return 0;
    const status = r.halfDay ? "half_day" as const : "leave" as const;
    const note = LEAVE_NOTE;

    if (r.kind === "staff") {
      const done = await tx.insert(staffAttendance).values(days.map((date) => ({ schoolId: this.ctx.schoolId, userId: r.userId!, date, status, note, markedBy: this.ctx.userId })))
        .onConflictDoUpdate({ target: [staffAttendance.userId, staffAttendance.date], set: { status, note, markedBy: this.ctx.userId, updatedAt: sql`now()` }, setWhere: sql`${staffAttendance.status} = 'absent'` })
        .returning({ id: staffAttendance.id });
      return done.length;
    }
    const sectionId = kid?.sectionId;
    if (!sectionId) return 0;
    const done = await tx.insert(studentAttendance).values(days.map((date) => ({ schoolId: this.ctx.schoolId, studentId: r.studentId!, sectionId, date, status: "leave" as const, note, markedBy: this.ctx.userId })))
      .onConflictDoUpdate({ target: [studentAttendance.studentId, studentAttendance.date], set: { status: "leave", sectionId, note, markedBy: this.ctx.userId, updatedAt: sql`now()` }, setWhere: sql`${studentAttendance.status} = 'absent'` })
      .returning({ id: studentAttendance.id });
    return done.length;
  }
}
