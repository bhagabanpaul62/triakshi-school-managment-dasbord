import { expect as baseExpect, test, type Page } from "@playwright/test";
import { SCHOOL, expectHealthy, login } from "./helpers";
const expect = baseExpect.configure({ timeout: 120_000 }); // the shared dev server is slow under load

const SHOTS = "test-results/ux-students";
const SLUG = "greenvalley";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(900_000);

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
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await page.setViewportSize(SIZES.desktop);
}

// Row clicks before React hydrates do nothing, so click again until the record has opened.
async function openRecord(page: Page, who: RegExp) {
  await baseExpect(async () => {
    await page.getByRole("link", { name: who }).first().click();
    await baseExpect(page.getByRole("tab", { name: /Overview/ })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 240_000 });
}

const open = (page: Page, path: string) => page.goto(`${SCHOOL(SLUG)}${path}`, { timeout: 300_000, waitUntil: "domcontentloaded" });

test.describe("students journeys", () => {
  test("admin: find students fast, filters narrow the list, row opens the record", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/students");
    await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByText("Active students")).toBeVisible();
    await shot(page, "list");

    const search = page.getByPlaceholder(/search/i);
    // The input can be typed into before React hydrates (which then resets it), so retry until the URL carries the query.
    await baseExpect(async () => {
      await search.fill("Aarav");
      await baseExpect(page).toHaveURL(/q=Aarav/, { timeout: 8_000 });
    }).toPass({ timeout: 180_000 });
    await expect(page.getByRole("link", { name: /Aarav Sharma/ }).first()).toBeVisible();
    await shot(page, "list-search");

    await open(page, "/app/students?q=zzzznobody");
    await expect(page.getByText(/no students match|nothing matches|no results/i).first()).toBeVisible({ timeout: 120_000 });
    await shot(page, "list-nomatch");

    await open(page, "/app/students");
    await openRecord(page, /Aarav Sharma/);
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("admin: admit with the minimum, guardian in the same flow, then delete", async ({ page }) => {
    const name = `UX Test ${Date.now() % 100000}`;
    await login(page, SLUG, "admin");
    await open(page, "/app/students");
    const dialog = page.getByRole("dialog");
    // A click before React hydrates does nothing, so retry until the dialog opens.
    await baseExpect(async () => {
      await page.getByRole("button", { name: /admit student/i }).first().click();
      await baseExpect(dialog).toBeVisible({ timeout: 6_000 });
    }).toPass({ timeout: 180_000 });
    // Minimal first: name, class and section, guardian are on screen; the rest hides behind "More details".
    await expect(dialog.getByLabel(/full name/i)).toBeVisible();
    await expect(dialog.getByLabel(/class and section/i)).toBeVisible();
    await expect(dialog.getByLabel(/guardian name/i)).toBeVisible();
    await expect(dialog.getByLabel(/blood group/i)).toBeHidden();
    await shot(page, "admit-open");
    await dialog.getByRole("button", { name: /admit/i }).last().click();
    await expect(dialog.getByText(/required|enter|choose/i).first()).toBeVisible();
    await dialog.getByLabel(/full name/i).fill(name);
    await dialog.getByLabel(/class and section/i).selectOption({ index: 1 });
    await dialog.getByLabel(/guardian name/i).fill("Test Parent");
    await dialog.getByLabel(/guardian phone/i).fill(`98${String(Date.now()).slice(-8)}`);
    await dialog.getByRole("button", { name: /^admit/i }).last().click();
    await expect(dialog).toBeHidden({ timeout: 120_000 }); // the toast is too brief to assert; the lookup below proves it saved

    await open(page, `/app/students?q=${encodeURIComponent(name)}`);
    await openRecord(page, new RegExp(name));
    await expect(page.getByRole("tab", { name: /Guardians/ })).toContainText("1", { timeout: 240_000 });
    await page.getByRole("tab", { name: /Guardians/ }).click();
    await expect(page.getByText("Test Parent").first()).toBeVisible();

    await baseExpect(async () => {
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await baseExpect(page.getByRole("dialog")).toBeVisible({ timeout: 6_000 });
    }).toPass({ timeout: 180_000 });
    await page.getByRole("dialog").getByRole("button", { name: /delete student/i }).click();
    await expect(page).toHaveURL(/\/app\/students$/, { timeout: 120_000 });
  });

  test("admin: record page next steps, upload a document, record consent", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/students?q=GR0001");
    await openRecord(page, /Aarav Sharma/);
    await expect(page.getByRole("link", { name: /^Fees/ }).first()).toBeVisible();
    await shot(page, "record-overview");

    await page.getByRole("tab", { name: /Documents/ }).click();
    await expect(page).toHaveURL(/tab=documents/);
    const dlg = page.getByRole("dialog");
    await baseExpect(async () => {
      await page.getByRole("button", { name: /upload document/i }).click();
      await baseExpect(dlg).toBeVisible({ timeout: 6_000 });
    }).toPass({ timeout: 180_000 });
    await dlg.getByLabel(/^document/i).selectOption({ index: 1 });
    await dlg.locator("input[type=file]").setInputFiles({ name: "ux-test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 ux test") });
    await dlg.getByRole("button", { name: /^upload/i }).last().click();
    await expect(page.getByText("ux-test.pdf").first()).toBeVisible({ timeout: 120_000 });
    await shot(page, "record-documents");
    await page.getByRole("button", { name: "Delete ux-test.pdf" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByText("ux-test.pdf")).toHaveCount(0, { timeout: 120_000 });

    await page.getByRole("tab", { name: /Consent/ }).click();
    await expect(page).toHaveURL(/tab=consent/);
    await baseExpect(async () => {
      await page.getByRole("button", { name: /record consent/i }).click();
      await baseExpect(page.getByRole("dialog")).toBeVisible({ timeout: 6_000 });
    }).toPass({ timeout: 180_000 });
    await page.getByRole("dialog").getByLabel(/consent for/i).selectOption({ index: 1 });
    await page.getByRole("dialog").getByRole("button", { name: /^record/i }).last().click();
    await expect(page.getByText("Consent recorded").first()).toBeVisible({ timeout: 120_000 });
    await shot(page, "record-consent");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("admin: CSV import dry run tells exactly what to fix", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/students/import");
    await expect(page.getByRole("heading", { name: "Import students" })).toBeVisible({ timeout: 240_000 });
    await shot(page, "import-start");
    const csv = "name,admission_no,class,section,dob,guardian_name,guardian_phone\n,,5,A,2015-01-01,Mr X,9811111111\nBad Section,,99,Z,not-a-date,Mr Y,123\n";
    await page.locator("input[type=file]").setInputFiles({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: /check file/i }).click();
    await expect(page.getByText(/with problems/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("What to fix")).toBeVisible();
    await expect(page.getByRole("button", { name: /^import/i })).toBeDisabled();
    await shot(page, "import-errors");
    await noHorizontalScroll(page);
  });

  test("admin: promote a section at year end", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/students/promote");
    await expect(page.getByRole("heading", { name: "Promote students" })).toBeVisible({ timeout: 240_000 });
    await shot(page, "promote-empty");
    await page.locator("a[href*='promote?from=']").first().click();
    await expect(page.getByText(/students? in this section|Promote .*\(/).first()).toBeVisible({ timeout: 120_000 });
    await shot(page, "promote-plan");
    await noHorizontalScroll(page);
  });

  test("admin: parents with their children", async ({ page }) => {
    await login(page, SLUG, "admin");
    await open(page, "/app/parents");
    await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole("link", { name: /Aarav Sharma/ }).first()).toBeVisible();
    await shot(page, "parents");
    await noHorizontalScroll(page);
    await expectHealthy(page);
  });

  test("parent: sees only own child", async ({ page }) => {
    await login(page, SLUG, "9820131071", "131071");
    await open(page, "/app/students");
    await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole("link", { name: /Aarav Sharma/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /admit student/i })).toHaveCount(0);
    await shot(page, "parent-list");
    await openRecord(page, /Aarav Sharma/);
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await shot(page, "parent-record");
    await noHorizontalScroll(page);
  });

  test("student: only own record", async ({ page }) => {
    await login(page, SLUG, "GR0001", "01012023");
    await open(page, "/app/students");
    await expect(page.getByRole("link", { name: /Aarav Sharma/ }).first()).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole("link", { name: /Saanvi Nair/ })).toHaveCount(0);
    await shot(page, "student-list");
    await openRecord(page, /Aarav Sharma/);
    await shot(page, "student-record");
    await noHorizontalScroll(page);
  });
});
