import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { expectHealthy, login, loginStudent, SCHOOL } from "./helpers";

// Communication journeys: assignments, announcements, events, messages. Screenshots land in test-results/ux-communication/.
/** One value from the local seed database, or null when it is not reachable. */
function sql(q: string): string | null {
  try { return execFileSync("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "smw", "-At", "-c", q], { env: { ...process.env, PGPASSWORD: "postgres" }, timeout: 20_000 }).toString().trim() || null; }
  catch { return null; }
}
const OUT = "test-results/ux-communication";
const SLUG = "greenvalley";
const STAMP = Date.now().toString().slice(-6);
/** A section and subject priya teaches in GR0001's own section, read from the seed (its rotation decides who teaches what). */
const TAUGHT = (() => {
  const row = sql(`select c.name || '-' || s.name || '|' || sub.name from students st join section_teachers t on t.section_id = st.section_id
    join users u on u.id = t.teacher_id join sections s on s.id = st.section_id join classes c on c.id = s.class_id join subjects sub on sub.id = t.subject_id
    join schools sc on sc.id = st.school_id where sc.slug = '${SLUG}' and st.admission_no = 'GR0001' and u.login_id = 'priya' order by sub.name limit 1`);
  const [section, subject] = (row ?? "Nursery-A|English").split("|");
  return { section: section!, subject: subject! };
})();
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial", timeout: 560_000 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
}
/** The page itself must never scroll sideways on a phone (tables scroll inside their panel). */
async function phone(page: Page, name: string) {
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}-phone.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name}: horizontal page scroll on phone`).toBeLessThanOrEqual(1);
  await page.setViewportSize(DESKTOP);
}
const go = async (page: Page, path: string) => { await page.goto(`${SCHOOL(SLUG)}${path}`, { timeout: 240_000, waitUntil: "domcontentloaded" }); await expectHealthy(page); };
/** Click a button until its dialog is up (a click before hydration does nothing under dev-server load). */
async function openDialog(page: Page, name: RegExp) {
  await expect(async () => {
    await page.getByRole("button", { name }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  return page.getByRole("dialog");
}
async function fillAndPost(page: Page, open: RegExp, post: RegExp, fill: (d: ReturnType<Page["getByRole"]>) => Promise<void>) {
  await expect(async () => {
    const dialog = page.getByRole("dialog");
    if (!(await dialog.isVisible())) await openDialog(page, open);
    await fill(dialog);
    await dialog.getByRole("button", { name: post }).click();
    await expect(dialog).toBeHidden({ timeout: 45_000 });
  }).toPass({ timeout: 400_000, intervals: [1000] });
}
/** Click a table row until the detail page opens (a click before hydration does nothing). */
async function openRow(page: Page, row: ReturnType<Page["locator"]>, url: RegExp) {
  await expect(async () => { await row.click(); await page.waitForURL(url, { timeout: 15_000 }); }).toPass({ timeout: 240_000, intervals: [1000] });
}
const pickFirst = async (page: Page, label: string | RegExp) => {
  const sel = page.getByLabel(label).first();
  const value = await sel.locator("option:not([value=''])").first().getAttribute("value");
  await sel.selectOption(value!);
};

test.beforeEach(async ({ page }) => { await page.setViewportSize(DESKTOP); });

test("teacher posts an assignment with a file, sees progress, grades", async ({ page }) => {
  await login(page, SLUG, "priya");
  await go(page, "/app/assignments");
  await expect(page.getByRole("heading", { name: "Assignments" }).first()).toBeVisible({ timeout: 200_000 });
  await shot(page, "t1-list");
  await phone(page, "t1-list");

  // Dev-server hot reloads (other agents editing files) can reset an open form, so fill and post until the dialog closes.
  await fillAndPost(page, /new assignment/i, /post assignment/i, async (dialog) => {
    await expect(dialog.getByLabel(/due by/i)).not.toHaveValue(""); // smart default
    await dialog.getByLabel(/^title/i).fill(`Chapter review ${STAMP}`);
    await dialog.getByLabel(/^section/i).selectOption({ label: TAUGHT.section });
    await dialog.getByLabel(/^subject/i).selectOption({ label: TAUGHT.subject });
    await dialog.getByLabel(/^instructions/i).fill("Read the chapter and answer questions 1 to 5 in your notebook.");
    await dialog.getByLabel(/worksheet or reference/i).setInputFiles({ name: "worksheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await shot(page, "t2-new-form");
  });
  await expect(page.getByText(`Chapter review ${STAMP}`).first()).toBeVisible({ timeout: 200_000 });

  await openRow(page, page.locator("tbody tr", { hasText: `Chapter review ${STAMP}` }).first().getByRole("link", { name: `Chapter review ${STAMP}` }), /assignments\/.+/);
  await expect(page.getByText("worksheet.pdf")).toBeVisible({ timeout: 200_000 });
  await shot(page, "t3-detail");
  await phone(page, "t3-detail");

  // Grade any existing hand-in on a seeded assignment of ours.
  await go(page, "/app/assignments");
  const rows = page.locator("tbody tr");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    await openRow(page, rows.nth(i).getByRole("link").first(), /assignments\/.+/); // the title link opens it; the row itself does not
    const grade = page.getByRole("button", { name: /^(grade|edit grade)$/i }).first();
    if (await grade.count()) {
      await grade.click();
      const d = page.getByRole("dialog");
      await expect(d).toBeVisible({ timeout: 30_000 });
      const marks = d.getByLabel(/marks out of/i);
      if (await marks.count()) await marks.fill("8");
      await d.getByLabel(/feedback/i).fill("Good work. Check question 3 again.");
      await shot(page, "t4-grade");
      await d.getByRole("button", { name: /save/i }).click();
      await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 30_000 });
      break;
    }
    await go(page, "/app/assignments");
  }
});

test("student sees what is due, opens it and the hand-in form", async ({ page }) => {
  const dob = sql("select to_char(dob,'DDMMYYYY') from students where admission_no='GR0001' limit 1");
  test.skip(!dob, "local database not reachable");
  await loginStudent(page, SLUG, "GR0001", dob!);
  await go(page, "/app/assignments");
  await expect(page.getByRole("heading", { name: "Assignments" }).first()).toBeVisible({ timeout: 200_000 });
  await shot(page, "s1-list");
  await phone(page, "s1-list");
  const first = page.locator("a[href^='/app/assignments/']").first();
  if (await first.count()) {
    await first.click();
    await page.waitForURL(/assignments\/.+/);
    await shot(page, "s2-detail");
    await phone(page, "s2-detail");
    const text = page.getByLabel(/your answer|notes|text/i).first();
    if (await text.count()) {
      await text.fill("Done. Answers are in my notebook.");
      await page.getByRole("button", { name: /hand in|submit/i }).first().click();
      await expect(page.getByText(/handed in/i).first()).toBeVisible({ timeout: 30_000 });
      await shot(page, "s3-handed-in");
    }
  }
});

test("admin posts a class announcement; student feed", async ({ page }) => {
  await login(page, SLUG, "admin");
  await go(page, "/app/announcements");
  await shot(page, "a1-staff");
  await phone(page, "a1-staff");
  const d = await openDialog(page, /new announcement/i);
  await d.getByLabel(/^title/i).fill(`Class picnic ${STAMP}`);
  await d.getByLabel(/^message/i).fill("Bring a water bottle and a cap. Leaving at 8 am.");
  await d.getByLabel(/send to/i).selectOption("class");
  await pickFirst(d, /which class/i);
  await shot(page, "a2-compose");
  await d.getByRole("button", { name: /^post$/i }).click();
  await expect(page.getByText(`Class picnic ${STAMP}`).first()).toBeVisible({ timeout: 200_000 });
  await shot(page, "a3-posted");
});

test("events list, month calendar, create an event", async ({ page }) => {
  await login(page, SLUG, "admin");
  await go(page, "/app/events");
  await shot(page, "e1-list");
  await phone(page, "e1-list");
  const d = await openDialog(page, /new event/i);
  await d.getByLabel(/^title/i).fill(`Book fair ${STAMP}`);
  await d.getByLabel(/^starts/i).fill("2026-11-25T10:00");
  await d.getByLabel(/who is invited/i).selectOption("parents");
  await shot(page, "e2-form");
  await d.getByRole("button", { name: /add event/i }).click();
  await expect(page.getByText(`Book fair ${STAMP}`).first()).toBeVisible({ timeout: 200_000 });
  await go(page, "/app/events?view=month&month=2026-11");
  await expect(page.getByText(`Book fair ${STAMP}`).first()).toBeVisible();
  await shot(page, "e3-month");
  await phone(page, "e3-month");
});

// No parent logins: the student login is the family login.
test("student: messages list and thread on phone, announcements and events", async ({ page }) => {
  const dob = sql("select to_char(dob,'DDMMYYYY') from students where admission_no='GR0001' limit 1");
  test.skip(!dob, "local database not reachable");
  await loginStudent(page, SLUG, "GR0001", dob!);
  await go(page, "/app/messages");
  await shot(page, "m1-inbox");
  await phone(page, "m1-inbox");
  const d = await openDialog(page, /new message/i);
  await expect(d.getByRole("list", { name: /people you can message/i }).getByRole("button").first()).toBeVisible({ timeout: 200_000 });
  await d.getByRole("list", { name: /people you can message/i }).getByRole("button").first().click();
  await d.getByLabel(/^subject/i).fill(`Homework help ${STAMP}`);
  await d.getByLabel(/^message/i).fill("Hello, could you share this week's homework plan?");
  await shot(page, "m2-compose");
  await d.getByRole("button", { name: /^send$/i }).click();
  await expect(page.getByText(`Homework help ${STAMP}`).first()).toBeVisible({ timeout: 200_000 });
  await shot(page, "m3-thread");
  await phone(page, "m3-thread");

  await go(page, "/app/announcements");
  await shot(page, "p1-announcements");
  await phone(page, "p1-announcements");
  await go(page, "/app/events");
  await shot(page, "p2-events");
  await go(page, "/app/assignments");
  await shot(page, "p3-assignments");
  await phone(page, "p3-assignments");
});
