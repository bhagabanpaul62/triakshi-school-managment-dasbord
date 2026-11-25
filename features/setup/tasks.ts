// Every getting-started task of every module, as data. Whether one is done is read from the school's data, never stored.
// No framework imports: the service, the pages and the tests share this list.
import { sql, type SQL } from "drizzle-orm";
import type { SchoolRole } from "@smw/db";

export const TASK_GROUPS = [
  { key: "school", label: "School" },
  { key: "people", label: "People and sign-ins" },
  { key: "daily", label: "Daily work" },
  { key: "exams", label: "Exams" },
  { key: "money", label: "Money" },
  { key: "families", label: "Families" },
  { key: "website", label: "Website" },
  { key: "safety", label: "Safety" },
] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number]["key"];

export interface TaskDef {
  /** Stable: stored with who it was given to, so never rename one. */
  key: string;
  group: TaskGroup;
  /** The module that must be on for this school. */
  module: string;
  label: string;
  /** One line: what the school gets from doing it. */
  why: string;
  minutes: number;
  href: string;
  /** The right that does it ("feature:permission") and the built-in roles that hold it by default. Used to warn when a task is given to someone who cannot open it. */
  needs: string;
  roles: readonly SchoolRole[];
  /** Tables the done query reads. When one is missing the task counts as not done, instead of failing the page. */
  tables?: readonly string[];
  /** A boolean SQL expression, a cheap EXISTS. */
  done?: SQL;
  /** Done is read from another module's own checklist: "fees:<step>" (fees' first-day steps), "comm:<step>" (communicationSteps) or "site:disclosure" (the disclosure's own filled rule). */
  source?: `fees:${string}` | `comm:${string}` | `site:${string}`;
}

const OFFICE = ["admin", "accountant"] as const;
const SCHOOL_ROW = sql`exists (select 1 from schools where board is not null and city is not null and state is not null)`;
const CURRENT_YEAR = sql`(select id from academic_years where is_current limit 1)`;

export const TASKS: readonly TaskDef[] = [
  // ---- School
  { key: "school.profile", group: "school", module: "settings", label: "Fill in the school details", why: "Your name, board and address print on receipts and report cards.", minutes: 3, href: "/app/settings/school", needs: "settings:manage", roles: ["admin"], done: SCHOOL_ROW },
  { key: "school.year", group: "school", module: "academics", label: "Set the academic year", why: "Every class, fee and attendance record belongs to a year.", minutes: 2, href: "/app/academics/years", needs: "academics:manage", roles: ["admin"], tables: ["academic_years"], done: sql`exists (select 1 from academic_years where is_current)` },
  { key: "school.classes", group: "school", module: "academics", label: "Add classes and sections", why: "Students, attendance and the timetable hang off sections.", minutes: 5, href: "/app/academics/classes", needs: "academics:manage", roles: ["admin"], tables: ["sections"], done: sql`exists (select 1 from sections)` },
  { key: "school.subjects", group: "school", module: "academics", label: "Choose the subjects each class studies", why: "The timetable, homework and exams need them.", minutes: 5, href: "/app/academics/subjects", needs: "academics:manage", roles: ["admin"], tables: ["class_subjects"], done: sql`exists (select 1 from class_subjects)` },

  // ---- People and sign-ins
  { key: "people.staff", group: "people", module: "staff", label: "Invite your teachers", why: "They get a link to set their own password and can start work.", minutes: 5, href: "/app/staff/import", needs: "staff:write", roles: ["admin"], tables: ["staff_profiles"], done: sql`exists (select 1 from staff_profiles sp join users u on u.id = sp.user_id where u.role = 'teacher' and u.status <> 'disabled')` },
  { key: "people.students", group: "people", module: "students", label: "Bring in your students", why: "Attendance, fees and report cards need them.", minutes: 10, href: "/app/students/import", needs: "students:write", roles: ["admin"], tables: ["students"], done: sql`exists (select 1 from students where status = 'active')` },
  { key: "people.classteachers", group: "people", module: "staff", label: "Pick a class teacher for every section", why: "Each class gets one person who marks attendance and writes report remarks.", minutes: 3, href: "/app/academics/classes", needs: "academics:manage", roles: ["admin"], tables: ["sections", "academic_years"],
    done: sql`exists (select 1 from sections where year_id = ${CURRENT_YEAR}) and not exists (select 1 from sections where year_id = ${CURRENT_YEAR} and class_teacher_id is null)` },
  { key: "people.slips", group: "people", module: "students", label: "Print login slips for your classes", why: "Families sign in with the slip; nothing reaches them before that.", minutes: 10, href: "/app/students", needs: "students:write", roles: ["admin"], tables: [], done: sql`exists (select 1 from audit_logs where module = 'students' and action = 'print_slips')` },
  { key: "people.families", group: "people", module: "students", label: "Get half of the families to sign in", why: "Notices, dues and homework only work for families who sign in.", minutes: 5, href: "/app/students", needs: "students:write", roles: ["admin"], tables: ["students"],
    done: sql`(select count(*) from users where role = 'student' and status <> 'disabled') > 0 and (select count(*) from users where role = 'student' and last_login_at is not null) * 2 >= (select count(*) from users where role = 'student' and status <> 'disabled')` },
  { key: "people.team", group: "people", module: "settings", label: "Add a second admin or an office login", why: "The school should not depend on one person's phone.", minutes: 3, href: "/app/settings/users", needs: "settings:manage", roles: ["admin"], done: sql`(select count(*) from users where role in ('admin', 'accountant') and status = 'active') >= 2` },

  // ---- Daily work
  { key: "daily.attendance", group: "daily", module: "attendance", label: "Mark attendance for one class", why: "Absences reach families the same day.", minutes: 2, href: "/app/attendance", needs: "attendance:mark", roles: ["admin", "teacher"], tables: ["student_attendance"], done: sql`exists (select 1 from student_attendance)` },
  { key: "daily.timetable", group: "daily", module: "timetable", label: "Build the timetable", why: "Teachers and families see today's periods.", minutes: 20, href: "/app/timetable", needs: "timetable:manage", roles: ["admin"], tables: ["timetable_slots"], done: sql`exists (select 1 from timetable_slots)` },
  { key: "daily.homework", group: "daily", module: "assignments", label: "Give the first homework", why: "Families see it and children hand in from home.", minutes: 3, href: "/app/assignments", needs: "assignments:write", roles: ["admin", "teacher"], tables: ["assignments"], done: sql`exists (select 1 from assignments where status = 'published')` },
  { key: "daily.library", group: "daily", module: "library", label: "Add your first books", why: "Lending and fines start once books are in.", minutes: 10, href: "/app/library", needs: "library:manage", roles: ["admin", "teacher"], tables: ["books"], done: sql`exists (select 1 from books)` },
  { key: "daily.transport", group: "daily", module: "transport", label: "Add a bus route", why: "Families see the stop and the times.", minutes: 10, href: "/app/transport", needs: "transport:manage", roles: ["admin"], tables: ["routes"], done: sql`exists (select 1 from routes)` },

  // ---- Exams
  { key: "exams.exam", group: "exams", module: "exams", label: "Create the first exam", why: "Papers, marks and report cards start from an exam.", minutes: 5, href: "/app/exams", needs: "exams:manage", roles: ["admin"], tables: ["exams"], done: sql`exists (select 1 from exams)` },
  { key: "exams.marks", group: "exams", module: "exams", label: "Enter marks for one paper", why: "Results and report cards come from marks.", minutes: 10, href: "/app/exams", needs: "exams:marks", roles: ["admin", "teacher"], tables: ["marks"], done: sql`exists (select 1 from marks)` },

  // ---- Money (the fees steps are read from the fees module's own first-day checklist)
  { key: "money.cash", group: "money", module: "fees", label: "Add the cash box and a bank account", why: "Every receipt lands in an account.", minutes: 5, href: "/app/finance/settings?tab=cash&next=/app/fees", needs: "finance:settings", roles: ["admin"], source: "fees:cash" },
  { key: "money.upi", group: "money", module: "fees", label: "Add the school's UPI ID", why: "Families can pay by UPI and you check the payment.", minutes: 3, href: "/app/finance/settings?tab=rules&next=/app/fees", needs: "finance:settings", roles: ["admin"], source: "fees:upi" },
  { key: "money.heads", group: "money", module: "fees", label: "Add fee heads, like Tuition", why: "Bills are built from heads.", minutes: 5, href: "/app/fees/heads", needs: "fees:setup", roles: OFFICE, source: "fees:heads" },
  { key: "money.plan", group: "money", module: "fees", label: "Make a fee plan and publish it", why: "The plan says what each class pays.", minutes: 10, href: "/app/fees/plans", needs: "fees:setup", roles: OFFICE, source: "fees:plan" },
  { key: "money.issue", group: "money", module: "fees", label: "Issue the bills", why: "Families see what they owe.", minutes: 5, href: "/app/fees/invoices/issue", needs: "fees:setup", roles: OFFICE, source: "fees:issue" },
  // Fees' own list asks "has THIS person a counter open"; for the school the question is whether any counter was ever opened.
  { key: "money.counter", group: "money", module: "fees", label: "Open your counter", why: "You can take the first payment and print a receipt.", minutes: 2, href: "/app/fees/counter", needs: "fees:collect", roles: OFFICE, tables: ["fee_counters"], done: sql`exists (select 1 from fee_counters)` },
  { key: "money.payroll", group: "money", module: "payroll", label: "Add pay details for your staff", why: "Salary runs and payslips start from them.", minutes: 15, href: "/app/payroll/people", needs: "payroll:manage", roles: OFFICE, tables: ["pay_profiles"], done: sql`exists (select 1 from pay_profiles)` },
  { key: "money.vendor", group: "money", module: "expenses", label: "Add your first vendor", why: "Bills and payments are tracked against vendors.", minutes: 3, href: "/app/expenses/vendors", needs: "expenses:manage", roles: OFFICE, tables: ["exp_vendors"], done: sql`exists (select 1 from exp_vendors)` },

  // ---- Families (communication's own first steps; the label and text come from the communication list)
  { key: "families.email", group: "families", module: "notifications", label: "Check that email works", why: "Families miss notices if mail does not leave.", minutes: 3, href: "/app/notifications/delivery", needs: "notifications:delivery", roles: ["admin"], source: "comm:email" },
  { key: "families.quiet", group: "families", module: "notifications", label: "Look at quiet hours", why: "No push or email at night unless you change it.", minutes: 2, href: "/app/settings/communication", needs: "notifications:manage", roles: ["admin"], source: "comm:quiet" },
  { key: "families.notice", group: "families", module: "announcements", label: "Send your first notice", why: "A short welcome is enough. You see who has read it.", minutes: 3, href: "/app/announcements/new", needs: "announcements:publish", roles: ["admin", "accountant", "teacher"], source: "comm:notice" },
  { key: "families.event", group: "families", module: "events", label: "Put the first event on the calendar", why: "Families and staff see it and get a reminder.", minutes: 3, href: "/app/events", needs: "events:write", roles: ["admin", "teacher"], tables: ["events"], done: sql`exists (select 1 from events)` },

  // ---- Website
  { key: "website.published", group: "website", module: "website", label: "Publish your website", why: "Parents find your fees, classes and contact, and can ask for a seat.", minutes: 10, href: "/app/website", needs: "website:publish", roles: ["admin"], tables: ["school_sites"], done: sql`exists (select 1 from school_sites where published_at is not null)` },
  { key: "website.domain", group: "website", module: "domains", label: "Connect your own web address", why: "yourschool.in instead of the free address.", minutes: 10, href: "/app/domains", needs: "domains:manage", roles: ["admin"], tables: ["school_domains"], done: sql`exists (select 1 from school_domains where kind = 'custom' and status = 'verified')` },
  { key: "website.disclosure", group: "website", module: "website", label: "Fill in the mandatory disclosure", why: "Boards ask schools to show these facts on the website.", minutes: 20, href: "/app/website/disclosure", needs: "website:manage", roles: ["admin"], source: "site:disclosure" },

  // ---- Safety
  { key: "safety.lead", group: "safety", module: "settings", label: "Name a safeguarding lead", why: "Concerns reach one trusted person, not only the principal.", minutes: 5, href: "/app/settings/roles", needs: "settings:manage", roles: ["admin"], source: "comm:lead" },
  { key: "safety.support", group: "safety", module: "support", label: "Read who may open your school", why: "You decide if Triakshi staff may look in, and see every visit.", minutes: 2, href: "/app/settings/access", needs: "settings:manage", roles: ["admin"],
    done: sql`exists (select 1 from audit_logs where entity = 'Support access') or exists (select 1 from schools where support_access <> 'always')` },
];

export const taskDef = (key: string) => TASKS.find((t) => t.key === key);

/** Can this person do the task? A custom role holds the right or it does not; a built-in role is on the task's list. */
export function canDoTask(t: Pick<TaskDef, "needs" | "roles">, p: { role: SchoolRole; grants: readonly string[] | null }): boolean {
  if (p.grants) return p.grants.includes(t.needs);
  return t.roles.includes(p.role);
}

/** The share done among the tasks still in play (skipped ones are out of the count). */
export const percentOf = (done: number, total: number, skipped: number) => {
  const live = total - skipped;
  return live <= 0 ? 100 : Math.round((done / live) * 100);
};
