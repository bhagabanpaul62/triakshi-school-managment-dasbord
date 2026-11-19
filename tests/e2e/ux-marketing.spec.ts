import { expect, test, type Page } from "@playwright/test";
import { MARKETING, expectHealthy } from "./helpers";

const OUT = "test-results/ux-marketing";
const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

async function reveal(page: Page) {
  // Scroll through so scroll-driven reveals fire before a full-page shot.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(900);
}

for (const [name, size] of Object.entries(VIEWS)) {
  test(`owner evaluates the site (${name})`, async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize(size);
    await page.goto(MARKETING, { waitUntil: "networkidle", timeout: 150_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/one dashboard/i);
    await reveal(page);
    await page.screenshot({ path: `${OUT}/home-${name}.png`, fullPage: true });

    // Page length stays within ~8 desktop screens; no sideways scroll.
    const { h, sw, cw } = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
    if (name === "desktop") expect(h).toBeLessThanOrEqual(900 * 8);

    // Pricing from the DB, GST shown.
    const pricing = page.locator("#pricing");
    await expect(pricing).toContainText("₹", { timeout: 60_000 });
    await expect(pricing).toContainText(/GST/, { timeout: 60_000 });
    await expect(pricing.getByRole("link", { name: /start free trial/i }).first()).toBeVisible();

    // FAQ opens.
    const q = page.locator("#faq summary").first();
    await q.click();
    await expect(page.locator("#faq details[open]")).toHaveCount(1);

    // Pricing page.
    await page.goto(`${MARKETING}/pricing`, { timeout: 150_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${OUT}/pricing-${name}.png`, fullPage: true });
    await expectHealthy(page);
  });

  test(`owner signs up (${name})`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(size);
    await page.goto(`${MARKETING}/signup`, { waitUntil: "networkidle", timeout: 150_000 });
    await page.screenshot({ path: `${OUT}/signup-1-${name}.png`, fullPage: true });

    // Errors sit next to the fields.
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/signup-errors-${name}.png`, fullPage: true });

    const stamp = Date.now().toString(36);
    await page.getByLabel(/school name/i).fill(`Maple Grove School ${stamp}`);
    await page.getByLabel(/board/i).selectOption("CBSE");
    await page.getByLabel(/how many students/i).fill("450");
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/your name/i).fill("Rekha Menon");
    await page.getByLabel(/email/i).fill(`rekha-${stamp}@example.com`);
    await page.getByLabel(/mobile number/i).fill("9876543210");
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/state/i).selectOption("Kerala");
    await page.getByLabel(/city/i).fill("Kochi");
    await page.getByRole("button", { name: /continue/i }).click();

    // Live subdomain availability: taken, then free.
    const slug = page.locator("#slug");
    await slug.fill("greenvalley");
    await expect(page.locator("#slug-status")).toContainText(/taken|not available|already/i, { timeout: 60_000 });
    await page.screenshot({ path: `${OUT}/signup-slug-taken-${name}.png`, fullPage: true });
    await slug.fill(`maple-${stamp}`);
    await expect(page.locator("#slug-status")).toContainText(/is available/i, { timeout: 60_000 });
    await page.screenshot({ path: `${OUT}/signup-slug-ok-${name}.png`, fullPage: true });

    await page.getByRole("button", { name: /create my school/i }).click();
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/review/i).first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/signup-done-${name}.png`, fullPage: true });
  });
}
