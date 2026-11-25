import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { login, SCHOOL, expectHealthy } from "./helpers";

const OUT = "test-results/ux-billing-support-notify";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

/** Screenshot at both sizes; the phone shot also asserts no horizontal page scroll. */
async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true });
    if (label === "phone") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name}: horizontal scroll on phone`).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize(SIZES.desktop);
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("admin: understand plan, compare plans, pay, download invoice", async ({ page }) => {
  await login(page, "sunrise", "admin"); // sunrise = trial school
  await page.goto(`${SCHOOL("sunrise")}/app/billing`, { timeout: 150_000, waitUntil: "domcontentloaded" });
  await expectHealthy(page);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await shoot(page, "billing-overview");

  // plans show the GST-inclusive total, not just the base price
  await expect(page.getByText(/Totals include 18% GST/i).first()).toBeVisible();

  // pay: choose a plan, land on the fake checkout, pay, come back
  // "Switch to" is a downgrade: it is scheduled for renewal and never opens checkout, so it is not a pay path.
  await page.getByRole("button", { name: /^(Choose|Upgrade to|Renew)/ }).first().click();
  await page.waitForURL(/fake-checkout|billing\/return|billing\/checkout/, { timeout: 150_000, waitUntil: "domcontentloaded" });
  await shoot(page, "checkout");
  const pay = page.getByRole("button", { name: /pay|success|complete/i }).first();
  if (await pay.isVisible().catch(() => false)) await pay.click();
  await page.waitForURL(/billing\/return/, { timeout: 150_000, waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /payment received/i })).toBeVisible();
  await shoot(page, "return-paid");

  await page.locator("main").getByRole("link", { name: /view invoice|back to billing|invoices/i }).first().click();
  await page.waitForURL(/\/app\/billing/);
  await expect(page.getByText("Paid").first()).toBeVisible();
  await shoot(page, "billing-after-pay");

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /download (invoice|receipt) .* as pdf/i }).first().click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});

test("admin: raise a support ticket and see the thread", async ({ page }) => {
  await login(page, "greenvalley", "admin");
  await page.goto(`${SCHOOL("greenvalley")}/app/support`, { timeout: 150_000, waitUntil: "domcontentloaded" });
  await expectHealthy(page);
  await shoot(page, "support-list");
  await page.getByRole("link", { name: "New ticket" }).first().click();
  await page.waitForURL(/\/app\/support\/new/);
  const subject = `UX check ${Date.now()}`;
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel(/tell us more/i).fill("Checking that the ticket journey works end to end.");
  await shoot(page, "support-new");
  await page.getByRole("button", { name: /^send/i }).click();
  await expect(async () => {
    if (!/\/app\/support\/.+/.test(page.url())) await page.getByRole("link", { name: subject }).or(page.getByText(subject)).first().click({ timeout: 5000 });
    await page.waitForURL(/\/app\/support\/.+/, { timeout: 20_000, waitUntil: "commit" });
  }).toPass({ timeout: 150_000 });
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  await page.getByLabel("Your reply").fill("Adding a follow-up.");
  await page.getByRole("button", { name: /^send/i }).click();
  await expect(page.getByText("Adding a follow-up.")).toBeVisible();
  await shoot(page, "support-thread");
});

test("any user: bell and notifications list", async ({ page }) => {
  await login(page, "greenvalley", "teacher");
  await page.goto(`${SCHOOL("greenvalley")}/app/notifications`, { timeout: 150_000, waitUntil: "domcontentloaded" });
  await expectHealthy(page);
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await shoot(page, "notifications-list");
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await shoot(page, "notifications-bell");
});
