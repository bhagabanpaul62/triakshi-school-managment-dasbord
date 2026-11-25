import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SCHOOL } from "./helpers";

// Follows every link inside the given sections as one person. A dead link, an error page, a refusal reached by a link the
// person was shown, a broken value, a script error or a page wider than a phone is a problem.
const FILE = /\/(pdf|csv|file|voucher|receipt|slip|template|statement|tuition-certificate|no-dues|bank-file)(\/|$|\?)|\/export(\/|$|\?)|\/files\/|^\/api\/|\.ics/;
const MAX = Number(process.env.CRAWL_MAX ?? 220);
/** Set CRAWL_SHOTS=dir to keep a picture of every page at desk and phone width. */
const SHOTS = process.env.CRAWL_SHOTS;

/** One page per shape: ids and most query values collapse, so a list of 300 bills is visited once. */
const shape = (u: URL) => u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ":id") + [...u.searchParams.keys()].filter((k) => ["tab", "kind", "state", "status"].includes(k)).map((k) => `?${k}=${u.searchParams.get(k)}`).join("");

export async function crawl(page: Page, o: { slug: string; sections: RegExp; starts: string[]; role: string }) {
  const { slug, sections, starts, role } = o;
  const base = SCHOOL(slug), seen = new Set<string>(), queue = starts.map((s) => ({ href: base + s, from: "(start)" })), problems: string[] = [];
  let errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let visited = 0;
  while (queue.length && visited < MAX) {
    const { href, from } = queue.shift()!;
    const u = new URL(href, base), key = shape(u);
    if (seen.has(key)) continue;
    seen.add(key);
    if (FILE.test(u.pathname + u.search)) {
      const r = await page.request.get(u.href, { maxRedirects: 5 });
      if (r.status() >= 400) problems.push(`${r.status()} file ${u.pathname}${u.search} (from ${from})`);
      continue;
    }
    visited++;
    errors = [];
    const r = await page.goto(u.href, { waitUntil: "load", timeout: 45_000 }).catch((e: Error) => { problems.push(`no answer ${u.pathname} (from ${from}): ${e.message.split("\n")[0]}`); return null; });
    if (!r) continue;
    // Skeletons stream in first: wait for the real content, or the page was never checked.
    await page.waitForFunction(() => !document.querySelector("main [aria-busy=true], main .animate-pulse"), undefined, { timeout: 15_000 }).catch(() => problems.push(`still loading after 15 s: ${u.pathname} (from ${from})`));
    await page.waitForTimeout(150);
    const body = await page.locator("body").innerText();
    const at = `${u.pathname}${u.search} (from ${from})`;
    if (r.status() >= 400) problems.push(`${r.status()} ${at}`);
    else if (/something went wrong|application error|school not found|page not found|could not load|couldn.t load|do not have permission|not allowed/i.test(body)) problems.push(`error text on ${at}: ${/.{0,60}(something went wrong|application error|school not found|page not found|could not load|couldn.t load|do not have permission|not allowed).{0,80}/i.exec(body)![0].replace(/\s+/g, " ")}`);
    if (errors.length) problems.push(`script error on ${at}: ${errors[0]!.slice(0, 160)}`);
    if (/undefined|NaN|\[object Object\]|Invalid Date/.test(body)) problems.push(`broken value on ${at}: ${/.{0,40}(undefined|NaN|\[object Object\]|Invalid Date).{0,40}/.exec(body)![0].replace(/\s+/g, " ")}`);
    const shot = SHOTS ? `${SHOTS}/${role}${key.replace(/[^a-z0-9]+/gi, "_")}` : null;
    if (shot) { mkdirSync(SHOTS!, { recursive: true }); await page.screenshot({ path: `${shot}.desk.png` }); }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(80);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${over}px too wide on a phone: ${at}`);
    if (shot) await page.screenshot({ path: `${shot}.phone.png` });
    await page.setViewportSize({ width: 1366, height: 900 });
    const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const l of links) {
      const n = new URL(l, base);
      if (n.origin === new URL(base).origin && sections.test(n.pathname) && !seen.has(shape(n))) queue.push({ href: n.href, from: u.pathname });
    }
  }
  console.log(`${role}: ${visited} pages, ${seen.size} shapes, ${problems.length} problems`);
  return problems;
}
