import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { login as signIn, SCHOOL } from "./helpers";

/** Sign in, retrying: the shared dev server reloads the page when other work changes files mid-submit. */
async function login(page: Page, slug: string, id: string) {
  for (let i = 0; ; i++) {
    try { await Promise.race([signIn(page, slug, id), new Promise((_, rej) => setTimeout(() => rej(new Error("sign-in stalled")), 60_000))]); return; }
    catch (e) { if (i >= 4) throw e; }
  }
}

// Journeys: admin adds and invites a teacher, finds staff, resends, deactivates; the invited teacher sets a password;
// admin edits the school, uploads a logo, reads the audit timeline, exports data; any user changes their password.
const SHOTS = "test-results/ux-staff-settings";
const SLUG = "greenvalley";
const MAILPIT = "http://localhost:8025/api/v1";
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const run = Date.now().toString(36);
const NAME = `Asha Rao ${run}`;
const EMAIL = `asha.${run}@greenvalley.example`;
const PASSWORD = "first-pass-9";

async function shot(page: Page, name: string, phone = false) {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${phone ? "phone" : "desktop"}-${name}.png`, fullPage: true });
  if (phone) await page.setViewportSize({ width: 1440, height: 900 });
}

/** The newest mailed set-password link for this address. */
async function inviteLink(request: APIRequestContext, to: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = await (await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const msgs = (list.messages ?? []) as { ID: string; Created: string }[];
    if (msgs.length > after) {
      const id = msgs.sort((a, b) => b.Created.localeCompare(a.Created))[0]!.ID;
      const full = await (await request.get(`${MAILPIT}/message/${id}`)).json();
      const m = /https?:\/\/[^\s"<>]*reset-password\?token=[\w-]+/.exec(full.Text ?? "");
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No set-password email for ${to}`);
}
const count = async (request: APIRequestContext, to: string) =>
  ((await (await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`)).json()).messages ?? []).length as number;

test("staff and settings journeys", async ({ page, browser, request }) => {
  test.setTimeout(1_500_000);
  page.setDefaultNavigationTimeout(240_000); // dev server compiles each route on first visit, slowly when busy
  page.setDefaultTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, SLUG, "admin");
  let staffUrl = "";

  await test.step("admin adds a teacher; the footer says who gets the email", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/staff`, { timeout: 240_000 });
    await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Yet to sign in")).toBeVisible();
    await shot(page, "staff-list");
    await shot(page, "staff-list", true);
    await page.getByRole("button", { name: "Add staff" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("No email, so you get a link to share by hand")).toBeVisible();
    await expect(dialog.getByLabel(/employee id/i)).toHaveValue(/^T\d+$/); // smart default
    await dialog.getByLabel(/full name/i).fill(NAME);
    await dialog.getByLabel(/^email/i).fill(EMAIL);
    await expect(dialog.getByText(`Emails a set-password link to ${EMAIL}`)).toBeVisible();
    await shot(page, "add-staff");
    await dialog.getByRole("button", { name: "Add and invite" }).click();
    await page.waitForURL(/\/app\/staff\/[0-9a-f-]{36}/, { timeout: 150_000 });
    staffUrl = page.url();
    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
    await expect(page.getByText("Invited").first()).toBeVisible();
    await expect(page.getByText(`Invite emailed to ${EMAIL}`)).toBeVisible();
    await shot(page, "staff-detail-invited");
    await shot(page, "staff-detail-invited", true);
  });

  let firstLink = "";
  await test.step("the invite is in the inbox; resend replaces it", async () => {
    firstLink = await inviteLink(request, EMAIL);
    await page.getByRole("button", { name: "Resend invite" }).click();
    await expect.poll(() => count(request, EMAIL), { timeout: 30_000 }).toBe(2);
  });

  await test.step("admin finds staff and sees what a teacher teaches", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/staff?q=${encodeURIComponent(run)}`);
    await expect(page.getByRole("row", { name: new RegExp(NAME) })).toBeVisible();
    await page.goto(`${SCHOOL(SLUG)}/app/staff?q=Priya`);
    const row = page.getByRole("row", { name: /Priya Sharma/ });
    await expect(row).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Teaches" })).toBeVisible();
    await row.getByRole("link").first().click();
    await page.waitForURL(/\/app\/staff\/[0-9a-f-]{36}/, { timeout: 150_000 });
    await page.getByRole("tab", { name: /Classes/ }).click();
    await expect(page.getByText("Subjects they teach")).toBeVisible();
    await shot(page, "staff-classes");
    await shot(page, "staff-classes", true);
  });

  await test.step("invited teacher: old link is dead, new link sets a password and signs in", async () => {
    const guest = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
    const p = await guest.newPage();
    await p.goto(firstLink);
    await expect(p.getByRole("heading", { name: "This link is not valid" })).toBeVisible({ timeout: 60_000 });
    await shot(p, "reset-old-link");

    const link = await inviteLink(request, EMAIL, 1);
    expect(link).not.toBe(firstLink);
    await p.goto(link);
    await expect(p.getByRole("heading", { name: "Set up your account" })).toBeVisible();
    await expect(p.getByText(/Welcome, Asha\./)).toBeVisible();
    await p.getByLabel("New password").fill("short");
    await expect(p.getByText("3 more characters needed")).toBeVisible();
    await p.getByLabel("New password").fill(PASSWORD);
    await p.getByLabel("Type it again").fill("something-else");
    await expect(p.getByText("The two passwords do not match yet")).toBeVisible();
    await expect(p.getByRole("button", { name: /set password/i })).toBeDisabled();
    await p.getByLabel("Type it again").fill(PASSWORD);
    await shot(p, "reset-form");
    await shot(p, "reset-form", true);
    await p.getByRole("button", { name: /set password and sign in/i }).click();
    await p.waitForURL(/\/app/, { timeout: 60_000 });
    await expect(p.getByText(NAME).first()).toBeVisible();

    await test.step("any user: profile and change password", async () => {
      await p.goto(`${SCHOOL(SLUG)}/app/profile`);
      await expect(p.getByRole("heading", { name: NAME })).toBeVisible();
      await shot(p, "profile");
      await shot(p, "profile", true);
      await p.getByRole("button", { name: "Change password" }).click();
      const d = p.getByRole("dialog");
      await d.getByLabel(/current password/i).fill("not-my-password");
      await d.getByLabel(/^new password\s*\*?$/i).fill("second-pass-9"); // the label text ends in the required " *"
      await d.getByLabel(/new password again/i).fill("second-pass-9");
      await d.getByRole("button", { name: "Change password" }).click();
      await expect(d.getByText("That is not your current password")).toBeVisible();
      await d.getByLabel(/current password/i).fill(PASSWORD);
      await d.getByRole("button", { name: "Change password" }).click();
      await expect(p.getByText("Password changed")).toBeVisible();
    });
    await guest.close();
  });

  await test.step("admin deactivates safely, then reactivates", async () => {
    await page.goto(staffUrl);
    await expect(page.getByText("Active").first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Deactivate" }).click();
    const d = page.getByRole("dialog");
    await expect(d.getByText(/signed out everywhere/)).toBeVisible();
    await expect(d.getByText(/reactivate them later/)).toBeVisible();
    await shot(page, "deactivate-confirm");
    await d.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Deactivated").first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "staff-detail-deactivated");
    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Active").first()).toBeVisible({ timeout: 30_000 });
  });

  await test.step("admin edits the school profile and uploads a logo that shows in the sidebar", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/settings`, { timeout: 240_000 });
    await expect(page.getByText("Profile completeness")).toBeVisible({ timeout: 60_000 });
    await shot(page, "settings-school");
    await shot(page, "settings-school", true);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel(/^phone/i).fill("9812345678");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("School details saved")).toBeVisible();
    await page.getByRole("button", { name: /^(Upload|Change)$/ }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });
    await page.getByRole("dialog").getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Logo updated")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('img[src*="public/logo"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('nav img[src*="public/logo"], aside img[src*="public/logo"], header img[src*="public/logo"]').first()).toBeAttached();
    await shot(page, "settings-logo");
  });

  await test.step("admin manages users and roles", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/settings?tab=users`);
    await expect(page.getByText("Admins", { exact: true })).toBeVisible({ timeout: 60_000 });
    await shot(page, "settings-users");
    await shot(page, "settings-users", true);
    await page.getByPlaceholder("Search by name, email or login").fill(run);
    const row = page.getByRole("row", { name: new RegExp(NAME) });
    await expect(row).toBeVisible();
    // Role sits in the person's Manage dialog, next to password, access link and sign-out.
    await row.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Change role" }).click();
    await expect(page.getByRole("dialog").last().getByLabel(/^role/i).locator("option", { hasText: /^Teacher$/ })).toBeAttached();
    await shot(page, "settings-role-modal");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await test.step("admin reads the audit log as a timeline", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/audit`);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`Added teacher ${NAME}`)).toBeVisible();
    await shot(page, "audit");
    await shot(page, "audit", true);
    await page.getByPlaceholder("Search what happened").fill("zzz-nothing-matches");
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
    await shot(page, "audit-empty");
  });

  await test.step("admin exports school data and finds the file", async () => {
    await page.goto(`${SCHOOL(SLUG)}/app/settings?tab=export`);
    await expect(page.getByText("Whole school")).toBeVisible({ timeout: 60_000 });
    await shot(page, "export-before");
    await page.getByRole("button", { name: "Export all school data" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("link", { name: /Download All school data/ }).first()).toBeVisible({ timeout: 240_000 });
    await shot(page, "export-after");
    await shot(page, "export-after", true);
  });

  await test.step("no horizontal scroll on a phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/app/staff", "/app/settings", "/app/settings?tab=users", "/app/settings?tab=export", "/app/audit", "/app/profile"]) {
      await page.goto(`${SCHOOL(SLUG)}${path}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
    }
  });
});
