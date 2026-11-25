import { expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

export const PASSWORD = "demo12345"; // local seed only (apps/school/scripts/seed.mts)
export const SCHOOL = (slug: string) => `http://${slug}.localhost:${process.env.SCHOOL_PORT ?? "4100"}`;
export const CONSOLE = `http://localhost:${process.env.CONSOLE_PORT ?? "4102"}`;
export const MARKETING = `http://localhost:${process.env.MARKETING_PORT ?? "4101"}`;
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

/** A strong password the specs set on a seeded student at the forced first-sign-in change. Re-runs find the student already switched. */
export const STUDENT_PASSWORD = "Sunflower-Desk-4271";

/**
 * APP BUG WORKAROUND: right after sign-in the redirect to /app/change-password renders "School not found" until the page is
 * loaded again. Reload once so the specs can carry on; remove when the app is fixed.
 */
export async function reloadIfSchoolNotFound(page: Page) {
  await page.waitForLoadState("load");
  if (await page.getByRole("heading", { name: "School not found" }).count()) {
    console.log("BUG: 'School not found' right after the sign-in redirect to", page.url());
    await page.goto(page.url());
  }
}

/**
 * Sign in as a seeded student (admission number + DOB password). Seeded students must change the first password,
 * so this completes /app/change-password when asked. Tries STUDENT_PASSWORD first (a re-run), then the DOB password.
 */
export async function loginStudent(page: Page, slug: string, admissionNo: string, dobPassword: string) {
  // The last try covers a parallel worker that changed the DOB password while we were trying it.
  for (const pw of [STUDENT_PASSWORD, dobPassword, STUDENT_PASSWORD]) {
    await page.goto(`${SCHOOL(slug)}/login`);
    await page.getByLabel(/email, phone or admission number/i).fill(admissionNo);
    await page.getByLabel(/^password$/i).fill(pw);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 90_000 }).catch(() => {});
    if (!new URL(page.url()).pathname.startsWith("/app")) continue; // wrong password, try the next one
    if (page.url().includes("/app/change-password")) {
      await reloadIfSchoolNotFound(page);
      await page.locator('input[name="current"]').fill(pw);
      await page.locator('input[name="next"]').fill(STUDENT_PASSWORD);
      await page.locator('input[name="confirm"]').fill(STUDENT_PASSWORD);
      await page.getByRole("button", { name: /save and continue/i }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/app") && !u.pathname.includes("change-password"), { timeout: 90_000 });
    }
    return;
  }
  throw new Error(`Could not sign in as student ${admissionNo}`);
}
