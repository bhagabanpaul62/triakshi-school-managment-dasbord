import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SCHOOL, expectHealthy, login, loginStudent } from "./helpers";

const SHOTS = "test-results/ux-dashboards";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(300_000);

const one = (q: string) =>
  execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d ${process.env.E2E_DB ?? "smw"} -tAc "${q.replace(/"/g, '\\"')}"`, { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
const schoolId = (slug: string) => one(`select id from schools where slug='${slug}'`);

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

/** Panels that sit side by side (same top edge) must be the same height. */
async function equalRowHeights(page: Page) {
  await page.setViewportSize(SIZES.desktop);
  const bad = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>("main .rounded-3xl")]
      .filter((el) => !el.parentElement?.closest(".rounded-3xl"))
      .map((el) => el.getBoundingClientRect());
    const byTop = new Map<number, number[]>();
    for (const b of boxes) { const k = Math.round((b.top + window.scrollY) / 3); byTop.set(k, [...(byTop.get(k) ?? []), Math.round(b.height)]); }
    return [...byTop.values()].filter((hs) => hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 2);
  });
  expect(bad, "side-by-side panels differ in height").toEqual([]);
}

async function mobileKpisTwoUp(page: Page) {
  await page.setViewportSize(SIZES.phone);
  const cols = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>("main a.rounded-3xl, main a[class*='rounded-3xl']")].slice(0, 4);
    return new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left))).size;
  });
  expect(cols).toBeLessThanOrEqual(2);
  await page.setViewportSize(SIZES.desktop);
}

async function home(page: Page, name: string, greeting?: RegExp) {
  await page.goto(`${SCHOOL("greenvalley")}/app`, { timeout: 120_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 90_000 });
  if (greeting) await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  await expect(page.locator("main a[href^='/app/']").first()).toBeVisible();
  await expectHealthy(page);
  await page.waitForTimeout(800);
  await shot(page, name);
  await noHorizontalScroll(page);
  await mobileKpisTwoUp(page);
  await equalRowHeights(page);
}

test.describe("dashboards: the home page of every role", () => {
  test("admin: school health and links that fix things", async ({ page }) => {
    await login(page, "greenvalley", "admin");
    await home(page, "admin");
    await expect(page.getByText("Students", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Present today", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Dues", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Needs attention", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/\d{4}-\d{2}-\d{2}T/)).toHaveCount(0);
    await page.getByRole("link", { name: /^Dues/ }).first().click();
    await expect(page).toHaveURL(/\/app\/fees\/dues/);
  });

  test("accountant: collections and who to chase", async ({ page }) => {
    await login(page, "greenvalley", "accounts");
    await home(page, "accountant");
    await expect(page.getByText(/collected today/i)).toBeVisible();
    await expect(page.getByText(/overdue/i).first()).toBeVisible();
  });

  test("teacher: my day", async ({ page }) => {
    await login(page, "greenvalley", "teacher");
    await home(page, "teacher");
    await expect(page.getByText(/now and next|no classes today/i).first()).toBeVisible();
    await expect(page.getByText(/registers to mark|all marked for today|not a class teacher|no attendance today/i).first()).toBeVisible();
  });

  test("student: today, due work, attendance, results", async ({ page }) => {
    const sid = schoolId("greenvalley");
    const pw = one(`select to_char(dob,'DDMMYYYY') from students where school_id='${sid}' and admission_no='GR0001'`);
    await loginStudent(page, "greenvalley", "GR0001", pw);
    await home(page, "student");
    await expect(page.getByText(/attendance this month/i).first()).toBeVisible();
  });

  // No parent logins: the student login is the family login, so fees show on the student home.
  test("student: fees on the family login", async ({ page }) => {
    const sid = schoolId("greenvalley");
    const pw = one(`select to_char(dob,'DDMMYYYY') from students where school_id='${sid}' and admission_no='GR0001'`);
    await loginStudent(page, "greenvalley", "GR0001", pw);
    await home(page, "student-fees");
    await expect(page.getByText(/fees/i).first()).toBeVisible();
  });

  test("sunrise (Starter): modules that are off leave no holes", async ({ page }) => {
    await login(page, "sunrise", "admin");
    await page.goto(`${SCHOOL("sunrise")}/app`, { timeout: 120_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 90_000 });
    await expectHealthy(page);
    await page.waitForTimeout(800);
    await shot(page, "sunrise-admin");
    await expect(page.locator("main").getByText(/transport|library/i)).toHaveCount(0);
    await noHorizontalScroll(page);
    await equalRowHeights(page);
  });
});
