import { test } from "@playwright/test";
import { SCHOOL, login } from "./helpers";
test.setTimeout(300_000);
test("before shots", async ({ page }) => {
  const S = "test-results/ux-exams/before";
  await login(page, "greenvalley", "admin");
  for (const [name, path] of [["list", "/app/exams"], ["results", "/app/results"]] as const) {
    await page.goto(`${SCHOOL("greenvalley")}${path}`, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    for (const [k, size] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(size); await page.waitForTimeout(300);
      await page.screenshot({ path: `${S}-${name}-${k}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.getByRole("row").nth(1).click().catch(() => {});
  await page.goto(`${SCHOOL("greenvalley")}/app/exams`);
  await page.getByRole("link", { name: /Half-Yearly/ }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${S}-detail-desktop.png`, fullPage: true });
  await page.getByRole("link", { name: /Enter marks|View marks/ }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${S}-marks-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${S}-marks-phone.png`, fullPage: true });
});
