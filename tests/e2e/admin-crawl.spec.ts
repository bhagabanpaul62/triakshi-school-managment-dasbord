import { expect, test } from "@playwright/test";
import { as, at, SLUG, type Person } from "./admin-lib";
import { crawl } from "./crawl-lib";
import { consoleLogin, CONSOLE } from "./helpers";

// Follows every link under the website, theme, enquiries, domains, settings, audit, getting-started, support and profile pages
// (and /app) as six kinds of person, at desk width 1440 and phone width 375 (the crawl checks each page at both), then the console as owner.
test.describe.configure({ mode: "default", timeout: 1_500_000 });
test.use({ trace: "off" });

const AREAS = "website|theme|enquiries|domains|settings|audit|getting-started|support|profile";
const SECTIONS = new RegExp(`^/app/(${AREAS})(/|$)|^/app$`);
const ALL = ["/app", ...AREAS.split("|").map((a) => `/app/${a}`)];

for (const who of ["admin", "accounts", "teacher", "librarian", "frontoffice", "family"] as Person[]) {
  test(`${who}: every link in the website, settings and support areas works (1440 and 375)`, async ({ browser }) => {
    const { ctx, page } = await as(browser, who, 1440);
    try {
      // Start from what the menu shows, and the pages everyone has.
      await page.goto(at(""));
      const nav = await page.locator("nav[aria-label=Main] a[href], header a[href]").evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
      const shown = new Set([...nav.filter((h) => SECTIONS.test(h)), "/app", "/app/profile", "/app/support"]);
      const problems = await crawl(page, { slug: SLUG, sections: SECTIONS, starts: [...shown], role: who, desk: 1440 });
      // An address the menu does not show must refuse in a sentence, not break.
      for (const p of ALL.filter((a) => !shown.has(a))) {
        const r = await page.goto(at(p.replace(/^\/app\/?/, "")), { waitUntil: "load" });
        const body = await page.locator("body").innerText();
        if ((r?.status() ?? 0) >= 500 || /something went wrong|application error|couldn.t load|could not load/i.test(body)) problems.push(`${p} by address: ${r?.status()} ${/.{0,30}(something went wrong|application error|couldn.t load|could not load).{0,50}/i.exec(body)?.[0] ?? ""}`);
      }
      expect(problems.join("\n")).toBe("");
    } finally { await ctx.close(); }
  });
}

test("admin: insights, pages, the enquiry views and the role page fit a phone and a desktop", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin", 375);
  const bad: string[] = [];
  for (const width of [375, 1440]) for (const p of ["website/insights", "website/pages", "settings/roles/admin", "enquiries?view=board", "enquiries?view=list", "enquiries/reports", "getting-started"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(at(p), { waitUntil: "load" });
    await page.waitForTimeout(800);
    if (/could not load/i.test(await page.locator("body").innerText())) bad.push(`${p}: could not load`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) bad.push(`${p} at ${width}: ${over}px too wide`);
  }
  await ctx.close();
  expect(bad).toEqual([]);
});

test("accounts and teacher: /app first load has no hydration error", async ({ browser }) => {
  for (const who of ["accounts", "teacher"] as const) {
    const errs: string[] = [];
    const { ctx, page } = await as(browser, who);
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(at(""), { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await ctx.close();
    expect(errs, who).toEqual([]);
  }
});

test("owner: every link in the console support, notices, domains and schools pages works (1440 and 375)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await consoleLogin(page);
  const seen = new Set<string>(), queue = ["/support", "/notices", "/domains", "/schools"].map((p) => ({ p, from: "(start)" })), problems: string[] = [];
  const SEC = /^\/(support|notices|domains|schools)(\/|$)/;
  let errors: string[] = [], visited = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(`console: ${m.text().slice(0, 140)}`); });
  const shape = (p: string) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ":id");
  while (queue.length && visited < 120) {
    const { p, from } = queue.shift()!;
    const u = new URL(p, CONSOLE), key = shape(u.pathname) + (u.searchParams.get("tab") ? `?tab=${u.searchParams.get("tab")}` : "");
    if (seen.has(key) || /\/(export|pdf|csv|file)/.test(u.pathname) || u.pathname.startsWith("/api")) continue;
    seen.add(key); visited++; errors = [];
    const r = await page.goto(u.href, { waitUntil: "load", timeout: 60_000 }).catch((e: Error) => { problems.push(`no answer ${u.pathname} (from ${from}): ${e.message.split("\n")[0]}`); return null; });
    if (!r) continue;
    await page.waitForFunction(() => !document.querySelector("main [aria-busy=true], main .animate-pulse"), undefined, { timeout: 15_000 }).catch(() => problems.push(`still loading ${u.pathname}`));
    const body = await page.locator("body").innerText(), at0 = `${u.pathname}${u.search} (from ${from})`;
    if (r.status() >= 400) problems.push(`${r.status()} ${at0}`);
    else if (/something went wrong|application error|page not found|could not load|couldn.t load|do not have permission|not allowed/i.test(body)) problems.push(`error text on ${at0}: ${/.{0,40}(something went wrong|application error|page not found|could not load|couldn.t load|do not have permission|not allowed).{0,60}/i.exec(body)![0].replace(/\s+/g, " ")}`);
    if (/undefined|NaN|\[object Object\]|Invalid Date/.test(body)) problems.push(`broken value on ${at0}: ${/.{0,30}(undefined|NaN|\[object Object\]|Invalid Date).{0,30}/.exec(body)![0].replace(/\s+/g, " ")}`);
    if (errors.length) problems.push(`script error on ${at0}: ${errors[0]}`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(100);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${over}px too wide on a phone: ${at0}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const l of await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      const n = new URL(l);
      if (n.origin === new URL(CONSOLE).origin && SEC.test(n.pathname) && !seen.has(shape(n.pathname))) queue.push({ p: n.pathname + n.search, from: u.pathname });
    }
  }
  console.log(`owner console: ${visited} pages, ${problems.length} problems`);
  expect(problems.join("\n")).toBe("");
});
