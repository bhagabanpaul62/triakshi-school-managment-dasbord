import { and, asc, count, eq, sql } from "drizzle-orm";
import { AppError, FeatureOffError, ForbiddenError, SchoolService, type Ctx } from "@smw/feature-kit";
import { academicYears, classes, sections, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { closedClassIds, isClosed } from "@smw/feature-attendance/holidays";
import { studentAttendance } from "@smw/feature-attendance/schema";
import { attendancePercent } from "@smw/feature-attendance/stats";
import { StudentService, type StudentCapacity } from "@smw/feature-students/service";
import { StudentAttendanceService } from "@smw/feature-attendance/service";
import { DuesService, type DueRow, type TrendPoint } from "@smw/feature-fees/service";
import { ExamService, ResultService } from "@smw/feature-exams/service";
import { TimetableService, type TodayRow } from "@smw/feature-timetable/service";
import { AssignmentService, SelfService } from "@smw/feature-assignments/service";
import { dueHint } from "@smw/feature-assignments/rules";
import { AnnouncementService, FeedService } from "@smw/feature-announcements/service";
import { NotificationService } from "@smw/feature-notifications/service";
import { RequestService } from "@smw/feature-requests/service";
import { DayService, MeetingService } from "@smw/feature-meetings/service";
import { EventService, type SchoolEvent } from "@smw/feature-events/service";
import { EnquiryService } from "@smw/feature-website/service";
import { communicationSteps, type CommStep } from "@smw/feature-setup/communication";
import homeFeature from "./feature";
import { staffLinks } from "./staff-links";
import { clockIST, dayLabel, greeting, markPeriods, monthStart, todayIST, type PeriodState } from "./rules";

// ---------- shapes ----------

/** One panel's data. `off` = the module is not on for this school (render nothing); `error` = it failed (render that panel's error state only). */
export type Slot<T> = { state: "ok"; data: T } | { state: "off" } | { state: "error"; message: string };

export interface HomeHeader { greeting: string; line: string }
export interface Child { id: string; name: string; sectionLabel: string | null }

export interface AttentionItem { key: string; label: string; count: number; href: string; tone: "warning" | "danger" | "info" }
export interface SectionToMark { id: string; label: string; students: number; marked: boolean }
export interface SectionsToMark { dayOff: string | null; rows: SectionToMark[] }
export interface PendingPaper { examId: string; examName: string; paperId: string; className: string; subjectName: string; date: string; students: number; entered: number }
export interface AttendanceToday { date: string; /** Why school is closed today (Sunday, a holiday), or null on a working day. */ dayOff: string | null; pct: number | null; present: number; absent: number; late: number; leave: number; marked: number; students: number }
export interface FeeSummary { collectedThisMonth: number; receiptsThisMonth: number; outstanding: number; overdueAmount: number; overdueCount: number; studentsWithDues: number }
export interface TodayTimetable { day: number | null; /** Why school is closed today, or null. A working Sunday has no periods but is not a day off. */ dayOff: string | null; now: string; rows: (TodayRow & { state: PeriodState })[] }
export interface AssignmentRow { assignmentId: string; title: string; subjectName: string; dueAt: Date; hint: string; overdue: boolean; studentId: string }
export interface AssignmentsDue { rows: AssignmentRow[]; todo: number; overdue: number }
export interface LatestResult { studentId: string; examId: string; examName: string; percent: number | null; grade: string | null; result: string; rank: number | null; sectionSize: number }
export interface AttendanceMonth { pct: number | null; present: number; absent: number; late: number; leave: number; from: string }
export interface GradingRow { id: string; title: string; sectionLabel: string; subjectName: string; toGrade: number; dueAt: Date }
export interface ClassMonth { sectionId: string; label: string; pct: number | null; students: number }
export interface RecentPayment { id: string; student: string; amountPaise: number; method: string; receiptNo: string; paidOn: string }
export interface OverdueList { total: number; amountPaise: number; rows: Pick<DueRow, "id" | "name" | "classLabel" | "overdue" | "nextDueDate">[] }
export interface ClassDue { classId: string; name: string; duePaise: number }

/** A notice as the home page lists it. `needsAnswer` is for families: an answer is wanted and not given. */
export interface HomeNotice { id: string; title: string; excerpt: string; publishedAt: Date | null; pinned: boolean; needsAnswer: boolean; href: string }
export interface ActionItem { id: string; title: string; body: string | null; href: string | null; createdAt: Date }
export interface RequestsSummary { mine: number; unassigned: number; overdue: number }
export interface MeetingSlotToday { slotId: string; meetingId: string; meetingTitle: string; startsAt: Date; studentName: string; studentLabel: string | null; visit: string | null }

export interface Common { header: HomeHeader; announcements: Slot<HomeNotice[]>; /** The top 5 things waiting on this person. */ needsAction: Slot<ActionItem[]> }
export interface AdminHome extends Common {
  capacity: Slot<StudentCapacity>;
  attendance: Slot<AttendanceToday>;
  fees: Slot<{ summary: FeeSummary; trend: TrendPoint[] }>;
  events: Slot<SchoolEvent[]>;
  attention: Slot<{ items: AttentionItem[]; unchecked: string[] }>;
  requests: Slot<RequestsSummary>;
  /** The first-day checklist; the card shows until every step is done (or the admin hides it). */
  firstDay: Slot<CommStep[]>;
}
export interface AccountantHome extends Common {
  money: Slot<{ todayPaise: number; todayCount: number; summary: FeeSummary }>;
  dueByClass: Slot<ClassDue[]>;
  recent: Slot<RecentPayment[]>;
  overdue: Slot<OverdueList>;
  requests: Slot<RequestsSummary>;
}
export interface TeacherHome extends Common {
  today: Slot<TodayTimetable>;
  toMark: Slot<SectionsToMark>;
  grading: Slot<{ toGrade: number; rows: GradingRow[] }>;
  marks: Slot<PendingPaper[]>;
  classMonth: Slot<ClassMonth[]>;
  meetings: Slot<MeetingSlotToday[]>;
}
export interface LearnerPanels {
  attendance: Slot<AttendanceMonth>;
  assignments: Slot<AssignmentsDue>;
  results: Slot<LatestResult | null>;
  fees: Slot<DueRow | null>;
}
export interface StudentHome extends Common, LearnerPanels { child: Child | null; timetable: Slot<TodayTimetable> }
export interface QuickLink { label: string; href: string; icon: string }
/** Non-teaching staff: their access comes from a custom role, so Home is a greeting plus links to what that role may open. */
export interface StaffHome extends Common { links: QuickLink[] }
export type HomeData =
  | { role: "admin"; data: AdminHome } | { role: "accountant"; data: AccountantHome } | { role: "teacher"; data: TeacherHome }
  | { role: "student"; data: StudentHome } | { role: "staff"; data: StaffHome };

type Perm = keyof typeof homeFeature.permissions;
const UNAVAILABLE = "Could not load this. Try again in a moment.";

/**
 * Everything the role home pages show, aggregated from the other modules' services (never their tables, except two
 * tiny counts no service offers). Each panel loads on its own: a module that is off gives `off`, one that fails gives
 * `error` for that panel only. Framework-free, so the mobile API can reuse it.
 */
export class HomeService extends SchoolService<Perm> {
  protected feature = homeFeature;

  /** `clock` is injectable so tests can pin "today". */
  constructor(ctx: Ctx, protected readonly clock: () => Date = () => new Date()) { super(ctx); }

  private get today() { return todayIST(this.clock()); }

  // ---------- plumbing ----------

  /** Run one panel: skip when a module it needs is off, turn a failure into an error state instead of a broken page. */
  protected async slot<T>(needs: string | string[], fn: () => Promise<T>): Promise<Slot<T>> {
    if (![needs].flat().every((k) => this.ctx.features.has(k))) return { state: "off" };
    try {
      return { state: "ok", data: await fn() };
    } catch (e) {
      if (e instanceof FeatureOffError || e instanceof ForbiddenError) return { state: "off" };
      if (!(e instanceof AppError)) console.error("[home] panel failed", e);
      return { state: "error", message: e instanceof AppError ? e.message : UNAVAILABLE };
    }
  }

  async header(): Promise<HomeHeader> {
    this.authorize("view", "read");
    const now = this.clock();
    const term = this.ctx.features.has("academics") ? await this.termName().catch(() => null) : null;
    return { greeting: greeting(this.ctx.name, now), line: [dayLabel(now), term].filter(Boolean).join(" · ") };
  }

  /** The running term, else the academic year. */
  private termName(): Promise<string | null> {
    return this.read("view", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) return null;
      const [term] = await tx.select({ name: terms.name }).from(terms)
        .where(and(eq(terms.yearId, year.id), sql`${terms.startsOn} <= ${this.today}`, sql`${terms.endsOn} >= ${this.today}`)).limit(1);
      return term?.name ?? year.name;
    });
  }

  async forRole(): Promise<HomeData> {
    this.authorize("view", "read");
    switch (this.ctx.role) {
      case "admin": return { role: "admin", data: await this.admin() };
      case "accountant": return { role: "accountant", data: await this.accountant() };
      case "teacher": return { role: "teacher", data: await this.teacher() };
      case "student": return { role: "student", data: await this.student() };
      case "staff": return { role: "staff", data: await this.staff() };
      default: throw new ForbiddenError(); // legacy parent logins are disabled
    }
  }

  /** A family sees what needs their answer first, then pinned, then the newest; staff see the latest sent. */
  private announcements(limit = 5): Promise<Slot<HomeNotice[]>> {
    return this.slot("announcements", async () => {
      if (this.ctx.role === "student") {
        const { rows } = await new FeedService(this.ctx).feed({ pageSize: limit * 2 });
        const seen = new Set<string>();
        return rows.filter((r) => !r.withdrawn && !seen.has(r.noticeId) && seen.add(r.noticeId))
          .map((r) => ({ id: r.noticeId, title: r.title, excerpt: r.excerpt, publishedAt: r.publishedAt, pinned: r.pinned, needsAnswer: r.needsAnswer, href: `/app/announcements/${r.noticeId}` })).slice(0, limit);
      }
      return (await new AnnouncementService(this.ctx).latest(limit)).map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt, publishedAt: a.publishedAt, pinned: a.pinned, needsAnswer: false, href: `/app/announcements/${a.id}` }));
    });
  }
  private needsAction(): Promise<Slot<ActionItem[]>> {
    return this.slot("notifications", async () => (await new NotificationService(this.ctx).list({ page: 1, pageSize: 5, filters: { tab: "action" } })).rows
      .map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt })));
  }
  /** The office's view of requests: what is mine, what nobody has taken, what is late. */
  private requests(): Promise<Slot<RequestsSummary>> {
    return this.slot("requests", async () => { const c = await new RequestService(this.ctx).counts(); return { mine: c.mine, unassigned: c.unassigned, overdue: c.overdue }; });
  }
  private events(limit = 5) { return this.slot("events", () => new EventService(this.ctx).upcoming(limit)); }

  // ---------- shared panels ----------

  /** Today's school-wide attendance. */
  protected attendanceToday(): Promise<Slot<AttendanceToday>> {
    return this.slot("attendance", async () => {
      const s = await new StudentAttendanceService(this.ctx).todaySchoolSummary();
      const off = await this.read("view", (tx) => isClosed(tx, this.today, { classId: null }));
      return { date: s.date, dayOff: off?.name ?? null, pct: s.pct, present: s.present, absent: s.absent, late: s.late, leave: s.leave, marked: s.marked, students: s.students };
    });
  }

  /** The dashboard fee numbers. Throws when no academic year is set (the panel then says so). */
  protected feeSummary(): Promise<FeeSummary> {
    return new DuesService(this.ctx).summary();
  }

  /** Sections of the current year with an active student and no attendance today (empty on a Sunday or holiday). `classTeacherOnly`: only sections this teacher is class teacher of. */
  protected sectionsToMark(classTeacherOnly: boolean): Promise<SectionsToMark> {
    const date = this.today;
    return this.read("view", async (tx) => {
      const off = await isClosed(tx, date, { classId: null });
      if (off) return { dayOff: off.name, rows: [] };
      const shut = await closedClassIds(tx, date);
      const [secs, sizes, marked] = await Promise.all([
        tx.select({ id: sections.id, classId: sections.classId, cls: classes.name, name: sections.name }).from(sections)
          .innerJoin(classes, eq(classes.id, sections.classId))
          .innerJoin(academicYears, and(eq(academicYears.id, sections.yearId), eq(academicYears.isCurrent, true)))
          .where(classTeacherOnly ? eq(sections.classTeacherId, this.ctx.userId) : undefined).orderBy(asc(classes.grade), asc(sections.name)),
        tx.select({ id: students.sectionId, n: count() }).from(students).where(eq(students.status, "active")).groupBy(students.sectionId),
        tx.select({ id: studentAttendance.sectionId, n: count() }).from(studentAttendance).where(eq(studentAttendance.date, date)).groupBy(studentAttendance.sectionId),
      ]);
      const size = new Map(sizes.map((r) => [r.id, Number(r.n)]));
      const done = new Set(marked.filter((r) => Number(r.n) > 0).map((r) => r.id));
      return {
        dayOff: null,
        rows: secs.filter((s) => !shut.has(s.classId)).map((s) => ({ id: s.id, label: `${s.cls}-${s.name}`, students: size.get(s.id) ?? 0, marked: done.has(s.id) })).filter((s) => s.students > 0),
      };
    });
  }

  /** Papers of exams with marks entry open that still miss marks. A teacher sees only papers they teach. */
  protected async pendingMarks(): Promise<PendingPaper[]> {
    const exams = new ExamService(this.ctx);
    const open = await exams.list({ filters: { status: "marks_open" }, pageSize: 20 });
    const details = await Promise.all(open.rows.map((e) => exams.detail(e.id)));
    return details.flatMap((d) => d.papers
      .filter((p) => p.canEnter && p.students > 0 && p.entered < p.students)
      .map((p) => ({ examId: d.exam.id, examName: d.exam.name, paperId: p.id, className: p.className, subjectName: p.subjectName, date: p.date, students: p.students, entered: p.entered })));
  }

  protected async timetableToday(): Promise<TodayTimetable> {
    const now = this.clock();
    const t = await new TimetableService(this.ctx).today(now);
    const off = await this.read("view", (tx) => isClosed(tx, this.today, { classId: null }));
    return { day: t.day, dayOff: off?.name ?? null, now: clockIST(now), rows: markPeriods(t.rows, clockIST(now)) };
  }

  // ---------- admin ----------

  async admin(): Promise<AdminHome> {
    const fees = this.slot("fees", async () => {
      const d = new DuesService(this.ctx);
      const [summary, trend] = await Promise.all([this.feeSummary(), d.trend("month", 6)]);
      return { summary, trend };
    });
    const [header, capacity, attendance, feesDone, events, announcements, attention, needsAction, requests, firstDay] = await Promise.all([
      this.header(),
      this.slot("students", () => new StudentService(this.ctx).capacity()),
      this.attendanceToday(),
      fees,
      this.events(5),
      this.announcements(5),
      this.attention(fees),
      this.needsAction(),
      this.requests(),
      this.slot("setup", () => this.read("view", (tx) => communicationSteps(tx, (f) => this.ctx.features.has(f)))),
    ]);
    return { header, capacity, attendance, fees: feesDone, events, announcements, attention, needsAction, requests, firstDay };
  }

  /** "Needs attention": only things with a count above zero, each with the page that fixes it. `unchecked` names sources that failed, so "all clear" is never claimed blindly. */
  protected async attention(fees: Promise<Slot<{ summary: FeeSummary }>>): Promise<Slot<{ items: AttentionItem[]; unchecked: string[] }>> {
    return this.slot([], async () => {
      const [unmarked, overdue, marks, support, enquiries] = await Promise.all([
        this.slot("attendance", () => this.sectionsToMark(false)),
        fees,
        this.slot("exams", () => this.pendingMarks()),
        this.slot("support", () => this.supportReplies()),
        this.slot("website", () => new EnquiryService(this.ctx).counts()),
      ]);
      const items: AttentionItem[] = [];
      const unchecked: string[] = [];
      const take = <T>(s: Slot<T>, label: string, add: (d: T) => void) => { if (s.state === "ok") add(s.data); else if (s.state === "error") unchecked.push(label); };
      take(unmarked, "attendance", (d) => { const n = d.rows.filter((r) => !r.marked).length; if (n) items.push({ key: "attendance", label: n === 1 ? "Section not marked today" : "Sections not marked today", count: n, href: "/app/attendance", tone: "warning" }); });
      take(overdue, "fees", (d) => { const n = d.summary.overdueCount; if (n) items.push({ key: "fees", label: n === 1 ? "Student with overdue fees" : "Students with overdue fees", count: n, href: "/app/fees?overdue=1", tone: "danger" }); });
      take(marks, "exams", (d) => { if (d.length) items.push({ key: "marks", label: d.length === 1 ? "Exam paper missing marks" : "Exam papers missing marks", count: d.length, href: "/app/exams", tone: "warning" }); });
      take(support, "support", (n) => { if (n) items.push({ key: "support", label: n === 1 ? "Support reply waiting for you" : "Support replies waiting for you", count: n, href: "/app/support", tone: "info" }); });
      take(enquiries, "enquiries", (d) => { if (d.new) items.push({ key: "enquiries", label: d.new === 1 ? "New admission enquiry" : "New admission enquiries", count: d.new, href: "/app/enquiries", tone: "info" }); });
      return { items, unchecked };
    });
  }

  /** Open or pending tickets whose latest message came from Triakshi support: the school's turn to answer. */
  protected supportReplies(): Promise<number> {
    return this.read("view", async (tx) => {
      const rows = await tx.execute<{ n: number }>(sql`select count(*)::int as n from support_tickets t where t.status in ('open', 'pending')
        and (select m.author_staff_id is not null from support_messages m where m.ticket_id = t.id order by m.created_at desc, m.id desc limit 1)`);
      return rows[0]?.n ?? 0;
    });
  }

  // ---------- accountant ----------

  async accountant(): Promise<AccountantHome> {
    const dues = new DuesService(this.ctx);
    const [header, money, dueByClass, recent, overdue, announcements, needsAction, requests] = await Promise.all([
      this.header(),
      this.slot("fees", async () => {
        const [summary, t] = await Promise.all([this.feeSummary(), this.collectedOn(this.today)]);
        return { todayPaise: t.paise, todayCount: t.n, summary };
      }),
      this.slot("fees", async () => {
        const classOptions = await dues.classOptions();
        const per = await Promise.all(classOptions.map(async (c) => ({ c, r: await dues.report({ filters: { classId: c.id }, pageSize: 1 }) })));
        // shortcut: one dues computation per class (each reads only its own students); fine up to ~20 classes.
        return per.filter((x) => x.r.total > 0).map((x) => ({ classId: x.c.id, name: x.c.name, duePaise: x.r.totals.due }));
      }),
      this.slot("fees", () => this.recentPayments(8)),
      this.slot("fees", async () => {
        const r = await dues.report({ filters: { overdue: "1" }, pageSize: 6 });
        return { total: r.total, amountPaise: r.totals.overdue, rows: r.rows.map((x) => ({ id: x.id, name: x.name, classLabel: x.classLabel, overdue: x.overdue, nextDueDate: x.nextDueDate })) };
      }),
      this.announcements(4),
      this.needsAction(),
      this.requests(),
    ]);
    return { header, money, dueByClass, recent, overdue, announcements, needsAction, requests };
  }

  /** Money received on one day: live receipts only (a reversed or bounced one is not money). */
  protected collectedOn(date: string): Promise<{ paise: number; n: number }> {
    return new DuesService(this.ctx).collected(date);
  }

  protected recentPayments(limit: number): Promise<RecentPayment[]> {
    return new DuesService(this.ctx).recentReceipts(limit);
  }

  // ---------- teacher ----------

  async teacher(): Promise<TeacherHome> {
    const [header, today, toMark, grading, marks, classMonth, announcements, needsAction, meetings] = await Promise.all([
      this.header(),
      this.slot("timetable", () => this.timetableToday()),
      this.slot("attendance", () => this.sectionsToMark(true)),
      this.slot("assignments", async () => {
        const svc = new AssignmentService(this.ctx);
        const [summary, page] = await Promise.all([svc.summary(), svc.listWithStats({ pageSize: 100, filters: { status: "published" } })]);
        const rows = page.rows.map((r) => ({ id: r.id, title: r.title, sectionLabel: r.sectionLabel, subjectName: r.subjectName, toGrade: r.progress.submitted + r.progress.late, dueAt: r.dueAt }))
          .filter((r) => r.toGrade > 0).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
        return { toGrade: summary.toGrade, rows };
      }),
      this.slot("exams", () => this.pendingMarks()),
      this.slot("attendance", () => this.classMonth()),
      this.announcements(4),
      this.needsAction(),
      this.slot("meetings", () => this.meetingsToday()),
    ]);
    return { header, today, toMark, grading, marks, classMonth, announcements, needsAction, meetings };
  }

  /** This teacher's booked parent-meeting slots today, in time order, from every meeting that runs today. */
  protected async meetingsToday(): Promise<MeetingSlotToday[]> {
    const day = this.today;
    const istDay = (d: Date) => todayIST(d);
    const list = (await new MeetingService(this.ctx).list({ page: 1, pageSize: 50, filters: {} })).rows
      .filter((m) => (m.state === "open" || m.state === "closed") && m.firstAt && m.lastAt && istDay(m.firstAt) <= day && day <= istDay(m.lastAt));
    const days = await Promise.all(list.map((m) => new DayService(this.ctx).day(m.id).catch(() => null)));
    return days.flatMap((d) => (d ? d.rows.filter((r) => istDay(r.startsAt) === day).map((r) => ({
      slotId: r.slotId, meetingId: d.meeting.id, meetingTitle: d.meeting.title, startsAt: r.startsAt, studentName: r.studentName, studentLabel: r.studentLabel, visit: r.visit,
    })) : [])).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  }

  /** Attendance % this month for each section this teacher is class teacher of. */
  protected async classMonth(): Promise<ClassMonth[]> {
    const svc = new StudentAttendanceService(this.ctx);
    const month = this.today.slice(0, 7);
    const own = await this.read("view", (tx) => tx.select({ id: sections.id }).from(sections)
      .innerJoin(academicYears, and(eq(academicYears.id, sections.yearId), eq(academicYears.isCurrent, true))).where(eq(sections.classTeacherId, this.ctx.userId)));
    return Promise.all(own.map(async (s) => {
      const reg = await svc.monthlyRegister(s.id, month);
      const total = { present: 0, late: 0, absent: 0, half_day: 0 };
      for (const r of reg.rows) { total.present += r.counts.present; total.late += r.counts.late; total.absent += r.counts.absent; total.half_day += r.counts.half_day; }
      return { sectionId: s.id, label: reg.section.label, pct: attendancePercent(total), students: reg.rows.length };
    }));
  }

  // ---------- staff ----------

  async staff(): Promise<StaffHome> {
    const [header, announcements, needsAction] = await Promise.all([this.header(), this.announcements(4), this.needsAction()]);
    return { header, announcements, needsAction, links: staffLinks(this.ctx) };
  }

  // ---------- student ----------

  /** The student this login is. */
  async children(): Promise<Child[]> {
    if (!this.ctx.features.has("students")) return [];
    return this.read("view", async (tx) => {
      const rows = await tx.select({ id: students.id, name: students.name, cls: classes.name, section: sections.name }).from(students)
        .leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, sections.classId))
        .where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active"))).orderBy(asc(students.name));
      return rows.map((r) => ({ id: r.id, name: r.name, sectionLabel: r.cls ? `${r.cls}-${r.section}` : null }));
    });
  }

  /** The numbers the student page shows (loaded in parallel). */
  protected async learnerPanels(child: Child | null): Promise<LearnerPanels> {
    const date = this.today;
    const forChild = <T>(needs: string, fn: (c: Child) => Promise<T>) => (child ? this.slot(needs, () => fn(child)) : Promise.resolve<Slot<T>>({ state: "off" }));
    const [attendance, assignments, results, fees] = await Promise.all([
      forChild("attendance", async (c) => {
        const s = await new StudentAttendanceService(this.ctx).studentSummary(c.id, monthStart(date), date);
        return { pct: s.pct, present: s.present, absent: s.absent, late: s.late, leave: s.leave, from: s.from };
      }),
      forChild("assignments", (c) => this.assignmentsDue(c.id)),
      forChild("exams", async (c): Promise<LatestResult | null> => {
        const item = (await new ResultService(this.ctx).mine()).find((m) => m.student.id === c.id)?.items[0];
        return item ? { studentId: c.id, examId: item.examId, examName: item.examName, percent: item.percent, grade: item.grade, result: item.result, rank: item.rank, sectionSize: item.sectionSize } : null;
      }),
      forChild("fees", async (c) => (await new DuesService(this.ctx).mine()).find((r) => r.id === c.id) ?? null),
    ]);
    return { attendance, assignments, results, fees };
  }

  protected async assignmentsDue(studentId: string): Promise<AssignmentsDue> {
    const now = this.clock();
    const open = (await new SelfService(this.ctx).mine()).filter((r) => r.studentId === studentId && (r.state === "todo" || r.state === "returned" || r.state === "overdue"));
    const rows = open.slice(0, 6).map((r) => ({ assignmentId: r.assignmentId, title: r.title, subjectName: r.subjectName, dueAt: r.dueAt, hint: dueHint(r.dueAt, now), overdue: r.state === "overdue", studentId }));
    return { rows, todo: open.filter((r) => r.state !== "overdue").length, overdue: open.filter((r) => r.state === "overdue").length };
  }

  async student(): Promise<StudentHome> {
    const [child] = await this.children();
    const [header, timetable, announcements, needsAction] = await Promise.all([this.header(), this.slot("timetable", () => this.timetableToday()), this.announcements(4), this.needsAction()]);
    return { header, child: child ?? null, timetable, announcements, needsAction, ...(await this.learnerPanels(child ?? null)) };
  }
}
