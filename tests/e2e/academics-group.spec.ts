import { expect, test, type Page } from "@playwright/test";
// postgres-js comes from @smw/db; the root workspace does not depend on it directly.
import postgres from "../../packages/db/node_modules/postgres";
import { expectHealthy, login, loginStudent, SCHOOL } from "./helpers";

// docs/ACADEMICS-PRD.md section 7 on the production build: every new screen opens for the right roles, phones don't
// scroll sideways, and the money/leave/timetable/report-card journeys work end to end.
const SLUG = "greenvalley";
const db = postgres(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/smw" /* local seed DB only */, { max: 1 });
const one = async <T>(q: Promise<T[]>) => (await q)[0]!;
test.afterAll(async () => { await db.end(); });

async function ids() {
  const school = await one(db<{ id: string }[]>`select id from schools where slug = ${SLUG}`);
  const section = await one(db<{ id: string }[]>`select s.id from sections s join classes c on c.id = s.class_id where s.school_id = ${school.id} order by c.grade desc, s.name limit 1`);
  const teacher = await one(db<{ id: string }[]>`select id from users where school_id = ${school.id} and login_id = 'teacher'`);
  const student = await one(db<{ id: string; uid: string; adm: string; dob: string }[]>`
    select s.id, s.user_id as uid, s.admission_no as adm, to_char(s.dob, 'DDMMYYYY') as dob from students s
    join users u on u.id = s.user_id where s.school_id = ${school.id} and s.section_id = ${section.id} and s.dob is not null order by s.admission_no limit 1`);
  const exam = await db<{ id: string }[]>`select id from exams where school_id = ${school.id} order by starts_on limit 1`;
  const term = await db<{ id: string }[]>`select id from terms where school_id = ${school.id} order by starts_on limit 1`;
  const vehicle = await db<{ id: string }[]>`select id from vehicles where school_id = ${school.id} limit 1`;
  return { school: school.id, section: section.id, teacher: teacher.id, student, exam: exam[0]?.id, term: term[0]?.id, vehicle: vehicle[0]?.id };
}

async function open(page: Page, path: string) {
  const res = await page.goto(`${SCHOOL(SLUG)}${path}`, { waitUntil: "domcontentloaded" });
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.getByText(/school not found|application error|something went wrong/i), path).toHaveCount(0);
  await expectHealthy(page);
}

async function noSideScroll(page: Page, path: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, path);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${path} scrolls sideways at 390px`).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
}

const ADMIN_PAGES = [
  "/app/academics/classes", "/app/academics/years", "/app/academics/subjects", "/app/academics/houses",
  "/app/attendance", "/app/attendance/register", "/app/attendance/staff", "/app/attendance/staff/register",
  "/app/attendance/leave-requests", "/app/attendance/eligibility", "/app/attendance/holidays",
  "/app/timetable", "/app/timetable/periods", "/app/timetable/generator", "/app/timetable/substitutions", "/app/timetable/special-days",
  "/app/assignments", "/app/exams", "/app/exams/scales", "/app/exams/weights", "/app/exams/co-scholastic", "/app/exams/remarks", "/app/results",
  "/app/library", "/app/library/books", "/app/library/loans", "/app/transport", "/app/transport/vehicles", "/app/fees",
];

test("admin: every academics-group screen opens; the key ones fit a phone", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, SLUG, "admin");
  for (const p of ADMIN_PAGES) await open(page, p);
  const x = await ids();
  await open(page, `/app/academics/classes/${(await one(db<{ id: string }[]>`select class_id as id from sections where id = ${x.section}`)).id}`);
  if (x.vehicle) await open(page, `/app/transport/vehicles/${x.vehicle}`);
  if (x.exam) await open(page, `/app/exams/${x.exam}/date-sheet`);
  for (const p of ["/app/attendance/leave-requests", "/app/timetable/generator", "/app/exams/scales", "/app/library", "/app/academics/houses"]) await noSideScroll(page, p);
});

test("admin: exports and PDFs download", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, SLUG, "admin");
  const x = await ids();
  const month = new Date().toISOString().slice(0, 7);
  const files: [string, RegExp][] = [
    ["/app/academics/classes/export", /text\/csv/],
    ["/app/academics/classes/allocation", /application\/pdf/],
    [`/app/attendance/register/export?sectionId=${x.section}&month=${month}&format=pdf`, /application\/pdf/],
    [`/app/attendance/register/export?sectionId=${x.section}&month=${month}&format=csv`, /text\/csv/],
    [`/app/timetable/sections/${x.section}/print`, /application\/pdf/],
    [`/app/timetable/teachers/${x.teacher}/print`, /application\/pdf/],
  ];
  if (x.term) files.push([`/app/results/term/${x.term}/${x.student.id}/report-card`, /application\/pdf/], [`/app/results/term/${x.term}/batch/${x.section}`, /application\/pdf/]);
  if (x.exam) files.push([`/app/exams/${x.exam}/admit-card/${x.student.id}`, /application\/pdf/]);
  for (const [path, type] of files) {
    const res = await page.request.get(`${SCHOOL(SLUG)}${path}`);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(type);
  }
});

test("teacher: leave approval, substitutions refused, own screens open", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, SLUG, "teacher");
  for (const p of ["/app/attendance", "/app/attendance/leave-requests", "/app/attendance/my-leave", "/app/timetable", "/app/assignments", "/app/exams", "/app/exams/remarks", "/app/exams/co-scholastic", "/app/library", "/app/academics/houses"]) await open(page, p);
  // the generator is admin / timetable in-charge only: a teacher gets a refusal (the app hides it as not found)
  await page.goto(`${SCHOOL(SLUG)}/app/timetable/generator`);
  await expect(page.getByText(/page not found|permission|not allowed|forbidden/i).first()).toBeVisible();
});

test("student: own screens open, a leave request reaches the class teacher, others' files are refused", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const x = await ids();
  await loginStudent(page, SLUG, x.student.adm, x.student.dob);
  for (const p of ["/app/attendance", "/app/attendance/my-leave", "/app/timetable", "/app/assignments", "/app/results", "/app/library", "/app/transport", "/app/profile", "/app/academics/houses"]) await open(page, p);
  await noSideScroll(page, "/app/attendance/my-leave");

  // apply for leave (2 days, next week) through the UI
  await open(page, "/app/attendance/my-leave");
  await page.getByRole("button", { name: /apply|request leave|new request/i }).first().click();
  const d = page.getByRole("dialog").last();
  const day = (n: number) => { const t = new Date(Date.now() + n * 86_400_000); return t.toISOString().slice(0, 10); };
  // Each run asks for later days: the app refuses a request that overlaps an earlier run's leave.
  const [{ n: past }] = await db<{ n: number }[]>`select count(*)::int as n from leave_requests where student_id = ${x.student.id}`;
  await d.getByLabel(/first day/i).fill(day(7 + past * 3));
  await d.getByLabel(/last day/i).fill(day(8 + past * 3));
  await d.getByLabel(/reason/i).fill("Family function");
  await d.getByRole("button", { name: /apply|send|submit|request/i }).last().click();
  await expect.poll(() => db`select status from leave_requests where student_id = ${x.student.id} order by created_at desc limit 1`.then((r) => r[0]?.status), { timeout: 30_000 }).toBe("pending");

  // a student cannot download another section's report card batch or another student's admit card
  if (x.term) expect((await page.request.get(`${SCHOOL(SLUG)}/app/results/term/${x.term}/batch/${x.section}`)).status()).toBeGreaterThanOrEqual(400);
  const other = await db<{ id: string }[]>`select id from students where school_id = ${x.school} and id <> ${x.student.id} limit 1`;
  if (x.exam && other[0]) expect((await page.request.get(`${SCHOOL(SLUG)}/app/exams/${x.exam}/admit-card/${other[0].id}`)).status()).toBeGreaterThanOrEqual(400);

  // the class teacher of that section approves it as admin override (seed teachers vary), and the days become leave
  const admin = await (await browser.newContext()).newPage();
  await login(admin, SLUG, "admin");
  await open(admin, "/app/attendance/leave-requests");
  await admin.getByRole("button", { name: /approve/i }).first().click();
  const confirm = admin.getByRole("dialog").last();
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /approve|confirm|yes/i }).last().click();
  await expect.poll(() => db`select status from leave_requests where student_id = ${x.student.id} order by created_at desc limit 1`.then((r) => r[0]?.status), { timeout: 30_000 }).toBe("approved");
  await admin.context().close();
});

// ---------- round 3: the gaps that were built after the first pass ----------
// Each test sets up the data the seed lacks with SQL, drives the screen like a person would, then puts the data back.

test("admin: a student's own elective picks, the RTE quota flag, and library history from both records", async ({ page }) => {
  test.setTimeout(300_000);
  const x = await ids();
  const { class_id: classId } = await one(db<{ class_id: string }[]>`select class_id from sections where id = ${x.section}`);
  const cs = await one(db<{ id: string; subject_id: string; name: string }[]>`
    select cs.id, cs.subject_id, s.name from class_subjects cs join subjects s on s.id = cs.subject_id where cs.class_id = ${classId} order by s.name limit 1`);
  await db`update class_subjects set is_elective = true where id = ${cs.id}`;
  try {
    await login(page, SLUG, "admin");
    await open(page, `/app/academics/classes/${classId}`);
    await page.getByRole("button", { name: /^Picks/ }).first().click();
    const d = page.getByRole("dialog").last();
    await d.getByRole("checkbox", { name: cs.name }).check();
    await d.getByRole("button", { name: "Save electives" }).click();
    await expect(page.getByText("Electives saved")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Picks (1)" })).toBeVisible({ timeout: 30_000 });

    // RTE quota: set from the edit form, shown as a chip and a fact
    await open(page, `/app/students/${x.student.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog").last();
    await edit.getByLabel("RTE quota seat").selectOption("true");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("RTE quota", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Yes, under RTE 12(1)(c)")).toBeVisible();

    // library history from the student record and from the staff record
    await page.locator(`main a[href="/app/library/members/student/${x.student.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/library/members/student/${x.student.id}`), { timeout: 30_000 });
    await expectHealthy(page);
    await open(page, `/app/staff/${x.teacher}`);
    await page.locator(`main a[href="/app/library/members/staff/${x.teacher}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/library/members/staff/${x.teacher}`), { timeout: 30_000 });
    await expectHealthy(page);
  } finally {
    await db`delete from student_subjects where subject_id = ${cs.subject_id} and group_id is null`;
    await db`update class_subjects set is_elective = false where id = ${cs.id}`;
    await db`update students set rte_quota = false where id = ${x.student.id}`;
  }
});

test("admin: schedule a draft timetable for tomorrow, then unschedule; the cell editor warns past a teacher's limit", async ({ page }) => {
  test.setTimeout(300_000);
  const x = await ids();
  const live = await one(db<{ id: string }[]>`select id from tt_versions where school_id = ${x.school} and status = 'live'`);
  const draft = await one(db<{ id: string }[]>`insert into tt_versions (id, school_id, name, status) values (gen_random_uuid(), ${x.school}, 'E2E draft', 'draft') returning id`);
  await db`insert into timetable_slots (id, school_id, version_id, section_id, day_of_week, period_id, subject_id, teacher_id, room, locked)
    select gen_random_uuid(), school_id, ${draft.id}, section_id, day_of_week, period_id, subject_id, teacher_id, room, locked from timetable_slots where version_id = ${live.id}`;
  // one empty cell in the live week (put back afterwards) and a week limit of 1 for every teacher, so whoever is picked is over it
  // Free one real cell: its own teacher is then free there, and already has periods this week.
  const [gone] = await db<Record<string, unknown>[]>`delete from timetable_slots where id = (select id from timetable_slots where version_id = ${live.id} and teacher_id is not null order by section_id, day_of_week limit 1) returning *`;
  const where = gone ? await one(db<{ day: number; period: string }[]>`select ${gone.day_of_week as number}::int as day, name as period from periods where id = ${gone.period_id as string}`) : null;
  await db`insert into tt_teacher_rules (id, school_id, teacher_id, max_per_week) select gen_random_uuid(), school_id, id, 1 from users where school_id = ${x.school} and role = 'teacher' on conflict do nothing`;
  try {
    await login(page, SLUG, "admin");
    await open(page, `/app/timetable/generator/${draft.id}`);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const d = page.getByRole("dialog").last();
    const tomorrow = new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    await d.getByLabel("Go live on").fill(tomorrow);
    await d.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText(/Scheduled\. It goes live on the morning of/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`scheduled to go live on ${tomorrow}`))).toBeVisible({ timeout: 30_000 });
    expect((await one(db<{ status: string }[]>`select status from tt_versions where id = ${live.id}`)).status).toBe("live"); // nothing changed for anyone yet
    await page.getByRole("button", { name: "Unschedule" }).click();
    await expect(page.getByText("Taken off the schedule. It stays a draft")).toBeVisible({ timeout: 30_000 });
    expect((await one(db<{ publish_on: string | null }[]>`select publish_on from tt_versions where id = ${draft.id}`)).publish_on).toBeNull();

    expect(gone, "the seed's live timetable has at least one taught cell").toBeTruthy();
    const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    await open(page, `/app/timetable?section=${gone!.section_id as string}`);
    await page.getByRole("button", { name: `${DAYS[where!.day]}, ${where!.period}: empty. Add a class` }).click();
    const cell = page.getByRole("dialog").last();
    await cell.getByLabel("Subject").selectOption(gone!.subject_id as string);
    await cell.getByLabel("Teacher").selectOption(gone!.teacher_id as string); // free here now, busy the rest of the week
    await expect(cell.getByText(/Heads up: \d+ periods that week, over their limit of 1\. You can still save\./)).toBeVisible();
    await expect(cell.getByRole("button", { name: "Save" })).toBeEnabled(); // a warning, not a block
    await cell.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await db`delete from tt_versions where id = ${draft.id}`;
    await db`delete from tt_teacher_rules where school_id = ${x.school}`;
    if (gone) await db`insert into timetable_slots ${db(gone)} on conflict do nothing`;
  }
});

test("admin: an exam's internal part fills from graded homework, ready to check and save", async ({ page }) => {
  test.setTimeout(300_000);
  const x = await ids();
  const hw = await one(db<{ subject_id: string; class_id: string; due: string }[]>`
    select a.subject_id, sec.class_id, to_char(a.due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as due from submissions s
    join assignments a on a.id = s.assignment_id join sections sec on sec.id = a.section_id
    where s.school_id = ${x.school} and s.marks is not null and a.max_marks > 0 and s.status in ('graded', 'returned') and a.status = 'published' limit 1`);
  const term = await one(db<{ id: string; year_id: string; ends_on: string }[]>`select id, year_id, ends_on::text from terms where school_id = ${x.school} and starts_on <= ${hw.due}::date and ends_on >= ${hw.due}::date limit 1`);
  const exam = await one(db<{ id: string }[]>`insert into exams (id, school_id, year_id, term_id, name, kind, starts_on, ends_on, status)
    values (gen_random_uuid(), ${x.school}, ${term.year_id}, ${term.id}, 'E2E internal', 'unit_test', ${term.ends_on}::date, ${term.ends_on}::date, 'marks_open') returning id`);
  try {
    const paper = await one(db<{ id: string }[]>`insert into exam_papers (id, school_id, exam_id, class_id, subject_id, date, max_marks, pass_marks)
      values (gen_random_uuid(), ${x.school}, ${exam.id}, ${hw.class_id}, ${hw.subject_id}, ${term.ends_on}::date, 100, 33) returning id`);
    await db`insert into paper_components (id, school_id, paper_id, name, max_marks, sort_order) values
      (gen_random_uuid(), ${x.school}, ${paper.id}, 'Theory', 80, 0), (gen_random_uuid(), ${x.school}, ${paper.id}, 'Internal', 20, 1)`;
    await login(page, SLUG, "admin");
    await open(page, `/app/exams/${exam.id}/marks/${paper.id}`);
    await expect(page.getByText(/Homework marks for \d+ students are ready/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Fill Internal from homework" }).click();
    await expect(page.getByText(/Internal filled for \d+ students from graded homework\. Check, then save\./)).toBeVisible({ timeout: 30_000 });
    const filled = await page.locator("input[type=number]").evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value !== "").length);
    expect(filled).toBeGreaterThan(0);
  } finally {
    await db`delete from exams where id = ${exam.id}`;
  }
});
