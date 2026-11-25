import { expect, test, type Page } from "@playwright/test";
import { SCHOOL, expectHealthy, login, loginStudent } from "./helpers";

const SHOTS = "test-results/ux-attendance";
const SLUG = "greenvalley";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(180_000);

async function shot(page: Page, name: string) {
  for (const [k, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${k}.png`, fullPage: true });
  }
  await page.setViewportSize(SIZES.desktop);
}

async function noHorizontalScroll(page: Page) {
  await page.setViewportSize(SIZES.phone);
  await page.waitForTimeout(300); // let charts and tables re-measure at the new width
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await page.setViewportSize(SIZES.desktop);
}

const open = (page: Page, path: string) => page.goto(`${SCHOOL(SLUG)}${path}`, { timeout: 90_000 });

test.describe("attendance journeys", () => {
  test("teacher: own class preselected, mark all present, tap absentees, save, reopen", async ({ page }) => {
    await login(page, SLUG, "teacher");
    await open(page, "/app/attendance");
    await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible({ timeout: 60_000 });
    const section = page.getByLabel("Section");
    await expect(section.locator("option:checked")).toContainText("your class");
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
    await shot(page, "teacher-open");

    const firstRows = page.locator("ul button[aria-label*='Tap to change']");
    const fill = page.getByRole("button", { name: /^(All|Rest) present$/ });
    if (await fill.count()) await fill.click();
    // Make the result the same on every run: rows 0 and 1 absent, the rest present.
    const n = await firstRows.count();
    for (let i = 0; i < n; i++) {
      const want = i < 2 ? "Absent" : "Present";
      for (let t = 0; t < 4 && !(await firstRows.nth(i).getAttribute("aria-label"))?.includes(`: ${want}.`); t++) await firstRows.nth(i).click();
    }
    await expect(page.locator("[role=status][aria-live=polite]:not(.sr-only)")).toContainText("2 absent");
    await shot(page, "teacher-marked");

    // A rerun on the same day finds these marks already saved: the button then reads "Saved".
    const save = page.getByRole("button", { name: /^(Save attendance|Saved)$/ });
    if ((await save.textContent())?.trim() === "Save attendance") await save.click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[role=status][aria-live=polite]:not(.sr-only)")).toContainText("Saved");

    await page.reload();
    await expect(page.locator("[role=status][aria-live=polite]:not(.sr-only)")).toContainText("2 absent");
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await shot(page, "teacher-reopened");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("teacher: past day is flagged, future day falls back to today", async ({ page }) => {
    await login(page, SLUG, "teacher");
    await open(page, "/app/attendance?date=2025-11-10");
    await expect(page.getByText("Past day", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/a past day/i)).toBeVisible();
    await shot(page, "teacher-past");
    await open(page, "/app/attendance?date=2099-01-01");
    await expect(page.getByText(/Future days cannot be marked/)).toBeVisible();
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  });

  test("admin: sections still to mark, register with defaulters, staff", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/attendance");
    await expect(page.getByText(/sections? (not marked|marked)/)).toBeVisible({ timeout: 60_000 });
    await shot(page, "admin-mark");
    const chase = page.getByRole("link", { name: /^Open / }).first();
    if (await chase.count()) {
      await chase.click();
      await expect(page).toHaveURL(/sectionId=/);
      await expect(page.getByLabel("Section")).toBeVisible();
    }
    await noHorizontalScroll(page);

    await open(page, "/app/attendance/register");
    await expect(page.getByText("Class attendance")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Below 75%/).first()).toBeVisible();
    await shot(page, "admin-register");
    await noHorizontalScroll(page);

    await open(page, "/app/attendance/staff");
    await expect(page.getByRole("heading", { name: "Staff attendance" })).toBeVisible({ timeout: 60_000 });
    await shot(page, "admin-staff");
    await expectHealthy(page);
  });

  test("student: gauge, month calendar and recent absences", async ({ page }) => {
    await loginStudent(page, SLUG, "GR0001", process.env.UX_STUDENT_PASSWORD ?? "01012023");
    await open(page, "/app/attendance");
    await expect(page.getByRole("group", { name: /Attendance in/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Previous month" }).or(page.getByRole("link", { name: "Previous month" }))).toBeVisible();
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/month=/);
    await shot(page, "student-self");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });
});
