import { expect, test, type Browser, type Page, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CONSOLE, consoleLogin, login, loginStudent, SCHOOL } from "./helpers";
import { dialog, job, main, mails, says, sql } from "./comm-lib";

// K7 to K11 of docs/WEBSITE-ADMIN-PRD.md section 16, as people do them. One new school (made from the console) carries every journey,
// so nothing here touches the demo schools' settings. Names are unique per run.
// AJ_REUSE=<slug of an earlier run> reuses that school (for the journeys that need only its admin); normally every run makes a new one.
const RUN = process.env.AJ_REUSE ? process.env.AJ_REUSE.slice(2) : Date.now().toString(36).slice(-6);
const SLUG = `aj${RUN}`;
const NAME = `Journey ${RUN} Public School`;
const ADMIN = { name: "Anita Journey", email: `admin.${SLUG}@example.test` };
const PW = "Journey-Pass-2026";
const site = SCHOOL(SLUG);
const PUPILS = [`Asha ${RUN}`, `Bilal ${RUN}`, `Chitra ${RUN}`];
const PHONE = (n: number) => `9${(Date.now() % 1e7).toString().padStart(7, "0")}${n}${n}`.slice(0, 10);
const at = (p: string) => `${site}/app/${p}`;

/** Newest mail to `to` whose subject matches, as text (waits for it). */
async function mailText(to: string, subject: RegExp, since = 0): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const hit = (await mails(to)).filter((m) => subject.test(m.Subject) && Date.parse((m as unknown as { Created: string }).Created) >= since)[0];
    if (hit) return ((await (await fetch(`http://localhost:8025/api/v1/message/${hit.ID}`)).json()) as { Text: string }).Text;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}
const linkIn = (text: string, re: RegExp) => text.match(re)![0].replace(/[).,>]+$/, "");

/** A new colleague opens the invite mail, sets a password and lands in the panel. */
async function joinFromInvite(browser: Browser, email: string): Promise<Page> {
  if (sql(`select status from users where email = '${email}'`) === "active") { // a reused school: the invite was used on an earlier run
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await login(page, SLUG, email, PW);
    return page;
  }
  const link = linkIn(await mailText(email, /./), /https?:\/\/\S+\/reset-password\?token=\S+/);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByLabel("New password").fill(PW);
  await page.getByLabel("Type it again").fill(PW);
  await page.getByRole("button", { name: /set password and sign in/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 90_000 });
  return page;
}

/** A signed-in console page. The session is kept between runs: the console's sign-in allows only a few tries in 15 minutes, and every journey of every run needs a staff member. */
async function consolePage(browser: Browser, email = "owner@triakshi.test"): Promise<Page> {
  const CONSOLE_STATE = `${tmpdir()}/aj-console-${email.split("@")[0]}.json`;
  if (existsSync(CONSOLE_STATE)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: CONSOLE_STATE });
    const page = await ctx.newPage();
    await page.goto(`${CONSOLE}/schools`);
    if (!page.url().includes("/login")) return page;
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await consoleLogin(page, email);
  writeFileSync(CONSOLE_STATE, JSON.stringify(await ctx.storageState()));
  return page;
}

let admin: Page, adminCtx: BrowserContext;

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

test.describe("admin journeys K7-K11", () => {
  test.afterAll(async () => { await adminCtx?.close(); });

  test("K10a console creates the school; the administrator sets a password from the mail", async ({ browser }) => {
    if (process.env.AJ_REUSE) {
      adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      admin = await adminCtx.newPage();
      await login(admin, SLUG, ADMIN.email, PW);
      return;
    }
    const c = await consolePage(browser);
    const cctx = c.context();
    await c.goto(`${CONSOLE}/schools`);
    const since = Date.now() - 2000;
    await c.getByRole("button", { name: /new school/i }).first().click();
    const d = dialog(c);
    await d.locator("[name=name]").fill(NAME);
    await d.locator("[name=slug]").fill(SLUG);
    await d.locator("[name=planId]").selectOption({ label: "Pro (up to 3000)" });
    await d.locator("[name=adminName]").fill(ADMIN.name);
    await d.locator("[name=adminEmail]").fill(ADMIN.email);
    await d.locator("[name=city]").fill("Mysuru");
    await d.locator("[name=state]").fill("Karnataka");
    await d.getByRole("button", { name: "Create school" }).click();
    await says(c, /School created/);
    await cctx.close();

    const mail = await mailText(ADMIN.email, /panel is ready/i, since);
    const link = linkIn(mail, /https?:\/\/\S+\/reset-password\?token=\S+/);
    expect(link).toContain(`${SLUG}.localhost`);
    adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    admin = await adminCtx.newPage();
    await admin.goto(link);
    await admin.getByLabel("New password").fill(PW);
    await admin.getByLabel("Type it again").fill(PW);
    await admin.getByRole("button", { name: /set password and sign in/i }).click();
    await admin.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 90_000 });
    await expect(admin).toHaveURL(/\/app\/setup/);
  });

  test("K10b the wizard: profile, year, classes, subjects, pasted staff, students, class teachers, website, team, finish", async () => {
    const step = (name: RegExp | string) => expect(admin.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 60_000 });
    const go = async (path: string, h: RegExp | string) => { await admin.goto(at(`setup/${path}`)); await step(h); };
    const save = () => admin.getByRole("button", { name: /save and continue/i }).click();

    await go("profile", "School profile");
    await expect(admin.getByLabel("School name")).toHaveValue(NAME); // prefilled from the creation
    await admin.getByLabel("Board").selectOption("CBSE");
    await admin.getByLabel("State").selectOption("Karnataka");
    await admin.getByLabel("Address").fill("12 Palace Road");
    await save();
    await step("Academic year");
    await save();
    await step("Classes and sections");
    await admin.getByRole("button", { name: "Clear" }).click();
    await admin.getByRole("button", { name: "Class 1", exact: true }).click();
    await admin.getByRole("button", { name: "Class 2", exact: true }).click();
    await admin.getByRole("button", { name: "Create classes" }).click();
    await step("Subjects");
    await save();
    await step("Teachers and staff");
    // paste from a sheet: three teachers and an accountant, checked first, then added
    const sheet = ["name\temail\tphone\trole",
      ...[1, 2, 3].map((n) => `Teacher ${RUN} ${n}\tt${n}.${SLUG}@example.test\t${PHONE(n)}\tTeacher`),
      `Office ${RUN}\toffice.${SLUG}@example.test\t${PHONE(9)}\tAccountant`].join("\n");
    await admin.getByLabel("Paste from a sheet").fill(sheet);
    await admin.getByRole("button", { name: "Check the sheet" }).click();
    await says(admin, /4 of 4 rows are ready/);
    await admin.getByRole("button", { name: /^Add 4 people/ }).click();
    await says(admin, /4 people added/);
    await expect(admin.getByText(/Everyone has an email, so every invite was sent/)).toBeVisible();
    await admin.getByRole("button", { name: "Continue" }).click();

    // students by hand: three children in the two classes
    await go("students", "Students");
    const rows = admin.locator("ul").filter({ has: admin.getByText("Student 1 name") }).locator("> li");
    for (const [i, who] of PUPILS.entries()) {
      const row = rows.nth(i);
      await row.getByLabel(/Student \d name/).fill(who);
      await row.locator("select").selectOption({ index: 1 + (i % 2) });
      await row.getByLabel("Guardian name").fill(`Parent of ${who}`);
      await row.getByLabel("Guardian phone").fill(PHONE(i + 4));
    }
    await admin.getByRole("button", { name: /^Add 3 students/ }).click();
    await says(admin, /3 added/);

    // class teachers: one select per section, from the teachers just pasted in
    await go("classteachers", "Class teachers");
    const selects = admin.locator("select[id^=ct-]");
    expect(await selects.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      const sel = selects.nth(i);
      await sel.selectOption(await sel.locator("option", { hasText: `Teacher ${RUN} ${(i % 3) + 1} ` }).first().getAttribute("value") as string);
    }
    await admin.getByRole("button", { name: "Save and continue" }).click();
    await step("Website");

    // website: pick a look and publish
    await admin.getByRole("button", { name: "Publish my website" }).click();
    await step("Your team");
    // an office login (the second admin comes in K8, from Settings)
    await admin.getByLabel("Full name").fill(`Front Desk ${RUN}`);
    await admin.getByLabel("Email").fill(`desk.${SLUG}@example.test`);
    await admin.getByLabel("Role").selectOption("accountant");
    await admin.getByRole("button", { name: "Add this person" }).click();
    await says(admin, /Invite sent to Front Desk/);
    await go("team", "Your team");
    await expect(admin.getByText(`Front Desk ${RUN}`)).toBeVisible();

    // review and finish
    await go("done", "Review and finish");
    await admin.getByRole("button", { name: "Finish setup" }).click();
    await expect(admin.getByRole("heading", { name: /is set up/ })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("link", { name: "See what to do next" }).click();
    await expect(admin).toHaveURL(/getting-started/);
  });

  test("K10c getting started: percent and next step, give a task to the office login, who signs in and does it", async ({ browser }) => {
    await expect(main(admin).getByText(/\d+% done|^\d+%/).first()).toBeVisible();
    await expect(admin.getByText("Next best step")).toBeVisible();
    // what the wizard did is already counted: classes and year are not in the list of things to do
    await expect(admin.locator("li").filter({ hasText: "Add classes and sections" }).getByRole("link", { name: "Open" })).toHaveCount(0);
    // only colleagues who have signed in can be given a task: the office login sets its password first
    const office = await joinFromInvite(browser, `office.${SLUG}@example.test`);
    await admin.reload();
    const row = admin.locator("li").filter({ hasText: "Add fee heads, like Tuition" });
    await row.getByRole("button", { name: "Give to", exact: true }).click();
    await row.getByLabel("Give this task to").selectOption({ label: `Office ${RUN}` });
    await row.getByRole("button", { name: "Give", exact: true }).click();
    await says(admin, /./); // toast
    await expect(row.getByText(`With Office ${RUN}`)).toBeVisible({ timeout: 20_000 });

    // the colleague sees the task and does it
    await office.reload();
    await expect(office.getByRole("link", { name: /Your setup tasks/ })).toBeVisible(); // told in the menu
    await office.goto(at("getting-started"));
    await expect(office.getByRole("heading", { level: 1, name: "Your tasks" })).toBeVisible();
    const mine = office.locator("li").filter({ hasText: "Add fee heads, like Tuition" });
    await expect(mine.getByText(/Given by Anita Journey/)).toBeVisible();
    await mine.getByRole("link", { name: "Do it" }).click();
    await expect(office).toHaveURL(/fees\/heads/);
    await office.getByRole("button", { name: "New fee" }).first().click();
    await dialog(office).locator("[name=name]").fill("Tuition");
    await dialog(office).getByRole("button", { name: "Save" }).click();
    await expect(office.getByRole("cell", { name: "Tuition", exact: true })).toBeVisible();

    // the admin sees it done, by data, with no button to press
    await admin.goto(at("getting-started"));
    await expect(admin.locator("li").filter({ hasText: "Add fee heads, like Tuition" }).getByRole("link", { name: "Open" })).toHaveCount(0);
    await admin.getByText(/^Done \(/).click();
    await expect(admin.getByText("Add fee heads, like Tuition")).toBeVisible();
    await office.context().close();
  });

  test("K7 domains: add, records one by one, verified, main domain redirects with a canonical, broken is told, released", async ({ playwright }) => {
    test.setTimeout(400_000);
    const www = `www.${SLUG}-school.in`;
    const bare = `${SLUG}-school.in`;
    const free = `${SLUG}.localhost`;
    const schoolId = sql(`select id from schools where slug = '${SLUG}'`);
    const row = () => `school_id = '${schoolId}' and hostname = '${www}'`;
    const hit = async (host: string, path: string) => {
      const api = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.SCHOOL_PORT ?? "4100"}` });
      const r = await api.get(path, { headers: { Host: `${host}:${process.env.SCHOOL_PORT ?? "4100"}` }, maxRedirects: 0 });
      const out = { status: r.status(), location: r.headers().location ?? "", body: r.status() === 200 ? await r.text() : "" };
      await api.dispose();
      return out;
    };

    // a reused school may still hold domains from an earlier run: remove them the way an admin would
    await admin.goto(at("domains"));
    for (let i = 0; i < 4; i++) {
      await expect(admin.getByRole("heading", { name: "Your own domain" })).toBeVisible();
      await expect(admin.getByText(free).first()).toBeVisible();
      if (!(await admin.locator('a[href^="/app/domains/"]').count())) break;
      const link = admin.locator('a[href^="/app/domains/"]').first();
      const host = (await link.textContent())!.trim();
      await link.click();
      await admin.getByRole("button", { name: "Remove domain" }).click();
      if (await dialog(admin).locator("[name=confirm]").count()) { await dialog(admin).locator("[name=confirm]").fill(host); await dialog(admin).getByRole("button", { name: "Remove domain" }).click(); }
      else await dialog(admin).getByRole("button", { name: "Remove", exact: true }).click();
      await admin.waitForURL(/\/app\/domains$/);
    }

    // add: the free address is there from the start; both forms in one tick
    await admin.goto(at("domains"));
    await expect(admin.getByText(free).first()).toBeVisible();
    await admin.getByRole("button", { name: "Add domain" }).first().click();
    await dialog(admin).locator("[name=hostname]").fill(www);
    await dialog(admin).getByLabel(/Also add the other form/).check();
    await dialog(admin).getByRole("button", { name: "Add domain" }).click();
    await expect(admin.getByRole("link", { name: www })).toBeVisible();
    await expect(admin.getByRole("link", { name: bare, exact: true })).toBeVisible();
    await expect(admin.getByText("Waiting for DNS").first()).toBeVisible();

    // the records, one by one, with the short name; the real DNS has nothing for this name, and says so
    await admin.getByRole("link", { name: www }).click();
    await expect(admin.getByRole("heading", { name: www, level: 1 })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Prove the domain is yours" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Point it to us" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Secure it with HTTPS" })).toBeVisible();
    await expect(admin.getByText("_smw-verify.www").first()).toBeVisible(); // the registrar's short form
    await expect(admin.getByText(/^smw-verify=/).first()).toBeVisible();
    await expect(admin.getByText(`sites.`).first()).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Send to my IT person" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: /How to add them/ })).toBeVisible();
    await admin.getByRole("button", { name: "Check now" }).click();
    await expect(admin.getByText("Not right yet").first()).toBeVisible({ timeout: 30_000 });
    await expect(admin.getByText("Nothing yet").first()).toBeVisible();
    await expect(admin.getByText("Waiting for DNS").first()).toBeVisible();

    // DNS cannot be faked: the row becomes what the worker writes once every record is found
    const rec = (key: string, expected: string, found: string) => ({ key, ok: true, expected, found: [found] });
    const token = sql(`select verify_token from school_domains where ${row()}`);
    const records = JSON.stringify([rec("txt", `smw-verify=${token}`, `smw-verify=${token}`), rec("cname", `sites.localhost`, `sites.localhost`), rec("https", "A valid certificate", "Issued by Lets Encrypt")]);
    const live = () => {
      sql(`update school_domains set is_primary = false where school_id = '${schoolId}'`);
      sql(`update school_domains set status = 'verified', verified_at = now(), last_checked_at = now(), check_error = null, health = 'ok', is_primary = true, failing_since = null, txt_missing_since = null, told_at = null,
        records = '${records}'::jsonb, cert_expires_at = now() + interval '80 days', dns_provider = 'cloudflare' where ${row()}`);
      sql(`insert into school_domain_events (id, school_id, domain_id, hostname, kind, detail) select gen_random_uuid(), school_id, id, hostname, 'verified', 'Ownership and the address are proven.' from school_domains where ${row()}`);
    };
    live();
    await admin.reload();
    await expect(admin.getByText("Found", { exact: true })).toHaveCount(3);
    await expect(admin.getByText(/Your school opens on this address, and it is your main domain/)).toBeVisible();
    await expect(admin.getByText("Went live")).toBeVisible(); // the timeline
    await admin.goto(at("domains"));
    await expect(admin.getByText("Main domain").first()).toBeVisible();
    await expect(admin.getByText(new RegExp(`${free} send visitors to ${www}`))).toBeVisible();

    // the redirect: public pages on the other addresses go to the main domain (308, path and query kept); panel and sign-in never
    const toMain = new RegExp(`^https://${www.replace(/\./g, "\\.")}/`);
    const moved = await hit(free, "/?ref=k7");
    expect(moved.status).toBe(308);
    expect(moved.location).toMatch(new RegExp(`${toMain.source}\\?ref=k7$`));
    const inner = await hit(free, "/admissions?ref=k7");
    expect(inner.status).toBe(308);
    expect(inner.location).toMatch(new RegExp(`${toMain.source}admissions\\?ref=k7$`));
    for (const keep of ["/login", "/app", "/api/healthz"]) {
      const r = await hit(free, keep);
      expect(r.location, keep).not.toContain(www);
    }
    // on the main domain itself the page opens, and says so is the canonical address
    const onMain = await hit(www, "/");
    expect(onMain.status).toBe(200);
    expect(onMain.body).toMatch(new RegExp(`<link rel="canonical" href="https?://${www.replace(/\./g, "\\.")}/?"`));

    // turn the rule off: every address shows the site; back on again
    await admin.getByRole("button", { name: "Turn off" }).click();
    await dialog(admin).getByRole("button", { name: "Turn off" }).click();
    await expect(admin.getByText(/Sending visitors to the main domain is off/)).toBeVisible();
    expect((await hit(free, "/")).status).toBe(200);
    await admin.getByRole("button", { name: "Turn on" }).click();
    await dialog(admin).getByRole("button", { name: "Turn on" }).click();
    await expect(admin.getByText(/send visitors to/)).toBeVisible();
    expect((await hit(free, "/")).status).toBe(308);

    // broken for a day: the worker asks the real DNS, finds the name does not point to us, and the admins are told once
    sql(`update school_domains set health = 'broken', failing_since = now() - interval '25 hours', told_at = null where ${row()}`);
    job("domains.verify-pending");
    await admin.goto(at("notifications"));
    await expect(admin.getByText(new RegExp(`${www} is not reaching your school`)).first()).toBeVisible();
    await admin.goto(at("domains"));
    await expect(admin.getByText("Not reaching your school").first()).toBeVisible();
    await expect(admin.getByText(/is your main domain but is not reaching your school/)).toBeVisible();
    expect(sql(`select count(*) from notifications where school_id = '${schoolId}' and title like '${www} is not reaching your school'`)).toBe("1");

    // the ownership record gone for 14 days: released, the free address is main again, and the school is told
    sql(`update school_domains set txt_missing_since = now() - interval '15 days' where ${row()}`);
    job("domains.verify-pending");
    await admin.goto(at(`domains`));
    await admin.getByRole("link", { name: www }).click();
    await expect(admin.getByRole("heading", { name: "This domain no longer opens your school" })).toBeVisible();
    await expect(admin.getByText("Stopped").first()).toBeVisible();
    await expect(admin.getByText("Stopped serving")).toBeVisible(); // timeline
    await admin.goto(at("notifications"));
    await expect(admin.getByText(new RegExp(`${www} no longer opens your school`)).first()).toBeVisible();
    expect(sql(`select is_primary from school_domains where school_id = '${schoolId}' and kind = 'subdomain'`)).toBe("t");
    // a host is remembered by the server for a minute; after that the released name serves nothing
    await admin.waitForTimeout(62_000);
    expect((await hit(www, "/")).status).not.toBe(200);
    expect((await hit(free, "/")).status).toBe(200); // the free address never redirects now
  });

  test("K9 audit and data: a student changed shows old to new, CSV; the export runs in the background, is downloaded and logged; a family privacy request is answered", async ({ browser }) => {
    const pupil = PUPILS[0]!;
    const editMotherTongue = async (to: string) => {
      await admin.getByRole("button", { name: "Edit", exact: true }).click();
      await dialog(admin).locator("[name=motherTongue]").fill(to);
      await dialog(admin).getByRole("button", { name: "Save" }).click();
      await expect(admin.getByText(to).first()).toBeVisible();
    };
    await admin.goto(at("students"));
    await admin.getByRole("link", { name: pupil }).first().click();
    await expect(admin.getByRole("heading", { level: 1, name: pupil })).toBeVisible();
    await editMotherTongue("Kannada");
    await editMotherTongue("Tulu");

    // the audit log: the entry opens beside the list, field by field, old to new
    await admin.goto(at("audit"));
    await admin.getByRole("link", { name: new RegExp(`^Open:.*${pupil}`) }).first().click();
    const peek = admin.getByRole("dialog").last();
    await expect(peek.getByRole("heading", { name: "What changed" })).toBeVisible();
    await expect(peek.getByRole("row", { name: /mother ?tongue.*Kannada.*Tulu/i })).toBeVisible();
    await expect(peek.getByText("Anita Journey").first()).toBeVisible(); // who
    await expect(peek.getByRole("link", { name: /All entries for this record/ })).toBeVisible();
    await admin.keyboard.press("Escape");

    // the CSV of what is on screen
    await admin.goto(at("audit?q=" + encodeURIComponent(pupil)));
    const csvHref = await admin.getByRole("link", { name: "CSV" }).getAttribute("href");
    const csv = await (await admin.request.get(`${site}${csvHref}`)).text();
    expect(csv).toContain("What happened");
    expect(csv).toContain(pupil);
    expect(csv).toContain("Anita Journey");

    // the export: asked, waiting, made by the worker, downloaded as a ZIP, and the download is logged
    await admin.goto(at("settings/export"));
    await admin.getByRole("button", { name: "Export school data" }).click();
    await dialog(admin).getByRole("button", { name: "Make the export" }).click();
    await expect(admin.getByText("Waiting").first()).toBeVisible();
    await expect(admin.getByText(/One export is being made/)).toBeVisible();
    job("settings.exports");
    await admin.reload();
    await expect(admin.getByText("Ready").first()).toBeVisible({ timeout: 30_000 });
    const href = await admin.getByRole("link", { name: /^Download/ }).first().getAttribute("href");
    const zip = await admin.request.get(`${site}${href}`);
    expect(zip.ok()).toBe(true);
    const file = `${tmpdir()}/aj-export-${RUN}.zip`;
    writeFileSync(file, await zip.body());
    const names = execFileSync("unzip", ["-Z1", file]).toString().split("\n");
    expect(names).toEqual(expect.arrayContaining(["README.txt", "manifest.json", "data/students.csv"]));
    expect(execFileSync("unzip", ["-p", file, "data/students.csv"]).toString()).toContain(pupil);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", file, "manifest.json"]).toString());
    expect(manifest.tables.find((t: { table: string }) => t.table === "students").rows).toBeGreaterThanOrEqual(3);
    await admin.goto(at("settings/export"));
    await expect(admin.getByText(/1 download/)).toBeVisible();
    await admin.goto(at("audit"));
    await expect(admin.getByRole("link", { name: /^Open:.*(download|export)/i }).first()).toBeVisible();

    // a family asks for a copy of the child's data; the office answers
    const adm = sql(`select admission_no from students where name = '${pupil}' and school_id = (select id from schools where slug = '${SLUG}')`);
    const fctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const family = await fctx.newPage();
    await loginStudent(family, SLUG, adm, adm);
    await family.goto(at("profile/data"));
    await family.getByRole("button", { name: "Ask a question about my data" }).click();
    await dialog(family).locator("[name=kind]").selectOption("access");
    await dialog(family).locator("[name=details]").fill("Please send me everything the school holds about my child.");
    await dialog(family).getByRole("button", { name: "Send to the school" }).click();
    await expect(family.getByText("A copy of my data").first()).toBeVisible();
    await expect(family.getByText(/The school answers by/)).toBeVisible();

    await admin.goto(at("settings/privacy"));
    await admin.getByRole("link", { name: new RegExp(pupil) }).first().click();
    await expect(admin.getByText("What was asked")).toBeVisible();
    await admin.getByRole("button", { name: "Make their export" }).click();
    await expect(admin.getByText(/Export queued/)).toBeVisible();
    job("settings.exports");
    await admin.getByRole("button", { name: "Close the request" }).click();
    await dialog(admin).locator("[name=state]").selectOption("done");
    await dialog(admin).locator("[name=outcome]").fill("Your copy is ready. Please collect it from the school office.");
    await dialog(admin).getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText(/This request is closed/)).toBeVisible();
    await family.reload();
    await expect(family.getByText("Your copy is ready. Please collect it from the school office.")).toBeVisible();
    await expect(family.getByText("Done", { exact: true }).first()).toBeVisible();
    await fctx.close();
  });

  test("K11 support: teacher asks with a file; console sees, notes, replies; teacher is told; solved, rated, reopened; access off blocks entry; a visit is listed", async ({ browser }) => {
    test.setTimeout(400_000);
    const TAG = `${RUN}${Date.now().toString(36).slice(-4)}`; // unique per execution, so a re-run on a reused school never meets old rows
    const SUBJECT = `Timetable will not save ${TAG}`;
    const schoolId = sql(`select id from schools where slug = '${SLUG}'`);
    // a 1 x 1 picture, the size of a real small upload is not the point
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const teacher = await joinFromInvite(browser, `t1.${SLUG}@example.test`);
    /** Open the one-time link from the dialog in a clean browser, as the staff member would; the panel shows the support banner. */
    const enterWith = async (d: ReturnType<typeof dialog>) => {
      const url = (await d.locator("p.select-all").textContent())!.trim();
      const visitor = await (await browser.newContext()).newPage();
      await visitor.goto(url);
      await visitor.getByRole("button", { name: /open the panel/i }).click(); // one click first, so a prefetch cannot burn the token
      await visitor.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 60_000 });
      await expect(visitor.getByText(/support (session|login|mode)/i).first()).toBeVisible();
      await visitor.context().close();
      await d.getByRole("button", { name: "Done" }).click();
    };

    // teacher: a ticket with a picture
    await teacher.goto(at("support/new"));
    await teacher.getByRole("radio", { name: "Something is not working" }).click();
    await teacher.getByLabel("Subject").fill(SUBJECT);
    await teacher.getByLabel("Tell us more").fill("I press save on the Class 1 timetable and nothing happens. The picture shows the screen.");
    await teacher.getByRole("radio", { name: /Blocking our work/ }).click();
    await teacher.locator('input[type=file]').first().setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
    await teacher.getByRole("button", { name: "Send to Triakshi" }).click();
    await expect(teacher).toHaveURL(/support\/[0-9a-f-]{36}$/);
    const ticketUrl = teacher.url();
    await expect(teacher.getByRole("heading", { level: 1, name: SUBJECT })).toBeVisible();
    const ref = (await teacher.getByText(/T-\d+/).first().textContent())!.match(/T-\d+/)![0];
    await expect(teacher.getByText("screen.png", { exact: true })).toBeVisible();

    // console: the queue finds it by words; the thread shows the file and the school; a note stays inside; the reply goes out
    // the owner: the seeded support login is not enrolled in two-step sign-in, and an owner is the one who may enter against the school's wish
    const desk = await consolePage(browser);
    await desk.goto(`${CONSOLE}/support?q=${encodeURIComponent(SUBJECT)}`);
    await desk.getByRole("row", { name: new RegExp(`${ref}.*${SUBJECT}`) }).getByText(ref).click();
    await expect(desk.getByRole("heading", { level: 1, name: SUBJECT })).toBeVisible();
    await expect(desk.getByText("screen.png", { exact: true })).toBeVisible();
    await expect(desk.getByText(NAME).first()).toBeVisible();
    await desk.getByPlaceholder("A note for the team").fill("Looks like the Class 1 timetable has no periods yet. Internal only.");
    await desk.getByRole("button", { name: "Add note" }).click();
    await expect(desk.getByText(/Internal only/)).toBeVisible();
    await desk.getByPlaceholder("Write a reply to the school").fill("Thanks. Please add periods to Class 1 first, then save again.");
    await desk.getByRole("button", { name: "Send reply" }).click();
    await expect(desk.getByText("Thanks. Please add periods to Class 1 first, then save again.").first()).toBeVisible();

    // teacher: told in the bell, sees the reply; the internal note is nowhere
    job("support.tell"); // the worker's minute job: staff messages are told to the school once
    await teacher.goto(at("notifications"));
    await teacher.getByRole("button", { name: "Everything" }).or(teacher.getByRole("link", { name: "Everything" })).first().click();
    await expect(teacher.getByText(`Triakshi replied on ${ref}`).first()).toBeVisible();
    await teacher.goto(ticketUrl);
    await expect(teacher.getByText("Thanks. Please add periods to Class 1 first, then save again.")).toBeVisible();
    await expect(teacher.getByText(/Internal only/)).toHaveCount(0);

    // solved by the desk, rated by the teacher, reopened by the teacher
    await desk.getByRole("button", { name: "Mark solved" }).click();
    await expect(desk.getByText("Solved").first()).toBeVisible();
    await teacher.reload();
    await teacher.getByRole("radio", { name: /^4 of 5/ }).click();
    await teacher.getByPlaceholder(/One line about how we did/).fill("Quick and clear");
    await teacher.getByRole("button", { name: "Send rating" }).click();
    await expect(teacher.getByRole("button", { name: "Change rating" })).toBeVisible();
    await desk.reload();
    await expect(desk.getByText(/4 of 5: Quick and clear/)).toBeVisible();
    await teacher.getByRole("button", { name: "It is not solved: reopen" }).click();
    await expect(teacher.getByRole("button", { name: "Mark as solved" })).toBeVisible();
    await desk.reload();
    await expect(desk.getByRole("button", { name: "Mark solved" })).toBeVisible();

    // the school turns support access off: the desk is refused, in words, on the ticket and at the school's door
    await admin.goto(at("settings/access"));
    await admin.getByRole("button", { name: "Change" }).click();
    await dialog(admin).locator("[name=mode]").selectOption("never");
    await dialog(admin).getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText("Triakshi cannot open your school.").first()).toBeVisible();
    await desk.reload();
    await expect(desk.getByText(/This school has asked that Triakshi does not sign in/)).toBeVisible();
    await expect(desk.getByRole("link", { name: "Open the school" })).toHaveCount(0);
    await expect(desk.getByRole("link", { name: "Emergency entry" })).toBeVisible(); // an owner may still enter, with a written reason
    await desk.goto(`${CONSOLE}/schools/${schoolId}`);
    await desk.getByRole("button", { name: /Support login \(not allowed\)/ }).click();
    await expect(dialog(desk).getByRole("status")).toContainText(/You are an owner, so you may enter in an emergency/);
    await dialog(desk).locator("[name=reason]").fill("too short");
    await dialog(desk).getByRole("button", { name: "Create link" }).click();
    await expect(dialog(desk).getByText(/needs a real reason/)).toBeVisible();
    await dialog(desk).locator("[name=reason]").fill(`Emergency: ticket ${TAG} says nobody can save the timetable`);
    await dialog(desk).getByRole("button", { name: "Create link" }).click();
    await enterWith(dialog(desk));

    // allowed again for 24 hours: the desk enters as a normal visit; both visits are listed, the emergency one marked
    await admin.getByRole("button", { name: "Change" }).click();
    await dialog(admin).locator("[name=mode]").selectOption("24h");
    await dialog(admin).getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText(/Triakshi can open your school until the time shown/)).toBeVisible();
    await desk.reload();
    await desk.getByRole("button", { name: "Support login", exact: true }).click();
    await dialog(desk).locator("[name=reason]").fill(`Checking the Class 1 timetable for ticket ${TAG}`);
    await dialog(desk).getByRole("button", { name: "Create link" }).click();
    await enterWith(dialog(desk));
    await admin.goto(at("settings/access"));
    const normal = admin.getByRole("row", { name: new RegExp(`Checking the Class 1 timetable for ticket ${TAG}`) });
    await expect(normal).toBeVisible();
    await expect(normal.getByText("Read only")).toBeVisible();
    const emergency = admin.getByRole("row", { name: new RegExp(`Emergency: ticket ${TAG}`) });
    await expect(emergency.getByText("Emergency", { exact: true })).toBeVisible();
    job("support.tell"); // the admins are told of every visit, whatever the setting says
    await admin.goto(at("notifications"));
    await admin.getByRole("button", { name: "Everything" }).or(admin.getByRole("link", { name: "Everything" })).first().click();
    await expect(admin.getByText("Triakshi support entered your school in an emergency").first()).toBeVisible();
    await expect(admin.getByText("Triakshi support opened a session on your school").first()).toBeVisible();
    await teacher.context().close();
    await desk.context().close();
  });

  test("K8 settings: add a second admin who signs in; their page; a failed try in the sign-in history; a role page", async ({ browser }) => {
    const email = `admin2.${SLUG}@example.test`;
    await admin.goto(at("settings/users"));
    await admin.getByRole("button", { name: "Add a login" }).click();
    const d = dialog(admin);
    await d.locator("[name=name]").fill(`Second Admin ${RUN}`);
    await d.locator("[name=email]").fill(email);
    await d.locator("[name=role]").selectOption({ label: "Admin" });
    await d.getByRole("button", { name: "Add login" }).click();
    await expect(admin).toHaveURL(/settings\/users\/[0-9a-f-]{36}$/);
    const userUrl = admin.url();
    await expect(admin.getByText("Invited").first()).toBeVisible(); // no sign-in yet

    const second = await joinFromInvite(browser, email);
    await expect(second.getByRole("link", { name: /Settings/ }).first()).toBeVisible(); // an admin sees the settings

    // a failed try on that login, as a stranger would make it
    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(`${site}/login`);
    await stranger.getByLabel(/email, phone or admission number/i).fill(email);
    await stranger.getByLabel(/^password$/i).fill("Not-The-Password-1");
    await stranger.getByRole("button", { name: /sign in/i }).click();
    await expect(stranger.getByRole("alert").first()).toBeVisible();
    await expect(stranger).toHaveURL(/login/);
    await stranger.context().close();

    // their page: what they can do in words, the sign-in, the device
    await admin.goto(userUrl);
    await expect(admin.getByText(/Everything in the school/)).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Sign-in history" })).toBeVisible();
    await expect(admin.getByText("Signed in").first()).toBeVisible();
    await expect(admin.getByText("Wrong password").first()).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Devices signed in" })).toBeVisible();
    await expect(admin.getByText("Set by them")).toBeVisible();

    // the school-wide history shows the failed try, searchable by the login
    await admin.goto(at("settings/sign-ins"));
    await admin.getByPlaceholder(/search by login/i).fill(email);
    await admin.keyboard.press("Enter");
    await expect(admin.getByRole("row", { name: /Wrong password/ }).first()).toBeVisible();
    await expect(admin.getByRole("row", { name: /Signed in/ }).first()).toBeVisible();

    // a role page: the matrix in words, its people, a comparison
    await admin.goto(at("settings/roles"));
    await admin.getByRole("link", { name: /^Accountant/ }).first().click();
    await expect(admin.getByRole("heading", { name: "What it can do" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: /People \(2\)/ })).toBeVisible(); // the office login and the front desk
    await admin.getByLabel("Compare with").selectOption({ label: "Teacher" });
    await admin.getByRole("button", { name: "Compare" }).click();
    await expect(admin.getByText(/^Only Teacher$/)).toBeVisible();
    await expect(admin.getByText(/^Both$/)).toBeVisible();
    await second.context().close();
  });
});
