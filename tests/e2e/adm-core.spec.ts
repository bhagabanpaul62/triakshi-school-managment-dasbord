import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { at, dialog, main, People, sql, SLUG, says, job } from "./comm-lib";
import AxeBuilder from "@axe-core/playwright";
import { CONSOLE, consoleLogin, login, SCHOOL, STUDENT_PASSWORD } from "./helpers";
import { crawl } from "./crawl-lib";

// Admissions wave 0 on the production build, one worker, every step done by clicking what is on screen.
// sql() only makes time pass (a joining day, a last day) or reads a number; never to skip a step a person takes.
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.use({ trace: "off", actionTimeout: 30_000, navigationTimeout: 60_000 });

const SHOTS = process.env.ADM_SHOTS ?? "test-results/adm-core";
let people: People;
test.beforeAll(async ({ browser }) => { people = new People(browser); await fetch(`${SCHOOL(SLUG)}/login`).catch(() => {}); });
test.afterAll(() => people.close());

// ---------- small helpers ----------

/** Wait for skeletons to go: real content, not the loading frame. */
export async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !document.querySelector("main [aria-busy=true], main .animate-pulse"), undefined, { timeout: 30_000 });
  await page.waitForTimeout(120);
}
const go = async (page: Page, path: string) => { await page.goto(at(path), { waitUntil: "domcontentloaded" }); await settle(page); };
const shot = async (page: Page, name: string) => { await page.waitForTimeout(1200); /* numbers count up */ await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

/** A click before React hydrates does nothing: click again until the dialog is open. */
async function openDialog(page: Page, button: Locator) {
  await expect(async () => {
    if (!(await dialog(page).isVisible().catch(() => false))) await button.click({ timeout: 4_000 });
    await expect(dialog(page)).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  return dialog(page);
}
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();

const rand = (n: number) => Array.from({ length: n }, () => "bcdfghjklmnprstvz"[Math.floor(Math.random() * 17)]).join("");
const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => ymd(new Date(Date.now() + 330 * 60_000 + n * 86_400_000));
/** A birth date that makes the child `years` old today, and a few days more. */
const bornYearsAgo = (years: number) => { const t = plusDays(0); return `${Number(t.slice(0, 4)) - years}-${t.slice(5)}`.replace(/-02-29$/, "-02-28"); };

/** One run's names: letters only, so the same-child check never meets last run's child. */
const STATE = "/tmp/adm-core-state.json";
const resumed = process.env.ADM_RESUME ? JSON.parse(readFileSync(STATE, "utf8")) as { run: typeof run0; S: Record<string, string> } : null;
const run0 = { tag: rand(5), next: { name: "2027-28", start: "2027-04-01" }, sectionName: rand(2).toUpperCase() };
const run = resumed ? { ...resumed.run, tag: rand(5), sectionName: rand(2).toUpperCase() } : run0; // a resumed run makes new names, so a half-done journey never meets its own children
const kid = (label: string) => `${label} ${run.tag}`;
/** Ids and numbers handed from one journey to the next. Kept in a file only so a journey can be re-run alone while writing (ADM_RESUME=1). */
const S: Record<string, string> = new Proxy(resumed?.S ?? {}, { set: (o, k: string, v: string) => { o[k] = v; writeFileSync(STATE, JSON.stringify({ run, S: o })); return true; } });

/** The toast or a field error that says `text`. */
const sees = (page: Page, text: RegExp | string) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });

// ---------- shared steps ----------
/** A number on a stat card: the cards count up, so read until two reads agree. */
const stat = async (page: Page, label: string) => {
  const read = async () => Number(new RegExp(`${label}\\s+(\\d+)`).exec(await main(page).innerText())?.[1] ?? NaN);
  let last = await read();
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(400); const n = await read(); if (n === last) return n; last = n; }
  return last;
};
const activeCount = (page: Page) => stat(page, "Active students");

/** Next year exists with sections, made from the screens: the students page link, Roll forward, back. */
async function nextYearReady(admin: Page) {
  await go(admin, "students");
  const notice = main(admin).getByText(/no next academic year|no sections yet/i).first();
  if (!(await notice.isVisible().catch(() => false))) return;
  S.notice = await notice.innerText();
  await main(admin).getByRole("link", { name: /add next year|set up classes and sections/i }).click();
  await admin.waitForURL(/\/app\/academics\/(years|classes)/);
  await settle(admin);
  const roll = btn(admin, /^roll forward to/i);
  await roll.waitFor();
  S.rollName = (await roll.innerText()).replace(/^roll forward to\s*/i, "").trim();
  const d = await openDialog(admin, roll);
  await d.getByRole("button", { name: /^roll forward$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await go(admin, "students");
  await expect(main(admin).getByText(/no next academic year|no sections yet/i)).toHaveCount(0);
}

/** Fill the admit form (the dialog is open). */
async function fillChild(d: Locator, o: { name: string; dob?: string; gender?: string; cls?: string; joinsOn?: string; year?: RegExp; planned?: RegExp; g1?: [string, string]; g2?: [string, string] }) {
  await d.getByLabel("Full name").fill(o.name);
  if (o.dob) await d.getByLabel("Date of birth").fill(o.dob);
  if (o.gender) await d.getByLabel("Gender").selectOption({ label: o.gender });
  if (o.cls) await d.getByLabel("Class", { exact: true }).selectOption({ label: o.cls });
  if (o.joinsOn) await d.getByLabel("Joining day").fill(o.joinsOn);
  if (o.year) await d.getByLabel("Academic year").selectOption({ label: String((await d.getByLabel("Academic year").locator("option").allInnerTexts()).find((t) => o.year!.test(t))) });
  if (o.planned) await d.getByLabel("Planned section").selectOption({ label: String((await d.getByLabel("Planned section").locator("option").allInnerTexts()).find((t) => o.planned!.test(t))) });
  if (o.g1) { await d.getByLabel("Guardian name", { exact: true }).fill(o.g1[0]); await d.getByLabel("Guardian phone", { exact: true }).fill(o.g1[1]); }
  if (o.g2) { await d.getByLabel("Second guardian name", { exact: true }).fill(o.g2[0]); await d.getByLabel("Second guardian phone", { exact: true }).fill(o.g2[1]); }
}
const openAdmit = (page: Page) => openDialog(page, btn(page, /^admit student$/i));
const search = async (page: Page, q: string) => { await go(page, `students?q=${encodeURIComponent(q)}`); };
const openRecord = async (page: Page, name: string) => { await search(page, name); await main(page).getByRole("link", { name: new RegExp(name) }).first().click(); await page.waitForURL(/\/app\/students\/[0-9a-f-]{36}/); await settle(page); S.url = page.url(); };
const idOf = (url: string) => /students\/([0-9a-f-]{36})/.exec(url)![1]!;

// ---------- W1 ----------
test("W1 admit a child for next April with a planned section", async () => {
  const admin = await people.as("admin");
  await nextYearReady(admin);
  const before = await activeCount(admin);
  // The year after the current one: the page names it on the Roll forward button.
  await go(admin, "academics/years");
  const years = await main(admin).innerText();
  const cur = /(\d{4})-\d{2}\s+\S*\s*Current|Current/.exec(years);
  expect(cur).toBeTruthy();
  const first = Math.min(...[...years.matchAll(/\b(20\d{2})-\d{2}\b/g)].map((m) => Number(m[1])));
  run.next = { name: `${first + 1}-${String(first + 2).slice(2)}`, start: `${first + 1}-04-01` };
  S.joiner = kid("Joiner");
  S.dob = bornYearsAgo(8);
  S.phone1 = phone(); S.phone2 = phone();
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name: S.joiner, dob: S.dob, gender: "Girl", cls: "Class 3", joinsOn: run.next.start, year: new RegExp(run.next.name), planned: new RegExp(`^3-A \\(${run.next.name}\\)`), g1: ["Rina Joiner", S.phone1], g2: ["Amit Joiner", S.phone2] });
  await shot(admin, "w1-form");
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });

  // The list: Joining, with the date, and not in the active count.
  await search(admin, S.joiner);
  const row = main(admin).getByRole("row").filter({ hasText: S.joiner }).first();
  await expect(row).toContainText(/joining/i);
  await expect(row).toContainText(/Apr/);
  await shot(admin, "w1-row");
  await go(admin, "students");
  expect(await activeCount(admin)).toBe(before);
  expect(await stat(admin, "Joining later")).toBeGreaterThan(0);
  await openRecord(admin, S.joiner);
  S.id = idOf(S.url!);
  await expect(main(admin).getByText(/^Joining$/).first()).toBeVisible();
  await shot(admin, "w1-record");
  await expect(main(admin).getByText("Planned section 3-A")).toBeVisible();
  await expect(main(admin).getByText("Class 3", { exact: true }).first()).toBeVisible();
  await expect(main(admin).getByRole("tab", { name: /Guardians/ })).toContainText("2");
  await expect(main(admin).getByText("Guardians", { exact: true }).first().locator("xpath=following::*[1]")).toHaveText(/^2/);
});

test("W1b a child joining this year, and where a joining child must not appear", async () => {
  const admin = await people.as("admin");
  S.soon = kid("Soon");
  S.soonDob = bornYearsAgo(8);
  S.soonPhone = phone();
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name: S.soon, dob: S.soonDob, gender: "Boy", cls: "Class 3", joinsOn: plusDays(20), planned: new RegExp(`^3-A \\((?!${run.next.name})`), g1: ["Mina Soon", S.soonPhone] });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await openRecord(admin, S.soon);
  S.soonId = idOf(S.url!);
  await expect(main(admin).getByText(/^Joining$/).first()).toBeVisible();

  // The class page counts the child apart: "N + 1 joining".
  await go(admin, "academics/classes");
  await main(admin).getByRole("link", { name: "Class 3", exact: true }).click();
  await admin.waitForURL(/academics\/classes\/[0-9a-f-]{36}/);
  await settle(admin);
  await expect(main(admin).getByText(/\d+ \+ \d+ joining/).first()).toBeVisible();
  await shot(admin, "w1-class3");

  // Not in the register of the section.
  await go(admin, "attendance");
  await admin.getByLabel("Section").selectOption({ label: "Class 3-A" });
  await admin.waitForURL(/sectionId=/);
  await settle(admin);
  await expect(main(admin).getByText(/Roll \d+/).first()).toBeVisible();
  await shot(admin, "w1-attendance");
  expect(await main(admin).innerText()).not.toContain(S.soon);

  // Not in a notice's audience: the people search finds an active child and not this one.
  await go(admin, "announcements/new");
  await btn(admin, /^choose people$/i).click();
  const find = admin.getByLabel(/Add classes, sections/);
  await find.fill("Aarav");
  await expect(admin.getByRole("listbox", { name: "Matches" }).getByRole("option").first()).toBeVisible({ timeout: 15_000 });
  await find.fill(S.soon);
  await expect(admin.getByText("No matches")).toBeVisible({ timeout: 15_000 });
  await shot(admin, "w1-audience");

  // Not offered for a bus seat.
  await go(admin, "transport");
  await main(admin).locator("a[href*='/app/transport/routes/']").nth(2).click(); // the third route has free seats
  await admin.waitForURL(/transport\/routes\//);
  await settle(admin);
  const pick = await openDialog(admin, btn(admin, /^add student$/i));
  await pick.getByRole("textbox").first().fill(S.soon);
  await admin.waitForTimeout(2000);
  await expect(pick.getByText(S.soon)).toHaveCount(0);
  await shot(admin, "w1-transport");
  await admin.keyboard.press("Escape");

  // Not offered for a library loan.
  await go(admin, "library");
  const member = admin.getByPlaceholder(/search name or admission number/i);
  await member.fill("Aarav");
  await expect(main(admin).getByText(/Aarav/).first()).toBeVisible({ timeout: 15_000 });
  await member.fill(S.soon);
  await admin.waitForTimeout(2000);
  await expect(main(admin).getByText(S.soon)).toHaveCount(0);
  await shot(admin, "w1-library");
});

// ---------- W2 ----------
/** A published fee plan for Class 3 in the joining year, made on the screens: the accountant copies this year's plan and sends it, the admin approves. */
async function planForNextYear(accounts: Page, admin: Page) {
  await go(accounts, "fees/plans");
  await accounts.getByLabel("Year").selectOption({ label: run.next.name });
  await accounts.getByRole("button", { name: "Show" }).click();
  await accounts.waitForURL(/yearId=/);
  await settle(accounts);
  const published = accounts.getByRole("region", { name: "Published" });
  if (await published.getByText(/Class 3/).count()) return;
  if (!(await accounts.getByRole("region", { name: /Waiting for approval/ }).getByText(/Class 3/).count()) && !(await accounts.getByRole("region", { name: "Drafts" }).getByText(/Class 3/).count())) {
    await go(accounts, "fees/plans");
    await accounts.getByRole("link", { name: /Class 3 fees/ }).first().click();
    await accounts.waitForURL(/\/app\/fees\/plans\/[0-9a-f-]{36}/);
    await settle(accounts);
    const d = await openDialog(accounts, btn(accounts, /^copy to a year$/i));
    await d.getByLabel("Into year").selectOption({ label: run.next.name });
    await d.getByLabel("Name").fill(`Class 3 fees ${run.next.name}`);
    await d.getByRole("button", { name: /^copy$/i }).click();
    await accounts.waitForURL(/\/edit$/, { timeout: 60_000 });
    await settle(accounts);
    await shot(accounts, "w2-plan-edit");
    await btn(accounts, /save and send for approval/i).click();
    await accounts.waitForURL(/\/app\/fees\/plans\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await settle(accounts);
    await sees(accounts, /waiting for .* to approve/i);
  }
  await go(admin, "finance/approvals");
  await shot(admin, "w2-approvals");
  const card = main(admin).getByText(new RegExp(`Class 3 fees ${run.next.name}`)).first();
  await card.waitFor();
  await btn(admin, /^approve/i).click();
  const d2 = admin.getByRole("dialog");
  if (await d2.isVisible().catch(() => false)) await d2.getByRole("button", { name: /^approve/i }).last().click();
  await expect(main(admin).getByText(new RegExp(`Class 3 fees ${run.next.name}`))).toHaveCount(0, { timeout: 30_000 });
}

test("W2 the accountant bills the joining year, takes money and prints", async () => {
  const accounts = await people.as("accounts"), admin = await people.as("admin");
  await planForNextYear(accounts, admin);
  const overdue = async () => { await go(accounts, "fees/dues"); return /Overdue\s+(₹[\d,]+)/.exec(await main(accounts).innerText())?.[1]; };
  const before = await overdue();
  expect(before).toBeTruthy();
  // Bill the joining year for Class 3.
  await go(accounts, "fees/invoices/issue");
  await accounts.getByLabel("Year").selectOption({ label: run.next.name });
  await accounts.getByText("Class 3", { exact: true }).click();
  await btn(accounts, /^preview$/i).click();
  const issue = btn(accounts, /^issue \d+ bills$/i);
  if (await issue.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) {
    await btn(accounts, /^show all \d+ bills$/i).click().catch(() => {});
    await expect(main(accounts).getByRole("link", { name: S.joiner }).first()).toBeVisible();
    await issue.click();
    await sees(accounts, /issued|bills were made|made \d+ bills/i);
  }
  // At the desk: found, marked as joining, one bill paid.
  await go(accounts, "fees/collect");
  await accounts.getByPlaceholder(/name, admission no/i).fill(S.joiner);
  const hit = accounts.getByRole("button", { name: new RegExp(S.joiner) }).or(accounts.getByRole("option", { name: new RegExp(S.joiner) })).first();
  await hit.waitFor({ timeout: 20_000 });
  await expect(hit).toContainText(/joining/i);
  await shot(accounts, "w2-desk-found");
  await hit.click();
  await accounts.waitForTimeout(1500);
  await shot(accounts, "w2-desk-bills");
  await accounts.getByText(/INV\/.*\/\d+/).first().locator("xpath=ancestor::*[self::label or self::li or self::div][.//input[@type='checkbox']][1]").locator("input[type=checkbox]").first().check();
  await accounts.getByLabel(/^cash/i).first().fill("1800").catch(async () => { await accounts.locator("input[inputmode], input[type=number]").nth(1).fill("1800"); });
  await shot(accounts, "w2-desk-ready");
  await btn(accounts, /^collect/i).click();
  await sees(accounts, /receipt made/i);
  await shot(accounts, "w2-desk-after");
  // Print: the receipt opens as a PDF in a new tab, with this child's name on it.
  // (a headless browser has no PDF viewer: catch the address the button opens and read it as the browser would)
  await accounts.evaluate(() => { (window as unknown as { opened: string[] }).opened = []; window.open = ((u: string) => { (window as unknown as { opened: string[] }).opened.push(String(u)); return null; }) as typeof window.open; });
  await btn(accounts, /print receipt/i).click();
  const opened = await accounts.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened[0]).toMatch(/^\/app\/fees\/receipts\/[0-9a-f-]{36}\/pdf$/);
  const pdf = await accounts.request.get(at(opened[0]!.slice(5)));
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  // The family's page: bills of the joining year, 1 paid, and this year's overdue is what it was.
  await go(accounts, `fees/students/${S.id}`);
  await expect(main(accounts).getByText(/joining/i).first()).toBeVisible();
  await shot(accounts, "w2-student-fees");
  expect(await overdue()).toBe(before);
});

// ---------- W3 ----------
/** A family at the sign-in page on a phone, in a context of its own. */
async function familyAt(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  return page;
}
async function tryLogin(page: Page, who: string, password: string) {
  await page.goto(at("").replace("/app/", "/login"));
  await page.getByLabel(/email, phone or admission number/i).fill(who);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/** A family signs in on a phone. The first password is the date of birth; the forced change sets STUDENT_PASSWORD. Pass `fresh` when the child has never signed in. */
async function signInFamily(page: Page, no: string, dobPw: string, fresh = false) {
  for (const pw of fresh ? [dobPw, STUDENT_PASSWORD] : [STUDENT_PASSWORD, dobPw]) {
    await tryLogin(page, no, pw);
    const wrong = page.getByText(/incorrect|invalid|not right|did not match|wrong/i).first();
    const where = await Promise.race([page.waitForURL(/\/app/, { timeout: 40_000 }).then(() => "in"), wrong.waitFor({ timeout: 40_000 }).then(() => "no")]).catch(() => "no");
    if (where === "no") continue;
    if (page.url().includes("change-password")) {
      await page.waitForLoadState("load");
      if (await page.getByRole("heading", { name: "School not found" }).count()) await page.goto(page.url());
      await page.locator('input[name="current"]').fill(pw);
      await page.locator('input[name="next"]').fill(STUDENT_PASSWORD);
      await page.locator('input[name="confirm"]').fill(STUDENT_PASSWORD);
      await page.getByRole("button", { name: /save and continue/i }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/app") && !u.pathname.includes("change-password"), { timeout: 60_000 });
    }
    return;
  }
  throw new Error(`could not sign in as ${no}`);
}
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace("Sept", "Sep");
const admissionNoOf = async (page: Page) => /\bGR\d{4,}\b/.exec(await main(page).innerText())![0];

test("W3 a joining login is refused with the start date; change the day; start now", async ({ browser }) => {
  const admin = await people.as("admin");
  await go(admin, `students/${S.soonId}`);
  S.soonNo = await admissionNoOf(admin);
  const dobPw = ddmm(S.soonDob);
  const fam = await familyAt(browser);
  const day1 = (await main(admin).getByText(/^Joins /).first().innerText().catch(() => "")) || "";
  // Wrong password: the usual words, no hint about the child.
  await tryLogin(fam, S.soonNo, "WrongPass-123");
  await sees(fam, /incorrect|invalid|not right|did not match|wrong/i);
  await expect(fam.getByText(/starts on/i)).toHaveCount(0);
  const usual = (await fam.getByText(/incorrect|invalid|not right|did not match|wrong/i).first().innerText()).trim();
  await shot(fam, "w3-wrong");
  // Right password: the start date, in words.
  await tryLogin(fam, S.soonNo, dobPw);
  await sees(fam, /This login starts on \d{1,2} \w{3,4} \d{4}\./);
  expect(await fam.getByText(/This login starts on/).first().innerText()).toContain(longDate(plusDays(20)));
  expect(usual).not.toMatch(/starts on/);
  await shot(fam, "w3-starts");

  // Change the joining day, on one dialog.
  const d = await openDialog(admin, btn(admin, /^change the joining day$/i));
  await shot(admin, "w3-day-dialog");
  const newDay = plusDays(25);
  await d.getByLabel("Joining day").fill(newDay);
  await d.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(admin, `students/${S.soonId}`);
  await expect(main(admin).getByText(new RegExp(`Joins ${Number(newDay.slice(8))} `)).first()).toBeVisible();
  await tryLogin(fam, S.soonNo, dobPw);
  await sees(fam, new RegExp(`starts on ${Number(newDay.slice(8))} `));

  // Start now.
  const start = await openDialog(admin, btn(admin, /^start now$/i));
  await shot(admin, "w3-start-dialog");
  await start.getByRole("button", { name: /^start now$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(admin, `students/${S.soonId}`);
  await expect(main(admin).getByText(/^Active$/).first()).toBeVisible();
  await shot(admin, "w3-active");
  // In the register of their section, with a roll number.
  await go(admin, "attendance");
  await admin.getByLabel("Section").selectOption({ label: "Class 3-A" });
  await admin.waitForURL(/sectionId=/);
  await settle(admin);
  await expect(main(admin).getByText(S.soon)).toBeVisible();
  // The family signs in (forced new password) and sees the home.
  const fam2 = await familyAt(browser);
  await signInFamily(fam2, S.soonNo, dobPw, true);
  await expect(fam2).toHaveURL(/\/app/);
  await shot(fam2, "w3-family-home");
  await fam2.context().close();
  await fam.context().close();
  void day1;
  // The class teacher of 3-A has a notice that the child joined.
  await go(admin, "academics/classes");
  await main(admin).getByRole("link", { name: "Class 3", exact: true }).click();
  await admin.waitForURL(/academics\/classes\/[0-9a-f-]{36}/);
  await settle(admin);
  const teacher = await admin.getByLabel("Class teacher of section A").evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text ?? "");
  expect(teacher, "3-A has a class teacher").not.toMatch(/^$|pick class teacher/i);
  const tctx = await browser.newContext();
  const tp = await tctx.newPage();
  await login(tp, SLUG, `${teacher.trim().toLowerCase().replace(/\s+/g, ".")}@greenvalley.example`);
  await tp.goto(at("notifications"), { waitUntil: "domcontentloaded" });
  await settle(tp);
  await sees(tp, new RegExp(`${S.soon} joined your class`));
  await shot(tp, "w3-teacher-notice");
  await tctx.close();
});

// ---------- W4 ----------
const todayIst = () => plusDays(0);
/** Admit a child who starts later in this year (a joining day a few days ahead), optionally with a planned section. */
async function admitJoiningSoon(admin: Page, name: string, withSection: boolean) {
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name, dob: bornYearsAgo(8), cls: "Class 3", joinsOn: plusDays(3), ...(withSection ? { planned: new RegExp(`^3-A \\((?!${run.next.name})`) } : {}), g1: [`Parent ${name}`, phone()] });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await openRecord(admin, name);
  return idOf(S.url!);
}

test("W4 the nightly job: a child with a section starts; one without waits and the admins hear once", async () => {
  const admin = await people.as("admin");
  S.c = kid("Cora"); S.dd = kid("Dina");
  S.cId = await admitJoiningSoon(admin, S.c, true);
  S.dId = await admitJoiningSoon(admin, S.dd, false);
  // The days pass: their joining day is today.
  sql(`update students set joins_on = '${todayIst()}' where id in ('${S.cId}', '${S.dId}')`);
  const bell = async () => { await go(admin, "notifications"); return (await main(admin).innerText()).split(`${S.dd} cannot start yet`).length - 1; };
  job("students.join-due");
  job("students.join-due");
  await go(admin, `students/${S.cId}`);
  await expect(main(admin).getByText(/^Active$/).first()).toBeVisible();
  await go(admin, `students/${S.dId}`);
  await expect(main(admin).getByText(/^Joining$/).first()).toBeVisible();
  // The record says why, on the page.
  await expect(main(admin).getByText(/no planned section/i).first()).toBeVisible();
  await shot(admin, "w4-waits");
  // Told once, though the job ran twice.
  expect(await bell()).toBe(1);
  job("students.join-due");
  expect(await bell()).toBe(1);
  // One click to the fix: "Choose a section first" opens the dialog; with a section chosen the next run starts them.
  await go(admin, `students/${S.dId}`);
  const dlg = await openDialog(admin, btn(admin, /^choose a section first$/i));
  await dlg.getByLabel("Planned section").selectOption({ label: String((await dlg.getByLabel("Planned section").locator("option").allInnerTexts()).find((t) => new RegExp(`^3-A \\((?!${run.next.name})`).test(t))) });
  await dlg.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  job("students.join-due");
  await go(admin, `students/${S.dId}`);
  await expect(main(admin).getByText(/^Active$/).first()).toBeVisible();
});

// ---------- W5 ----------
test("W5 withdraw before joining: the reason, the record, not chased, the number is not reused", async () => {
  const admin = await people.as("admin"), accounts = await people.as("accounts");
  // E is the last child admitted, then withdraws; F, admitted after, must get a number after E's.
  S.e = kid("Esha");
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name: S.e, dob: bornYearsAgo(8), cls: "Class 3", joinsOn: run.next.start, planned: new RegExp(`^3-A \\(${run.next.name}\\)`), g1: [`Parent ${S.e}`, phone()] });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await openRecord(admin, S.e);
  S.eId = idOf(S.url!);
  S.eNo = await admissionNoOf(admin);
  const w = await openDialog(admin, btn(admin, /^withdraw before joining$/i));
  await shot(admin, "w5-dialog");
  await w.getByLabel(/why they are not coming/i).fill("Family moved abroad");
  await w.getByRole("button", { name: /^withdraw$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(admin, `students/${idOf(S.url!)}`);
  await expect(main(admin).getByText(/^Left$/).first()).toBeVisible();
  await expect(main(admin).getByText(/withdrew before joining/i).first()).toBeVisible();
  await shot(admin, "w5-record");

  // A, who has bills and paid one, withdraws too: still owed money stays visible to the accountant but is not chased.
  await go(admin, `students/${S.id}`);
  const wa = await openDialog(admin, btn(admin, /^withdraw before joining$/i));
  await expect(wa.getByText(/bill/i).first()).toBeVisible();
  await shot(admin, "w5-dialog-bills");
  await wa.getByLabel(/why they are not coming/i).fill("Took a seat in another school");
  await wa.getByRole("button", { name: /^withdraw$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(accounts, `fees/students/${S.id}`);
  await expect(main(accounts).getByText(/withdrew before joining/i).first()).toBeVisible();
  await shot(accounts, "w5-fees");
  // Dues: shown as a child who is not joining, and the reminder run skips them.
  await go(accounts, `fees/dues?q=${encodeURIComponent(S.joiner)}`);
  await shot(accounts, "w5-dues");
  await expect(main(accounts).getByText(/not joining|withdrew|left/i).first()).toBeVisible();

  // The number of E is not given to the next child.
  S.f = kid("Fiona");
  await go(admin, "students");
  const d2 = await openAdmit(admin);
  await fillChild(d2, { name: S.f, dob: bornYearsAgo(8), g1: [`Parent ${S.f}`, phone()] });
  await d2.getByLabel("Class and section").selectOption({ label: "3-A" });
  await d2.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await openRecord(admin, S.f);
  S.fId = idOf(S.url!);
  S.fNo = await admissionNoOf(admin);
  expect(Number(S.fNo.replace(/\D/g, ""))).toBeGreaterThan(Number(S.eNo.replace(/\D/g, "")));
});

// ---------- W6 ----------
/** The admit dialog is open and refused: still open, and nothing typed is gone. */
async function expectKept(d: Locator, o: { name?: string; dob?: string; g1?: string }) {
  await expect(d).toBeVisible();
  if (o.name) await expect(d.getByLabel("Full name")).toHaveValue(o.name);
  if (o.dob) await expect(d.getByLabel("Date of birth")).toHaveValue(o.dob);
  if (o.g1) await expect(d.getByLabel("Guardian phone", { exact: true })).toHaveValue(o.g1);
}

test("W6 duplicates, ages and guardians on the admission form", async () => {
  const admin = await people.as("admin");
  const dob = bornYearsAgo(9), ph = phone();
  // The same child, written with other capitals and a double space, is refused with a link to the record.
  await go(admin, "students");
  let d = await openAdmit(admin);
  const again = S.f.toUpperCase().replace(" ", "  ");
  // F was admitted with an age of 8; use F's own birth date for the repeat.
  const fDob = bornYearsAgo(8);
  await fillChild(d, { name: again, dob: fDob, g1: ["Someone Else", ph] });
  await d.getByLabel("Class and section").selectOption({ label: "3-A" });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(d.getByText(new RegExp(`${S.f}.*${S.fNo}|${S.fNo}.*${S.f}`, "i")).first()).toBeVisible({ timeout: 20_000 });
  await shot(admin, "w6-duplicate");
  const open = d.getByRole("link", { name: /open their record/i });
  await expect(open).toHaveAttribute("href", `/app/students/${S.fId}`);
  await expectKept(d, { name: again, dob: fDob, g1: ph });
  // Ticking the box: a different child with the same name and birth date.
  await d.getByLabel(/different child with the same name/i).check();
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await search(admin, S.f.split(" ").pop()!);
  expect(await main(admin).getByRole("row").filter({ hasText: /Fiona/i }).count()).toBeGreaterThanOrEqual(2);

  // A newborn in the top class: refused, and what was typed stays.
  await go(admin, "students");
  d = await openAdmit(admin);
  const newborn = plusDays(-30), nm = kid("Baby");
  await fillChild(d, { name: nm, dob: newborn, g1: ["Parent Baby", phone()] });
  await d.getByLabel("Class and section").selectOption({ label: "10-A" });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(d.getByText(/years? old|age|too young|between 2 and 25/i).first()).toBeVisible({ timeout: 20_000 });
  await shot(admin, "w6-newborn");
  await expectKept(d, { name: nm, dob: newborn });
  // A birth date in the future: refused too.
  const future = plusDays(400);
  await d.getByLabel("Date of birth").fill(future);
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(d.getByText(/future/i).first()).toBeVisible({ timeout: 20_000 });
  await expectKept(d, { name: nm, dob: future });
  // A child who is a little young for the class is warned on the form, and the office decides.
  await d.getByLabel("Date of birth").fill(bornYearsAgo(7));
  await expect(d.getByRole("status").filter({ hasText: /usually for ages/i })).toBeVisible();
  await shot(admin, "w6-class-warning");
  await d.getByLabel("Date of birth").fill(bornYearsAgo(15));
  await expect(d.getByText(/usually for ages/i)).toHaveCount(0);
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });

  // Two guardians with one phone: one guardian, linked once.
  await go(admin, "students");
  d = await openAdmit(admin);
  const g = kid("Gita"), same = phone();
  await fillChild(d, { name: g, dob: bornYearsAgo(8), g1: ["Mother Gita", same], g2: ["Father Gita", same] });
  await d.getByLabel("Class and section").selectOption({ label: "3-A" });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
  await openRecord(admin, g);
  await expect(main(admin).getByRole("tab", { name: /Guardians/ })).toContainText("1");
});

// ---------- W7 ----------
test("W7 from an enquiry: admit for next year, the enquiry says admitted, the same child is refused again", async () => {
  const admin = await people.as("admin");
  await go(admin, "enquiries?who=all&view=list");
  const hrefs = await main(admin).locator("a[href]").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!).filter((h) => /^\/app\/enquiries\/[0-9a-f-]{36}$/.test(h)))]);
  expect(hrefs.length).toBeGreaterThan(0);
  let admitHref = "";
  for (const h of hrefs) {
    await admin.goto(at(h.slice(5)), { waitUntil: "domcontentloaded" });
    await settle(admin);
    const offer = admin.getByRole("button", { name: /^make offer$/i });
    if (await offer.isVisible().catch(() => false)) { await offer.click(); await expect(main(admin).getByRole("link", { name: /^admit$/i })).toBeVisible({ timeout: 30_000 }); }
    const link = main(admin).getByRole("link", { name: /^admit$/i });
    if (await link.isVisible().catch(() => false)) { admitHref = h; S.enqId = h.split("/").pop()!; break; }
  }
  expect(admitHref, "an enquiry that can be admitted").not.toBe("");
  S.enqName = (await main(admin).getByRole("heading").first().innerText()).trim();
  await main(admin).getByRole("link", { name: /^admit$/i }).click();
  await admin.waitForURL(/\/admit$/);
  await settle(admin);
  await shot(admin, "w7-admit-page");
  S.enqName = (await admin.getByLabel("Full name").inputValue()).trim();
  S.enqDob = await admin.getByLabel("Date of birth").inputValue();
  // For next year: no section this year, the class and the planned section of next year.
  await admin.getByLabel("Class and section").selectOption({ label: "None" });
  await admin.getByLabel("Class", { exact: true }).selectOption({ label: "Class 3" });
  await admin.getByLabel("Joining day").fill(run.next.start);
  await admin.getByLabel("Planned section").selectOption({ label: `3-A (${run.next.name})` });
  if (!S.enqDob) await admin.getByLabel("Date of birth").fill(bornYearsAgo(8));
  await btn(admin, /^admit student$/i).click();
  await admin.waitForURL(new RegExp(`/app/enquiries/${S.enqId}$`), { timeout: 60_000 });
  await settle(admin);
  await expect(main(admin).getByText(/admitted/i).first()).toBeVisible();
  const stuLink = main(admin).getByRole("link", { name: S.enqName }).first();
  await expect(stuLink).toBeVisible();
  await shot(admin, "w7-enquiry-admitted");
  await stuLink.click();
  await admin.waitForURL(/\/app\/students\/[0-9a-f-]{36}/);
  await settle(admin);
  await expect(main(admin).getByText(/^Joining$/).first()).toBeVisible();
  S.enqStuId = idOf(admin.url());
  await expect(main(admin).getByText(/Came from enquiry/i)).toBeVisible();
  // The same child again: the admit page says they are in, and the student form refuses the same name and birth date.
  await admin.goto(at(`enquiries/${S.enqId}/admit`), { waitUntil: "domcontentloaded" });
  await settle(admin);
  await expect(main(admin).getByText(/already admitted/i)).toBeVisible();
  await go(admin, "students");
  const d = await openAdmit(admin);
  const dobNow = S.enqDob || bornYearsAgo(8);
  await fillChild(d, { name: S.enqName, dob: dobNow, cls: "Class 3", joinsOn: run.next.start, planned: new RegExp(`^3-A \\(${run.next.name}\\)`), g1: ["Someone", phone()] });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(d.getByRole("link", { name: /open their record/i })).toBeVisible({ timeout: 20_000 });
  await admin.keyboard.press("Escape");
});

// ---------- W8 ----------
test("W8 import: the template has the new columns; the check shows a duplicate and a joining row; commit", async () => {
  const admin = await people.as("admin");
  await go(admin, "students/import");
  await shot(admin, "w8-page");
  const [dl] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: /download template/i }).click()]);
  const header = (await readFile((await dl.path())!, "utf8")).split(/\r?\n/)[0]!.replace(/^﻿/, "").split(",");
  for (const col of ["pen", "joins_on", "joins_year", "guardian2_name", "guardian2_phone", "allow_duplicate"]) expect(header).toContain(col);
  const joiner = kid("Imrana"), plain = kid("Imran"), dupDob = bornYearsAgo(8);
  const csv = (allow: string) => [
    "name,dob,gender,class,section,guardian_name,guardian_phone,joins_on,joins_year,allow_duplicate",
    `${joiner},${bornYearsAgo(8)},female,Class 3,A,Parent ${joiner},${phone()},${run.next.start},${run.next.name},`,
    `${plain},${bornYearsAgo(8)},male,Class 3,A,Parent ${plain},${phone()},,,`,
    `${S.f},${dupDob},female,Class 3,A,Parent Dup,${phone()},,,${allow}`,
  ].join("\n");
  const upload = async (body: string) => {
    await admin.locator("input[type=file]").setInputFiles({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(body) });
    await btn(admin, /^check file$/i).click();
  };
  await upload(csv(""));
  await sees(admin, /with problems/i);
  await expect(main(admin).getByText(/already has this name/i).first()).toBeVisible();
  await expect(main(admin).getByText(/starts? later/i).first()).toBeVisible();
  await expect(main(admin).getByText(new RegExp(`${joiner}.*joins`)).first()).toBeVisible();
  await expect(btn(admin, /^import \d+ students$/i)).toBeDisabled();
  await shot(admin, "w8-check");
  // Fixed file (the office says the duplicate is a different child): checks clean, and commits.
  await admin.reload(); await settle(admin);
  await upload(csv("yes"));
  await sees(admin, /every row looks good/i);
  await btn(admin, /^import 3 students$/i).click();
  await sees(admin, /3 students were admitted/i);
  await shot(admin, "w8-done");
  await search(admin, joiner);
  await expect(main(admin).getByRole("row").filter({ hasText: joiner })).toContainText(/joining/i);
});

// ---------- W9 ----------
/** Open the dialog "Mark as left" for a child and fill it. Returns the dialog, still open. */
async function leaving(admin: Page, id: string, lastDay: string) {
  await go(admin, `students/${id}`);
  const d = await openDialog(admin, btn(admin, /^mark as left$/i));
  await d.getByLabel("Last day at school").fill(lastDay);
  await d.getByLabel("Reason").selectOption({ label: "Changed school" });
  return d;
}

test("W9 mark as left on a past day: the effects are true; the family has the limited home; the sign-in ends after the days", async ({ browser }) => {
  const admin = await people.as("admin");
  const lastDay = plusDays(-2);
  const d = await leaving(admin, S.soonId, lastDay);
  // The dialog says until when the family can sign in, and what is still open.
  const until = plusDays(90); // ninety days after the later of today and the last day
  await expect(d.getByText(/the family can sign in until/i)).toBeVisible();
  await expect(d.getByText(new RegExp(`until ${Number(until.slice(8))} \\w+ ${until.slice(0, 4)}`, "i"))).toBeVisible();
  await expect(d.getByText(/still open|nothing is open/i)).toBeVisible();
  const effects = (await d.getByRole("listitem").allInnerTexts()).join(" | ");
  await shot(admin, "w9-dialog");
  await d.getByRole("button", { name: /^mark as left$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(admin, `students/${S.soonId}`);
  await expect(main(admin).getByText(/^Left$/).first()).toBeVisible();
  await shot(admin, "w9-record");
  // Effects, one by one: enrolment closed as left; the section kept; out of the open register and the lists; the seat is free.
  expect(effects).toMatch(/enrolment closes as left/i);
  await expect(main(admin).getByText("Left", { exact: true }).nth(1)).toBeVisible(); // enrolment history badge
  await expect(main(admin).getByText(/Last section/)).toBeVisible();
  await expect(main(admin).getByText(/Family can sign in until/)).toBeVisible();
  await go(admin, "attendance");
  await admin.getByLabel("Section").selectOption({ label: "Class 3-A" });
  await admin.waitForURL(/sectionId=/);
  await settle(admin);
  await expect(main(admin).getByText(/Roll \d+/).first()).toBeVisible();
  expect(await main(admin).innerText()).not.toContain(S.soon);
  // The register of the month they left in still lists them, with the plain note.
  await go(admin, "attendance/register");
  await admin.getByLabel("Section").selectOption({ label: "Class 3-A" });
  await admin.waitForURL(/sectionId=/);
  await go(admin, `attendance/register?${new URL(admin.url()).searchParams.toString().replace(/month=[^&]*&?/, "")}&month=${lastDay.slice(0, 7)}`);
  await expect(main(admin).getByText(S.soon)).toBeVisible();
  await expect(main(admin).getByText(new RegExp(`Left ${Number(lastDay.slice(8))} \\w+`))).toBeVisible();
  await shot(admin, "w9-register");
  // The lists stop offering them.
  await go(admin, "announcements/new");
  await btn(admin, /^choose people$/i).click();
  await admin.getByLabel(/Add classes, sections/).fill(S.soon);
  await expect(admin.getByText("No matches")).toBeVisible({ timeout: 15_000 });
  // Result and fees stay open to staff.
  const accounts = await people.as("accounts");
  await go(accounts, `fees/students/${S.soonId}`);
  await expect(main(accounts).getByText(/left/i).first()).toBeVisible();
  const res = await admin.request.get(at("results"));
  expect(res.status()).toBeLessThan(400);

  // The family, on a phone: signs in, sees only fees, results and notices.
  const fam = await familyAt(browser);
  await signInFamily(fam, S.soonNo, ddmm(S.soonDob));
  await expect(fam).toHaveURL(/\/app/);
  await settle(fam);
  await shot(fam, "w9-family-home");
  const menu = await fam.locator("nav a[href^='/app']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
  expect(menu.some((h) => /attendance|messages|requests|timetable|library|transport/.test(h))).toBe(false);
  // Every link on the limited home works.
  const problems = await crawl(fam, { slug: SLUG, sections: /^\/app(\/(fees|results|exams|notifications|settings|home|my-profile)(\/|$)|$)/, starts: ["/app"], role: "left-family", desk: 375 });
  expect(problems).toEqual([]);
  // An old bookmark: a plain page, never an error.
  for (const path of ["attendance", "messages", "requests"]) {
    await fam.goto(at(path), { waitUntil: "domcontentloaded" });
    await settle(fam);
    await expect(fam.getByText(/not open to a student who has left the school/i)).toBeVisible();
    await expect(fam.getByText(/something went wrong|application error|do not have permission/i)).toHaveCount(0);
  }
  await shot(fam, "w9-bookmark");
  // The days pass: the 91st day is over. The open session ends; the sign-in says the sentence; a wrong password does not.
  sql(`update students set access_until = access_until - 91 where id = '${S.soonId}'`);
  await fam.goto(at(""), { waitUntil: "domcontentloaded" });
  await fam.waitForURL(/\/login/, { timeout: 30_000 });
  await tryLogin(fam, S.soonNo, "WrongPass-123");
  await sees(fam, /incorrect|invalid|not right|did not match|wrong/i);
  await expect(fam.getByText(/closed because the student left/i)).toHaveCount(0);
  await tryLogin(fam, S.soonNo, STUDENT_PASSWORD);
  await sees(fam, "This login was closed because the student left the school. Ask the school office.");
  await shot(fam, "w9-closed");
  await fam.context().close();
});

// ---------- W10 ----------
test("W10 bring back: class and section asked, everything works again", async ({ browser }) => {
  const admin = await people.as("admin");
  await go(admin, `students/${S.soonId}`);
  const d = await openDialog(admin, btn(admin, /^bring back$/i));
  await shot(admin, "w10-dialog");
  await expect(d.getByLabel("Class and section")).toBeVisible();
  await d.getByRole("button", { name: /^bring back$/i }).click();
  await expect(d.getByText(/choose|required/i).first()).toBeVisible({ timeout: 15_000 }); // the section is asked for
  await d.getByLabel("Class and section").selectOption({ label: "3-A" });
  await d.getByRole("button", { name: /^bring back$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await go(admin, `students/${S.soonId}`);
  await expect(main(admin).getByText(/^Active$/).first()).toBeVisible();
  await expect(main(admin).getByText(/Family can sign in until/)).toHaveCount(0);
  await go(admin, "attendance");
  await admin.getByLabel("Section").selectOption({ label: "Class 3-A" });
  await admin.waitForURL(/sectionId=/);
  await settle(admin);
  await expect(main(admin).getByText(S.soon)).toBeVisible();
  // The family signs in again and has the whole menu.
  const fam = await familyAt(browser);
  await signInFamily(fam, S.soonNo, ddmm(S.soonDob));
  await settle(fam);
  await fam.goto(at("attendance"), { waitUntil: "domcontentloaded" });
  await settle(fam);
  await expect(fam.getByText(/not open to a student who has left/i)).toHaveCount(0);
  await shot(fam, "w10-family-attendance");
  await fam.context().close();
});

// ---------- W11 ----------
/** A new section of a class in this year, made on the Academics screens. */
async function newSection(admin: Page, className: string, name: string) {
  await go(admin, "academics/classes");
  await main(admin).getByRole("link", { name: className, exact: true }).click();
  await admin.waitForURL(/academics\/classes\/[0-9a-f-]{36}/);
  await settle(admin);
  const d = await openDialog(admin, btn(admin, /^new section$/i));
  await d.getByRole("textbox").first().fill(name);
  await d.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 30_000 });
  await expect(main(admin).getByText(new RegExp(`${className.replace("Class ", "")}-${name}|Section ${name}|\\b${name}\\b`)).first()).toBeVisible();
}
/** Admit an active child into a section of this year, by its label (like "3-AB"). */
async function admitInto(admin: Page, name: string, section: string, years: number) {
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name, dob: bornYearsAgo(years), g1: [`Parent ${name}`, phone()] });
  await d.getByLabel("Class and section").selectOption({ label: section });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });
}

test("W11 promotion counts a joining child planned into the target; the last class graduates", async ({ browser }) => {
  const admin = await people.as("admin");
  const sec = run.sectionName, grad = `${run.sectionName}G`;
  // A section of Class 3 with two children, and a child who joins next year into 4-A.
  await newSection(admin, "Class 3", sec);
  const a = kid("Pia"), b = kid("Pavan");
  await admitInto(admin, a, `3-${sec}`, 8);
  await admitInto(admin, b, `3-${sec}`, 8);
  S.j4 = kid("Jaya");
  await go(admin, "students");
  const d = await openAdmit(admin);
  await fillChild(d, { name: S.j4, dob: bornYearsAgo(9), cls: "Class 4", joinsOn: run.next.start, planned: new RegExp(`^4-A \\(${run.next.name}\\)`), g1: [`Parent ${S.j4}`, phone()] });
  await d.getByRole("button", { name: /^admit$/i }).click();
  await expect(dialog(admin)).toBeHidden({ timeout: 60_000 });

  await go(admin, "students/promote");
  await main(admin).getByRole("link", { name: new RegExp(`^3-${sec}\\b`) }).click();
  await admin.waitForURL(/from=/);
  await settle(admin);
  const dlg = await openDialog(admin, btn(admin, /^promote section$/i));
  const options = await dlg.getByLabel("Move the class to").locator("option").allInnerTexts();
  const target = options.find((t) => /^4-A \(/.test(t) || /^4-A/.test(t));
  expect(target, `4-A among ${options.join(" | ")}`).toBeTruthy();
  expect(target).toMatch(/[1-9]\d* joining planned/);
  await shot(admin, "w11-promote");
  const nowBefore = Number(/(\d+) now/.exec(target!)?.[1]);
  await dlg.getByLabel("Move the class to").selectOption({ label: target! });
  await dlg.getByRole("button", { name: /^promote$/i }).click();
  await admin.waitForURL(/\/app\/students$/, { timeout: 60_000 });
  // The target is counted again, with the two who came up.
  await go(admin, "students/promote");
  await main(admin).getByRole("link", { name: /^3-B\b/ }).click();
  await admin.waitForURL(/from=/);
  await settle(admin);
  const dlg2 = await openDialog(admin, btn(admin, /^promote section$/i));
  const after = (await dlg2.getByLabel("Move the class to").locator("option").allInnerTexts()).find((t) => /^4-A/.test(t))!;
  expect(Number(/(\d+) now/.exec(after)?.[1]), `${target} then ${after}`).toBe(nowBefore + 2);
  expect(after).toMatch(/[1-9]\d* joining planned/);
  await admin.keyboard.press("Escape");

  // The last class graduates.
  await newSection(admin, "Class 10", grad);
  const g1 = kid("Gopal"), g2 = kid("Gauri");
  await admitInto(admin, g1, `10-${grad}`, 15);
  await admitInto(admin, g2, `10-${grad}`, 15);
  await go(admin, "students/promote");
  await main(admin).getByRole("link", { name: new RegExp(`^10-${grad}\\b`) }).click();
  await admin.waitForURL(/from=/);
  await settle(admin);
  await expect(main(admin).getByText(/last class: students become alumni/i)).toBeVisible();
  const gd = await openDialog(admin, btn(admin, /^graduate class$/i));
  await shot(admin, "w11-graduate");
  await gd.getByRole("button", { name: /^graduate$/i }).click();
  await admin.waitForURL(/\/app\/students$/, { timeout: 60_000 });
  await openRecord(admin, g1);
  S.alumniId = idOf(S.url!);
  S.alumniNo = await admissionNoOf(admin);
  await expect(main(admin).getByText(/^Alumni$/).first()).toBeVisible();
  // The alumnus signs in on a phone: fees and results, and a plain page for the rest.
  const fam = await familyAt(browser);
  await signInFamily(fam, S.alumniNo, ddmm(bornYearsAgo(15)), true);
  await settle(fam);
  await shot(fam, "w11-alumni-home");
  await fam.goto(at("attendance"), { waitUntil: "domcontentloaded" });
  await settle(fam);
  await expect(fam.getByText(/not open to a student who has left the school/i)).toBeVisible();
  for (const ok of ["fees", "results"]) {
    const r = await fam.goto(at(ok), { waitUntil: "domcontentloaded" });
    expect(r!.status()).toBeLessThan(400);
    await settle(fam);
    await expect(fam.getByText(/not open to a student who has left/i)).toHaveCount(0);
  }
  await fam.context().close();
});

// ---------- W12 ----------
/** Every button and link a person sees that changes a student. Only the admin may use them. */
const WRITE = /^(admit student|edit|start now|change the joining day|choose a section first|withdraw before joining|mark as left|bring back|delete|reset login|photo|login slips|import csv|promote)$/i;
const REFUSAL = /not allowed|do not have permission|don.t have permission|read.only|something went wrong|application error/i;
const screens = () => ["students", `students/${S.enqStuId}`, `students/${S.fId}`, `students/${S.eId}`, `students/${S.alumniId}`, "students/import", "students/promote", `enquiries/${S.enqId}/admit`];
const seeWrite = async (page: Page) => (await page.locator("main button, main a").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ")))).filter((t) => WRITE.test(t));

for (const who of ["accounts", "teacher", "cashier", "auditor"] as const) {
  test(`W12 ${who}: no button that ends in refusal on the student screens`, async () => {
    const page = await people.as(who);
    const found: string[] = [];
    for (const path of screens()) {
      const r = await page.goto(at(path), { waitUntil: "domcontentloaded" });
      await settle(page).catch(() => {});
      const here = new URL(page.url()).pathname;
      const body = await page.locator("body").innerText();
      if (r && r.status() >= 500) found.push(`${r.status()} ${path}`);
      if (REFUSAL.test(body) && !/^\/app\/(students|enquiries)/.test(here) === false && /not allowed|do not have permission/i.test(body)) found.push(`refusal text on ${path}`);
      for (const t of await seeWrite(page)) found.push(`${who} sees "${t}" on ${path}`);
    }
    // Every link they are shown works, in the student area.
    const problems = await crawl(page, { slug: SLUG, sections: /^\/app\/(students|enquiries|attendance|fees\/students|library\/members)(\/|$)|^\/app\/results$/, starts: screens().slice(0, 4).map((p) => `/app/${p}`), role: who, desk: 1366 });
    expect([...found, ...problems]).toEqual([]);
  });
}

test("W12 a read-only school and a support session: nothing to press that ends in refusal", async ({ browser }) => {
  const was = sql(`select status from schools where slug = '${SLUG}'`);
  const admin = await people.as("admin");
  try {
    sql(`update schools set status = 'read_only' where slug = '${SLUG}'`);
    const found: string[] = [];
    for (const path of ["students", `students/${S.enqStuId}`, `students/${S.fId}`, `students/${S.eId}`, "students/import", "students/promote"]) {
      await admin.goto(at(path), { waitUntil: "domcontentloaded" });
      await settle(admin).catch(() => {});
      for (const t of await seeWrite(admin)) found.push(`read-only school shows "${t}" on ${path}`);
    }
    await shot(admin, "w12-readonly");
    expect(found).toEqual([]);
  } finally {
    sql(`update schools set status = '${was}' where slug = '${SLUG}'`);
  }

  // A support session from the console: read only unless the school allowed writes.
  const ctx = await browser.newContext();
  const con = await ctx.newPage();
  await consoleLogin(con);
  await con.goto(`${CONSOLE}/schools`, { waitUntil: "domcontentloaded" });
  await con.getByRole("link", { name: /green valley/i }).first().click();
  await con.waitForURL(/\/schools\/[0-9a-f-]{36}/);
  const sl = await openDialog(con, btn(con, /support login/i));
  await sl.getByLabel(/why are you logging in/i).fill("Checking how a joining child looks to the office");
  await sl.getByRole("button", { name: /create link/i }).click();
  const link = con.locator("p.select-all");
  await link.waitFor({ timeout: 60_000 });
  const url = (await link.textContent())!.trim();
  const sup = await ctx.newPage();
  await sup.goto(url, { waitUntil: "domcontentloaded" });
  await sup.getByRole("button", { name: /open the panel/i }).click();
  await sup.waitForURL(/\/app/, { timeout: 90_000 });
  await expect(sup.getByText(/support (session|login|mode)/i).first()).toBeVisible();
  const seen: string[] = [];
  for (const path of ["students", `students/${S.enqStuId}`, `students/${S.fId}`, `students/${S.eId}`]) {
    await sup.goto(at(path), { waitUntil: "domcontentloaded" });
    await settle(sup).catch(() => {});
    for (const t of await seeWrite(sup)) seen.push(`support session shows "${t}" on ${path}`);
  }
  await shot(sup, "w12-support");
  expect(seen).toEqual([]);
  await ctx.close();
});

// ---------- W13 ----------
async function inspect(page: Page, path: string, who: string, width: number) {
  const out: string[] = [];
  const errs: string[] = [];
  const onErr = (m: { type(): string; text(): string }) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(401|403|404)/i.test(m.text())) errs.push(m.text().slice(0, 140)); };
  page.on("console", onErr);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(at(path), { waitUntil: "domcontentloaded" });
  await settle(page).catch(() => out.push(`still loading ${path}`));
  const where = `${who} ${path} @${width}`;
  if ((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) > 1) out.push(`sideways scroll: ${where}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main p, main span, main button, main a, main label, main li, main dt, main dd")].filter((e) => {
    const c = getComputedStyle(e);
    return e.children.length === 0 && (e.textContent ?? "").trim() && e.clientWidth > 4 /* not a screen-reader-only label */ && e.scrollWidth > e.clientWidth + 2 && ["hidden", "clip"].includes(c.overflowX) && c.textOverflow !== "ellipsis";
  }).map((e) => (e.textContent ?? "").trim().slice(0, 40)));
  for (const t of clipped) out.push(`clipped text "${t}": ${where}`);
  if (errs.length) out.push(`console error: ${where}: ${errs[0]}`);
  page.off("console", onErr);
  return out;
}

for (const who of ["admin", "teacher", "accounts"] as const) {
  test(`W13 ${who}: crawl and layout of the student screens`, async () => {
    const page = await people.as(who);
    const problems: string[] = [];
    for (const path of screens()) {
      for (const w of [1440, 375]) problems.push(...(await inspect(page, path, who, w)));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of screens()) problems.push(...(await crawl(page, { slug: SLUG, sections: /^\/app\/(students|enquiries)(\/|$)/, starts: [`/app/${path}`], role: `${who}-${path.replace(/[^a-z]/gi, "")}`.slice(0, 40), desk: 1440 })));
    expect([...new Set(problems)]).toEqual([]);
  });
}

for (const who of ["admin", "teacher", "accounts"] as const) {
  test(`W13 axe: ${who}`, async () => {
    const home = await people.as(who);
    const found: string[] = [];
    const scan = async (page: Page, name: string) => {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))
        for (const n of v.nodes) found.push(`${v.impact} ${v.id} | ${who}/${name} | ${n.target.join(" ").replace(/:nth-child\(\d+\)/g, "")} | ${n.html.slice(0, 90)}`);
    };
    for (const path of screens()) {
      const page = await home.context().newPage();
      await page.goto(at(path), { waitUntil: "domcontentloaded" });
      await settle(page).catch(() => {});
      await scan(page, path.replace(/[0-9a-f-]{36}/, ":id"));
      if (who === "admin") {
        // The dialogs of the screen, open.
        for (const name of [/^admit student$/i, /^start now$/i, /^change the joining day$/i, /^choose a section first$/i, /^withdraw before joining$/i, /^mark as left$/i, /^bring back$/i]) {
          const b = page.getByRole("button", { name }).first();
          if (!(await b.isVisible().catch(() => false))) continue;
          await b.click();
          await dialog(page).waitFor({ timeout: 15_000 });
          await page.waitForTimeout(400);
          await scan(page, `${path.replace(/[0-9a-f-]{36}/, ":id")} dialog ${name.source}`);
          await page.keyboard.press("Escape");
          await dialog(page).waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
        }
      }
      await page.close();
    }
    const uniq = [...new Set(found)];
    for (const f of uniq) console.log("AXE " + f);
    expect(uniq).toEqual([]);
  });
}
