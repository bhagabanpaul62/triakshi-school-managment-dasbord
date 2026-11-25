import { expect, test, type Page } from "@playwright/test";
import { as, at, REFUSAL, settled, type Person } from "./admin-lib";

// K12 (docs/WEBSITE-ADMIN-PRD.md section 16): the home page of seven kinds of person. Every link on it opens a page that does not
// refuse them; every number on it opens a list, and the list shows that number (compared where the list states a total).
test.describe.configure({ mode: "default", timeout: 600_000 });
test.use({ trace: "off" });

const PEOPLE: Person[] = ["admin", "accounts", "cashier", "teacher", "librarian", "frontoffice", "family"];
const FILE = /\/(pdf|csv|file|voucher|receipt|slip|template|statement|export)(\/|$|\?)|\/files\/|^\/api\//;
const num = (s: string) => Number(s.replace(/,/g, ""));

type Fig = { raw: string; kind: "count" | "money" | "percent"; value: number };
/** The figure a home tile carries: a line that is only a number ("120", "₹2.4L", "74%"). */
function figureOf(text: string): Fig | null {
  for (const line of text.split("\n").map((l) => l.trim())) {
    let m = /^₹\s?([\d,]+(?:\.\d+)?)\s?(L|K|Cr)?$/.exec(line);
    if (m) return { raw: line, kind: "money", value: num(m[1]!) * ({ L: 1e5, K: 1e3, Cr: 1e7 } as Record<string, number>)[m[2] ?? ""]! || num(m[1]!) };
    m = /^(\d+(?:\.\d+)?)%$/.exec(line);
    if (m) return { raw: line, kind: "percent", value: Number(m[1]) };
    m = /^(\d[\d,]*)$/.exec(line);
    if (m) return { raw: line, kind: "count", value: num(m[1]!) };
  }
  return null;
}

/** What a list says about how many there are: "120 students", "of 120", "Total 120", plus table rows. */
async function listFigures(page: Page) {
  const body = (await page.locator("main").first().innerText().catch(() => "")) || (await page.locator("body").innerText());
  const said = new Set<number>();
  for (const m of body.matchAll(/(\d[\d,]*)\s+(?:results?|students?|enquir(?:y|ies)|requests?|bills?|items?|records?|overdue|open|in total|late|waiting|new|books?|visits?|claims?|dues?)\b/gi)) said.add(num(m[1]!));
  for (const m of body.matchAll(/\b(?:total|of|showing|count)\b\D{0,14}(\d[\d,]*)/gi)) said.add(num(m[1]!));
  const rows = Math.max(0, (await page.getByRole("row").count()) - 1);
  const money = [...body.matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map((m) => num(m[1]!));
  return { body, said, rows, money, hasTable: (await page.getByRole("table").count()) > 0 };
}

for (const who of PEOPLE) {
  test(`${who}: home links open, numbers open the list that proves them`, async ({ browser }) => {
    const { ctx, page } = await as(browser, who);
    const problems: string[] = [], notes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(40[14])/.test(m.text())) errors.push(`console: ${m.text().slice(0, 140)}`); });
    try {
      await page.goto(at(""), { waitUntil: "load" });
      await settled(page);
      await page.waitForTimeout(400);
      const home = await page.locator("main").innerText();
      if (REFUSAL.test(home)) problems.push(`home itself says: ${REFUSAL.exec(home)![0]}`);
      if (/undefined|NaN|\[object Object\]|Invalid Date/.test(home)) problems.push(`broken value on home: ${/.{0,30}(undefined|NaN|\[object Object\]|Invalid Date).{0,30}/.exec(home)![0].replace(/\s+/g, " ")}`);
      const links = await page.locator("main a[href]").evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).getAttribute("href")!, text: (a as HTMLElement).innerText.trim() })));
      const internal = links.filter((l) => l.href.startsWith("/app"));
      const hrefs = [...new Set(internal.map((l) => l.href))];
      const tiles = [...new Map(internal.map((l) => [l.href, { ...l, fig: figureOf(l.text) }] as const)).values()].filter((l) => l.fig);
      console.log(`${who}: ${internal.length} links on home, ${hrefs.length} distinct, ${tiles.length} numbers [${tiles.map((t) => `${t.fig!.raw} -> ${t.href}`).join(" | ")}]`);
      const buttons = await page.locator("main button:visible").evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.trim() || b.getAttribute("aria-label") || "").filter(Boolean));
      console.log(`${who}: buttons on home (not pressed, they change data): ${buttons.join(" | ") || "none"}`);

      // Every link a person is shown opens a page that does not refuse them.
      for (const href of hrefs) {
        if (href === "/app") continue;
        if (FILE.test(href)) { const r = await page.request.get(at("").replace(/\/app$/, "") + href); if (r.status() >= 400) problems.push(`${r.status()} file ${href}`); continue; }
        errors.length = 0;
        const r = await page.goto(at("").replace(/\/app$/, "") + href, { waitUntil: "load" }).catch((e: Error) => { problems.push(`no answer ${href}: ${e.message.split("\n")[0]}`); return null; });
        if (!r) continue;
        await settled(page);
        const path = new URL(page.url()).pathname, body = await page.locator("body").innerText();
        const want = new URL(href, "http://x").pathname;
        if (r.status() >= 400) problems.push(`${r.status()} ${href}`);
        else if (path === "/app" && want !== "/app") problems.push(`${href} bounced back to /app (a link shown on home that the person cannot use)`);
        else if (REFUSAL.test(body)) problems.push(`${href} says: ${/.{0,40}(something went wrong|application error|school not found|page not found|could not load|couldn.t load|do not have permission|not allowed|ask an admin if you need access).{0,60}/i.exec(body)![0].replace(/\s+/g, " ")}`);
        if (errors.length) problems.push(`script error on ${href}: ${errors[0]}`);
      }

      // Every number: open it from home, read the figure at that moment, and compare with the list.
      for (const t of tiles) {
        await page.goto(at(""), { waitUntil: "load" });
        await settled(page);
        await page.waitForTimeout(1800); // the tiles count up: read the figure after it stops
        const tile = page.locator(`main a[href="${t.href}"]`).filter({ hasText: t.fig!.raw.slice(0, 1) === "₹" ? /₹/ : /\d/ }).first();
        const now = figureOf(await tile.innerText()) ?? t.fig!;
        await tile.click();
        await page.waitForURL((u) => u.pathname !== "/app", { timeout: 30_000 });
        const record = /\/[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(new URL(page.url()).pathname);
        let verdict = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          await settled(page);
          await page.waitForTimeout(1800); // figures on the fee pages count up for a second
          const l = await listFigures(page);
          const tag = `${t.href} (home says ${now.raw})`;
          if (REFUSAL.test(l.body)) { problems.push(`${tag}: list says ${REFUSAL.exec(l.body)![0]}`); verdict = "refused"; break; }
          if (now.kind === "count") {
            const ok = l.said.has(now.value) || l.rows === now.value || new RegExp(`(^|[^\\d,.])${now.raw.replace(/,/g, ",?")}([^\\d]|$)`).test(l.body);
            const comparable = l.said.size > 0 || l.hasTable;
            verdict = ok ? "" : comparable ? `${tag}: list states [${[...l.said].slice(0, 6).join(", ")}] and shows ${l.rows} rows, not ${now.raw}` : `NOTE ${tag}: list states no total to compare`;
          } else if (now.kind === "money") {
            const near = l.money.some((m) => Math.abs(m - now.value) <= Math.max(now.value * 0.06, 5_000));
            verdict = near ? "" : record ? `NOTE ${tag}: a record page, it states no overdue total to compare` : l.money.length ? `${tag}: no ₹ amount on the list within 6% (amounts: ${l.money.slice(0, 5).join(", ")})` : `NOTE ${tag}: list shows no rupee total to compare`;
          } else verdict = `NOTE ${tag}: percentage, list opened (not compared)`;
          if (!verdict || verdict.startsWith("NOTE") || attempt === 1) break;
          // Other runs change the school's data: read the tile and the list once more before calling it a mismatch.
          await page.goto(at(""), { waitUntil: "load" }); await settled(page); await page.waitForTimeout(1800);
          const again = figureOf(await page.locator(`main a[href="${t.href}"]`).filter({ hasText: now.kind === "money" ? /₹/ : /\d/ }).first().innerText()); if (again) Object.assign(now, again);
          await page.locator(`main a[href="${t.href}"]`).filter({ hasText: now.kind === "money" ? /₹/ : /\d/ }).first().click();
          await page.waitForURL((u) => u.pathname !== "/app", { timeout: 30_000 });
        }
        if (verdict.startsWith("NOTE")) notes.push(verdict.slice(5)); else if (verdict && verdict !== "refused") problems.push(verdict);
      }
    } finally { await ctx.close(); }
    for (const n of notes) console.log(`NOTE ${who} ${n}`);
    console.log(`${who}: ${problems.length} problems`);
    expect(problems.join("\n")).toBe("");
  });
}

test("family: the home Fees panel's ledger link opens their fees", async ({ browser }) => {
  const { ctx, page } = await as(browser, "family");
  await page.goto(at(""));
  await settled(page);
  await page.getByRole("link", { name: "View ledger and receipts" }).click();
  await settled(page);
  await expect(page.locator("body")).not.toContainText(/couldn.t load fees/i);
  await ctx.close();
});
