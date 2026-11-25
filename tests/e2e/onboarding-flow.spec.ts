import { expect, test, type Page } from "@playwright/test";
// postgres-js comes from @smw/db; the root workspace does not depend on it directly.
import postgres from "../../packages/db/node_modules/postgres";
import { CONSOLE, consoleLogin, MARKETING } from "./helpers";

// The way into a school after signup: one email = one account, the approval email opens "Set up your account" when no
// password was set, and every sign-in button arrives with the email already filled in. Production build only.
const MAILPIT = "http://localhost:8025/api/v1";
const db = postgres(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/smw" /* local seed DB only */, { max: 1 });
test.afterAll(async () => { await db.end(); });

/** Newest mail to `to` whose subject matches, as plain text. */
async function mailTo(to: string, subject: RegExp, after = 0): Promise<string> {
  for (let i = 0; i < 90; i++) {
    const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`)).json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const hit = list.messages.filter((m) => subject.test(m.Subject) && Date.parse(m.Created) > after).sort((a, b) => b.Created.localeCompare(a.Created))[0];
    if (hit) return ((await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json()) as { Text: string }).Text;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}

/** Fill the marketing signup form; stops after "Create my school". */
async function signUp(page: Page, email: string, slug: string) {
  await page.goto(`${MARKETING}/signup`, { timeout: 120_000 });
  await page.getByLabel("School name").fill(`Flow ${slug} School`);
  await page.getByLabel("Board").selectOption("CBSE");
  await page.getByLabel(/how many students/i).fill("300");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Ritu Sen");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("State").selectOption("Karnataka");
  await page.getByLabel(/city/i).fill("Mysuru");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#slug").fill(slug);
  await expect(page.getByText(/is available/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Create my school" }).click();
}

test("an email that already signs in to a school cannot register another; its owner gets the sign-in link", async ({ page }) => {
  test.setTimeout(240_000);
  const [admin] = await db<{ email: string }[]>`select u.email from users u join schools s on s.id = u.school_id where s.slug = 'greenvalley' and u.role = 'admin' and u.email is not null limit 1`;
  const slug = `dup${Date.now().toString(36)}`;
  const since = Date.now();
  await signUp(page, admin!.email, slug);
  await expect(page.getByText(/already has a Triakshi account, so we have emailed it a sign-in link/)).toBeVisible({ timeout: 60_000 });
  expect(await db`select 1 from schools where slug = ${slug}`).toHaveLength(0); // no lead, no pending school
  const mail = await mailTo(admin!.email, /already have a Triakshi account/i, since - 1000);
  expect(mail).toContain("Green Valley Public School");
  expect(mail).toContain(`/login?id=${encodeURIComponent(admin!.email)}`); // the admin has a password: straight to sign-in

  // the button lands on sign-in with the email typed in and the cursor in the password box
  await page.goto(mail.match(/https?:\/\/\S+\/login\?id=\S+/)![0]);
  await expect(page.getByLabel("Email, phone or admission number")).toHaveValue(admin!.email);
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
});

test("approved before setting a password: the approval email opens Set up your account, and that signs them in", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const slug = `nopw${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  await signUp(page, email, slug);
  await mailTo(email, /confirm your email/i); // ignored on purpose: this admin never opens it
  const [school] = await db<{ id: string }[]>`select id from schools where slug = ${slug}`;

  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cpage = await cctx.newPage();
  await consoleLogin(cpage);
  await cpage.goto(`${CONSOLE}/approvals/${school!.id}`, { timeout: 120_000 });
  await cpage.getByRole("button", { name: "Approve", exact: true }).click();
  await cpage.getByRole("button", { name: /approve and email/i }).click();
  await expect(cpage.getByText(/approved|trial/i).first()).toBeVisible({ timeout: 60_000 });

  const approved = await mailTo(email, /is approved/i);
  expect(approved).toContain("Set your password to sign in");
  const link = approved.match(/https?:\/\/\S+\/reset-password\?token=\S+/)![0];
  expect(link).toContain(`${slug}.localhost`);

  // a fresh browser, like the person opening their email: first page is "Set up your account", not forgot-password
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(link);
  await expect(fresh.getByRole("heading", { name: "Set up your account" })).toBeVisible({ timeout: 60_000 });
  await expect(fresh.getByText(/Welcome, Ritu\./)).toBeVisible();
  await fresh.getByLabel("New password").fill("Fresh-Start-2026");
  await fresh.getByLabel("Type it again").fill("Fresh-Start-2026");
  await fresh.getByRole("button", { name: "Set password and sign in" }).click();
  await fresh.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 60_000 });
  const [admin] = await db<{ status: string; verified: boolean }[]>`select status, email_verified_at is not null as verified from users where school_id = ${school!.id} and role = 'admin'`;
  expect(admin).toEqual({ status: "active", verified: true });

  // the console can send the way in again; with a password set it is sign-in with the email filled in
  await cpage.goto(`${CONSOLE}/schools/${school!.id}`, { timeout: 120_000 });
  const since = Date.now();
  await cpage.getByRole("button", { name: "Resend sign-in email" }).click();
  await cpage.getByRole("dialog").getByRole("button", { name: "Send" }).click();
  await expect(cpage.getByText(/sign-in link with their email filled in/)).toBeVisible({ timeout: 60_000 });
  const again = await mailTo(email, /is approved/i, since - 1000);
  await fresh.context().clearCookies();
  await fresh.goto(again.match(/https?:\/\/\S+\/login\?id=\S+/)![0]);
  await expect(fresh.getByLabel("Email, phone or admission number")).toHaveValue(email);
  await cctx.close();
});
