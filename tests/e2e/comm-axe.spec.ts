import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { at, People, type Who } from "./comm-lib";

// Accessibility of the communication screens on the production build: axe (serious or critical fail) and keyboard-only. Read only.
test.describe.configure({ timeout: 300_000 });
// Traces of big pages take more memory than the tab has.
test.use({ trace: "off" });

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A screen: a fixed path, or the first link on a list page that matches `open` (a record, a conversation...). */
type Screen = { name: string; path: string; open?: RegExp };
const SCREENS: Screen[] = [
  { name: "list", path: "announcements" },
  { name: "record", path: "announcements", open: new RegExp(`/app/announcements/${UUID}$`) },
  { name: "write", path: "announcements/new" },
  { name: "inbox", path: "messages" },
  { name: "conversation", path: "messages", open: new RegExp(`/app/messages\\?thread=${UUID}|/app/messages/${UUID}`) },
  { name: "requests", path: "requests" },
  { name: "request", path: "requests", open: new RegExp(`/app/requests/${UUID}$`) },
  { name: "calendar", path: "events" },
  { name: "event", path: "events", open: new RegExp(`/app/events/${UUID}$`) },
  { name: "meetings", path: "meetings" },
  { name: "meeting", path: "meetings", open: new RegExp(`/app/meetings/${UUID}$`) },
  { name: "notifications", path: "notifications" },
  { name: "preferences", path: "notifications/preferences" },
  { name: "holidays", path: "attendance/holidays" },
  { name: "safeguarding", path: "safeguarding" },
  { name: "settings", path: "settings/communication" },
];

let people: People;
test.beforeAll(({ browser }) => { people = new People(browser); });
test.afterAll(() => people.close());

async function resolve(page: Page, s: Screen) {
  const res = await page.goto(at(s.path), { waitUntil: "networkidle" });
  if (!res || res.status() >= 400 || !new URL(page.url()).pathname.startsWith(`/app/${s.path.split("/")[0]}`)) return null; // not this person's screen
  if (!s.open) return page.url();
  const hrefs = await page.locator("main a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  const href = hrefs.find((h) => s.open!.test(new URL(h).pathname + new URL(h).search));
  if (!href) return null;
  await page.goto(href, { waitUntil: "networkidle" });
  return href;
}

for (const who of ["admin", "teacher", "family"] as Who[]) {
  test(`axe: ${who}`, async () => {
    const home = await people.as(who);
    const found: string[] = [], skipped: string[] = [];
    for (const s of SCREENS) {
      // A fresh tab per screen: sixteen passes in one tab use up its memory.
      const page = await home.context().newPage();
      if (!(await resolve(page, s))) { skipped.push(s.name); await page.close(); continue; }
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))
        for (const n of v.nodes) found.push(`${v.impact} ${v.id} | ${who}/${s.name} ${new URL(page.url()).pathname.replace(new RegExp(UUID), ":id")} | ${n.target.join(" ").replace(/:nth-child\(\d+\)/g, "")} | ${n.html.slice(0, 90)} | ${n.any[0]?.message?.slice(0, 110) ?? ""}`);
      await page.close();
    }
    console.log(`axe ${who}: checked ${SCREENS.length - skipped.length}, skipped [${skipped.join(", ")}], violations ${found.length}`);
    const uniq = [...new Set(found)];
    for (const f of uniq) console.log("AXE " + f);
    expect(uniq).toEqual([]);
  });
}

// Keyboard only: Tab from the top of the page until the primary action has focus, and it must show a ring.
const PRIMARY: { name: string; path: string; action: RegExp }[] = [
  { name: "notices", path: "announcements", action: /^new notice$/i },
  { name: "messages", path: "messages", action: /^new message$/i },
  { name: "requests", path: "requests", action: /^new request$/i },
];
for (const p of PRIMARY) {
  test(`keyboard: ${p.name} primary action is reachable with a visible focus ring`, async () => {
    const page = await people.as("admin");
    await page.goto(at(p.path), { waitUntil: "networkidle" });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // Tab from the top, without clicking (the corner is the logo link)
    let seen = "";
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press("Tab");
      const read = () => page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        const c = getComputedStyle(e);
        const label = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ");
        return { label, inMain: !!e.closest("main"), ring: (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,?\s*/g, "").replace(/none/, "").trim() !== "" };
      });
      let f = await read();
      if (f && f.inMain && p.action.test(f.label)) {
        await page.waitForTimeout(300); // focus styles may transition in
        f = (await read())!;
        seen = f.label;
        expect(f.ring, `focus ring on "${f.label}"`).toBe(true);
        break;
      }
    }
    expect(seen, "primary action never got focus in 150 Tab presses").not.toBe("");
  });
}
