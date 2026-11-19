import { expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

export const PASSWORD = "demo12345"; // local seed only (apps/school/scripts/seed.mts)
export const SCHOOL = (slug: string) => `http://${slug}.localhost:${process.env.SCHOOL_PORT ?? "4100"}`;
export const CONSOLE = "http://localhost:4102";
export const MARKETING = "http://localhost:4101";
const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Sign in to a school panel and wait for /app. */
export async function login(page: Page, slug: string, identifier: string, password = PASSWORD) {
  await page.goto(`${SCHOOL(slug)}/login`);
  await page.getByLabel(/email, phone or admission number/i).fill(identifier);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

/** Sign in to the console as the seeded owner, including the TOTP step. */
export async function consoleLogin(page: Page, email = "owner@triakshi.test") {
  await page.goto(`${CONSOLE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|continue/i }).click();
  await page.waitForURL(/2fa/);
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(DEV_TOTP_SECRET) }).generate();
  await page.getByLabel(/code/i).fill(code);
  await page.getByRole("button", { name: /verify|continue|sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** No console errors and no Next.js error overlay on the current page. */
export async function expectHealthy(page: Page) {
  // Next dev always mounts its badge in <nextjs-portal>; only an open error dialog is a failure.
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await expect(page.getByText(/application error|unhandled runtime error/i)).toHaveCount(0);
}
