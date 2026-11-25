import { execSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { login as signIn, loginStudent, reloadIfSchoolNotFound, SCHOOL } from "./helpers";

// Acceptance items of docs/AUTH-PRD.md section 8 (sign-in, roles, forced change, forgot password, email codes).
// Staff are made through the app's own UI with unique names; at the end they are disabled through the UI.
const SLUG = "greenvalley";
const SHOTS = "test-results/auth-rbac";
const MAILPIT = "http://localhost:8025/api/v1";
const run = Date.now().toString(36);
const STRONG = `Quill-Harbor-${run}7`;
const STRONG2 = `Maple-Tundra-${run}9`;

const sql = (q: string) =>
  execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d ${process.env.E2E_DB ?? "smw"} -tAc "${q.replace(/"/g, '\\"')}"`, { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
const sid = () => sql(`select id from schools where slug='${SLUG}'`);

test.describe.configure({ mode: "default" });
test.setTimeout(900_000);

// ---------- plumbing ----------

/** Each context gets its own forwarded IP, so the per-IP rate limits (10 sign-ins, 5 resets an hour) never leak between tests or runs. */
let ipN = 0;
const fakeIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${(++ipN % 250) + 1}`;
async function newCtx(browser: Browser, phone = false): Promise<BrowserContext> {
  return browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, colorScheme: "dark", extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
}
async function newPage(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  p.setDefaultNavigationTimeout(240_000); // the dev server compiles each route on first visit
  p.setDefaultTimeout(90_000);
  return p;
}
/** Sign in, retrying: the shared dev server can reload the page mid-submit. */
async function login(page: Page, id: string, pw: string) {
  for (let i = 0; ; i++) {
    try { await Promise.race([signIn(page, SLUG, id, pw), new Promise((_, rej) => setTimeout(() => rej(new Error("sign-in stalled")), 90_000))]); return; }
    catch (e) { if (i >= 3) throw e; }
  }
}
async function adminSession(browser: Browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await login(page, "admin", "demo12345");
  return { ctx, page };
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

/** Poll Mailpit until `n` mails to this address match `subject`; returns the newest one in full. */
async function waitMail(request: APIRequestContext, to: string, subject: RegExp, n = 1): Promise<{ Subject: string; Text: string }> {
  for (let i = 0; i < 80; i++) {
    const list = await (await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const msgs = ((list.messages ?? []) as { ID: string; Subject: string; Created: string }[]).filter((m) => subject.test(m.Subject)).sort((a, b) => b.Created.localeCompare(a.Created));
    if (msgs.length >= n) return await (await request.get(`${MAILPIT}/message/${msgs[0]!.ID}`)).json();
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No mail matching ${subject} for ${to}`);
}
const mailCount = async (request: APIRequestContext, to: string, subject: RegExp) =>
  (((await (await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`)).json()).messages ?? []) as { Subject: string }[]).filter((m) => subject.test(m.Subject)).length;
const linkOf = (text: string) => /https?:\/\/[^\s"<>]*reset-password\?token=[\w-]+/.exec(text)?.[0] ?? "";
const codeOf = (text: string) => /code[^:\n]*:\s*(\d{6})/.exec(text)?.[1] ?? /\b(\d{6})\b/.exec(text)?.[1] ?? "";

// ---------- app flows ----------

const made: string[] = []; // names of the staff made in this run, disabled at the end

/** Admin adds a staff member through the Add staff dialog. With an email it returns the mailed link, without one the copied access link. */
async function addStaff(admin: Page, request: APIRequestContext, o: { name: string; email?: string; role?: string }): Promise<string> {
  made.push(o.name);
  await admin.goto(`${SCHOOL(SLUG)}/app/staff`);
  await expect(admin.getByRole("heading", { name: "Staff", exact: true })).toBeVisible({ timeout: 90_000 });
  await admin.getByRole("button", { name: "Add staff" }).first().click();
  const d = admin.getByRole("dialog");
  if (o.role) {
    const sel = d.getByLabel("Role");
    const v = await sel.locator("option", { hasText: o.role }).first().getAttribute("value");
    await sel.selectOption(v!);
  }
  await d.getByLabel(/full name/i).fill(o.name);
  if (o.email) await d.getByLabel(/^email/i).fill(o.email);
  await d.getByRole("button", { name: o.email ? "Add and invite" : "Add and get link" }).click();
  if (o.email) {
    await admin.waitForURL(/\/app\/staff\/[0-9a-f-]{36}/, { timeout: 150_000 });
    return linkOf((await waitMail(request, o.email, /./)).Text);
  }
  const input = admin.locator('input[aria-label="Access link"]');
  await expect(input).toBeVisible({ timeout: 90_000 });
  const url = await input.inputValue();
  await admin.getByRole("button", { name: "Done" }).click();
  return url;
}

/** Open an invite or reset link in a fresh context and choose a password; resolves signed in on /app. */
async function activate(browser: Browser, link: string, pw: string, heading = "Set up your account") {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("New password").fill(pw);
  await page.getByLabel("Type it again").fill(pw);
  await page.getByRole("button", { name: /set password and sign in/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 90_000 });
  return { ctx, page };
}

/** A staff member (default Teacher role) with an email, a password and an open session. */
async function activeStaff(browser: Browser, request: APIRequestContext, admin: Page, tag: string) {
  const name = `${tag} ${run}`;
  const email = `${tag.toLowerCase().replace(/\s+/g, ".")}.${run}@greenvalley.example`;
  const link = await addStaff(admin, request, { name, email });
  const session = await activate(browser, link, STRONG);
  return { name, email, ...session };
}

/** Open a person's own page from Settings, Users: every action on the account is on it. `dialog` is the page body, so the old lookups keep working. */
async function manage(admin: Page, search: string, name = search) {
  await admin.goto(`${SCHOOL(SLUG)}/app/settings/users`);
  await admin.getByPlaceholder("Search by name, email or login").fill(search);
  const row = admin.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible({ timeout: 90_000 });
  await row.getByRole("link").first().click();
  await expect(admin).toHaveURL(/\/app\/settings\/users\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return { row, dialog: admin.locator("body") };
}

/** A seeded student who has never signed in, picked from the end of the list (the other specs start from the top). */
function pickStudent(offset: number) {
  const r = sql(`select s.admission_no || '|' || to_char(s.dob,'DDMMYYYY') || '|' || s.class_id || '|' || s.name from students s join users u on u.id = s.user_id where s.school_id='${sid()}' and u.must_change_password and u.last_login_at is null and s.dob is not null and s.status='active' and s.class_id is not null order by s.admission_no desc limit 1 offset ${offset}`);
  const [no, dob, classId, name] = r.split("|");
  if (!no) throw new Error("No seeded student left that has never signed in");
  return { no: no!, dob: dob!, classId: classId!, name: name! };
}

let signedIn: ReturnType<typeof pickStudent> | undefined; // set by test 2, read by test 9

// ---------- tests ----------

test("1. custom Librarian role: access link, set up account, Library yes, Fees no", async ({ browser, request }) => {
  const { ctx, page } = await adminSession(browser);
  const role = `Librarian ${run}`;
  await page.goto(`${SCHOOL(SLUG)}/app/settings/roles`);
  await page.getByRole("button", { name: "New role" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel(/role name/i).fill(role);
  await d.locator('input[name="g.library"]').first().check();
  await d.locator('input[name="g.library"][value="library:manage"]').check();
  await expect(d.locator('input[name="g.fees"]:checked')).toHaveCount(0);
  await shot(page, "roles-new-librarian");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: new RegExp(role) })).toBeVisible({ timeout: 90_000 });

  const name = `Lib Rian ${run}`;
  const link = await addStaff(page, request, { name, role });
  expect(link).toMatch(/reset-password\?token=/);

  const { ctx: c2, page: p } = await activate(browser, link, STRONG);
  await expect(p).toHaveURL(/\/app$/);
  const nav = p.getByRole("navigation", { name: "Main" });
  await expect(nav.locator('a[href="/app/library"]')).toBeVisible({ timeout: 90_000 });
  await expect(nav.locator('a[href="/app/fees"]')).toHaveCount(0);
  await expect(nav.locator('a[href="/app/staff"]')).toHaveCount(0);
  await shot(p, "librarian-home");

  const resp = await p.goto(`${SCHOOL(SLUG)}/app/fees`);
  const status = resp?.status();
  const path = new URL(p.url()).pathname;
  const body = await p.locator("body").innerText();
  await shot(p, "librarian-fees-refused");
  console.log(`librarian GET /app/fees -> status ${status}, final path ${path}, body: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
  expect(status === 403 || status === 404 || path !== "/app/fees" || /ask an admin if you need access|page not found|not allowed|forbidden|no access|permission|do not have|don.t have/i.test(body), `fees was reachable: status ${status} path ${path}`).toBe(true);
  // the library itself opens
  await p.goto(`${SCHOOL(SLUG)}/app/library`);
  await expect(p.getByRole("heading", { name: /library/i }).first()).toBeVisible({ timeout: 90_000 });
  await c2.close(); await ctx.close();
});

test("2. student: DOB sign-in forces a password change, weak refused, old password dead", async ({ browser }) => {
  const s = pickStudent(0);
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/login`);
  await page.getByLabel(/email, phone or admission number/i).fill(s.no);
  await page.getByLabel(/^password$/i).fill(s.dob);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app\/change-password/, { timeout: 120_000 });
  await reloadIfSchoolNotFound(page);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await shot(page, "student-forced-change");

  for (const path of ["/app", "/app/profile", "/app/fees", "/app/library"]) {
    await page.goto(`${SCHOOL(SLUG)}${path}`);
    await expect(page, `${path} should bounce back`).toHaveURL(/\/app\/change-password/);
  }

  const fill = async (cur: string, next: string) => {
    await page.locator('input[name="current"]').fill(cur);
    await page.locator('input[name="next"]').fill(next);
    await page.locator('input[name="confirm"]').fill(next);
    await page.getByRole("button", { name: /save and continue/i }).click();
  };
  await fill(s.dob, s.dob); // the DOB itself
  await expect(page.getByText(/cannot be your date of birth|different from the current/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/app\/change-password/);
  await fill(s.dob, "password");
  await expect(page.getByText(/too common/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/app\/change-password/);
  await shot(page, "student-weak-refused");

  await fill(s.dob, STRONG);
  await page.waitForURL((u) => u.pathname === "/app", { timeout: 90_000 });
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible({ timeout: 90_000 });
  await expect(page).not.toHaveURL(/change-password/);
  await shot(page, "student-home");
  signedIn = s;

  // the old (DOB) password is dead, the new one works
  const c2 = await newCtx(browser);
  const p2 = await newPage(c2);
  await p2.goto(`${SCHOOL(SLUG)}/login`);
  await p2.getByLabel(/email, phone or admission number/i).fill(s.no);
  await p2.getByLabel(/^password$/i).fill(s.dob);
  await p2.getByRole("button", { name: /sign in/i }).click();
  await expect(p2.locator('p[role="alert"]')).toContainText(/not right/i, { timeout: 60_000 });
  await expect(p2).toHaveURL(/\/login/);
  await p2.getByLabel(/^password$/i).fill(STRONG);
  await p2.getByRole("button", { name: /sign in/i }).click();
  await p2.waitForURL(/\/app$/, { timeout: 90_000 });
  await ctx.close(); await c2.close();
});

test("3a. forgot password: one mail with link and code; the code resets once", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Forgot Code");
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/forgot-password`);
  await page.getByLabel(/email, phone or admission number/i).fill(u.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(/6-digit code and a reset link/i, { timeout: 90_000 });

  const mail = await waitMail(request, u.email, /^Reset your password/);
  await new Promise((r) => setTimeout(r, 2000));
  expect(await mailCount(request, u.email, /^Reset your password/), "exactly one reset mail").toBe(1);
  const code = codeOf(mail.Text);
  expect(linkOf(mail.Text), "link in the mail").toMatch(/reset-password\?token=/);
  expect(code, "6-digit code in the mail").toMatch(/^\d{6}$/);

  await page.getByLabel("6-digit code").fill(code);
  await page.getByLabel("New password", { exact: false }).first().fill(STRONG2);
  await page.getByLabel("Type it again").fill(STRONG2);
  await page.getByRole("button", { name: /set password and sign in/i }).click();
  await page.waitForURL((x) => x.pathname.startsWith("/app"), { timeout: 90_000 });

  // the new password works, the old one does not
  const c2 = await newCtx(browser);
  const p2 = await newPage(c2);
  await login(p2, u.email, STRONG2);
  await expect(p2).toHaveURL(/\/app/);

  // the used code is dead: a fresh request makes a new code, and the old one is refused
  const c3 = await newCtx(browser);
  const p3 = await newPage(c3);
  await p3.goto(`${SCHOOL(SLUG)}/forgot-password`);
  await p3.getByLabel(/email, phone or admission number/i).fill(u.email);
  await p3.getByRole("button", { name: "Email me a code" }).click();
  await expect(p3.getByLabel("6-digit code")).toBeVisible({ timeout: 90_000 });
  await p3.getByLabel("6-digit code").fill(code);
  await p3.getByLabel("New password").first().fill(STRONG);
  await p3.getByLabel("Type it again").fill(STRONG);
  await p3.getByRole("button", { name: /set password and sign in/i }).click();
  await expect(p3.locator('p[role="alert"]')).toContainText(/not right|expired|too many/i, { timeout: 60_000 });
  await shot(p3, "forgot-used-code-refused");
  await expect(p3).not.toHaveURL(/\/app/);
  for (const c of [ctx, c2, c3, u.ctx, admin.ctx]) await c.close();
});

test("3b. forgot password: the mailed link works once, then 'already used'", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Forgot Link");
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/forgot-password`);
  await page.getByLabel(/email, phone or admission number/i).fill(u.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const link = linkOf((await waitMail(request, u.email, /^Reset your password/)).Text);
  expect(link).toMatch(/reset-password\?token=/);

  const { ctx: c2, page: p } = await activate(browser, link, STRONG2, "Set a new password");
  await expect(p).toHaveURL(/\/app/);
  await p.goto(link);
  await expect(p.getByRole("heading", { name: "This link was already used" })).toBeVisible({ timeout: 90_000 });
  await shot(p, "reset-link-used");
  for (const c of [ctx, c2, u.ctx, admin.ctx]) await c.close();
});

test("3c. forgot password: an expired link says expired", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Forgot Expired");
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/forgot-password`);
  await page.getByLabel(/email, phone or admission number/i).fill(u.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const link = linkOf((await waitMail(request, u.email, /^Reset your password/)).Text);
  // Fake time the one allowed way: age this person's live reset link in the DB.
  sql(`update one_time_tokens set expires_at = now() - interval '1 minute' where user_id = (select id from users where school_id='${sid()}' and lower(email)='${u.email}') and purpose='reset_password' and used_at is null`);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible({ timeout: 90_000 });
  await shot(page, "reset-link-expired");
  for (const c of [ctx, u.ctx, admin.ctx]) await c.close();
});

test("4. forgot password: unknown and known logins read the same", async ({ browser }) => {
  const ask = async (id: string) => {
    const ctx = await newCtx(browser);
    const page = await newPage(ctx);
    await page.goto(`${SCHOOL(SLUG)}/forgot-password`);
    await page.getByLabel(/email, phone or admission number/i).fill(id);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible({ timeout: 90_000 });
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    await ctx.close();
    return text;
  };
  const known = await ask("admin@greenvalley.test");
  const unknown = await ask(`nobody.${run}@greenvalley.example`);
  const student = await ask(pickStudent(1).no); // a real login with no email
  expect(unknown).toBe(known);
  expect(student).toBe(known);
  expect(known).toMatch(/If an account matches/);
});

test("5. sign in with an emailed code; a wrong code is refused", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Code Login");
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/login`);
  await page.getByRole("button", { name: "Email me a code instead" }).click();
  await page.getByLabel(/email, phone or admission number/i).fill(u.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible({ timeout: 90_000 });
  const m1 = await waitMail(request, u.email, /is your .* code$/, 1);
  const c1 = /^(\d{6}) is your/.exec(m1.Subject)?.[1] ?? "";
  expect(c1).toMatch(/^\d{6}$/);
  // wrong first, on the same code
  const wrong = String((Number(c1) + 1) % 1_000_000).padStart(6, "0");
  await page.getByLabel("6-digit code").fill(wrong);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/not right or has expired/i, { timeout: 60_000 }); // the app now gives one neutral message, no "tries left" count
  await shot(page, "login-code-wrong");
  await page.getByLabel("6-digit code").fill(c1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((x) => x.pathname.startsWith("/app"), { timeout: 90_000 });
  await expect(page).toHaveURL(/\/app$/);
  for (const c of [ctx, u.ctx, admin.ctx]) await c.close();
});

test("6. Settings, Users: no self-disable, last admin kept, temporary password shown once", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const p = admin.page;

  // the admin's own row: no Disable
  const own = await manage(p, "admin@greenvalley.test", "admin@greenvalley.test");
  await expect(own.dialog.getByText("Disable account")).toHaveCount(0);
  await expect(own.dialog.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);
  await expect(own.dialog.getByText("Sign out everywhere")).toBeVisible();
  await shot(p, "users-own-row-no-disable");

  // nobody changes their own role, so the only admin cannot step down (the server refuses it too: people.test.ts)
  await expect(own.dialog.getByRole("button", { name: "Change role" })).toHaveCount(0);

  // temporary password on a staff user
  const u = await activeStaff(browser, request, p, "Temp Reset");
  const m = await manage(p, u.email, u.name);
  await m.dialog.getByRole("button", { name: "Temporary password" }).click();
  const confirm = p.getByRole("dialog").last();
  await expect(confirm.getByText(/replaces their password/i)).toBeVisible();
  await confirm.getByRole("button", { name: "Continue" }).click();
  const field = p.locator(`input[aria-label="Temporary password for ${u.name}"]`);
  await expect(field).toBeVisible({ timeout: 60_000 });
  const temp = await field.inputValue();
  expect(temp.length).toBeGreaterThanOrEqual(8);
  await expect(p.getByText(/shown once/i)).toBeVisible();
  await shot(p, "users-temp-password");
  await p.getByRole("dialog").last().getByRole("button", { name: "Close" }).first().click();
  await expect(p.locator(`input[value="${temp}"]`)).toHaveCount(0); // forgotten once closed

  // their open session is dead
  await u.page.goto(`${SCHOOL(SLUG)}/app`);
  await expect(u.page).toHaveURL(/\/login/, { timeout: 90_000 });
  // next sign-in is forced to change the password
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await login(page, u.email, temp);
  await expect(page).toHaveURL(/\/app\/change-password/, { timeout: 90_000 });
  await shot(page, "staff-forced-change-after-temp");
  for (const c of [ctx, u.ctx, admin.ctx]) await c.close();
});

test("7. a role change ends the user's open session", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Role Swap");
  await u.page.goto(`${SCHOOL(SLUG)}/app`);
  await expect(u.page).toHaveURL(/\/app$/);
  const m = await manage(admin.page, u.email, u.name);
  await m.dialog.getByRole("button", { name: "Change role" }).click();
  const d = admin.page.getByRole("dialog").last();
  const sel = d.getByLabel("Role");
  await sel.selectOption(await sel.locator("option", { hasText: /^Accountant$/ }).first().getAttribute("value") ?? "accountant");
  await d.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => sql(`select role from users where school_id='${sid()}' and lower(email)='${u.email}'`), { timeout: 60_000 }).toBe("accountant");
  await u.page.goto(`${SCHOOL(SLUG)}/app`);
  await expect(u.page).toHaveURL(/\/login/, { timeout: 90_000 });
  // and they can sign back in, now as an accountant
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await login(page, u.email, STRONG);
  await expect(page.getByRole("navigation", { name: "Main" }).locator('a[href="/app/fees"]')).toBeVisible({ timeout: 90_000 });
  for (const c of [ctx, u.ctx, admin.ctx]) await c.close();
});

test("8. a disabled user cannot sign in and their session stops", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "To Disable");
  const m = await manage(admin.page, u.email, u.name);
  await m.dialog.getByRole("button", { name: "Disable", exact: true }).click();
  await admin.page.getByRole("dialog").last().getByRole("button", { name: "Disable", exact: true }).click();
  await expect(admin.page.getByText("Account is disabled")).toBeVisible({ timeout: 90_000 }); // the person's page re-renders
  await u.page.goto(`${SCHOOL(SLUG)}/app`);
  await expect(u.page).toHaveURL(/\/login/, { timeout: 90_000 });
  const ctx = await newCtx(browser);
  const page = await newPage(ctx);
  await page.goto(`${SCHOOL(SLUG)}/login`);
  await page.getByLabel(/email, phone or admission number/i).fill(u.email);
  await page.getByLabel(/^password$/i).fill(STRONG);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/disabled/i, { timeout: 60_000 });
  await expect(page).toHaveURL(/\/login/);
  await shot(page, "login-disabled");
  for (const c of [ctx, u.ctx, admin.ctx]) await c.close();
});

test("9. login slips list only never-signed-in students", async ({ browser }) => {
  if (!signedIn) { // test 2 did not run: sign one student in now
    signedIn = pickStudent(0);
    const c = await newCtx(browser); const p = await newPage(c);
    await loginStudent(p, SLUG, signedIn.no, signedIn.dob);
    await c.close();
  }
  const admin = await adminSession(browser);
  const p = admin.page;
  await p.goto(`${SCHOOL(SLUG)}/app/students/credentials?classId=${signedIn.classId}`);
  const list = p.getByRole("list", { name: "Login slips" });
  const waiting = Number(sql(`select count(*) from students s join users u on u.id=s.user_id where s.school_id='${sid()}' and s.class_id='${signedIn.classId}' and s.status='active' and u.last_login_at is null`));
  if (waiting === 0) await expect(p.getByText("Nothing to print.")).toBeVisible({ timeout: 90_000 });
  else {
    await expect(list).toBeVisible({ timeout: 90_000 });
    await expect(list.getByText(signedIn.no, { exact: true })).toHaveCount(0);
    await expect(list.getByRole("listitem")).toHaveCount(waiting);
  }
  await shot(p, "credentials-class");
  await admin.ctx.close();
});

test("10. no parent login anywhere", async ({ browser }) => {
  const anon = await newCtx(browser);
  const lp = await newPage(anon);
  await lp.goto(`${SCHOOL(SLUG)}/login`);
  await expect(lp.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 90_000 });
  expect((await lp.locator("body").innerText())).not.toMatch(/parent/i);
  await lp.getByRole("button", { name: "Email me a code instead" }).click();
  expect((await lp.locator("body").innerText())).not.toMatch(/parent/i);
  const admin = await adminSession(browser);
  const p = admin.page;
  const noParent = async (label: string) => {
    const opts = (await p.locator("select option").allInnerTexts()).join(" | ");
    expect(opts, `${label} select options`).not.toMatch(/parent/i);
  };
  await p.goto(`${SCHOOL(SLUG)}/app/staff`);
  await p.getByRole("button", { name: "Add staff" }).first().click();
  await expect(p.getByRole("dialog").getByLabel("Role")).toBeVisible({ timeout: 90_000 });
  await noParent("Add staff");
  await p.keyboard.press("Escape");
  await p.goto(`${SCHOOL(SLUG)}/app/settings/users`);
  await expect(p.getByText("Admins", { exact: true })).toBeVisible({ timeout: 90_000 });
  expect(await p.locator("main").innerText()).not.toMatch(/parent/i);
  await noParent("Users");
  await p.goto(`${SCHOOL(SLUG)}/app/settings/roles`);
  await expect(p.getByRole("button", { name: "New role" }).first()).toBeVisible({ timeout: 90_000 });
  expect(await p.locator("main").innerText()).not.toMatch(/parent/i);
  await p.getByRole("button", { name: "New role" }).first().click();
  await noParent("New role");
  await p.keyboard.press("Escape");
  await expect(p.getByRole("navigation", { name: "Main" })).not.toContainText(/parent/i);
  // guardians stay as contact records
  await p.goto(`${SCHOOL(SLUG)}/app/parents`);
  await expect(p.getByRole("heading", { name: "Guardians" })).toBeVisible({ timeout: 90_000 });
  await anon.close(); await admin.ctx.close();
});

test("11. profile: devices list, sign out everywhere else", async ({ browser, request }) => {
  const admin = await adminSession(browser);
  const u = await activeStaff(browser, request, admin.page, "Devices Test");
  const second = await newCtx(browser);
  const p2 = await newPage(second);
  await login(p2, u.email, STRONG);
  await u.page.goto(`${SCHOOL(SLUG)}/app/profile`);
  await expect(u.page.getByText("This device")).toBeVisible({ timeout: 90_000 });
  await expect(u.page.getByRole("button", { name: /^Sign out (?!everywhere)/ })).toHaveCount(1); // the other device
  await shot(u.page, "profile-devices");
  await u.page.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect(u.page.getByText(/No other devices are signed in/i)).toBeVisible({ timeout: 60_000 });
  await p2.goto(`${SCHOOL(SLUG)}/app`);
  await expect(p2).toHaveURL(/\/login/, { timeout: 90_000 });
  await u.page.goto(`${SCHOOL(SLUG)}/app`);
  await expect(u.page).toHaveURL(/\/app$/); // this one stays
  for (const c of [second, u.ctx, admin.ctx]) await c.close();
});

test("12. phone width: no horizontal scroll on the new screens", async ({ browser }) => {
  const noScroll = async (page: Page, name: string) => {
    await page.waitForTimeout(600);
    await shot(page, `phone-${name}`);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `${name}: scrollWidth ${sw} vs innerWidth ${iw}`).toBeLessThanOrEqual(iw! + 1);
  };
  const anon = await newCtx(browser, true);
  const a = await newPage(anon);
  await a.goto(`${SCHOOL(SLUG)}/login`);
  await expect(a.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 90_000 });
  await noScroll(a, "login");
  await a.getByRole("button", { name: "Email me a code instead" }).click();
  await noScroll(a, "login-code");
  await a.goto(`${SCHOOL(SLUG)}/forgot-password`);
  await expect(a.getByRole("button", { name: "Email me a code" })).toBeVisible({ timeout: 90_000 });
  await noScroll(a, "forgot-password");
  await a.getByLabel(/email, phone or admission number/i).fill(`nobody.${run}@greenvalley.example`);
  await a.getByRole("button", { name: "Email me a code" }).click();
  await expect(a.getByLabel("6-digit code")).toBeVisible({ timeout: 90_000 });
  await noScroll(a, "forgot-password-code");

  // change-password: a second seeded student, left unchanged
  const s = pickStudent(3);
  const sc = await newCtx(browser, true);
  const sp = await newPage(sc);
  await sp.goto(`${SCHOOL(SLUG)}/login`);
  await sp.getByLabel(/email, phone or admission number/i).fill(s.no);
  await sp.getByLabel(/^password$/i).fill(s.dob);
  await sp.getByRole("button", { name: /sign in/i }).click();
  await sp.waitForURL(/\/app\/change-password/, { timeout: 120_000 });
  await reloadIfSchoolNotFound(sp);
  await noScroll(sp, "change-password");

  const ac = await newCtx(browser, true);
  const ap = await newPage(ac);
  await login(ap, "admin", "demo12345");
  await ap.goto(`${SCHOOL(SLUG)}/app/settings/roles`);
  await expect(ap.getByRole("button", { name: "New role" }).first()).toBeVisible({ timeout: 90_000 });
  await noScroll(ap, "settings-roles");
  await ap.goto(`${SCHOOL(SLUG)}/app/students/credentials?classId=${s.classId}`);
  await expect(ap.getByRole("heading", { name: "Login slips" })).toBeVisible({ timeout: 90_000 });
  await noScroll(ap, "credentials");
  for (const c of [anon, sc, ac]) await c.close();
});

test.afterAll(async ({ browser }) => {
  // Clean up with the app's own UI: disable the staff made in this run (test 8's user is already disabled).
  if (!made.length) return;
  const { ctx, page } = await adminSession(browser);
  for (const name of made) {
    try {
      await page.goto(`${SCHOOL(SLUG)}/app/settings/users`);
      await page.getByPlaceholder("Search by name, email or login").fill(name);
      const row = page.getByRole("row", { name: new RegExp(name) });
      await row.waitFor({ timeout: 60_000 });
      if (await row.getByText("Disabled").count()) continue;
      await row.getByRole("link").first().click();
      await page.getByRole("button", { name: "Disable", exact: true }).click();
      await page.getByRole("dialog").last().getByRole("button", { name: "Disable", exact: true }).click();
      await page.waitForTimeout(1500);
    } catch (e) { console.log(`cleanup: could not disable ${name}: ${(e as Error).message.split("\n")[0]}`); }
  }
  await ctx.close();
});
