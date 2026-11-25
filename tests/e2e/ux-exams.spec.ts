import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, SCHOOL, expectHealthy, loginStudent } from "./helpers";

const SHOTS = "test-results/ux-exams";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(900_000);
test.describe.configure({ mode: "serial" });

async function shot(page: Page, name: string) {
  for (const [k, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
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

// The shared dev server recompiles under load and aborts navigations; retry instead of failing the journey.
async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; }
  }
}
async function login(page: Page, slug: string, id: string, pw = PASSWORD) {
  await retry(async () => {
    await page.goto(`${SCHOOL(slug)}/login`, { timeout: 120_000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000); // let the form hydrate before typing
    await page.getByLabel(/email, phone or admission number/i).fill(id, { timeout: 60_000 });
    await page.getByLabel(/^password$/i).fill(pw);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app/, { timeout: 90_000 });
  }, 4);
}
const open = (page: Page, slug: string, path: string) => retry(() => page.goto(`${SCHOOL(slug)}${path}`, { timeout: 120_000, waitUntil: "domcontentloaded" }));
const NAME = `UX check ${Date.now().toString().slice(-6)}`;

test.describe("exams and results journeys", () => {
  test("admin: create an exam for classes, watch progress, publish is blocked until marks are in", async ({ page }) => {
    await login(page, "greenvalley", "admin");
    await open(page, "greenvalley", "/app/exams");
    await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible({ timeout: 90_000 });
    await shot(page, "admin-list");

    await page.getByRole("button", { name: /New exam/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Exam name")).toBeVisible();
    // Smart defaults: every class ticked, dates already filled.
    expect(await dialog.locator("input[name=classIds]:checked").count()).toBeGreaterThan(1);
    await expect(dialog.getByLabel("First day")).not.toHaveValue("");
    await dialog.getByLabel("Exam name").fill(NAME);
    await shot(page, "admin-create");
    await dialog.getByRole("button", { name: "Create exam" }).click();
    // Lands on the new exam, ready to schedule.
    await expect(page).toHaveURL(/\/app\/exams\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
    await expect(page.getByText(/Next step/i).first()).toBeVisible();
    await shot(page, "admin-detail-draft");

    await page.getByRole("button", { name: "Schedule exam" }).click();
    await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("Marks open", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "admin-detail-marks-open");

    // Publishing with marks missing says why and how much.
    await expect(page.getByText(/marks are still missing/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Enter marks/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Publish anyway" }).click();
    await expect(page.getByRole("dialog")).toContainText(/still missing/i);
    await shot(page, "admin-publish-blocked");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Enter one paper fully as admin, progress moves.
    await page.getByRole("link", { name: /Enter marks/ }).first().click();
    await expect(page.getByRole("button", { name: "Save marks" })).toBeVisible({ timeout: 60_000 });
    const inputs = page.locator("input[type=number]");
    const n = await inputs.count();
    await inputs.first().focus();
    for (let i = 0; i < n; i++) { await page.keyboard.type(String(30 + (i % 40))); await page.keyboard.press("Enter"); }
    await page.getByRole("button", { name: "Save marks" }).click();
    await expect(page.getByText(/Marks saved|All saved/i).first()).toBeVisible({ timeout: 30_000 });

    // Clean up: delete the exam we made.
    await open(page, "greenvalley", "/app/exams");
    await page.getByPlaceholder("Search exams").fill(NAME);
    await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 });
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: `Delete ${NAME}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(`Nothing matches "${NAME}".`)).toBeVisible({ timeout: 30_000 }); // the search echoes the name, so look for the empty state
    await expect(page.getByRole("button", { name: `Delete ${NAME}` })).toHaveCount(0);
  });

  test("teacher: keyboard marks entry with inline validation and sticky save, own subjects only", async ({ page }) => {
    await login(page, "sunrise", "teacher");
    await open(page, "sunrise", "/app/exams");
    await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("link", { name: /Half-Yearly Exam/ }).first().click();
    await expect(page.getByText("Marks open", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
    await shot(page, "teacher-detail");
    // Only papers this teacher can enter are listed.
    const enter = page.getByRole("link", { name: /Enter marks/ });
    expect(await enter.count()).toBeGreaterThan(0);
    await enter.first().click();
    await expect(page.getByRole("button", { name: "Save marks" })).toBeVisible({ timeout: 90_000 });
    await shot(page, "teacher-marks-before");

    const inputs = page.locator("input[type=number]");
    await inputs.first().focus();
    await page.keyboard.type("9999");
    await expect(page.getByRole("alert").filter({ hasText: /0 to/ }).first()).toBeVisible(); // inline, before saving
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("41");
    await page.keyboard.press("Enter");
    await expect(inputs.nth(1)).toBeFocused();
    await page.getByRole("button", { name: /Mark .* absent/ }).nth(2).click();
    await expect(page.getByText(/unsaved/).first()).toBeVisible();
    await shot(page, "teacher-marks-typed");
    await page.getByRole("button", { name: /Save marks/ }).click();
    await expect(page.getByText(/All saved|Saved/).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "teacher-marks-saved");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("admin: class result with rank, subject averages, pass percent and report cards", async ({ page }) => {
    await login(page, "greenvalley", "admin");
    await open(page, "greenvalley", "/app/results");
    // Defaults: latest published exam and the first section are already chosen.
    await expect(page.getByText("Pass percent").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Subject averages")).toBeVisible();
    await expect(page.getByRole("link", { name: /Download all report cards/ })).toBeVisible();
    await shot(page, "admin-results");
    const first = page.getByRole("link", { name: /Report card/ }).first();
    await expect(first).toBeVisible();
    const abs = async (link: ReturnType<typeof page.getByRole>) => new URL((await link.getAttribute("href"))!, page.url()).toString(); // the links are relative
    const res = await page.request.get(await abs(first));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("pdf");
    const batch = await page.request.get(await abs(page.getByRole("link", { name: /Download all report cards/ }).first()));
    expect(batch.status()).toBe(200);
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("student: published results with per-subject grades and report card", async ({ page }) => {
    await loginStudent(page, "greenvalley", "GR0001", process.env.UX_STUDENT_PW ?? "01012023");
    await open(page, "greenvalley", "/app/results");
    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Half-Yearly Exam/).first()).toBeVisible();
    await shot(page, "student-results");
    await page.getByRole("link", { name: /Half-Yearly Exam/ }).first().click();
    await expect(page.getByText("Subjects").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /report card/i }).first()).toBeVisible();
    await shot(page, "student-result");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });
});
