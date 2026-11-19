import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectHealthy, login, SCHOOL } from "./helpers";

const OUT = "test-results/ux-website-domains";
// Another agent's playwright run may clear test-results, so make the folder again before every shot.
const shot = async (page: Page, name: string, full = true) => {
  await page.waitForTimeout(700); // let entrance animations finish
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};
const SITE = SCHOOL("greenvalley");

test.describe("website and domains journeys", () => {
  test.setTimeout(580_000);

  test("visitor: home, admissions, enquiry confirmation", async ({ browser }) => {
    for (const [tag, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: "light" });
      const page = await ctx.newPage();
      await page.goto(SITE, { timeout: 170_000 });
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, `visitor-home-${tag}`);
      // no sideways scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.goto(`${SITE}/admissions`, { timeout: 170_000 });
      await shot(page, `visitor-admissions-${tag}`);
      if (tag === "phone") {
        // validation: empty submit explains what is missing
        await page.getByRole("button", { name: /send enquiry/i }).click();
        await expect(page.getByText(/required|enter|add/i).first()).toBeVisible();
        await shot(page, "visitor-form-errors-phone");
        await page.getByLabel(/child's name/i).fill("Test Child UX");
        await page.getByLabel(/parent or guardian/i).fill("Test Parent");
        await page.getByLabel(/mobile number/i).fill("9876543210");
        await page.getByRole("button", { name: /send enquiry/i }).click();
        await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible({ timeout: 30_000 });
        await shot(page, "visitor-form-done-phone");
      }
      await ctx.close();
    }
  });

  test("admin: website editor, preview, publish, theme, enquiries, domain", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, "greenvalley", "admin");
    await page.goto(`${SITE}/app/website`, { timeout: 170_000 });
    await expectHealthy(page);
    await shot(page, "admin-website-desktop");

    await page.goto(`${SITE}/app/theme`, { timeout: 170_000 });
    await shot(page, "admin-theme-desktop");

    await page.goto(`${SITE}/app/enquiries`, { timeout: 170_000 });
    const row = page.getByRole("row", { name: /Test Child UX/ }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Mark called" }).click();
    await expect(page.getByRole("row", { name: /Test Child UX.*Contacted/ }).first()).toBeVisible();
    await shot(page, "admin-enquiries-desktop");
    // clean up the enquiry this run created so the list does not fill with duplicates
    await page.getByRole("row", { name: /Test Child UX/ }).first().getByRole("button", { name: "Delete enquiry" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    await page.goto(`${SITE}/app/domains`, { timeout: 170_000 });
    await shot(page, "admin-domains-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [n, p] of [["website", "website"], ["theme", "theme"], ["enquiries", "enquiries"], ["domains", "domains"]]) {
      await page.goto(`${SITE}/app/${p}`, { timeout: 170_000 });
      await shot(page, `admin-${n}-phone`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });
});
