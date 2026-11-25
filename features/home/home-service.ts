import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { AppError, FeatureOffError, ForbiddenError, SchoolService, type Ctx } from "@smw/feature-kit";
import { users } from "@smw/db";
import { academicYears, classes, sections, subjects, terms } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { staffProfiles } from "@smw/feature-staff/schema";
import { closedClassIds, closedDays, closedFrom } from "@smw/feature-attendance/holidays";
import { leaveRequests, studentAttendance } from "@smw/feature-attendance/schema";
import { StudentService, type StudentCapacity } from "@smw/feature-students/service";
import { StudentAttendanceService } from "@smw/feature-attendance/service";
import { CounterService, ChequeService, DuesService, type DueRow, type TrendPoint } from "@smw/feature-fees/service";
import { finApprovals } from "@smw/feature-finance/schema";
import { DashboardService as PayrollDashboard } from "@smw/feature-payroll/services/dashboard";
import { examPapers, exams } from "@smw/feature-exams/schema";
import { ExamService, ResultService } from "@smw/feature-exams/service";
import { SubstitutionService } from "@smw/feature-timetable/substitution-service";
import { TimetableService, type TodayRow } from "@smw/feature-timetable/service";
import { AssignmentService, SelfService } from "@smw/feature-assignments/service";
import { dueHint } from "@smw/feature-assignments/rules";
import { AnnouncementService, FeedService } from "@smw/feature-announcements/service";
import { NotificationService } from "@smw/feature-notifications/service";
import { RequestService } from "@smw/feature-requests/service";
import { DayService } from "@smw/feature-meetings/service";
import { meetingDays, meetingSlots } from "@smw/feature-meetings/schema";
import { unreadByThread } from "@smw/feature-messages/core";
import { messageReports } from "@smw/feature-messages/schema";
import { EventService, type SchoolEvent } from "@smw/feature-events/service";
import { EnquiryService } from "@smw/feature-website/service";
import { ENQUIRY_STATUSES, schoolSites, type EnquiryStatus } from "@smw/feature-website/schema";
import { OPEN_STAGES } from "@smw/feature-website/enquiry-core";
import { HoldService, LibraryStats, LoanService } from "@smw/feature-library/service";
import { RouteService, StudentTransportService } from "@smw/feature-transport/service";
import { vehicleDocuments, vehicles } from "@smw/feature-transport/schema";
import { SetupTaskService, type MyTask } from "@smw/feature-setup/task-service";
import { SupportService } from "@smw/feature-support/service";
import homeFeature from "./feature";
import { staffLinks } from "./staff-links";
import { holds, layoutOf, panelAllowed, panelsFor, type PanelDef, type PanelKey } from "./panels";
import {
  addDays, ageOn, changePct, changePoints, clockIST, dayLabel, dayWords, greeting, markPeriods, monthDayOf, monthStart, monthToDate, nextOpenDay, receiptsHref,
  sameWeekdayAverage, todayIST, type Change, type PeriodState,
} from "./rules";

// ---------- shapes ----------

/** One panel's data. `off` = the module is not on for this school or the person may not see it (render nothing); `error` = it failed (render that panel's error state only). */
export type Slot<T> = { state: "ok"; data: T } | { state: "off" } | { state: "error"; message: string };

export interface HomeHeader { greeting: string; line: string }
export interface Child { id: string; name: string; sectionLabel: string | null; classId: string | null }

/** Why school is closed today (Sunday, a holiday) and the next day it is open. */
export interface DayOff { name: string; next: string | null }

export interface AttentionItem { key: string; label: string; count: number; href: string; tone: "warning" | "danger" | "info" }
export interface SectionToMark { id: string; label: string; students: number; marked: boolean }
export interface SectionsToMark { dayOff: DayOff | null; rows: SectionToMark[] }
export interface PendingPaper { examId: string; examName: string; paperId: string; className: string; subjectName: string; date: string; students: number; entered: number }
export interface AttendanceToday { date: string; dayOff: DayOff | null; pct: number | null; present: number; absent: number; late: number; leave: number; marked: number; students: number }
export interface TodayTimetable { day: number | null; dayOff: DayOff | null; now: string; rows: (TodayRow & { state: PeriodState })[] }
export interface AssignmentRow { assignmentId: string; title: string; subjectName: string; dueAt: Date; hint: string; overdue: boolean; studentId: string }
export interface AssignmentsDue { rows: AssignmentRow[]; todo: number; overdue: number }
export interface LatestResult { studentId: string; examId: string; examName: string; percent: number | null; grade: string | null; result: string; rank: number | null; sectionSize: number }
export interface AttendanceMonth { pct: number | null; present: number; absent: number; late: number; leave: number; from: string }
export interface GradingRow { id: string; title: string; sectionLabel: string; subjectName: string; toGrade: number; dueAt: Date }
export interface RecentPayment { id: string; student: string; amountPaise: number; method: string; receiptNo: string; paidOn: string }
export interface ClassDue { classId: string; name: string; duePaise: number }
export interface OverdueList { total: number; amountPaise: number; /** `phone` only for a role that may see phones. */ rows: (Pick<DueRow, "id" | "name" | "classLabel" | "overdue" | "nextDueDate"> & { phone: string | null })[] }
export interface HomeNotice { id: string; title: string; excerpt: string; publishedAt: Date | null; pinned: boolean; needsAnswer: boolean; href: string }
export interface ActionItem { id: string; title: string; body: string | null; href: string | null; createdAt: Date }
export interface RequestsSummary { mine: number; unassigned: number; overdue: number }
export interface MeetingSlotToday { slotId: string; meetingId: string; meetingTitle: string; startsAt: Date; studentName: string; studentLabel: string | null; visit: string | null }
export interface QuickLink { label: string; href: string; icon: string }

export interface TodayStrip { date: string; dayOff: DayOff | null; closures: { date: string; label: string; name: string }[]; nextEvent: { id: string; title: string; startsAt: Date } | null; staffAway: number | null }
export interface NumberCard { key: "present" | "collected" | "dues" | "enquiries"; label: string; kind: "percent" | "money" | "count"; value: number | null; meta: string; href: string; change: Change | null; failed?: boolean }
export interface AttendanceWeek { dayOff: DayOff | null; points: { date: string; pct: number }[]; unmarked: SectionToMark[]; sections: number }
export interface MoneyTrend { trend: TrendPoint[]; thisMonth: number; lastMonthSame: number; change: Change | null }
export interface Funnel { stages: { key: EnquiryStatus; count: number }[]; open: number; total: number }
export interface Approvals { pending: number; rows: { id: string; title: string; amountPaise: number; href: string }[] }
export interface GettingStarted { card: { percent: number; left: number; next: { label: string; href: string; minutes: number } | null } | null }
export interface MyApprovals { rows: { id: string; title: string; amountPaise: number; href: string | null; since: Date }[] }
export interface Leave { away: { id: string; name: string; until: string }[]; pending: number }
export interface Birthdays { students: { id: string; name: string; label: string | null; age: number | null }[]; staff: { id: string; name: string; age: number | null }[] }
export interface MyClass { dayOff: DayOff | null; canCall: boolean; sections: { id: string; label: string; marked: boolean; absent: { id: string; name: string; phone: string | null }[]; birthdays: { id: string; name: string }[] }[] }
export interface Homework { rows: { id: string; title: string; sectionLabel: string; subjectName: string; dueAt: Date; handedIn: number }[] }
export interface FamilyAnswer { notices: HomeNotice[]; actions: ActionItem[] }
export interface NextExam { examName: string; subject: string; date: string; startTime: string | null; more: number }
export interface NextMeeting { meetingId: string; title: string; teacher: string; startsAt: Date; place: string | null }
export interface BusToday { route: string; stop: string; morning: string | null; evening: string | null; vehicle: string | null; driver: string | null; trackingUrl: string | null }
export interface LibraryBooks { out: number; overdue: number; dueSoon: number; titles: string[] }
export interface FinNumbers {
  today: string;
  collectedToday: { paise: number; count: number }; overdue: { amountPaise: number; count: number }; outstandingPaise: number;
  /** Null when the person does not run a counter. */
  counter: { open: boolean; expectedPaise: number; receipts: number } | null;
}
export interface ChequesToClear { received: { count: number; paise: number }; deposited: { count: number; paise: number }; bounced: { count: number; paise: number } }
export interface PayrollState { month: string; run: { id: string; status: string; label: string; netPaise: number; people: number } | null; next: { text: string; href: string } | null; dueCount: number }
export interface FrontOffice { calls: number; visits: number; fresh: number; rows: { enquiryId: string; studentName: string; parentName: string; label: string; at: Date | null; late: boolean; visit: boolean }[] }
export interface LibraryDesk { dueToday: number; overdue: number; issued: number; holdsWaiting: number; holdsReady: number }
export interface TransportToday { dayOff: DayOff | null; expired: number; expiring: { id: string; vehicleId: string; reg: string; kind: string; expiresOn: string; days: number }[]; routes: { id: string; name: string; riders: number; vehicle: string | null }[] }
export interface ExamCoordinator { papers: number; missing: number; exams: { examId: string; examName: string; papers: number; missing: number }[] }
export interface CoverNeeded { date: string; dayOff: DayOff | null; absent: number; open: number }
export interface WebsiteState { state: "never" | "draft" | "asked" | "live"; draftAt: Date | null; askedAt: Date | null; askedNote: string | null }
export interface Safeguarding { reports: number }

/** What each panel loads, by key. */
export interface PanelData {
  "today": TodayStrip; "needs-action": ActionItem[]; "attention": { items: AttentionItem[]; unchecked: string[] }; "numbers": NumberCard[];
  "attendance-week": AttendanceWeek; "money-trend": MoneyTrend; "funnel": Funnel; "requests": RequestsSummary; "approvals": Approvals; "my-approvals": MyApprovals;
  "getting-started": GettingStarted; "my-setup": MyTask[]; "plan": StudentCapacity; "leave": Leave; "birthdays": Birthdays; "notices": HomeNotice[]; "events": SchoolEvent[];
  "now-next": TodayTimetable; "to-mark": SectionsToMark; "to-grade": { toGrade: number; rows: GradingRow[] }; "marks": PendingPaper[]; "homework": Homework; "my-class": MyClass;
  "meetings": MeetingSlotToday[]; "messages": { unread: number };
  "family-answer": FamilyAnswer; "family-classes": TodayTimetable; "family-homework": AssignmentsDue; "family-dues": DueRow | null; "family-attendance": AttendanceMonth;
  "family-exam": NextExam | null; "family-result": LatestResult | null; "family-meeting": NextMeeting | null; "family-bus": BusToday | null; "family-library": LibraryBooks;
  "fin-numbers": FinNumbers; "dues-by-class": ClassDue[]; "overdue": OverdueList; "receipts": RecentPayment[]; "cheques": ChequesToClear; "payroll": PayrollState;
  "front-office": FrontOffice; "library": LibraryDesk; "transport": TransportToday; "exam-coordinator": ExamCoordinator; "cover": CoverNeeded; "website": WebsiteState;
  "safeguarding": Safeguarding; "links": QuickLink[];
}

const UNAVAILABLE = "Could not load this. Try again in a moment.";
const STAGE_COUNT = (c: Record<EnquiryStatus, number>) => ENQUIRY_STATUSES.map((key) => ({ key, count: c[key] ?? 0 }));
type Perm = keyof typeof homeFeature.permissions;

/**
 * Everything Home shows, one method per panel. Each panel loads on its own: a module that is off, or a panel the person may not
 * see, gives `off`; one that fails gives `error` for that panel only. Data two panels both need is loaded once per instance
 * (`once`), so build one HomeService per request. Framework-free, so the mobile API can reuse it.
 */
export class HomeService extends SchoolService<Perm> {
  protected feature = homeFeature;
  private readonly memo = new Map<string, Promise<unknown>>();

  /** `clock` is injectable so tests can pin "today". */
  constructor(ctx: Ctx, protected readonly clock: () => Date = () => new Date()) { super(ctx); }

  private get today() { return todayIST(this.clock()); }

  // ---------- plumbing ----------

  /** Load once per request, however many panels ask. */
  protected once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key);
    if (!p) { p = fn(); this.memo.set(key, p); }
    return p as Promise<T>;
  }

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

  private holds(need: string) { return holds(this.ctx, need); }

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

  /** The panels this login sees, in order. A legacy parent login has no home. */
  layout(): PanelDef[] {
    this.authorize("view", "read");
    if (this.ctx.role === "parent") throw new ForbiddenError();
    return panelsFor(this.ctx);
  }

  /** One panel's data. A panel this login may not see is `off`, whatever the caller asked for. */
  panel<K extends PanelKey>(key: K): Promise<Slot<PanelData[K]>> {
    if (!panelAllowed(this.ctx, key) || !layoutOf(this.ctx).includes(key)) return Promise.resolve({ state: "off" });
    return (this.loaders[key] as () => Promise<Slot<PanelData[K]>>)();
  }

  /** A school with no students yet shows its admin the setup, not a page of empty boxes. */
  async emptySchool(): Promise<boolean> {
    if (this.ctx.role !== "admin" || !this.ctx.features.has("students")) return false;
    const c = await this.capacity();
    return c.state === "ok" && c.data.active === 0;
  }

  private enquiryCounts() { return this.once("enquiryCounts", () => new EnquiryService(this.ctx).counts()); }

  private upcomingEvents() { return this.once("events", () => new EventService(this.ctx).upcoming(5)); }

  private readonly loaders: { [K in PanelKey]: () => Promise<Slot<PanelData[K]>> } = {
    "today": () => this.todayStrip(), "needs-action": () => this.needsAction(), "attention": () => this.attention(), "numbers": () => this.numbers(),
    "attendance-week": () => this.attendanceWeek(), "money-trend": () => this.moneyTrend(), "funnel": () => this.funnel(), "requests": () => this.requests(),
    "approvals": () => this.approvals(), "my-approvals": () => this.myApprovals(), "getting-started": () => this.gettingStarted(), "my-setup": () => this.mySetup(), "plan": () => this.capacity(),
    "leave": () => this.leave(), "birthdays": () => this.birthdays(), "notices": () => this.announcements(5), "events": () => this.events(),
    "now-next": () => this.nowNext(), "to-mark": () => this.toMark(), "to-grade": () => this.toGrade(), "marks": () => this.marks(), "homework": () => this.homework(),
    "my-class": () => this.myClass(), "meetings": () => this.meetings(), "messages": () => this.messages(),
    "family-answer": () => this.familyAnswer(), "family-classes": () => this.nowNext(), "family-homework": () => this.familyHomework(), "family-dues": () => this.familyDues(),
    "family-attendance": () => this.familyAttendance(), "family-exam": () => this.familyExam(), "family-result": () => this.familyResult(),
    "family-meeting": () => this.familyMeeting(), "family-bus": () => this.familyBus(), "family-library": () => this.familyLibrary(),
    "fin-numbers": () => this.finNumbers(), "dues-by-class": () => this.duesByClass(), "overdue": () => this.overdueList(), "receipts": () => this.receipts(), "cheques": () => this.cheques(),
    "payroll": () => this.payroll(), "front-office": () => this.frontOffice(), "library": () => this.libraryDesk(), "transport": () => this.transportToday(),
    "exam-coordinator": () => this.examCoordinator(), "cover": () => this.cover(), "website": () => this.website(), "safeguarding": () => this.safeguarding(), "links": () => this.links(),
  };

  // ---------- shared loaders (each runs once per request) ----------

  /** Closed days from today for three weeks: today's day off with the next open day, and the closures coming up. */
  private dayInfo() {
    return this.once("day", () => this.read("view", async (tx) => {
      const today = this.today, to = addDays(today, 21);
      const closed = this.ctx.features.has("attendance") ? await closedDays(tx, today, to, { classId: null }) : closedFrom([], today, to, { classId: null });
      const off = closed.get(today) ?? null;
      const next = off ? nextOpenDay(new Set(closed.keys()), today, 21) : null;
      return {
        dayOff: off ? { name: off.name, next: next ? dayWords(next, today) : null } : null,
        closures: [...closed.entries()].filter(([d, c]) => d > today && c.kind !== "sunday").slice(0, 3).map(([d, c]) => ({ date: d, label: dayWords(d, today), name: c.name })),
      };
    }));
  }

  private async dayOff(): Promise<DayOff | null> { return (await this.dayInfo()).dayOff; }

  private capacity(): Promise<Slot<StudentCapacity>> { return this.once("capacity", () => this.slot("students", () => new StudentService(this.ctx).capacity())); }

  /** The fee numbers. Throws when no academic year is set (the panel then says so). */
  protected feeSummary() { return this.once("fees", () => new DuesService(this.ctx).summary()); }

  private feeDays() { return this.once("feeDays", () => new DuesService(this.ctx).trend("day", 65)); }

  private attendanceTrend() { return this.once("attTrend", () => new StudentAttendanceService(this.ctx).trend(30)); }

  /** Today's school-wide attendance. */
  protected attendanceToday(): Promise<Slot<AttendanceToday>> {
    return this.once("attToday", () => this.slot("attendance", async () => {
      const [s, dayOff] = await Promise.all([new StudentAttendanceService(this.ctx).todaySchoolSummary(), this.dayOff()]);
      return { date: s.date, dayOff, pct: s.pct, present: s.present, absent: s.absent, late: s.late, leave: s.leave, marked: s.marked, students: s.students };
    }));
  }

  /** Sections of the current year with an active student and no attendance today (none on a day off). `classTeacherOnly`: only sections this teacher is class teacher of. */
  protected sectionsToMark(classTeacherOnly: boolean): Promise<SectionsToMark> {
    return this.once(`mark:${classTeacherOnly}`, async () => {
      const date = this.today, dayOff = await this.dayOff();
      if (dayOff) return { dayOff, rows: [] };
      return this.read("view", async (tx) => {
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
    });
  }

  /** Papers that still miss marks (one batch for all open exams); a teacher's own ones have `canEnter`. */
  protected pendingPapers() { return this.once("pending", () => new ExamService(this.ctx).pendingPapers()); }

  protected timetableToday(): Promise<TodayTimetable> {
    return this.once("timetable", async () => {
      const now = this.clock();
      const [t, dayOff] = await Promise.all([new TimetableService(this.ctx).today(now), this.dayOff()]);
      return { day: t.day, dayOff, now: clockIST(now), rows: markPeriods(t.rows, clockIST(now)) };
    });
  }

  private assignmentList() { return this.once("assignments", () => new AssignmentService(this.ctx).listWithStats({ pageSize: 100, filters: { status: "published" } })); }

  private child(): Promise<Child | null> { return this.once("child", async () => (await this.children())[0] ?? null); }

  /** The student this login is. */
  async children(): Promise<Child[]> {
    if (!this.ctx.features.has("students")) return [];
    return this.read("view", async (tx) => {
      const rows = await tx.select({ id: students.id, name: students.name, classId: students.classId, cls: classes.name, section: sections.name }).from(students)
        .leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, sections.classId))
        .where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active"))).orderBy(asc(students.name));
      return rows.map((r) => ({ id: r.id, name: r.name, classId: r.classId, sectionLabel: r.cls ? `${r.cls}-${r.section}` : null }));
    });
  }

  /** A panel about the student this login is; `off` when the login has no student. */
  private forChild<T>(needs: string | string[], fn: (c: Child) => Promise<T>): Promise<Slot<T>> {
    return this.slot(needs, async () => { const c = await this.child(); if (!c) throw new ForbiddenError(); return fn(c); });
  }

  // ---------- shared panels ----------

  /** Today strip: school day or day off, closures coming, next event, staff away. */
  protected todayStrip(): Promise<Slot<TodayStrip>> {
    return this.slot([], async () => {
      const [info, event, away] = await Promise.all([
        this.dayInfo(),
        this.ctx.features.has("events") && this.holds("events:read") ? this.upcomingEvents().then((r) => r[0] ?? null).catch(() => null) : Promise.resolve(null),
        this.ctx.features.has("attendance") && this.holds("attendance:approve") ? this.staffAway() : Promise.resolve(null),
      ]);
      return { date: this.today, dayOff: info.dayOff, closures: info.closures, nextEvent: event && { id: event.id, title: event.title, startsAt: event.startsAt }, staffAway: info.dayOff ? null : away };
    });
  }

  /** Staff on approved leave or marked away today (a count, no names). */
  private staffAway(): Promise<number> {
    const d = this.today;
    return this.read("view", async (tx) => {
      const rows = await tx.execute<{ n: number }>(sql`select count(distinct uid)::int n from (
        select user_id uid from leave_requests where kind = 'staff' and status = 'approved' and user_id is not null and from_date <= ${d}::date and to_date >= ${d}::date
        union select user_id from staff_attendance where date = ${d}::date and status in ('absent', 'leave')) x`);
      return [...rows][0]?.n ?? 0;
    });
  }

  /** A family sees what needs their answer first, then pinned, then the newest; staff see the latest sent. */
  private announcements(limit = 5): Promise<Slot<HomeNotice[]>> {
    return this.once(`notices:${limit}`, () => this.slot("announcements", async () => {
      if (this.ctx.role === "student") {
        const { rows } = await new FeedService(this.ctx).feed({ pageSize: limit * 2 });
        const seen = new Set<string>();
        return rows.filter((r) => !r.withdrawn && !seen.has(r.noticeId) && seen.add(r.noticeId))
          .map((r) => ({ id: r.noticeId, title: r.title, excerpt: r.excerpt, publishedAt: r.publishedAt, pinned: r.pinned, needsAnswer: r.needsAnswer, href: `/app/announcements/${r.noticeId}` })).slice(0, limit);
      }
      return (await new AnnouncementService(this.ctx).latest(limit)).map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt, publishedAt: a.publishedAt, pinned: a.pinned, needsAnswer: false, href: `/app/announcements/${a.id}` }));
    }));
  }

  private needsAction(): Promise<Slot<ActionItem[]>> {
    return this.once("action", () => this.slot("notifications", async () => (await new NotificationService(this.ctx).list({ page: 1, pageSize: 5, filters: { tab: "action" } })).rows
      .map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt }))));
  }

  /** The office's view of requests: what is mine, what nobody has taken, what is late. */
  private requests(): Promise<Slot<RequestsSummary>> {
    return this.slot("requests", async () => { const c = await new RequestService(this.ctx).counts(); return { mine: c.mine, unassigned: c.unassigned, overdue: c.overdue }; });
  }

  private events() { return this.slot("events", () => this.upcomingEvents().then((r) => r.slice(0, 5))); }

  // ---------- admin ----------

  /** Four numbers, each with how it moved; a number whose module is off is left out, one that failed says so. */
  protected async numbers(): Promise<Slot<NumberCard[]>> {
    return this.slot([], async () => {
      const today = this.today;
      const card = async (key: NumberCard["key"], label: string, href: string, kind: NumberCard["kind"], run: () => Promise<Omit<NumberCard, "key" | "label" | "href" | "kind"> | null>): Promise<NumberCard | null> => {
        try { const r = await run(); return r && { key, label, href, kind, ...r }; }
        catch (e) {
          if (e instanceof FeatureOffError || e instanceof ForbiddenError) return null;
          if (!(e instanceof AppError)) console.error("[home] number failed", e);
          // "Set up the academic year first" is said as it is and links to the page that fixes it.
          const say = e instanceof AppError ? e.message : "Could not load";
          return { key, label, href: /academic year/i.test(say) ? "/app/academics/years" : href, kind, value: null, meta: say, change: null, failed: true };
        }
      };
      const on = (f: string, need: string) => this.ctx.features.has(f) && this.holds(need);
      const cards = await Promise.all([
        on("attendance", "attendance:read") ? card("present", "Present today", "/app/attendance", "percent", async () => {
          const a = await this.attendanceToday();
          if (a.state !== "ok") return null;
          const d = a.data;
          if (d.dayOff) return { value: null, meta: `${d.dayOff.name}, no classes${d.dayOff.next ? `. Next school day: ${d.dayOff.next}` : ""}`, change: null };
          if (!d.marked || d.pct === null) return { value: null, meta: "Not marked yet", change: null };
          const avg = sameWeekdayAverage(await this.attendanceTrend(), today);
          // The change is worked out from the two numbers as they are shown (whole percents).
          const now = Math.round(d.pct), before = avg === null ? null : Math.round(avg);
          return { value: now, meta: before === null ? `${d.absent} absent` : `${d.absent} absent, vs ${before}% on the last ${new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" })}s`, change: before === null ? null : changePoints(now, before) };
        }) : null,
        on("fees", "fees:read") ? card("collected", "Collected this month", receiptsHref(monthStart(today), today), "money", async () => {
          const m = monthToDate(await this.feeDays(), today);
          return { value: m.thisMonth, meta: m.lastMonthSame > 0 ? "vs the same days last month" : "Nothing collected the same days last month", change: changePct(m.thisMonth, m.lastMonthSame) };
        }) : null,
        on("fees", "fees:read") ? card("dues", "Dues", "/app/fees/dues", "money", async () => {
          const s = await this.feeSummary();
          return { value: s.outstanding, meta: s.overdueCount ? `${s.overdueCount} ${s.overdueCount === 1 ? "student" : "students"} overdue` : "Nobody is overdue", change: null };
        }) : null,
        on("website", "website:enquiries") ? card("enquiries", "Open enquiries", "/app/enquiries?view=list&stage=open", "count", async () => {
          const c = await this.enquiryCounts();
          const open = OPEN_STAGES.reduce((n, s) => n + c[s], 0);
          return { value: open, meta: c.new ? `${c.new} new, waiting for a call` : "None waiting for a first call", change: null };
        }) : null,
      ]);
      return cards.filter((c): c is NumberCard => c !== null);
    });
  }

  /** "Needs attention": only things with a count above zero, each with the page that fixes it. `unchecked` names sources that failed, so "all clear" is never claimed blindly. */
  protected async attention(): Promise<Slot<{ items: AttentionItem[]; unchecked: string[] }>> {
    return this.slot([], async () => {
      const [unmarked, fees, marks, support, enquiries] = await Promise.all([
        this.slot("attendance", () => this.sectionsToMark(false)),
        this.slot("fees", () => this.feeSummary()),
        this.slot("exams", () => this.pendingPapers()),
        this.slot("support", () => new SupportService(this.ctx).waiting()),
        this.slot("website", () => this.enquiryCounts()),
      ]);
      const items: AttentionItem[] = [];
      const unchecked: string[] = [];
      const take = <T>(s: Slot<T>, label: string, add: (d: T) => void) => { if (s.state === "ok") add(s.data); else if (s.state === "error") unchecked.push(label); };
      take(unmarked, "attendance", (d) => { const n = d.rows.filter((r) => !r.marked).length; if (n) items.push({ key: "attendance", label: n === 1 ? "Section not marked today" : "Sections not marked today", count: n, href: "/app/attendance", tone: "warning" }); });
      take(fees, "fees", (d) => { const n = d.overdueCount; if (n) items.push({ key: "fees", label: n === 1 ? "Student with overdue fees" : "Students with overdue fees", count: n, href: "/app/fees/dues?overdue=1", tone: "danger" }); });
      take(marks, "exams", (d) => { const ids = [...new Set(d.map((p) => p.examId))]; if (ids.length) items.push({ key: "marks", label: ids.length === 1 ? "Exam missing marks" : "Exams missing marks", count: ids.length, href: ids.length === 1 ? `/app/exams/${ids[0]}` : "/app/exams?status=marks_open", tone: "warning" }); });
      take(support, "support", (n) => { if (n) items.push({ key: "support", label: n === 1 ? "Support ticket waiting for your reply" : "Support tickets waiting for your reply", count: n, href: "/app/support?status=pending", tone: "info" }); });
      take(enquiries, "enquiries", (d) => { if (d.new) items.push({ key: "enquiries", label: d.new === 1 ? "New admission enquiry" : "New admission enquiries", count: d.new, href: "/app/enquiries?view=list&stage=new", tone: "info" }); });
      return { items, unchecked };
    });
  }

  /** Attendance over the last 7 days and the sections still not marked today. */
  protected attendanceWeek(): Promise<Slot<AttendanceWeek>> {
    return this.slot("attendance", async () => {
      const today = this.today, from = addDays(today, -6);
      const [trend, marks] = await Promise.all([this.attendanceTrend(), this.sectionsToMark(false)]);
      return { dayOff: marks.dayOff, points: trend.filter((p) => p.date >= from && p.date <= today), unmarked: marks.rows.filter((r) => !r.marked), sections: marks.rows.length };
    });
  }

  protected moneyTrend(): Promise<Slot<MoneyTrend>> {
    return this.slot("fees", async () => {
      const [trend, days] = await Promise.all([new DuesService(this.ctx).trend("month", 6), this.feeDays()]);
      const m = monthToDate(days, this.today);
      return { trend, thisMonth: m.thisMonth, lastMonthSame: m.lastMonthSame, change: changePct(m.thisMonth, m.lastMonthSame) };
    });
  }

  /** The admissions funnel in one small bar: how many enquiries sit at each stage. */
  protected funnel(): Promise<Slot<Funnel>> {
    return this.slot("website", async () => {
      const c = await this.enquiryCounts();
      return { stages: STAGE_COUNT(c), open: OPEN_STAGES.reduce((n, s) => n + c[s], 0), total: ENQUIRY_STATUSES.reduce((n, s) => n + c[s], 0) };
    });
  }

  /** Money requests waiting for a decision (the approvals list proves the count). */
  protected approvals(): Promise<Slot<Approvals>> {
    return this.slot("finance", () => this.read("view", async (tx) => {
      const where = eq(finApprovals.status, "pending");
      const [[n], rows] = await Promise.all([
        tx.select({ n: count() }).from(finApprovals).where(where),
        tx.select({ id: finApprovals.id, title: finApprovals.title, amountPaise: finApprovals.amountPaise, href: finApprovals.href }).from(finApprovals).where(where).orderBy(asc(finApprovals.createdAt)).limit(4),
      ]);
      return { pending: Number(n?.n ?? 0), rows: rows.map((r) => ({ id: r.id, title: r.title, amountPaise: Number(r.amountPaise), href: "/app/finance/approvals" })) };
    }));
  }

  /** What this person asked to have approved and is still waiting for (for someone who cannot approve). */
  protected myApprovals(): Promise<Slot<MyApprovals>> {
    return this.slot("finance", async () => {
      if (this.holds("finance:approve")) throw new ForbiddenError();
      return this.read("view", async (tx) => ({ rows: (await tx.select({ id: finApprovals.id, title: finApprovals.title, amountPaise: finApprovals.amountPaise, href: finApprovals.href, since: finApprovals.createdAt }).from(finApprovals)
        .where(and(eq(finApprovals.status, "pending"), eq(finApprovals.requestedBy, this.ctx.userId))).orderBy(asc(finApprovals.createdAt)).limit(5)).map((r) => ({ ...r, amountPaise: Number(r.amountPaise) })) }));
    });
  }

  /** The getting-started card; hiding it is the school's choice, kept on the server. */
  protected gettingStarted(): Promise<Slot<GettingStarted>> {
    return this.slot("setup", async () => ({ card: await new SetupTaskService(this.ctx).card() }));
  }

  /** Tasks someone gave this person in Getting started. */
  protected mySetup(): Promise<Slot<MyTask[]>> { return this.slot("setup", () => new SetupTaskService(this.ctx).mine()); }

  /** Staff away on approved leave today, and requests waiting for a decision. */
  protected leave(): Promise<Slot<Leave>> {
    return this.slot("attendance", () => this.read("view", async (tx) => {
      const d = this.today;
      const [away, [pending]] = await Promise.all([
        tx.select({ id: leaveRequests.id, name: users.name, until: leaveRequests.toDate }).from(leaveRequests).innerJoin(users, eq(users.id, leaveRequests.userId))
          .where(and(eq(leaveRequests.kind, "staff"), eq(leaveRequests.status, "approved"), lte(leaveRequests.fromDate, d), gte(leaveRequests.toDate, d))).orderBy(asc(leaveRequests.toDate), asc(users.name)).limit(8),
        tx.select({ n: count() }).from(leaveRequests).where(and(eq(leaveRequests.kind, "staff"), eq(leaveRequests.status, "pending"))),
      ]);
      return { away, pending: Number(pending?.n ?? 0) };
    }));
  }

  /** Students and staff whose birthday is today (active only). */
  protected birthdays(): Promise<Slot<Birthdays>> {
    return this.slot("students", () => this.read("view", async (tx) => {
      const today = this.today, md = monthDayOf(today);
      const [kids, team] = await Promise.all([
        tx.select({ id: students.id, name: students.name, dob: students.dob, cls: classes.name, section: sections.name }).from(students)
          .leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, sections.classId))
          .where(and(eq(students.status, "active"), sql`to_char(${students.dob}, 'MM-DD') = ${md}`)).orderBy(asc(students.name)).limit(12),
        this.ctx.features.has("staff") && this.holds("staff:read")
          ? tx.select({ id: users.id, name: users.name, dob: staffProfiles.dob }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId))
            .where(and(eq(staffProfiles.status, "active"), sql`${users.status} <> 'disabled'`, sql`to_char(${staffProfiles.dob}, 'MM-DD') = ${md}`)).orderBy(asc(users.name)).limit(12)
          : Promise.resolve([]),
      ]);
      return {
        students: kids.map((k) => ({ id: k.id, name: k.name, label: k.cls ? `${k.cls}-${k.section}` : null, age: k.dob ? ageOn(k.dob, today) : null })),
        staff: team.map((t) => ({ id: t.id, name: t.name, age: t.dob ? ageOn(t.dob, today) : null })),
      };
    }));
  }

  // ---------- teacher ----------

  protected nowNext(): Promise<Slot<TodayTimetable>> { return this.slot("timetable", () => this.timetableToday()); }

  protected toMark(): Promise<Slot<SectionsToMark>> { return this.slot("attendance", () => this.sectionsToMark(true)); }

  protected toGrade(): Promise<Slot<{ toGrade: number; rows: GradingRow[] }>> {
    return this.slot("assignments", async () => {
      const page = await this.assignmentList();
      const rows = page.rows.map((r) => ({ id: r.id, title: r.title, sectionLabel: r.sectionLabel, subjectName: r.subjectName, toGrade: r.progress.submitted + r.progress.late, dueAt: r.dueAt }))
        .filter((r) => r.toGrade > 0).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      return { toGrade: rows.reduce((n, r) => n + r.toGrade, 0), rows };
    });
  }

  /** Papers this person can enter marks for. */
  protected marks(): Promise<Slot<PendingPaper[]>> {
    return this.slot("exams", async () => (await this.pendingPapers()).filter((p) => p.canEnter)
      .map((p) => ({ examId: p.examId, examName: p.examName, paperId: p.id, className: p.className, subjectName: p.subjectName, date: p.date, students: p.students, entered: p.entered })));
  }

  /** Published homework that falls due in the next three days, with how much is handed in. */
  protected homework(): Promise<Slot<Homework>> {
    return this.slot("assignments", async () => {
      const now = this.clock().getTime(), soon = now + 3 * 86_400_000;
      const page = await this.assignmentList();
      return { rows: page.rows.filter((r) => r.dueAt.getTime() >= now && r.dueAt.getTime() <= soon).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .map((r) => ({ id: r.id, title: r.title, sectionLabel: r.sectionLabel, subjectName: r.subjectName, dueAt: r.dueAt, handedIn: r.progress.submitted + r.progress.late })) };
    });
  }

  /** The class this teacher is class teacher of: who is absent today (with the guardian's number where this role may see phones) and whose birthday it is. */
  protected myClass(): Promise<Slot<MyClass>> {
    return this.slot("attendance", async () => {
      const date = this.today, md = monthDayOf(date), canCall = this.holds("students:read"), dayOff = await this.dayOff();
      return this.read("view", async (tx) => {
        const own = await tx.select({ id: sections.id, cls: classes.name, name: sections.name }).from(sections).innerJoin(classes, eq(classes.id, sections.classId))
          .innerJoin(academicYears, and(eq(academicYears.id, sections.yearId), eq(academicYears.isCurrent, true))).where(eq(sections.classTeacherId, this.ctx.userId)).orderBy(asc(classes.grade), asc(sections.name));
        if (!own.length) return { dayOff, canCall, sections: [] };
        const ids = own.map((s) => s.id);
        const [absent, marked, born] = await Promise.all([
          tx.select({ id: students.id, name: students.name, sectionId: studentAttendance.sectionId }).from(studentAttendance).innerJoin(students, eq(students.id, studentAttendance.studentId))
            .where(and(eq(studentAttendance.date, date), eq(studentAttendance.status, "absent"), inArray(studentAttendance.sectionId, ids), eq(students.status, "active"))).orderBy(asc(students.name)),
          tx.select({ id: studentAttendance.sectionId, n: count() }).from(studentAttendance).where(and(eq(studentAttendance.date, date), inArray(studentAttendance.sectionId, ids))).groupBy(studentAttendance.sectionId),
          tx.select({ id: students.id, name: students.name, sectionId: students.sectionId }).from(students)
            .where(and(inArray(students.sectionId, ids), eq(students.status, "active"), sql`to_char(${students.dob}, 'MM-DD') = ${md}`)).orderBy(asc(students.name)),
        ]);
        const phones = canCall && absent.length
          ? await tx.select({ studentId: studentGuardians.studentId, phone: guardians.phone, primary: studentGuardians.isPrimary }).from(studentGuardians)
            .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(inArray(studentGuardians.studentId, absent.map((a) => a.id)))
          : [];
        const done = new Set(marked.filter((m) => Number(m.n) > 0).map((m) => m.id));
        const phoneOf = (id: string) => phones.filter((p) => p.studentId === id && p.phone).sort((a, b) => Number(b.primary) - Number(a.primary))[0]?.phone ?? null;
        return {
          dayOff, canCall,
          sections: own.map((s) => ({
            id: s.id, label: `${s.cls}-${s.name}`, marked: done.has(s.id),
            absent: absent.filter((a) => a.sectionId === s.id).map((a) => ({ id: a.id, name: a.name, phone: phoneOf(a.id) })),
            birthdays: born.filter((b) => b.sectionId === s.id).map((b) => ({ id: b.id, name: b.name })),
          })),
        };
      });
    });
  }

  /** This teacher's booked parent-meeting slots today, in time order: one read that marks nothing seen. A failure shows as the panel's error. */
  protected meetings(): Promise<Slot<MeetingSlotToday[]>> {
    return this.slot("meetings", () => new DayService(this.ctx).mineOn(this.today));
  }

  /** Messages from others this person has not opened. */
  protected messages(): Promise<Slot<{ unread: number }>> {
    return this.slot("messages", () => this.read("view", async (tx) => ({ unread: [...(await unreadByThread(tx, { userId: this.ctx.userId, role: this.ctx.role })).values()].reduce((a, b) => a + b, 0) })));
  }

  // ---------- family ----------

  protected familyAnswer(): Promise<Slot<FamilyAnswer>> {
    return this.slot([], async () => {
      const [notices, actions] = await Promise.all([this.announcements(5), this.needsAction()]);
      return { notices: notices.state === "ok" ? notices.data.filter((n) => n.needsAnswer) : [], actions: actions.state === "ok" ? actions.data : [] };
    });
  }

  protected familyHomework(): Promise<Slot<AssignmentsDue>> {
    return this.forChild("assignments", async (c) => {
      const now = this.clock();
      const open = (await new SelfService(this.ctx).mine()).filter((r) => r.studentId === c.id && (r.state === "todo" || r.state === "returned" || r.state === "overdue"));
      const rows = open.slice(0, 6).map((r) => ({ assignmentId: r.assignmentId, title: r.title, subjectName: r.subjectName, dueAt: r.dueAt, hint: dueHint(r.dueAt, now), overdue: r.state === "overdue", studentId: c.id }));
      return { rows, todo: open.filter((r) => r.state !== "overdue").length, overdue: open.filter((r) => r.state === "overdue").length };
    });
  }

  protected familyDues(): Promise<Slot<DueRow | null>> {
    return this.forChild("fees", async (c) => (await new DuesService(this.ctx).mine()).find((r) => r.id === c.id) ?? null);
  }

  protected familyAttendance(): Promise<Slot<AttendanceMonth>> {
    return this.forChild("attendance", async (c) => {
      const date = this.today, s = await new StudentAttendanceService(this.ctx).studentSummary(c.id, monthStart(date), date);
      return { pct: s.pct, present: s.present, absent: s.absent, late: s.late, leave: s.leave, from: s.from };
    });
  }

  protected familyResult(): Promise<Slot<LatestResult | null>> {
    return this.forChild("exams", async (c) => {
      const item = (await new ResultService(this.ctx).mine()).find((m) => m.student.id === c.id)?.items[0];
      return item ? { studentId: c.id, examId: item.examId, examName: item.examName, percent: item.percent, grade: item.grade, result: item.result, rank: item.rank, sectionSize: item.sectionSize } : null;
    });
  }

  /** The next paper in the class's date sheet (exams that are scheduled or open for marks). */
  protected familyExam(): Promise<Slot<NextExam | null>> {
    return this.forChild("exams", async (c) => {
      if (!c.classId) return null;
      const rows = await this.read("view", (tx) => tx.select({ examName: exams.name, subject: subjects.name, date: examPapers.date, startTime: examPapers.startTime }).from(examPapers)
        .innerJoin(exams, eq(exams.id, examPapers.examId)).innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
        .where(and(eq(examPapers.classId, c.classId!), gte(examPapers.date, this.today), inArray(exams.status, ["scheduled", "marks_open"]))).orderBy(asc(examPapers.date), asc(examPapers.startTime)).limit(6));
      const [first] = rows;
      return first ? { examName: first.examName, subject: first.subject, date: first.date, startTime: first.startTime, more: rows.length - 1 } : null;
    });
  }

  /** The family's next booked parent-meeting slot. */
  protected familyMeeting(): Promise<Slot<NextMeeting | null>> {
    return this.forChild("meetings", (c) => this.read("view", async (tx) => {
      const [row] = await tx.select({ meetingId: meetingSlots.meetingId, title: meetingDays.title, teacher: users.name, startsAt: meetingSlots.startsAt, place: sql<string | null>`(select w.place from meeting_windows w where w.id = ${meetingSlots.windowId})` })
        .from(meetingSlots).innerJoin(meetingDays, eq(meetingDays.id, meetingSlots.meetingId)).innerJoin(users, eq(users.id, meetingSlots.teacherId))
        .where(and(eq(meetingSlots.studentId, c.id), eq(meetingSlots.state, "booked"), gte(meetingSlots.startsAt, this.clock()))).orderBy(asc(meetingSlots.startsAt)).limit(1);
      return row ?? null;
    }));
  }

  protected familyBus(): Promise<Slot<BusToday | null>> {
    return this.forChild("transport", async (c) => {
      const r = (await new StudentTransportService(this.ctx).mine()).find((x) => x.studentId === c.id);
      return r ? { route: r.routeName, stop: r.stopName, morning: r.morningTime, evening: r.eveningTime, vehicle: r.vehicle, driver: r.driverName, trackingUrl: r.trackingUrl } : null;
    });
  }

  protected familyLibrary(): Promise<Slot<LibraryBooks>> {
    return this.forChild("library", async (c) => {
      const out = (await new LoanService(this.ctx).mine()).filter((l) => l.studentId === c.id && !l.returnedOn);
      const soon = addDays(this.today, 3);
      return { out: out.length, overdue: out.filter((l) => l.status === "overdue").length, dueSoon: out.filter((l) => l.status !== "overdue" && l.dueOn <= soon).length, titles: out.slice(0, 3).map((l) => l.title) };
    });
  }

  // ---------- money ----------

  protected finNumbers(): Promise<Slot<FinNumbers>> {
    return this.slot("fees", async () => {
      const s = await this.feeSummary();
      const counter = this.holds("fees:collect") ? await new CounterService(this.ctx).current().then((c) => ({ open: !!c, expectedPaise: c?.expectedPaise ?? 0, receipts: c?.receipts ?? 0 })) : null;
      return { today: this.today, collectedToday: { paise: s.collectedToday, count: s.receiptsToday }, overdue: { amountPaise: s.overdueAmount, count: s.overdueCount }, outstandingPaise: s.outstanding, counter };
    });
  }

  protected duesByClass(): Promise<Slot<ClassDue[]>> { return this.slot("fees", () => new DuesService(this.ctx).dueByClass()); }

  protected overdueList(): Promise<Slot<OverdueList>> {
    return this.slot("fees", async () => {
      const [rows, s] = await Promise.all([new DuesService(this.ctx).worstOverdue(6), this.feeSummary()]);
      const phones = this.holds("students:read"); // a call link only for a role that may see phones
      return { total: s.overdueCount, amountPaise: s.overdueAmount, rows: rows.map(({ phone, ...r }) => ({ ...r, phone: phones ? phone : null })) };
    });
  }

  protected receipts(): Promise<Slot<RecentPayment[]>> { return this.slot("fees", () => new DuesService(this.ctx).recentReceipts(8)); }

  /** Cheques received and not yet cleared, and bounced ones. */
  protected cheques(): Promise<Slot<ChequesToClear>> {
    return this.slot("fees", async () => {
      const t = await new ChequeService(this.ctx).totals(), pick = (k: string) => t[k] ?? { count: 0, paise: 0 };
      return { received: pick("received"), deposited: pick("deposited"), bounced: pick("bounced") };
    });
  }

  protected payroll(): Promise<Slot<PayrollState>> {
    return this.slot("payroll", async () => {
      const o = await new PayrollDashboard(this.ctx).overview();
      return { month: o.month, run: o.run, next: o.next, dueCount: o.due.length };
    });
  }

  // ---------- custom roles ----------

  /** Calls due (new enquiries nobody has called, and follow-ups due or late) and visits today. */
  protected frontOffice(): Promise<Slot<FrontOffice>> {
    return this.slot("website", async () => {
      const t = await new EnquiryService(this.ctx).today("mine", this.clock());
      const item = (i: (typeof t.fresh)[number], visit: boolean) => ({ enquiryId: i.enquiryId, studentName: i.studentName, parentName: i.parentName, label: visit ? "Visit" : i.title ?? (i.taskId ? "Follow-up call" : "First call"), at: i.at, late: i.late, visit });
      const rows = [...t.visits.map((i) => item(i, true)), ...t.fresh.map((i) => item(i, false)), ...t.due.map((i) => item(i, false))].slice(0, 5);
      return { calls: t.due.length + t.fresh.length, visits: t.visits.length, fresh: t.fresh.length, rows };
    });
  }

  protected libraryDesk(): Promise<Slot<LibraryDesk>> {
    return this.slot("library", async () => {
      const [stats, due, holdsQueue] = await Promise.all([
        new LibraryStats(this.ctx).summary(),
        new LoanService(this.ctx).list({ filters: { status: "due-today" }, pageSize: 1 }),
        new HoldService(this.ctx).queue(),
      ]);
      return { dueToday: due.total, overdue: stats.overdue, issued: stats.issuedNow, holdsWaiting: holdsQueue.filter((h) => h.status === "waiting").length, holdsReady: holdsQueue.filter((h) => h.status === "ready").length };
    });
  }

  /** Vehicle papers that expire within 30 days (or have), and today's routes. */
  protected transportToday(): Promise<Slot<TransportToday>> {
    return this.slot("transport", async () => {
      const today = this.today, soon = addDays(today, 30), dayOff = await this.dayOff();
      const [docs, routes] = await Promise.all([
        this.read("view", (tx) => tx.select({ id: vehicleDocuments.id, vehicleId: vehicles.id, reg: vehicles.registrationNo, kind: vehicleDocuments.kind, expiresOn: vehicleDocuments.expiresOn }).from(vehicleDocuments)
          .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId)).where(lte(vehicleDocuments.expiresOn, soon)).orderBy(asc(vehicleDocuments.expiresOn)).limit(40)),
        dayOff ? Promise.resolve([]) : new RouteService(this.ctx).overview(),
      ]);
      const days = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      return {
        dayOff, expired: docs.filter((d) => d.expiresOn < today).length,
        expiring: docs.slice(0, 4).map((d) => ({ ...d, days: days(d.expiresOn) })),
        routes: routes.filter((r) => r.riders > 0).map((r) => ({ id: r.route.id, name: r.route.name, riders: r.riders, vehicle: r.vehicle?.registrationNo ?? null })),
      };
    });
  }

  /** Marks still missing in exams that are open for entry. */
  protected examCoordinator(): Promise<Slot<ExamCoordinator>> {
    return this.slot("exams", async () => {
      const rows = await this.pendingPapers(), byExam = new Map<string, { examId: string; examName: string; papers: number; missing: number }>();
      for (const p of rows) {
        const e = byExam.get(p.examId) ?? { examId: p.examId, examName: p.examName, papers: 0, missing: 0 };
        e.papers++; e.missing += p.students - p.entered; byExam.set(p.examId, e);
      }
      return { papers: rows.length, missing: rows.reduce((n, p) => n + p.students - p.entered, 0), exams: [...byExam.values()] };
    });
  }

  /** Periods of absent teachers that nobody covers yet today. */
  protected cover(): Promise<Slot<CoverNeeded>> {
    return this.slot("timetable", async () => {
      const dayOff = await this.dayOff();
      if (dayOff) return { date: this.today, dayOff, absent: 0, open: 0 };
      const b = await new SubstitutionService(this.ctx).board(this.today);
      return { date: this.today, dayOff: null, absent: b.absent.length, open: b.absent.reduce((n, t) => n + t.periods.filter((p) => !p.cover).length, 0) };
    });
  }

  /** Whether the website draft is waiting to be published (or waits for an approver). */
  protected website(): Promise<Slot<WebsiteState>> {
    return this.slot("website", () => this.read("view", async (tx) => {
      const [s] = await tx.select({ draftAt: schoolSites.draftAt, publishedAt: schoolSites.publishedAt, askedAt: schoolSites.askedAt, askedNote: schoolSites.askedNote }).from(schoolSites).limit(1);
      const draft = !!s?.draftAt && (!s.publishedAt || s.draftAt > s.publishedAt);
      const state = !s ? "never" : s.askedAt ? "asked" : draft ? "draft" : s.publishedAt ? "live" : "never";
      return { state, draftAt: s?.draftAt ?? null, askedAt: s?.askedAt ?? null, askedNote: s?.askedNote ?? null } satisfies WebsiteState;
    }));
  }

  /** Open reports, a count only: the reports themselves are for the safeguarding page. */
  protected safeguarding(): Promise<Slot<Safeguarding>> {
    return this.slot("messages", () => this.read("view", async (tx) => {
      const [r] = await tx.select({ n: count() }).from(messageReports).where(eq(messageReports.state, "new"));
      return { reports: Number(r?.n ?? 0) };
    }));
  }

  /** Links to the pages this login may open. */
  protected links(): Promise<Slot<QuickLink[]>> { return Promise.resolve({ state: "ok", data: staffLinks(this.ctx) }); }
}
