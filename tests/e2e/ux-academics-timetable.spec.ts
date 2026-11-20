import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SCHOOL, expectHealthy, login, loginStudent } from "./helpers";

const SHOTS = "test-results/ux-academics-timetable";
/** Parallel runs clear test-results, so a second copy of each screenshot goes here when UX_SHOTS_COPY is set. */
const COPY = process.env.UX_SHOTS_COPY;
const SLUG = "greenvalley";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(240_000);

async function shot(page: Page, name: string) {
  for (const [k, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${k}.png`, fullPage: true });
    if (COPY) await page.screenshot({ path: `${COPY}/${name}-${k}.png`, fullPage: true });
  }
  await page.setViewportSize(SIZES.desktop);
}

async function noHorizontalScroll(page: Page) {
  await page.setViewportSize(SIZES.phone);
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 4).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`);
    return { extra: document.documentElement.scrollWidth - w, wide };
  });
  expect(over.extra, JSON.stringify(over.wide)).toBeLessThanOrEqual(1);
  await page.setViewportSize(SIZES.desktop);
}

const open = (page: Page, path: string) => page.goto(`${SCHOOL(SLUG)}${path}`, { timeout: 120_000 });

/** A seeded value straight from the local database (read-only), or null when it is not reachable. */
function sql(query: string): string | null {
  try {
    return execFileSync("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "smw", "-Atc", query], { env: { ...process.env, PGPASSWORD: "postgres" }, timeout: 60_000 }).toString().trim() || null;
  } catch { return null; }
}

test.describe("academics: the admin sees the structure and fixes gaps", () => {
  test("classes overview, then a class page with inline fixes", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/academics/classes");
    await expect(page.getByRole("heading", { name: "Classes", exact: true })).toBeVisible({ timeout: 90_000 });
    await expectHealthy(page);
    await expect(page.getByText("Gaps", { exact: true })).toBeVisible();
    await expect(page.getByText("Sections", { exact: true }).first()).toBeVisible();
    await shot(page, "classes");
    await noHorizontalScroll(page);

    await page.locator("tbody tr td:first-child a").first().click();
    await expect(page).toHaveURL(/\/app\/academics\/classes\/[0-9a-f-]{36}/, { timeout: 90_000 });
    await expect(page.getByText("Subject teachers", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel(/^Class teacher of section/).first()).toBeVisible();
    await expect(page.getByLabel(/teacher for section/).first()).toBeVisible();
    await shot(page, "class");
    await noHorizontalScroll(page);
  });

  test("subjects show who is missing a teacher; years show current and upcoming", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/academics/subjects");
    await expect(page.getByRole("heading", { name: "Subjects", exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Gaps", { exact: true })).toBeVisible();
    await shot(page, "subjects");
    await noHorizontalScroll(page);

    await open(page, "/app/academics/years");
    await expect(page.getByRole("heading", { name: "Academic years" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Current", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Roll forward to/ })).toBeVisible();
    await shot(page, "years");
  });
});

test.describe("timetable", () => {
  test("admin: cell picker only offers who teaches, load panel, auto-fill asks first", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/timetable");
    await expect(page.getByRole("heading", { name: "Timetable", exact: true })).toBeVisible({ timeout: 90_000 });
    await expectHealthy(page);
    await expect(page.getByText("Teacher load")).toBeVisible({ timeout: 60_000 });
    await shot(page, "admin-timetable");

    await page.getByRole("button", { name: /\. Edit$|Add a class$/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Subject").selectOption({ index: 1 });
    const teacherPick = dialog.getByLabel("Teacher");
    await expect(teacherPick).toBeEnabled();
    await expect(teacherPick.locator("option:checked")).not.toHaveText("Choose a teacher"); // the section's own teacher is preselected
    await page.screenshot({ path: `${SHOTS}/admin-cell-editor.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Auto-fill empty periods" }).click();
    await expect(page.getByRole("dialog").getByText(/skipping teachers who are busy/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await noHorizontalScroll(page);
  });

  test("teacher: my timetable highlights today and shows now and next", async ({ page }) => {
    await login(page, SLUG, "priya");
    await open(page, "/app/timetable");
    await expect(page.getByRole("heading", { name: "My timetable" })).toBeVisible({ timeout: 90_000 });
    await expectHealthy(page);
    await expect(page.getByRole("heading", { name: "Right now" })).toBeVisible({ timeout: 30_000 });
    await shot(page, "teacher-my-timetable");
    await noHorizontalScroll(page);
  });

  test("student: their section's week on a phone, with day tabs", async ({ page }) => {
    const dob = sql("select to_char(dob,'DDMMYYYY') from students where admission_no='GR0001'");
    test.skip(!dob, "local database not reachable to read the demo student's date of birth");
    await loginStudent(page, SLUG, "GR0001", dob!);
    await page.setViewportSize(SIZES.phone);
    await open(page, "/app/timetable");
    await expect(page.getByRole("heading", { name: "Timetable", exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("radio").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/student-phone.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
