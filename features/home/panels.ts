// The panel registry: every panel Home can show, what it needs, and the fixed order each kind of login sees. Pure data, no database, no React.
import { allows, type Ctx } from "@smw/feature-kit";
import { FEATURES } from "./staff-links";

type Who = Pick<Ctx, "role" | "features" | "grants" | "supportStaffId" | "leftUntil">;

export type PanelKey =
  // shared
  | "today" | "needs-action" | "attention" | "numbers" | "attendance-week" | "money-trend" | "funnel" | "requests" | "approvals" | "my-approvals"
  | "left" | "getting-started" | "my-setup" | "plan" | "leave" | "birthdays" | "notices" | "events"
  // teacher
  | "now-next" | "to-mark" | "to-grade" | "marks" | "homework" | "my-class" | "meetings" | "messages"
  // family
  | "family-answer" | "family-classes" | "family-homework" | "family-dues" | "family-attendance" | "family-exam" | "family-result" | "family-meeting" | "family-bus" | "family-library"
  // money
  | "fin-numbers" | "dues-by-class" | "overdue" | "receipts" | "cheques" | "payroll"
  // custom roles
  | "front-office" | "library" | "transport" | "exam-coordinator" | "cover" | "website" | "safeguarding" | "links";

export interface PanelDef {
  key: PanelKey;
  title: string;
  /** "feature:permission" pairs; all must hold (the module on, and the grant or the role default). They cover what the data call needs and every page the panel links to. */
  needs: readonly string[];
  /** Columns out of 12 on a wide screen; a phone always gets the full width. */
  size: 4 | 5 | 6 | 7 | 12;
  /** Height of the skeleton while the panel loads, close to the real panel so the page does not jump. */
  height: number;
  /** Skeleton height on a phone, where cards stack. */
  phone?: number;
  /** Usually one line (or nothing): its skeleton is a line, so a panel that has nothing to say does not leave a hole. */
  quiet?: boolean;
  /** Shows names, phones, messages or children: never in a support session. */
  private?: boolean;
  /** A permission that takes the panel away (an approver sees the approvals themselves, not their own waiting requests). */
  not?: string;
  /** The pages the panel can link to (path only); each is checked against what `needs` gives. */
  links: readonly string[];
}

const def = (key: PanelKey, title: string, size: PanelDef["size"], height: number, needs: string[], links: string[], o: Partial<Pick<PanelDef, "private" | "quiet" | "phone" | "not">> = {}): PanelDef => ({ key, title, size, height, needs, links, ...o });
const LINE = 48;

export const PANELS: Record<PanelKey, PanelDef> = {
  /** For a student who left: what the login still does, until when, and who to ask. Nothing else is on their Home. */
  "left": def("left", "Your login", 12, 160, [], []),
  "today": def("today", "Today", 12, 76, [], []),
  "needs-action": def("needs-action", "Needs action", 7, 240, ["notifications:read"], ["/app/notifications"], { private: true }),
  "attention": def("attention", "Needs attention", 5, 240, [], []),
  "numbers": def("numbers", "Key numbers", 12, 136, [], [], { phone: 284 }),
  "attendance-week": def("attendance-week", "Attendance this week", 7, 300, ["attendance:read"], ["/app/attendance"]),
  "money-trend": def("money-trend", "Fee collection", 5, 300, ["fees:read"], ["/app/fees/reports", "/app/fees"]),
  "funnel": def("funnel", "Admissions", 6, 380, ["website:enquiries"], ["/app/enquiries"]),
  "requests": def("requests", "Requests", 6, LINE, ["requests:use"], ["/app/requests"], { quiet: true }),
  "approvals": def("approvals", "Approvals", 6, LINE, ["finance:approve"], ["/app/finance/approvals"], { quiet: true, private: true }),
  "my-approvals": def("my-approvals", "Waiting for approval", 6, LINE, ["fees:read", "fees:collect"], [], { quiet: true, private: true, not: "finance:approve" }),
  "getting-started": def("getting-started", "Getting started", 12, LINE, ["setup:run"], ["/app/getting-started"], { quiet: true }),
  "my-setup": def("my-setup", "Your setup tasks", 12, LINE, ["setup:task"], ["/app/getting-started"], { quiet: true, private: true }),
  "plan": def("plan", "Plan usage", 6, 240, ["students:write", "settings:manage"], ["/app/billing"]),
  "leave": def("leave", "Staff on leave", 6, LINE, ["attendance:approve"], ["/app/attendance/leave-calendar", "/app/attendance/leave-requests"], { quiet: true, private: true }),
  "birthdays": def("birthdays", "Birthdays today", 6, LINE, ["students:read"], ["/app/students"], { quiet: true, private: true }),
  "notices": def("notices", "Notices", 7, 240, ["announcements:read"], ["/app/announcements"]),
  "events": def("events", "Events", 5, 240, ["events:read"], ["/app/events"]),

  "now-next": def("now-next", "Now and next", 6, 200, ["timetable:read"], ["/app/timetable"]),
  "to-mark": def("to-mark", "Registers to mark", 6, 200, ["attendance:mark", "attendance:read"], ["/app/attendance"]),
  "to-grade": def("to-grade", "To grade", 6, 200, ["assignments:read"], ["/app/assignments"], { quiet: true }),
  "marks": def("marks", "Marks to enter", 6, 200, ["exams:read", "exams:marks"], ["/app/exams"], { quiet: true }),
  "homework": def("homework", "Homework due", 5, 200, ["assignments:read"], ["/app/assignments"], { quiet: true }),
  "my-class": def("my-class", "My class today", 7, 220, ["attendance:mark", "attendance:read"], ["/app/attendance/register"], { private: true }),
  "meetings": def("meetings", "Parent meetings today", 6, LINE, ["meetings:use"], ["/app/meetings"], { quiet: true, private: true }),
  "messages": def("messages", "Messages", 5, LINE, ["messages:use"], ["/app/messages"], { quiet: true, private: true }),

  "family-answer": def("family-answer", "Needs your answer", 7, LINE, ["announcements:read", "notifications:read"], ["/app/announcements", "/app/notifications"], { quiet: true, private: true }),
  "family-classes": def("family-classes", "Today's classes", 5, 260, ["timetable:read"], ["/app/timetable"]),
  "family-homework": def("family-homework", "Homework due", 6, 220, ["assignments:self"], ["/app/assignments"], { quiet: true }),
  "family-dues": def("family-dues", "Fees", 6, 220, ["fees:self"], ["/app/fees"]),
  "family-attendance": def("family-attendance", "Attendance this month", 4, 260, ["attendance:self"], ["/app/attendance"]),
  "family-exam": def("family-exam", "Next exam", 4, LINE, ["exams:self"], ["/app/results"], { quiet: true }),
  "family-result": def("family-result", "Latest result", 4, 200, ["exams:self"], ["/app/results"]),
  "family-meeting": def("family-meeting", "Next meeting", 4, LINE, ["meetings:use"], ["/app/meetings"], { quiet: true, private: true }),
  "family-bus": def("family-bus", "Bus", 4, LINE, ["transport:self"], ["/app/transport"], { quiet: true }),
  "family-library": def("family-library", "Library books", 4, LINE, ["library:self"], ["/app/library"], { quiet: true }),

  "fin-numbers": def("fin-numbers", "Money today", 12, 136, ["fees:read"], ["/app/fees/receipts", "/app/fees/dues"], { phone: 284 }),
  "dues-by-class": def("dues-by-class", "Dues by class", 7, 280, ["fees:read"], ["/app/fees/dues"]),
  "overdue": def("overdue", "Overdue", 5, 280, ["fees:read"], ["/app/fees/dues", "/app/fees/students"], { private: true }),
  "receipts": def("receipts", "Receipts", 7, 280, ["fees:read"], ["/app/fees/receipts"], { private: true }),
  "cheques": def("cheques", "Cheques to clear", 5, LINE, ["fees:collect"], ["/app/fees/cheques"], { quiet: true }),
  "payroll": def("payroll", "Payroll", 6, 180, ["payroll:read"], ["/app/payroll", "/app/payroll/statutory"]),

  "front-office": def("front-office", "Front office today", 6, 200, ["website:enquiries"], ["/app/enquiries"], { private: true }),
  "library": def("library", "Library desk", 6, 160, ["library:read"], ["/app/library"]),
  "transport": def("transport", "Transport", 6, 180, ["transport:read"], ["/app/transport"]),
  "exam-coordinator": def("exam-coordinator", "Exam marks", 6, LINE, ["exams:read", "exams:manage"], ["/app/exams"], { quiet: true }),
  "cover": def("cover", "Cover needed today", 6, LINE, ["timetable:manage"], ["/app/timetable/substitutions"], { quiet: true }),
  "website": def("website", "Website", 6, LINE, ["website:read", "website:manage"], ["/app/website"], { quiet: true }),
  "safeguarding": def("safeguarding", "Safeguarding", 6, LINE, ["messages:safeguard"], ["/app/safeguarding"], { quiet: true, private: true }),
  "links": def("links", "Your pages", 12, 160, [], []),
};

// ---------- who sees what, in what order ----------

const ADMIN: PanelKey[] = ["today", "getting-started", "numbers", "needs-action", "attention", "requests", "approvals", "attendance-week", "money-trend", "funnel", "plan", "leave", "birthdays", "notices", "events"];
const ACCOUNTANT: PanelKey[] = ["fin-numbers", "needs-action", "approvals", "my-approvals", "requests", "dues-by-class", "overdue", "receipts", "cheques", "payroll", "notices", "my-setup"];
const TEACHER: PanelKey[] = ["now-next", "to-mark", "to-grade", "marks", "homework", "my-class", "meetings", "needs-action", "messages", "notices", "my-setup"];
const LEFT: PanelKey[] = ["left"];
const FAMILY: PanelKey[] = ["family-answer", "family-classes", "family-homework", "family-dues", "family-attendance", "family-exam", "family-result", "family-meeting", "family-bus", "family-library", "notices"];
/** What a custom role is built from: each panel appears when the role holds what it needs. */
const CUSTOM: PanelKey[] = ["needs-action", "front-office", "requests", "library", "transport", "fin-numbers", "approvals", "my-approvals", "dues-by-class", "overdue", "receipts", "cheques", "payroll", "exam-coordinator", "cover", "website", "safeguarding", "notices", "links", "my-setup"];

const FEATURE = new Map(FEATURES.map((f) => [f.key, f]));

const MENU: [string, string][] = FEATURES.flatMap((f) => (f.menu ?? []).map((m) => [m.href, `${f.key}:${m.permission}`] as [string, string]));
/** Pages that are not a menu entry of their own, or that more than one permission opens. */
const EXTRA: [string, string][] = [
  ["/app/notifications", "notifications:read"], ["/app/getting-started", "setup:run"], ["/app/getting-started", "setup:task"], ["/app/billing", "settings:manage"],
  ["/app/fees/counter", "fees:collect"], ["/app/fees/cheques", "fees:collect"], ["/app/fees/reports", "fees:read"], ["/app/fees/students", "fees:read"], ["/app/fees/students", "fees:self"],
  ["/app/fees/receipts", "fees:read"], ["/app/timetable/substitutions", "timetable:manage"], ["/app/payroll/statutory", "payroll:read"], ["/app/students/import", "students:write"],
  ["/app/transport", "transport:self"], ["/app/library", "library:self"], ["/app/attendance/holidays", "attendance:manage"],
];

/** The permissions that open a page (any one of them will do), by the longest menu or listed path that starts it. Empty when the page is unknown. */
export function pageNeeds(href: string): string[] {
  const path = href.split("?")[0]!;
  const hits = [...MENU, ...EXTRA].filter(([p]) => path === p || path.startsWith(`${p}/`));
  const best = Math.max(0, ...hits.map(([p]) => p.length));
  return [...new Set(hits.filter(([p]) => p.length === best).map(([, n]) => n))];
}

/** Does this login hold `feature:permission`? An unknown module holds nothing. */
export function holds(ctx: Pick<Ctx, "role" | "features" | "grants">, need: string): boolean {
  const [feature, permission] = need.split(":") as [string, string];
  const f = FEATURE.get(feature);
  return !!f && allows(ctx, f, permission);
}

/** Whether `key` may be shown to this login at all: the needs hold, and a support session never sees private panels. */
export function panelAllowed(ctx: Who, key: PanelKey): boolean {
  const p = PANELS[key];
  if (p.private && ctx.supportStaffId) return false;
  return p.needs.every((n) => holds(ctx, n)) && !(p.not && holds(ctx, p.not));
}

/** Home for a base role with its default grants; for a custom role (grants set), the work panels (periods, registers, marks) and everything it holds, each shown when its grants allow. */
export function layoutOf(ctx: Who): PanelKey[] {
  if (ctx.leftUntil) return LEFT;
  if (ctx.role === "student") return FAMILY;
  const base = ctx.role === "admin" ? ADMIN : ctx.role === "accountant" ? ACCOUNTANT : ctx.role === "teacher" ? TEACHER : [];
  if (ctx.grants === undefined && base.length) return base;
  return [...(ctx.role === "admin" ? ADMIN : TEACHER).filter((k) => !CUSTOM.includes(k)), ...CUSTOM];
}

/** The panels this login sees, in order. */
export function panelsFor(ctx: Who): PanelDef[] {
  return layoutOf(ctx).filter((k) => panelAllowed(ctx, k)).map((k) => PANELS[k]);
}
