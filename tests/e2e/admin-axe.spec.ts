import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { as, at, SLUG } from "./admin-lib";
import { SCHOOL } from "./helpers";

// axe (serious or critical fail) on the main pages of the six areas as the admin, and on the public site in all five templates.
test.describe.configure({ timeout: 600_000 });
test.use({ trace: "off" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const AREAS: Record<string, string[]> = {
  home: ["", "getting-started"],
  website: ["website", "theme"],
  enquiries: ["enquiries", "enquiries?view=list&stage=open", "enquiries/reports"],
  domains: ["domains"],
  settings: ["settings", "settings/school", "settings/users", "settings/roles", "settings/sign-ins", "settings/privacy", "settings/export", "settings/access", "settings/modules", "settings/account", "audit"],
  support: ["support", "profile"],
};

async function scan(ctx: BrowserContext, url: string, label: string, found: string[]) {
  const page = await ctx.newPage(); // a fresh tab per page keeps memory down
  try {
    const r = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!r || r.status() >= 400) { found.push(`status ${r?.status()} | ${label}`); return; }
    await page.waitForTimeout(300);
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    for (const v of res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))
      for (const n of v.nodes) found.push(`${v.impact} ${v.id} | ${label} | ${n.target.join(" ").replace(/:nth-child\(\d+\)/g, "")} | ${n.html.slice(0, 90)} | ${n.any[0]?.message?.slice(0, 100) ?? ""}`);
  } finally { await page.close(); }
}

test("axe: admin, the six areas", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin");
  const found: string[] = [];
  let n = 0;
  for (const [area, paths] of Object.entries(AREAS)) for (const p of paths) { await scan(ctx, at(p), `${area}: /app/${p}`.replace(UUID, ":id"), found); n++; }
  // The first record on the two lists, and the editor's first section.
  for (const [list, re] of [["enquiries?view=list&stage=open", /\/app\/enquiries\/[0-9a-f-]{36}$/], ["settings/users", /\/app\/settings\/users\/[0-9a-f-]{36}$/], ["support", /\/app\/support\/[0-9a-f-]{36}$/]] as const) {
    await page.goto(at(list), { waitUntil: "networkidle" });
    const href = (await page.locator("main a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))).find((h) => re.test(new URL(h).pathname));
    if (href) { await scan(ctx, href, `record: ${new URL(href).pathname.replace(UUID, ":id")}`, found); n++; }
  }
  const uniq = [...new Set(found)];
  console.log(`axe admin: ${n} pages, violations ${uniq.length}`);
  for (const f of uniq) console.log("AXE " + f);
  await ctx.close();
  expect(uniq).toEqual([]);
});

for (const key of ["classic", "modern", "minimal", "campus", "playful"]) {
  // Fixed: AA-safe site colours (siteRoles) and no (site)/loading.tsx, so an unknown address answers a real 404.
  test(`axe: public site, template ${key}`, async ({ browser }) => {
    const { ctx } = await as(browser, "admin"); // the draft preview of a template needs the website admin
    const found: string[] = [];
    for (const p of ["", "admissions", "news", "privacy", "no-such-page-here"]) {
      const url = `${SCHOOL(SLUG)}/${p}${p ? "?" : "?"}preview=1&template=${key}`;
      const page = await ctx.newPage();
      try {
        const r = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
        const label = `${key}: /${p || "(home)"}`;
        const want404 = p === "no-such-page-here";
        if (!r || (want404 ? r.status() !== 404 : r.status() >= 400)) found.push(`status ${r?.status()} | ${label} (wanted ${want404 ? 404 : "under 400"})`);
        await page.waitForTimeout(300);
        const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const v of res.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))
          for (const n of v.nodes) found.push(`${v.impact} ${v.id} | ${label} | ${n.target.join(" ").replace(/:nth-child\(\d+\)/g, "")} | ${n.html.slice(0, 90)} | ${n.any[0]?.message?.slice(0, 100) ?? ""}`);
      } finally { await page.close(); }
    }
    const uniq = [...new Set(found)];
    console.log(`axe public ${key}: violations ${uniq.length}`);
    for (const f of uniq) console.log("AXE " + f);
    await ctx.close();
    expect(uniq).toEqual([]);
  });
}
