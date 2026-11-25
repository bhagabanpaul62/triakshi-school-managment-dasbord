import { expect, test, type Page } from "@playwright/test";
import { at, dialog, job, mails, People, says, SLUG, sql } from "./comm-lib";
import { SCHOOL } from "./helpers";

// K1 to K6 of docs/WEBSITE-ADMIN-PRD.md section 16, done the way people do them. Every name carries `run`, so a second run (or another agent) never meets our rows.
const run = Date.now().toString(36).slice(-5);
const SITE = SCHOOL(SLUG);
const sid = () => sql(`select id from schools where slug = '${SLUG}'`);
const phone = (n: number) => `9${String(Date.now()).slice(-6)}${String(n).padStart(3, "0")}`.slice(0, 10);
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);
test.use({ actionTimeout: 30_000, navigationTimeout: 120_000 });

// Whatever happens in K5, the school's website is never left offline.
test.afterAll(() => { sql(`update school_sites set offline_at = null where school_id = '${sid()}'`); });

let people: People;
test.beforeAll(({ browser }) => { people = new People(browser, []); });
test.afterAll(async () => { await people.close(); });

const STRONG = `Quill-Harbor-${run}7`;
let ipN = 0;
/** A fresh browser context with its own forwarded address, so the per-address sign-in limits never meet. */
const fakeIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${(++ipN % 250) + 1}`;
const ctxFor = (browser: Browser, width = 1440, height = 900) => browser.newContext({ viewport: { width, height }, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });

/** The admin makes a role with exactly these grants, through the roles screen. */
async function makeRole(admin: Page, name: string, grants: string[]) {
  await admin.goto(at("settings/roles"));
  await admin.getByRole("button", { name: "New role" }).first().click();
  const d = dialog(admin);
  await d.getByLabel(/role name/i).fill(name);
  for (const g of grants) await d.locator(`input[name="g.${g.split(":")[0]}"][value="${g}"]`).check();
  await d.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("row", { name: new RegExp(name) })).toBeVisible({ timeout: 90_000 });
}
/** The admin adds a staff member in that role and gets the access link; the person opens it, sets a password and is signed in. */
async function makeStaff(browser: Browser, admin: Page, name: string, role: string): Promise<Page> {
  await admin.goto(at("staff"));
  await admin.getByRole("button", { name: "Add staff" }).first().click();
  const d = dialog(admin);
  const sel = d.getByLabel("Role");
  await sel.selectOption(await sel.locator("option", { hasText: role }).first().getAttribute("value") as string);
  await d.getByLabel(/full name/i).fill(name);
  await d.getByRole("button", { name: "Add and get link" }).click();
  const input = admin.locator('input[aria-label="Access link"]');
  await expect(input).toBeVisible({ timeout: 90_000 });
  const link = await input.inputValue();
  await admin.getByRole("button", { name: "Done" }).click();
  const page = await (await ctxFor(browser)).newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Set up your account" })).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("New password").fill(STRONG);
  await page.getByLabel("Type it again").fill(STRONG);
  await page.getByRole("button", { name: /set password and sign in/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 90_000 });
  return page;
}
const noAccess = (p: Page, path: string) => p.goto(at(path)).then(() => expect(p.getByText(/cannot open the website|handled by the office|only the office admin|are for the office|for the office admin/i).first()).toBeVisible({ timeout: 60_000 }));

/** A family asks for a seat on the public form, on a phone, as a person does. */
async function apply(browser: Browser, o: { child: string; parent: string; tel: string; email?: string; url?: string; klass?: string }) {
  const ctx = await ctxFor(browser, 375, 812); // every family has its own address: the public form limits what one address may send
  const v = await ctx.newPage();
  await v.goto(`${SITE}${o.url ?? "/admissions"}`);
  await v.getByLabel(/child's name/i).fill(o.child);
  await v.getByLabel(/parent or guardian/i).fill(o.parent);
  await v.getByLabel(/mobile number/i).fill(o.tel);
  if (o.klass) await v.getByLabel(/class applying for/i).selectOption({ label: o.klass });
  if (o.email) { await v.getByText(/more details/i).click(); await v.getByLabel(/^email/i).fill(o.email); }
  await v.getByRole("checkbox").check();
  await v.waitForTimeout(2000); // the time trap: a person takes longer than 1.5 s
  await v.getByRole("button", { name: /send enquiry/i }).click();
  await expect(v.getByRole("status").filter({ hasText: /we have your enquiry/i })).toBeVisible({ timeout: 30_000 });
  const text = await v.locator("main").innerText();
  await ctx.close();
  return text;
}
const enq = (child: string) => sql(`select id || '|' || ref || '|' || status from enquiries where school_id = '${sid()}' and student_name = '${child}' order by created_at limit 1`).split("|") as [string, string, string];

const ROLE_EDIT = `Site editor ${run}`, ROLE_DESK = `Enquiry desk ${run}`;
let editor: Page, desk: Page;

test("setup: two custom roles, one holds only website:manage, the other only website:enquiries", async ({ browser }) => {
  const admin = await people.as("admin");
  await makeRole(admin, ROLE_EDIT, ["website:manage"]);
  await makeRole(admin, ROLE_DESK, ["website:enquiries"]);
  editor = await makeStaff(browser, admin, `Edi Tor ${run}`, ROLE_EDIT);
  desk = await makeStaff(browser, admin, `Desk Clerk ${run}`, ROLE_DESK);
});

test("K1 visitor on a phone sends an enquiry; the office is told; the mail has the reference", async ({ browser }) => {
  const child = `Kid${run}`, parent = `Parent${run}`, email = `k1.${run}@family.example`, tel = phone(1);
  const ctx = await ctxFor(browser, 375, 812);
  const v = await ctx.newPage();
  await v.goto(SITE);
  await v.getByRole("link", { name: /apply for admission|admissions/i }).first().click();
  await expect(v).toHaveURL(/\/admissions/);
  expect(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await v.getByLabel(/child's name/i).fill(child);
  await v.getByLabel(/parent or guardian/i).fill(parent);
  await v.getByLabel(/mobile number/i).fill(tel);
  await v.getByText(/more details/i).click();
  await v.getByLabel(/^email/i).fill(email);
  // consent is required: without it the form says so and sends nothing
  await v.getByRole("button", { name: /send enquiry/i }).click();
  await says(v, /tick the box/i);
  await v.getByRole("checkbox").check();
  await v.waitForTimeout(2000); // the form's time trap: a person takes longer than 1.5 s to fill it
  await v.getByRole("button", { name: /send enquiry/i }).click();
  const ok = v.getByRole("status").filter({ hasText: /we have your enquiry/i });
  await expect(ok).toBeVisible({ timeout: 30_000 });
  // no reference number on screen
  expect(await v.locator("body").innerText()).not.toMatch(/E-\d{4}-\d+/);
  await ctx.close();

  const row = sql(`select id || '|' || ref || '|' || source || '|' || status from enquiries where school_id = '${sid()}' and student_name = '${child}'`).split("|");
  expect(row[2]).toBe("website"); expect(row[3]).toBe("new");
  const ref = row[1]!;
  expect(ref).toMatch(/^E-\d{4}-\d{4,}$/);

  // the office is told: a notification row for the admin, and it shows in the bell
  const admin = await people.as("admin");
  const told = () => sql(`select string_agg(distinct u.role::text, ',') from notifications n join users u on u.id = n.user_id where n.topic = 'enquiry.new' and n.subject_id = '${row[0]}'`);
  await expect.poll(told, { timeout: 60_000 }).toContain("admin");
  expect(await told()).toContain("accountant"); // both holders of website:enquiries
  await admin.goto(at(""));
  await admin.getByRole("button", { name: /^notifications/i }).first().click();
  await says(admin, /new admission enquiry/i);
  await admin.keyboard.press("Escape");

  // the same family writing again sees the same words and no new row (a stranger cannot learn which enquiries exist)
  const again = await apply(browser, { child, parent, tel, email });
  expect(again).toMatch(/we have your enquiry/i);
  expect(again).not.toMatch(/E-\d{4}-\d+|already|again/i);
  expect(sql(`select count(*) from enquiries where school_id = '${sid()}' and student_name = '${child}'`), "no second row").toBe("1");

  // the mail to the family carries the reference
  await expect.poll(async () => (await mails(email)).length, { timeout: 90_000 }).toBeGreaterThan(0);
  const m = (await mails(email))[0]!;
  const body = (await (await fetch(`http://localhost:8025/api/v1/message/${m.ID}`)).json()).Text as string;
  expect(body).toContain(ref);
});

test("permissions: a role with only website:manage edits but cannot publish or see enquiries; a role with only website:enquiries is the reverse", async () => {
  const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
  // --- manage only
  await editor.goto(at("website"));
  await expect(nav(editor).locator('a[href="/app/website"]')).toBeVisible({ timeout: 90_000 });
  await expect(nav(editor).locator('a[href="/app/enquiries"]')).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^publish/i })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^schedule$/i })).toHaveCount(0);
  for (const p of ["website/edit", "website/pages", "website/media", "website/disclosure", "website/versions", "website/insights", "website/settings", "theme"]) {
    const r = await editor.goto(at(p));
    expect(r?.status(), p).toBeLessThan(400);
    await expect(editor.getByText(/cannot open the website/i), p).toHaveCount(0);
    await expect(editor.locator("main").first(), p).toBeVisible();
  }
  await editor.goto(at("website/edit"));
  await expect(editor.getByRole("button", { name: /add section/i })).toBeVisible({ timeout: 60_000 }); // may edit
  await editor.goto(at("website/settings"));
  await says(editor, /only people who may publish can take it offline/i);
  await expect(editor.getByRole("button", { name: /^take offline$/i })).toHaveCount(0);
  for (const p of ["enquiries", "enquiries/reports", "enquiries/settings", "enquiries/import"]) await noAccess(editor, p);

  // --- enquiries only
  await desk.goto(at("enquiries"));
  await expect(nav(desk).locator('a[href="/app/enquiries"]')).toBeVisible({ timeout: 90_000 });
  await expect(nav(desk).locator('a[href="/app/website"]')).toHaveCount(0);
  await expect(desk.getByRole("heading", { name: /admission enquiries/i })).toBeVisible();
  await desk.goto(at("enquiries/reports"));
  await expect(desk.getByRole("heading", { name: /report/i }).first()).toBeVisible({ timeout: 60_000 });
  for (const p of ["enquiries/settings", "enquiries/import", "website", "website/edit", "website/pages", "website/media", "website/disclosure", "website/versions", "website/insights", "website/settings"]) await noAccess(desk, p);
  const csv = await desk.request.get(`${SITE}/api/enquiries/csv`);
  expect(csv.status(), "the enquiry spreadsheet needs website:pipeline").toBeGreaterThanOrEqual(401);
});

const istAt = (days: number, hhmm: string) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10) + "T" + hhmm;
/** Submit the open dialog. */
const save = (p: Page, name: RegExp | string = "Save") => dialog(p).getByRole("button", { name }).click();

/** The stage really changed (database), then the page is opened fresh so the next button is the one for that stage. */
async function stageIs(p: Page, id: string, status: string) {
  await expect.poll(() => sql(`select status from enquiries where id = '${id}'`), { timeout: 60_000 }).toBe(status);
  await p.goto(at(`enquiries/${id}`));
}

const K2 = { a: `Aadya${run}`, d1: `Dev${run}`, d2: `Diya${run}`, c: `Chirag${run}` };
const phoneA = phone(2), phoneD = phone(3), phoneC = phone(4), emailA = `k2.${run}@family.example`, REASON = "Too far away";

test("K2 front office: Today, call, visit, offer; admin admits; duplicate joined; another closed with a reason; report agrees with the lists", async ({ browser }) => {
  await apply(browser, { child: K2.a, parent: `PA${run}`, tel: phoneA, email: emailA, klass: "Nursery" });
  await apply(browser, { child: K2.d1, parent: `PD${run}`, tel: phoneD });
  await apply(browser, { child: K2.d2, parent: `PD${run}`, tel: phoneD });
  await apply(browser, { child: K2.c, parent: `PC${run}`, tel: phoneC });
  const [aId, aRef] = enq(K2.a);

  // --- the desk clerk (website:enquiries only) works it
  await desk.goto(at("enquiries?who=all"));
  const fresh = desk.getByRole("listitem").filter({ hasText: K2.a });
  await expect(fresh).toBeVisible({ timeout: 60_000 });
  await fresh.getByRole("button", { name: "Log call" }).click();
  await dialog(desk).getByLabel(/how did the call go/i).selectOption({ label: "Talked" });
  await dialog(desk).getByLabel(/what was said/i).fill("Wants a visit this week");
  await save(desk);
  await stageIs(desk, aId, "contacted");
  await expect(desk.getByText(/Talked: Wants a visit/)).toBeVisible({ timeout: 30_000 });
  await desk.getByRole("button", { name: "Book visit" }).click();
  await dialog(desk).getByLabel(/visit time/i).fill(istAt(1, "11:00"));
  await save(desk);
  await stageIs(desk, aId, "visit");
  // the family is mailed the invitation with a calendar file
  await expect.poll(async () => (await mails(emailA)).map((m) => m.Subject).join("|"), { timeout: 90_000 }).toMatch(/visit/i);
  await desk.getByRole("button", { name: "Record visit" }).click();
  await dialog(desk).getByLabel(/how it went/i).fill("Liked the classrooms");
  await save(desk);
  await stageIs(desk, aId, "visited");
  await desk.getByRole("button", { name: "Mark applied" }).click();
  await stageIs(desk, aId, "applied");
  await desk.getByRole("button", { name: "Make offer" }).click();
  await stageIs(desk, aId, "offered");
  // the clerk cannot join, delete or give away enquiries, and cannot admit: only a role that may add students can
  await expect(desk.getByRole("button", { name: /^join$/i })).toHaveCount(0);
  await desk.goto(at(`enquiries/${aId}/admit`));
  await says(desk, /your role cannot admit students/i);

  // --- admin admits
  const admin = await people.as("admin");
  await admin.goto(at(`enquiries/${aId}`));
  await admin.getByRole("link", { name: "Admit", exact: true }).click();
  await expect(admin).toHaveURL(/\/admit$/);
  await admin.getByRole("button", { name: "Admit student" }).click();
  await expect(admin).toHaveURL(new RegExp(`/app/enquiries/${aId}$`), { timeout: 90_000 });
  await says(admin, /admitted as/i);
  await expect(admin.getByText("Admitted").first()).toBeVisible();
  const stu = sql(`select s.id || '|' || s.admission_no from students s join enquiries e on e.converted_student_id = s.id where e.id = '${aId}'`).split("|");
  expect(stu[0], "the enquiry is linked to a student").toBeTruthy();
  await admin.getByRole("link", { name: /open the student/i }).first().click();
  await expect(admin).toHaveURL(new RegExp(`/app/students/${stu[0]}`));
  await says(admin, new RegExp(`came from enquiry ${aRef}`, "i"));

  // --- the duplicate: same phone twice, joined by the admin
  const [d1Id, d1Ref] = enq(K2.d1); const [d2Id] = enq(K2.d2);
  await admin.goto(at(`enquiries/${d1Id}`));
  await says(admin, new RegExp(`Another enquiry from this phone|${K2.d2}`));
  await admin.getByRole("button", { name: "Join", exact: true }).click();
  await dialog(admin).getByRole("button", { name: /join them/i }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await says(admin, /joined|saved/i);
  await admin.goto(at(`enquiries/${d2Id}`));
  await says(admin, new RegExp(`joined to ${d1Ref}`));

  // --- another one closed with a reason
  const [cId] = enq(K2.c);
  await admin.goto(at(`enquiries/${cId}`));
  await admin.getByRole("button", { name: /more/i }).first().click();
  await admin.getByText(/move to a stage/i).first().click();
  await dialog(admin).getByLabel(/^stage/i).selectOption({ label: "Closed" });
  await dialog(admin).getByLabel(/why/i).selectOption({ label: REASON });
  await save(admin);
  await stageIs(admin, cId, "closed");
  expect(sql(`select close_reason from enquiries where id = '${cId}'`)).toBe(REASON);

  // --- the report agrees with the lists: every number is a link, and the list behind it has that many rows
  await admin.goto(at("enquiries/reports"));
  const main = admin.locator("main").first();
  await expect(main.getByText("Why they were lost")).toBeVisible({ timeout: 60_000 });
  const links = await main.locator("a[href^='/app/enquiries?']").evaluateAll((as) => as.map((a) => ({ n: (a.textContent ?? "").trim(), href: a.getAttribute("href")! })).filter((x) => /^\d+$/.test(x.n)));
  expect(links.length, "the report has numbers to follow").toBeGreaterThan(8);
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.href)) continue;
    seen.add(l.href);
    await admin.goto(`${SITE}${l.href}`);
    const total = l.n === "0" ? 0 : Number(((await admin.getByText(/^[\d,]+ total$/).first().innerText({ timeout: 30_000 })).replace(/\D/g, "")));
    expect(total, `the list behind ${l.href} has ${l.n} rows`).toBe(Number(l.n));
  }
  await admin.goto(at("enquiries/reports"));
  const lost = main.getByRole("row", { name: new RegExp(`^${REASON}\\b`) });
  expect(Number((await lost.innerText()).replace(/\D/g, "")), "lost for this reason, as in the database").toBe(Number(sql(`select count(*) from enquiries where school_id = '${sid()}' and status = 'closed' and close_reason = '${REASON}'`)));
});

// ---------- website journeys ----------

const SLUG_A = `fees-${run}`, SLUG_B = `fees-${run}-new`, TITLE = `Fees ${run}`;
const section = (p: Page, text: string) => p.getByRole("listitem").filter({ hasText: text }).first();
const get = (p: Page, path: string) => p.request.get(`${SITE}${path}`, { maxRedirects: 0 });
const versions = () => Number(sql(`select coalesce(max(number), 0) from site_versions where school_id = '${sid()}'`));
const adminName = () => sql(`select name from users where school_id = '${sid()}' and email = 'admin@greenvalley.test'`);

/** Overview, Publish (or Publish changes), accept any warning, confirm. Waits until a new version exists. */
async function publish(p: Page, note: string) {
  const before = versions();
  await p.goto(at("website"));
  await p.getByRole("button", { name: /^publish( changes)?$/i }).click();
  const d = dialog(p);
  await d.getByLabel(/note for the version list/i).fill(note);
  const ok = d.getByLabel(/i have seen this/i);
  if (await ok.count()) await ok.check();
  await d.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(versions, { timeout: 30_000 }).toBeGreaterThan(before);
}
async function openSection(p: Page, slug: string, text: string) {
  await p.goto(at(`website/edit?page=${slug}`));
  const li = section(p, text);
  await expect(li).toBeVisible({ timeout: 60_000 });
  await li.getByRole("button", { expanded: false }).first().click();
  return li;
}

test("K3 website: add a page, editor asks to publish, admin publishes, reorder and hide, rename address (redirect), restore the old version, publish", async () => {
  const admin = await people.as("admin");
  // admin adds a page from a template
  await admin.goto(at("website/pages"));
  await admin.getByRole("button", { name: "Add page" }).first().click();
  const d = dialog(admin);
  await d.getByLabel(/start from/i).selectOption({ label: (await d.getByLabel(/start from/i).locator("option", { hasText: /^About us/ }).first().innerText()) });
  await d.getByLabel(/page title/i).fill(TITLE);
  await d.getByLabel(/web address/i).fill(SLUG_A);
  await save(admin, "Add page");
  await expect(admin.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 });

  // the editor (manage, no publish) changes a section and asks to publish
  const li = await openSection(editor, SLUG_A, "Our story");
  await li.locator("input").first().fill(`Story ${run}`);
  await li.getByRole("button", { name: "Save", exact: true }).click();
  await says(editor, /saved to the draft/i);
  await editor.goto(at("website"));
  await editor.getByRole("button", { name: "Ask to publish" }).click();
  await dialog(editor).getByLabel(/note for them/i).fill(`New fees page ${run}`);
  await dialog(editor).getByRole("button", { name: "Send request" }).click();
  await expect(editor.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await says(editor, /you asked for this to be published/i);
  await expect(editor.getByRole("button", { name: "Take back my request" })).toBeVisible();

  // the publisher is told in the bell, and on the overview
  const told = sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@greenvalley.test' and n.topic = 'work.approval' and n.created_at > now() - interval '10 minutes'`);
  expect(Number(told)).toBeGreaterThan(0);
  const title = sql(`select n.title from notifications n join users u on u.id = n.user_id where u.email = 'admin@greenvalley.test' and n.topic = 'work.approval' order by n.created_at desc limit 1`);
  await admin.goto(at(""));
  await admin.getByRole("button", { name: /^notifications/i }).first().click();
  await says(admin, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await admin.keyboard.press("Escape");
  await admin.goto(at("website"));
  await says(admin, new RegExp(`Edi Tor ${run} asked you to publish.*New fees page ${run}`));
  const v0 = versions();
  await publish(admin, `Fees page ${run}`);
  await expect.poll(async () => (await get(admin, `/${SLUG_A}`)).status(), { timeout: 30_000 }).toBe(200);
  expect(await (await get(admin, `/${SLUG_A}`)).text()).toContain(`Story ${run}`);
  const vA = versions();
  expect(vA).toBeGreaterThan(v0);
  expect(sql(`select name from site_versions where school_id = '${sid()}' and number = ${vA}`)).toBe(`Fees page ${run}`);
  expect(sql(`select asked_at is null from school_sites where school_id = '${sid()}'`), "the request is cleared by the publish").toBe("t");

  // reorder: "Our story" below "What we stand for"; hide the principal's section
  await admin.goto(at(`website/edit?page=${SLUG_A}`));
  const story = section(admin, `Story ${run}`);
  await expect(story).toBeVisible({ timeout: 60_000 });
  await story.getByRole("button", { name: "Move down" }).click();
  const at2 = async (t: string) => (await admin.getByRole("listitem").allInnerTexts()).findIndex((x) => x.includes(t));
  await expect.poll(async () => (await at2("What we stand for")) < (await at2(`Story ${run}`)), { timeout: 30_000 }).toBe(true);
  await section(admin, "From the principal's desk").getByRole("button", { name: /^More for/ }).click();
  await admin.getByRole("menuitem", { name: "Hide from the site" }).click();
  await expect(section(admin, "From the principal's desk").getByText("Hidden")).toBeVisible({ timeout: 30_000 });

  // rename the address; the old one must lead to the new
  await admin.goto(at("website/pages"));
  await admin.getByRole("button", { name: `More for ${TITLE}` }).first().click();
  await admin.getByRole("menu").getByText("Change address", { exact: true }).click();
  await dialog(admin).getByLabel(/new web address/i).fill(SLUG_B);
  await save(admin, "Change address");
  await expect(admin.getByText(`/${SLUG_B}`).first()).toBeVisible({ timeout: 30_000 });
  await publish(admin, `Renamed ${run}`);
  const vB = versions();
  // a visitor with the old address (an old link, a bookmark) lands on the new page
  const visitor = await (await ctxFor(await admin.context().browser()!)).newPage();
  await visitor.goto(`${SITE}/${SLUG_A}`);
  await expect(visitor).toHaveURL(new RegExp(`/${SLUG_B}$`), { timeout: 30_000 });
  await expect(visitor.getByText(`Story ${run}`).first()).toBeVisible();
  await visitor.context().close();
  const html = await (await get(admin, `/${SLUG_B}`)).text();
  expect(html).toContain(`Story ${run}`);
  expect(html.indexOf("What we stand for"), "reordered: features first, then the story").toBeLessThan(html.indexOf(`Story ${run}`));
  expect(html).not.toContain("From the principal");

  // versions: restore the old one as draft (the current draft is saved first), then publish
  await admin.goto(at("website/versions"));
  const card = admin.getByRole("listitem").filter({ hasText: new RegExp(`Version ${vA}\\b`) }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  const n0 = versions();
  await card.getByRole("button", { name: /bring back as draft/i }).click();
  await dialog(admin).getByRole("button", { name: "Bring back", exact: true }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect(admin.getByText(/draft saved before a restore/i).first()).toBeVisible({ timeout: 30_000 });
  expect(versions()).toBeGreaterThan(n0);
  await publish(admin, `Back to ${vA} ${run}`);
  expect(versions()).toBeGreaterThan(vB);
  await expect.poll(async () => (await get(admin, `/${SLUG_A}`)).status(), { timeout: 30_000, message: "after the restore the old address is a live page again" }).toBe(200);
  expect(await (await get(admin, `/${SLUG_A}`)).text()).toContain("From the principal");
});

test("K4 two editors on one section: the second save is refused with the first one's name", async () => {
  const admin = await people.as("admin");
  const name = adminName();
  const a = await openSection(admin, SLUG_A, `Story ${run}`);
  const b = await openSection(editor, SLUG_A, `Story ${run}`);
  await a.locator("input").first().fill(`Admin ${run}`);
  await a.getByRole("button", { name: "Save", exact: true }).click();
  await says(admin, /saved to the draft/i);
  await b.locator("input").first().fill(`Editor ${run}`);
  await b.getByRole("button", { name: "Save", exact: true }).click();
  const alert = editor.getByRole("alert").filter({ hasText: /after you opened it/i });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(name);
  expect(sql(`select draft::text like '%Admin ${run}%' and draft::text not like '%Editor ${run}%' from school_sites where school_id = '${sid()}'`), "nothing was overwritten").toBe("t");
  // keep mine: now the editor's words are the draft
  await alert.getByRole("button", { name: "Keep mine" }).click();
  await expect.poll(() => sql(`select draft::text like '%Editor ${run}%' from school_sites where school_id = '${sid()}'`), { timeout: 30_000 }).toBe("t");
  // the admin's copy is now old: saving is refused with the editor's name, and "Take theirs" shows the editor's words
  const a2 = admin.getByRole("listitem").filter({ has: admin.getByRole("button", { name: "Save", exact: true }) }).first(); // the open section, whatever its heading says now
  await a2.locator("input").first().fill(`Admin again ${run}`);
  await a2.getByRole("button", { name: "Save", exact: true }).click();
  const alert2 = admin.getByRole("alert").filter({ hasText: /after you opened it/i });
  await expect(alert2).toContainText(`Edi Tor ${run}`, { timeout: 30_000 });
  await alert2.getByRole("button", { name: "Take theirs" }).click();
  await expect(a2.locator("input").first()).toHaveValue(`Editor ${run}`, { timeout: 30_000 });
});

test("K5 schedule a publish; the clock makes it live; later edits wait; cancel; offline and back", async () => {
  const admin = await people.as("admin");
  const li = await openSection(admin, SLUG_A, `Editor ${run}`);
  await li.locator("input").first().fill(`Scheduled ${run}`);
  await li.getByRole("button", { name: "Save", exact: true }).click();
  await says(admin, /saved to the draft/i);
  await admin.goto(at("website"));
  await admin.getByRole("button", { name: "Schedule", exact: true }).click();
  await dialog(admin).getByLabel(/go live at/i).fill(new Date(Date.now() + 330 * 60_000 + 10 * 60_000).toISOString().slice(0, 16));
  await dialog(admin).getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect(admin.getByRole("button", { name: "Cancel schedule" })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select scheduled_for is not null from school_sites where school_id = '${sid()}'`)).toBe("t");
  // an edit after scheduling waits for the next publish
  const li2 = await openSection(admin, SLUG_A, `Scheduled ${run}`);
  await li2.locator("input").first().fill(`Later ${run}`);
  await li2.getByRole("button", { name: "Save", exact: true }).click();
  await says(admin, /saved to the draft/i);
  // time travel: the chosen time arrives
  const before = versions();
  sql(`update school_sites set scheduled_for = now() - interval '1 minute' where school_id = '${sid()}'`);
  job("website.publish-due");
  expect(versions()).toBe(before + 1);
  expect(sql(`select kind from site_versions where school_id = '${sid()}' and number = ${versions()}`)).toBe("schedule");
  const html = await (await get(admin, `/${SLUG_A}`)).text();
  expect(html).toContain(`Scheduled ${run}`);
  expect(html, "the edit made after scheduling is not live").not.toContain(`Later ${run}`);
  await admin.goto(at("website"));
  await expect(admin.getByRole("button", { name: /^publish changes$/i })).toBeEnabled({ timeout: 30_000 }); // "Later" still waits
  // schedule again and cancel
  await admin.getByRole("button", { name: "Schedule", exact: true }).click();
  await dialog(admin).getByLabel(/go live at/i).fill(new Date(Date.now() + 330 * 60_000 + 30 * 60_000).toISOString().slice(0, 16));
  await dialog(admin).getByRole("button", { name: "Schedule", exact: true }).click();
  await admin.getByRole("button", { name: "Cancel schedule" }).click();
  await expect(admin.getByRole("button", { name: "Cancel schedule" })).toHaveCount(0, { timeout: 30_000 });
  expect(sql(`select scheduled_for is null from school_sites where school_id = '${sid()}'`)).toBe("t");

  // offline and back (typed confirmation)
  await admin.goto(at("website/settings"));
  await admin.getByRole("button", { name: "Take offline", exact: true }).click();
  const go = dialog(admin).getByRole("button", { name: "Take offline", exact: true });
  await expect(go).toBeDisabled();
  await dialog(admin).getByLabel(/type offline/i).fill("OFFLINE");
  await go.click();
  await says(admin, /the website is offline/i);
  // (the status code of the updating page is part of the K3b APP BUG: it is 200 as the page streams)
  await expect.poll(async () => await (await get(admin, "/")).text(), { timeout: 30_000 }).toMatch(/being updated/i);
  await expect.poll(async () => await (await get(admin, `/${SLUG_A}`)).text(), { timeout: 30_000 }).toMatch(/being updated/i);
  await admin.getByRole("button", { name: "Bring the website back" }).click();
  await expect.poll(async () => await (await get(admin, "/")).text(), { timeout: 30_000 }).not.toMatch(/being updated/i);
  expect(await (await get(admin, `/${SLUG_A}`)).text()).toContain(`Scheduled ${run}`);
});

test("K6 disclosure: fill, upload, put on the site, publish, the public page shows it; expiry warning", async () => {
  const admin = await people.as("admin");
  const FILL = `${run} square metres`;
  await admin.goto(at("website/disclosure"));
  await admin.getByRole("listitem").filter({ hasText: "Campus area (square metres)" }).getByRole("button", { name: /fill in|change/i }).click();
  await dialog(admin).getByLabel("Answer").fill(FILL);
  await save(admin);
  await expect(admin.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  // a fire safety certificate that runs out in 12 days
  const row = admin.getByRole("listitem").filter({ hasText: "Fire safety certificate" });
  await row.getByRole("button", { name: /fill in|change/i }).click();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  await dialog(admin).getByLabel("PDF file").setInputFiles({ name: `fire-${run}.pdf`, mimeType: "application/pdf", buffer: pdf });
  const days = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  await dialog(admin).getByLabel("Valid until").fill(days(12));
  await save(admin);
  await expect(admin.getByRole("dialog")).toHaveCount(0, { timeout: 60_000 });
  await expect(admin.getByRole("listitem").filter({ hasText: "Fire safety certificate" }).getByText(/expires in 1[12] days/i)).toBeVisible({ timeout: 30_000 });
  // the clock warns the people who manage the website
  job("website.document-expiry");
  expect(Number(sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@greenvalley.test' and n.subject_id = 'fire_safety:soon' and n.created_at > now() - interval '10 minutes'`))).toBeGreaterThan(0);
  // put on the site, publish, read as a visitor
  await admin.getByRole("button", { name: /put on the site|update the page on the site/i }).click();
  await expect(admin.getByText(/visitors can see the page at|in your draft at/i).first()).toBeVisible({ timeout: 30_000 });
  const slug = ((await admin.getByText(/(in your draft at|can see the page at) \//i).first().innerText()).match(/at \/([\w-]+)/) ?? [])[1];
  expect(slug, "the page address").toBeTruthy();
  await publish(admin, `Disclosure ${run}`);
  await expect.poll(async () => (await get(admin, `/${slug}`)).status(), { timeout: 30_000 }).toBe(200);
  const page = await (await get(admin, `/${slug}`)).text();
  expect(page).toContain(FILL);
  expect(page).toContain("Fire safety certificate");
  expect(await (await get(admin, "/")).text(), "a footer link to it").toContain(`/${slug}`);
  // it runs out: the clock says so again
  await admin.goto(at("website/disclosure"));
  await admin.getByRole("listitem").filter({ hasText: "Fire safety certificate" }).getByRole("button", { name: "Change" }).click();
  await dialog(admin).getByLabel("Valid until").fill(days(-2));
  await save(admin);
  await expect(admin.getByRole("listitem").filter({ hasText: "Fire safety certificate" }).getByText("Expired")).toBeVisible({ timeout: 30_000 });
  job("website.document-expiry");
  expect(Number(sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@greenvalley.test' and n.subject_id = 'fire_safety:expired'`))).toBeGreaterThan(0);
});

test("K3b a moved address answers 308 and an unknown one 404", async () => {
  const admin = await people.as("admin");
  // K3 restores its renamed page, so its old address is live again: this one moved for good (the row a rename writes).
  const old = `/moved-${String(run).toLowerCase()}`;
  sql(`insert into site_redirects (id, school_id, from_path, to_path, automatic) values (gen_random_uuid(), '${sid()}', '${old}', '/admissions', true)`);
  const r = await get(admin, old);
  expect(r.status()).toBe(308);
  expect(r.headers().location).toMatch(/\/admissions$/);
  expect((await get(admin, `/no-such-page-${run}`)).status()).toBe(404);
});
