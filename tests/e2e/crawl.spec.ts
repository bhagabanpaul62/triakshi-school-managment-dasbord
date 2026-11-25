// Visits every panel route as each role and fails on a server error or an error overlay.
// Screenshots land in test-results/crawl/<role>/ for visual review.
import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { login, loginStudent, SCHOOL } from "./helpers";

const sql = (q: string) =>
  execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d ${process.env.E2E_DB ?? "smw"} -tAc "${q.replace(/"/g, '\\"')}"`, { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();

const school = "greenvalley";
const sid = () => sql(`select id from schools where slug='${school}'`);

/** First id from a query, for dynamic routes. */
const one = (q: string) => sql(q).split("\n")[0] ?? "";

function routes() {
  const s = sid();
  const ids = {
    classId: one(`select id from classes where school_id='${s}' order by grade limit 1`),
    studentId: one(`select id from students where school_id='${s}' order by admission_no limit 1`),
    staffUser: one(`select user_id from staff_profiles where school_id='${s}' limit 1`),
    examId: one(`select id from exams where school_id='${s}' and status='published' limit 1`),
    paperId: one(`select p.id from exam_papers p join exams e on e.id=p.exam_id where e.school_id='${s}' limit 1`),
    assignmentId: one(`select id from assignments where school_id='${s}' limit 1`),
    bookId: one(`select id from books where school_id='${s}' limit 1`),
    routeId: one(`select id from routes where school_id='${s}' limit 1`),
    teacherId: one(`select id from users where school_id='${s}' and role='teacher' and login_id<>'teacher' limit 1`),
  };
  const paperExam = one(`select exam_id from exam_papers where id='${ids.paperId}'`);
  return [
    "/app", "/app/announcements", "/app/academics/classes", `/app/academics/classes/${ids.classId}`, "/app/academics/subjects", "/app/academics/years",
    "/app/students", `/app/students/${ids.studentId}`, "/app/students/import", "/app/students/promote", "/app/parents",
    "/app/staff", `/app/staff/${ids.staffUser}`,
    "/app/attendance", "/app/attendance/register", "/app/attendance/staff", "/app/attendance/holidays",
    "/app/fees", "/app/fees/plans", "/app/fees/collect", "/app/finance", "/app/expenses", "/app/payroll", `/app/fees/students/${ids.studentId}`,
    "/app/exams", `/app/exams/${ids.examId}`, `/app/exams/${paperExam}/marks/${ids.paperId}`, "/app/results", `/app/results/${ids.examId}/${ids.studentId}`,
    "/app/timetable", "/app/timetable/periods", `/app/timetable/teachers/${ids.teacherId}`,
    "/app/assignments", `/app/assignments/${ids.assignmentId}`,
    "/app/events", "/app/messages", "/app/notifications",
    "/app/library", "/app/library/books", `/app/library/books/${ids.bookId}`, "/app/library/loans",
    "/app/transport", `/app/transport/routes/${ids.routeId}`, "/app/transport/vehicles",
    "/app/website", "/app/theme", "/app/enquiries", "/app/domains",
    "/app/billing", "/app/support", "/app/settings", "/app/profile", "/app/audit",
  ];
}

async function visit(page: Page, role: string, path: string, problems: string[]) {
  const errors: string[] = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (e) => errors.push(e.message));
  // 30 s cap: a page whose network never goes quiet (a stuck request) is reported here instead of eating the test budget.
  const res = await page.goto(`${SCHOOL(school)}${path}`, { waitUntil: "networkidle", timeout: 30_000 }).catch((e) => { problems.push(`${path}: navigation ${e.message.split("\n")[0]}`); return null; });
  const status = res?.status() ?? 0;
  const overlay = await page.locator("[data-nextjs-dialog]").count();
  const name = path.replace(/[^a-z0-9]+/gi, "_").slice(0, 80) || "root";
  await page.screenshot({ path: `test-results/crawl/${role}/${name}.png`, fullPage: true }).catch(() => {});
  if (status >= 500 || overlay || errors.length) problems.push(`${path}: status ${status}${overlay ? ", error overlay" : ""}${errors.length ? `, ${errors[0]!.slice(0, 160)}` : ""}`);
}

const ROLES: { role: string; id: () => string; pw?: () => string }[] = [
  { role: "admin", id: () => "admin" },
  { role: "accountant", id: () => "accounts" },
  { role: "teacher", id: () => one(`select login_id from users where school_id='${sid()}' and role='teacher' and login_id<>'teacher' limit 1`) },
  { role: "student", id: () => "GR0001", pw: () => one(`select to_char(dob,'DDMMYYYY') from students where school_id='${sid()}' and admission_no='GR0001'`) },
];

for (const r of ROLES) {
  test(`crawl as ${r.role}`, async ({ page }) => {
    test.setTimeout(600_000);
    if (r.role === "student") await loginStudent(page, school, r.id(), r.pw!());
    else await login(page, school, r.id(), r.pw?.());
    const problems: string[] = [];
    for (const path of routes()) await visit(page, r.role, path, problems);
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
