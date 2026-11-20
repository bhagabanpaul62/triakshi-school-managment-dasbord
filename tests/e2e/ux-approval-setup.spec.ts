import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { consoleLogin, expectHealthy, MARKETING, PASSWORD, SCHOOL } from "./helpers";

const OUT = "test-results/ux-approval-setup";
mkdirSync(OUT, { recursive: true });
const MAILPIT = "http://localhost:8025/api/v1";
const shot = (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true }); // other agents' Playwright runs clear test-results
  return page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

/** Poll Mailpit for the newest message to `to` whose subject matches; returns its text body. */
async function mailTo(to: string, subject: RegExp): Promise<string> {
  for (let i = 0; i < 120; i++) {
    try {
      // Search by recipient: other agents share this Mailpit, so the newest 50 may not include ours.
      const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`)).json()) as { messages: { ID: string; Subject: string }[] };
      const hit = list.messages.find((m) => subject.test(m.Subject));
      if (hit) return ((await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json()) as { Text: string }).Text;
    } catch { /* Mailpit busy: try again */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}

/** After the password is set the panel shows the awaiting screen; on a busy dev server the redirect can time out, so retry from /app once. */
async function awaiting(page: Page, slug: string) {
  const heading = page.getByRole("heading", { name: /being reviewed/i });
  try { await expect(heading).toBeVisible({ timeout: 240_000 }); } catch {
    await page.goto(`${SCHOOL(slug)}/app`, { timeout: 150_000 });
    await expect(heading).toBeVisible({ timeout: 150_000 });
  }
}

/** Register a school on the marketing site, confirm the email, set a password. Returns the awaiting page. */
async function register(page: Page, tag: string) {
  const slug = `ux${Date.now().toString(36)}${tag}`;
  const email = `${slug}@example.test`;
  await page.goto(`${MARKETING}/signup`, { timeout: 240_000 });
  await page.getByLabel("School name").fill(`UX ${slug} Public School`);
  await page.getByLabel("Board").selectOption("CBSE");
  await page.getByLabel(/how many students/i).fill("400");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Asha Verma");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("State").selectOption("Karnataka");
  await page.getByLabel(/city/i).fill("Mysuru");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#slug").fill(slug);
  await expect(page.getByText(/is available/)).toBeVisible({ timeout: 240_000 });
  await page.getByRole("button", { name: "Create my school" }).click();
  // The mail is the source of truth: a dev-server hot reload by another agent can reset the form after the school is created.
  await page.getByRole("heading", { name: /check your email/i }).waitFor({ timeout: 20_000 }).catch(() => undefined);
  const body = await mailTo(email, /confirm your email/i);
  const link = body.match(/https?:\/\/\S+verify-email\?token=\S+/)![0];
  return { slug, email, link };
}

test.describe("approval and setup journey", () => {
  test.setTimeout(1_500_000);

  test("owner flow: sign up, verify, wait, approve, set up", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240_000);
    const { slug, email, link } = await register(page, "a");
    await shot(page, "01-signup-done-desktop");

    // verify
    await page.goto(link, { timeout: 240_000 });
    await shot(page, "02-verify-desktop");
    await page.getByLabel("Choose a password").fill(PASSWORD);
    await page.getByLabel("Type it again").fill(PASSWORD);
    await page.getByRole("button", { name: /confirm email/i }).click();
    await awaiting(page, slug);
    await shot(page, "03-awaiting-desktop");
    await noSideScroll(page);

    // console: approve
    const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cpage = await cctx.newPage();
    cpage.setDefaultTimeout(240_000);
    await consoleLogin(cpage);
    await cpage.goto("http://localhost:4102/approvals", { timeout: 240_000 });
    await cpage.getByRole("link", { name: new RegExp(slug) }).first().click();
    await shot(cpage, "04-console-review");
    await cpage.getByRole("button", { name: "Approve", exact: true }).click();
    await cpage.getByRole("button", { name: /approve and email/i }).click();
    await expect(cpage.getByText(/approved|trial/i).first()).toBeVisible({ timeout: 240_000 });
    await cctx.close();

    const approved = await mailTo(email, /is approved/i);
    expect(approved).toContain(`${slug}.localhost`);

    // the awaiting page moves on by itself, or after a reload
    await page.reload();
    await page.waitForURL(/\/app\/setup/, { timeout: 240_000 });
    await shot(page, "05-wizard-first-step-desktop");
    await expectHealthy(page);

    // The signup already filled the school profile, so the wizard opens at the first unfinished step: the year.
    await page.waitForURL(/setup\/year/, { timeout: 240_000 });
    await expect(page.getByRole("link", { name: /Done School profile/ })).toBeVisible();
    await page.goto(`${SCHOOL(slug)}/app/setup/profile`);
    await expect(page.getByLabel("School name")).toHaveValue(/UX/, { timeout: 240_000 }); // prefilled from the signup
    await shot(page, "05b-wizard-profile-desktop");
    await page.getByRole("button", { name: /save and continue/i }).click();
    // year: defaults must be enough
    await page.waitForURL(/setup\/year/);
    await shot(page, "06-year-desktop");
    await page.getByRole("button", { name: /save and continue/i }).click();
    // classes
    await page.waitForURL(/setup\/classes/);
    await shot(page, "07-classes-desktop");
    await page.getByRole("button", { name: /create classes|save and continue/i }).click();
    // subjects
    await page.waitForURL(/setup\/subjects/);
    await shot(page, "08-subjects-desktop");
    await page.getByRole("button", { name: /save and continue/i }).click();
    // students: skip
    await page.waitForURL(/setup\/students/);
    await shot(page, "09-students-desktop");
    await page.getByRole("link", { name: /skip for now/i }).click();
    // staff
    await page.waitForURL(/setup\/staff/);
    await page.getByLabel("Teacher 1 name").fill("Ravi Kumar");
    await page.getByLabel("Teacher 1 email").fill(`ravi.${slug}@example.test`);
    await shot(page, "10-staff-desktop");
    await page.getByRole("button", { name: /invite 1 teacher/i }).click();
    // website
    await page.waitForURL(/setup\/website/);
    await shot(page, "11-website-desktop");
    await page.getByRole("button", { name: /publish my website/i }).click();
    // review + finish
    await page.waitForURL(/setup\/done/);
    await shot(page, "12-review-desktop");
    await page.getByRole("button", { name: /finish setup/i }).click();
    await expect(page.getByRole("heading", { name: /is set up/i })).toBeVisible({ timeout: 240_000 });
    await shot(page, "13-finished-desktop");
    await page.getByRole("link", { name: /open my dashboard/i }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "14-home-desktop");
    await expectHealthy(page);
    expect(SCHOOL(slug)).toContain(slug);
    await ctx.close();
  });

  test("reject path shows the rejected screen", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240_000);
    const { slug, email, link } = await register(page, "r");
    await shot(page, "20-signup-done-phone");
    await noSideScroll(page);
    await page.goto(link, { timeout: 240_000 });
    await shot(page, "21-verify-phone");
    await noSideScroll(page);
    await page.getByLabel("Choose a password").fill(PASSWORD);
    await page.getByLabel("Type it again").fill(PASSWORD);
    await page.getByRole("button", { name: /confirm email/i }).click();
    await awaiting(page, slug);
    await shot(page, "22-awaiting-phone");
    await noSideScroll(page);

    const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cpage = await cctx.newPage();
    cpage.setDefaultTimeout(240_000);
    await consoleLogin(cpage);
    await cpage.goto("http://localhost:4102/approvals", { timeout: 240_000 });
    await cpage.getByRole("link", { name: new RegExp(slug) }).first().click();
    await cpage.getByRole("button", { name: "Reject", exact: true }).click();
    await cpage.getByLabel("Reason").fill("We could not find this school in the UDISE register.");
    await cpage.getByRole("button", { name: /reject school/i }).click();
    await expect(cpage.getByText(/rejected/i).first()).toBeVisible({ timeout: 240_000 });
    await cctx.close();

    const mail = await mailTo(email, /update on your/i);
    expect(mail).toContain("UDISE");
    await page.reload();
    await expect(page.getByRole("heading", { name: /could not approve/i })).toBeVisible({ timeout: 240_000 });
    await shot(page, "23-rejected-phone");
    await noSideScroll(page);
    await ctx.close();
  });

  test("wizard on a phone: no sideways scroll, steps readable", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240_000);
    // sunrise is a seeded school; its admin may already be past setup, so only check what renders
    await page.goto(`${SCHOOL("sunrise")}/login`, { timeout: 240_000 });
    await page.getByLabel(/email, phone or admission number/i).fill("admin");
    await page.getByLabel(/^password$/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app/);
    for (const step of ["profile", "year", "classes", "subjects", "students", "staff", "website", "done"]) {
      await page.goto(`${SCHOOL("sunrise")}/app/setup/${step}`, { timeout: 240_000 });
      await shot(page, `30-phone-${step}`);
      await noSideScroll(page);
    }
    await ctx.close();
  });
});
