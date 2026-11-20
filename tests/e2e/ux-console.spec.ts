import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { consoleLogin, CONSOLE, expectHealthy, PASSWORD } from "./helpers";

const OUT = "test-results/ux-console";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
const GOTO = { timeout: 150_000, waitUntil: "domcontentloaded" } as const;

/** Screenshot at both sizes; the phone shot also asserts no horizontal page scroll. */
async function shoot(page: Page, name: string, checkOverflow = true) {
  mkdirSync(OUT, { recursive: true });
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true });
    if (label === "phone" && checkOverflow) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name}: horizontal scroll on phone`).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize(SIZES.desktop);
}

async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(`${CONSOLE}${path}`, GOTO);
  await expectHealthy(page);
  await expect(page.getByRole("heading", { name: heading, level: 1 }).first()).toBeVisible({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial", timeout: 600_000 });

test("owner: overview says what needs me, then every list page is scannable", async ({ page }) => {
  await consoleLogin(page);
  await open(page, "/", "Overview");
  await expect(page.getByRole("heading", { name: "Needs you today" })).toBeVisible();
  await expect(page.getByRole("link", { name: /waiting for approval/i }).first()).toBeVisible();
  await shoot(page, "overview");

  for (const [path, heading, name] of [
    ["/schools", "Schools", "schools"], ["/plans", "Plans", "plans"], ["/modules", "Modules", "modules"], ["/domains", "Domains", "domains"],
    ["/billing", "Billing", "billing"], ["/support", "Support", "support"], ["/design-requests", "Design requests", "design-requests"],
    ["/staff", "Staff", "staff"], ["/audit", "Audit log", "audit"],
  ] as const) {
    await open(page, path, heading);
    await shoot(page, name);
  }
});

test("owner: approvals queue, review a school, reject then reopen", async ({ page }) => {
  await consoleLogin(page);
  await open(page, "/approvals", "Approvals");
  await shoot(page, "approvals");
  // The approval-setup spec decides its own "UX … Public School" in parallel; reviewing it here races that spec.
  const rows = page.locator("a[href^='/approvals/']").filter({ hasNotText: /UX \w+ Public School/ });
  if ((await rows.count()) === 0) test.skip(true, "No pending schools in the seed");
  await rows.first().click();
  await page.waitForURL(/\/approvals\//, GOTO);
  await expect(page.getByRole("button", { name: /^approve$/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^reject$/i })).toBeVisible();
  await shoot(page, "approval-review");
  // reject needs a reason: the form must say so rather than silently fail
  // dev pages hydrate late: retry the click until the dialog is really open
  await expect(async () => {
    await page.getByRole("button", { name: /^reject$/i }).click();
    await expect(page.getByRole("button", { name: /reject school/i })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page.getByRole("button", { name: /reject school/i }).click();
  await expect(page.getByText(/required|enter|reason/i).first()).toBeVisible();
  await shoot(page, "approval-reject-error");
  await page.keyboard.press("Escape");
});

test("owner: school detail tabs and actions", async ({ page }) => {
  await consoleLogin(page);
  await open(page, "/schools", "Schools");
  await page.getByRole("link", { name: /green valley/i }).first().click();
  await page.waitForURL(/\/schools\/[0-9a-f-]+/, GOTO);
  await expect(page.getByRole("button", { name: /support login/i })).toBeVisible({ timeout: 60_000 });
  const base = page.url().split("?")[0]!;
  await shoot(page, "school-overview");
  for (const tab of ["modules", "domains", "invoices", "tickets", "audit"]) {
    await page.goto(`${base}?tab=${tab}`, GOTO);
    await expectHealthy(page);
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 60_000 });
    await shoot(page, `school-${tab}`);
  }
  await page.goto(base, GOTO);
  // extend trial opens a form with a sensible default
  await expect(async () => {
    await page.getByRole("button", { name: /extend trial/i }).click();
    await expect(page.getByLabel(/add days/i)).toHaveValue("14", { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page.keyboard.press("Escape");
  // suspend states its consequence before it acts
  await expect(async () => {
    await page.getByRole("button", { name: /^suspend$/i }).click();
    await expect(page.getByText(/loses access to everything except billing/i)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await shoot(page, "school-suspend-confirm");
  await page.keyboard.press("Escape");
  // support login asks why, then shows a one-time link
  await expect(async () => {
    await page.getByRole("button", { name: /support login/i }).click();
    await expect(page.getByLabel(/why are you logging in/i)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page.getByLabel(/why are you logging in/i).fill("Checking the fee setup the school asked about");
  await page.getByRole("button", { name: /create link/i }).click();
  const link = page.locator("p.select-all");
  await expect(link).toBeVisible({ timeout: 60_000 });
  await shoot(page, "school-support-login");
  const url = (await link.textContent())!.trim();
  await page.getByRole("button", { name: /^done$/i }).click();
  await page.goto(url, GOTO);
  // the school asks for one click first, so a link prefetch cannot burn the one-time token
  await page.getByRole("button", { name: /open the panel/i }).click({ timeout: 120_000 });
  await page.waitForURL(/\/app/, { timeout: 180_000 });
  await expect(page.getByText(/support (session|login|mode)/i).first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "support-banner", false); // the school panel is another area: screenshot only
});

test("support role: can view, cannot approve or manage staff", async ({ page }) => {
  // The seed leaves support un-enrolled: enrol with the setup key the page shows (a fresh db:fresh resets this).
  await page.goto(`${CONSOLE}/login`, GOTO);
  await page.getByLabel(/email/i).fill("support@triakshi.test");
  await page.getByLabel(/password/i).fill(PASSWORD);
  await expect(async () => {
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/2fa/, { timeout: 8_000 });
  }).toPass({ timeout: 90_000 });
  const key = (await page.locator("p.select-all").first().textContent())?.replace(/\s/g, "") ?? "";
  if (!/^[A-Z2-7]{16,}$/.test(key)) test.skip(true, "Support is already enrolled with a key this test cannot know");
  await page.getByLabel(/code/i).fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(key) }).generate());
  await page.getByRole("button", { name: /turn on and sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  await open(page, "/approvals", "Approvals");
  await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
  await shoot(page, "support-approvals");
  // The approval-setup spec decides its own "UX … Public School" in parallel; reviewing it here races that spec.
  const rows = page.locator("a[href^='/approvals/']").filter({ hasNotText: /UX \w+ Public School/ });
  if ((await rows.count()) > 0) {
    await rows.first().click();
    await expect(page.getByRole("button", { name: /^(approve|reject)$/i })).toHaveCount(0);
    await expect(page.getByText(/only an owner can/i).first()).toBeVisible({ timeout: 60_000 });
    await shoot(page, "support-review");
  }
});
