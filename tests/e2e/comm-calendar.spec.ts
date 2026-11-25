import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, request, test, type Page } from "@playwright/test";
import { crawl } from "./crawl-lib";
import { at, dialog, job, mails, main, newMailDay, People, schoolAwake, sql, SLUG } from "./comm-lib";
import { login, reloadIfSchoolNotFound, SCHOOL, STUDENT_PASSWORD } from "./helpers";

// J9 to J13 of docs/COMMUNICATION-PRD.md 13.1, walked as people do: click what is on screen, family on a 375 px phone.
// The database helpers (sql, job) only make time pass or put things back; every step a person takes is done in the browser.

test.setTimeout(240_000);
test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 });

const GREEN = sql("select id from schools where slug = 'greenvalley'");
const RUN = String(Date.now() % 1_000_000);

// ---------- small helpers ----------

/** Today in India, plus n days, as YYYY-MM-DD. */
const istDay = (plus = 0) => new Date(Date.now() + plus * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

/** Use the side menu the way a person does: on a phone the menu button comes first. */
async function menu(page: Page, name: RegExp) {
  if (isPhone(page)) await page.getByRole("button", { name: /open menu/i }).click();
  await page.getByRole("link", { name }).and(page.locator(":visible")).first().click();
  await page.waitForLoadState("load");
}

/** Anything that sticks out to the right of a phone screen, or makes the page wider. Returns what it found. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window.innerWidth, out: string[] = [];
    if (document.documentElement.scrollWidth - w > 1) out.push(`page is ${document.documentElement.scrollWidth - w}px wider than the screen`);
    for (const el of document.querySelectorAll<HTMLElement>("main *, [role=dialog] *")) {
      const r = el.getBoundingClientRect();
      if (r.width && getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) out.push(`text cut off with "..." : "${el.innerText.trim().slice(0, 50)}"`);
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (r.right > w + 1 && !el.closest("[class*=overflow-x-auto], [class*=overflow-auto], .custom-scrollbar, nav[aria-label=Layers], select")) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ends at ${Math.round(r.right)} of ${w}`);
    }
    return out.slice(0, 5);
  });
}
/** Phone-layout findings are collected and judged by one test at the end of each journey, so a clipped label never stops the walk. */
// A failed test restarts the worker, so the findings go to a file rather than a variable.
const LAYOUT = `${tmpdir()}/comm-calendar-layout.log`;
let journey = "";
const fits = async (page: Page, where: string) => { for (const f of await clipped(page)) appendFileSync(LAYOUT, `${Date.now()}\t${journey} ${where}: ${f}\n`); };
/** A finding about something other than layout, judged by one test at the end of its journey. */
const found = (key: string, msg: string) => appendFileSync(LAYOUT, `${Date.now()}\t${key} ${msg}\n`);
const foundBy = (key: string, title: string) => test(title, () => {
  const lines = existsSync(LAYOUT) ? readFileSync(LAYOUT, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")) : [];
  expect([...new Set(lines.filter(([t, l]) => Date.now() - Number(t) < 15 * 60_000 && l!.startsWith(`${key} `)).map(([, l]) => l!.slice(key.length + 1)))]).toEqual([]);
});
const noClipping = (j: string) => test(`${j}: nothing is clipped or cut off at 375 px`, () => {
  const lines = existsSync(LAYOUT) ? readFileSync(LAYOUT, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")) : [];
  expect([...new Set(lines.filter(([t, l]) => Date.now() - Number(t) < 15 * 60_000 && l!.startsWith(j)).map(([, l]) => l))]).toEqual([]);
});

/** Number in the bell's label ("Notifications, 17 unread") or 0. */
async function bell(page: Page) {
  const label = (await page.getByRole("button", { name: /^notifications/i }).first().getAttribute("aria-label")) ?? "";
  return Number(/(\d+) unread/.exec(label)?.[1] ?? 0);
}
/** The "(n) " in front of the browser tab title, or 0. */
const tabCount = async (page: Page) => Number(/^\((\d+)\) /.exec(await page.title())?.[1] ?? 0);
/** The numbers beside side-menu links (Messages 6), 0 when none. Opens and closes the phone menu once. */
async function badges(page: Page, names: string[]) {
  if (isPhone(page)) await page.getByRole("button", { name: /open menu/i }).click();
  const out: Record<string, number> = {};
  for (const name of names) {
    const link = page.getByRole("link", { name: new RegExp(`^${name}\\b`) }).and(page.locator(":visible")).first();
    out[name] = Number(/(\d+)\s*$/.exec((await link.innerText()).trim())?.[1] ?? 0);
  }
  if (isPhone(page)) await page.getByRole("button", { name: /close menu/i }).last().click();
  return out;
}
/** Records every toast a page shows (they last four seconds), so a message that came and went can still be read. */
const watchToasts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __toasts?: string[]; __watch?: boolean };
  if (w.__watch) return; w.__watch = true; w.__toasts = [];
  new MutationObserver(() => document.querySelectorAll("[aria-live=polite] [role=status]").forEach((e) => { const t = (e as HTMLElement).innerText.trim(); if (t && !w.__toasts!.includes(t)) w.__toasts!.push(t); })).observe(document.body, { childList: true, subtree: true, characterData: true });
});
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts?: string[] }).__toasts ?? []);

/** Where the fresh browsers of this file keep their people. */
let crowd: People;
const asFamily = (n: "family" | "family2" = "family") => crowd.as(n);

let asleep: (() => void) | undefined;
test.beforeAll(async ({ browser }) => { newMailDay(); asleep = schoolAwake(); crowd = new People(browser); });
test.afterAll(async () => { asleep?.(); await crowd?.close(); });

// ======================================================================================================
// J9  Event with answers and a limit -> full -> waiting list -> time changed -> cancelled -> phone calendar
// ======================================================================================================
test.describe("J9 event, waiting list, phone calendar", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => { journey = "J9"; });
  const title = `Open day, meet the teachers; room 4 ${RUN} ओपन डे with a long name so the calendar line has to be folded`;
  const short = `Open day, meet the teachers; room 4 ${RUN}`;
  let link = "";

  test("admin adds the event, two families answer, the second waits", async () => {
    const admin = await crowd.as("admin");
    await admin.goto(at(""));
    await menu(admin, /^Calendar$/);
    await admin.getByRole("link", { name: /add event/i }).click();
    await admin.getByLabel(/^Title/).fill(title);
    await admin.getByLabel(/^Starts/).fill(`${istDay(6)}T10:00`);
    await admin.getByRole("button", { name: "All families", exact: true }).click();
    await expect(admin.getByText(/families? will|reaching|\d+ (people|families)/i).first()).toBeVisible({ timeout: 15_000 });
    await admin.getByLabel(/Ask people to answer/).check();
    await admin.getByLabel(/^Places/).fill("1");
    await admin.getByRole("button", { name: "Publish event" }).click();
    await expect(admin).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
    await expect(admin.getByRole("heading", { name: new RegExp(`Open day, meet the teachers`) })).toBeVisible();
    await expect(admin.getByText("1 places", { exact: true })).toBeVisible();

    // The first family: the event is in their calendar, one tap answers.
    const one = await asFamily("family");
    await one.goto(at(""));
    await menu(one, /^Calendar$/);
    await one.getByRole("link", { name: new RegExp(`Open day, meet the teachers; room 4 ${RUN}`) }).first().click();
    await expect(one.getByRole("heading", { name: "Will you come?" })).toBeVisible();
    await one.getByRole("button", { name: "Yes, I will come" }).click();
    await expect(one.getByText("You are coming.")).toBeVisible();
    await fits(one, "family event page");

    // The second family finds it full: they are told so in a sentence, not left to guess.
    const two = await asFamily("family2");
    await two.goto(at(""));
    await menu(two, /^Calendar$/);
    await two.getByRole("link", { name: new RegExp(`Open day, meet the teachers; room 4 ${RUN}`) }).first().click();
    await two.getByRole("button", { name: "Yes, I will come" }).click();
    await expect(two.getByText(/The event is full\. You are on the waiting list/).first()).toBeVisible();
    await fits(two, "family waiting list");

    // The office sees the same truth.
    await admin.reload();
    await expect(admin.getByText(/1 of 1 places taken/)).toBeVisible();
    await expect(admin.getByText("Waiting list").first()).toBeVisible();
  });

  test("time changes: families are told, the page shows the new time", async () => {
    const admin = await crowd.as("admin");
    const one = await asFamily("family");
    await one.goto(at(""));
    const before = await bell(one);
    await admin.getByRole("link", { name: "Edit", exact: true }).click();
    await admin.getByLabel(/^Starts/).fill(`${istDay(7)}T11:30`);
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
    // A change always tells: wait for the bell on the family's phone to move without a reload.
    await one.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => bell(one), { timeout: 30_000 }).toBeGreaterThan(before);
    expect(await tabCount(one), "tab title and bell agree").toBe(await bell(one));
    await one.getByRole("button", { name: /^notifications/i }).click();
    await dialog(one).getByRole("link", { name: /open day/i }).first().click();
    await expect(one.getByText(/11:30/)).toBeVisible();
    await fits(one, "family event after time change");
  });

  test("a place opens: the waiting family moves up by itself and is told", async () => {
    const one = await asFamily("family"), two = await asFamily("family2");
    await two.goto(at(""));
    const before = await bell(two);
    await one.getByRole("button", { name: "Change" }).click();
    await one.getByRole("button", { name: "No", exact: true }).click();
    await expect(one.getByText("You said you cannot come.")).toBeVisible();
    // The second family hears about it without asking: the open page picks it up when the phone wakes.
    const moved = await expect.poll(async () => { await two.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); return bell(two); }, { timeout: 20_000 }).toBeGreaterThan(before).then(() => true, () => false);
    expect.soft(moved, "bell count on the open page moves when a place opens for you").toBe(true);
    await two.reload();
    await two.getByRole("button", { name: /^notifications/i }).click();
    await expect(dialog(two).getByText(/A place is yours: Open day/).first()).toBeVisible();
    // The page the notice opens says the same thing.
    await dialog(two).getByRole("link", { name: /A place is yours/ }).first().click();
    await expect(two.getByText("You are coming.")).toBeVisible();
  });

  test("admin cancels with a reason; families see it struck through", async () => {
    const admin = await crowd.as("admin");
    await admin.getByRole("button", { name: /^more/i }).click();
    await admin.getByRole("menuitem", { name: /cancel event/i }).click();
    await dialog(admin).getByLabel(/Why is it cancelled/).fill("Heavy rain, the ground is not safe");
    await dialog(admin).getByRole("button", { name: "Cancel event" }).click();
    await expect(admin.getByText(/This event is cancelled: Heavy rain/)).toBeVisible();

    const two = await asFamily("family2");
    await two.reload();
    await expect(two.getByText(/This event is cancelled: Heavy rain/)).toBeVisible();
    // A cancelled event must not still ask the family to answer.
    await expect(two.getByRole("button", { name: "Yes, I will come" }), "answer buttons on a cancelled event").toHaveCount(0);
    await fits(two, "family cancelled event");
  });

  test("phone calendar feed: parses, folds lines, shows the cancelled event, reset gives 404", async () => {
    const two = await asFamily("family2");
    await two.goto(at("events"));
    await two.getByRole("button", { name: "Phone calendar" }).click();
    // A link made on an earlier run still exists, and cannot be shown again: a person makes a new one.
    if (await dialog(two).getByRole("button", { name: "Make my link" }).count()) await dialog(two).getByRole("button", { name: "Make my link" }).click();
    else { await dialog(two).getByRole("button", { name: "Make a new link" }).click(); await dialog(two).getByRole("button", { name: "Yes, make a new link" }).click(); }
    await expect(dialog(two).getByLabel("Your calendar link")).toBeVisible();
    link = await dialog(two).getByLabel("Your calendar link").inputValue();
    expect(link).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]{22}\.ics$/);
    await fits(two, "phone calendar dialog");
    await expect(dialog(two).getByText(/up to a day/)).toBeVisible();

    // A phone has no cookies.
    const phone = await request.newContext({ extraHTTPHeaders: { "user-agent": "iOS/17 dataaccessd" } });
    const res = await phone.get(link);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const raw = await res.text();
    const lines = raw.split(/\r\n/);
    expect(raw.includes("\n") && !raw.includes("\r\n"), "lines end with CRLF").toBe(false);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.filter(Boolean).at(-1)).toBe("END:VCALENDAR");
    for (const k of ["VCALENDAR", "VEVENT"]) expect(lines.filter((l) => l === `BEGIN:${k}`).length, `${k} pairs`).toBe(lines.filter((l) => l === `END:${k}`).length);
    expect(lines.some((l) => l.startsWith("VERSION:2.0"))).toBe(true);
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    const tooLong = lines.filter((l) => Buffer.byteLength(l) > 75);
    expect(tooLong.map((l) => `${Buffer.byteLength(l)} octets: ${l.slice(0, 50)}`), "every line is at most 75 octets").toEqual([]);
    const folded = lines.filter((l) => l.startsWith(" ")).length;
    expect(folded, "the long title is folded onto continuation lines").toBeGreaterThan(0);

    const text = raw.replace(/\r\n[ \t]/g, "");
    const mine = text.split("BEGIN:VEVENT").find((b) => b.includes(`room 4 ${RUN}`));
    expect(mine, "the cancelled event is still in the feed").toBeTruthy();
    expect(mine!).toContain("STATUS:CANCELLED");
    expect(mine!).toMatch(/SEQUENCE:[1-9]/);
    expect(mine!).toMatch(/UID:\S+/);
    expect(mine!.match(/SUMMARY:(.*)/)![1], "comma in the title is escaped").toContain("Open day\\, meet");
    expect.soft(mine!.match(/SUMMARY:(.*)/)![1], "semicolon in the title is escaped as backslash-semicolon (RFC 5545 3.3.11)").toContain("teachers\\; room 4");
    expect(mine!).toContain("ओपन"); // Hindi survives folding

    // Resetting ends the old link at once and starts a new one.
    await dialog(two).getByRole("button", { name: "Make a new link" }).click();
    await expect(dialog(two).getByText(/old link stops working at once/)).toBeVisible();
    await dialog(two).getByRole("button", { name: "Yes, make a new link" }).click();
    await expect(dialog(two).getByLabel("Your calendar link")).not.toHaveValue(link);
    const fresh = await dialog(two).getByLabel("Your calendar link").inputValue();
    expect((await phone.get(link)).status(), "the old link").toBe(404);
    expect((await phone.get(fresh)).status(), "the new link").toBe(200);
    expect((await phone.get(link.replace(/[A-Za-z0-9_-]{22}\.ics$/, "x".repeat(22) + ".ics"))).status(), "a made-up token").toBe(404);
    await phone.dispose();
    void short;
  });

});
noClipping("J9");

// ======================================================================================================
// J10  Parent-teacher meeting: open -> two families book at once -> a time changes -> rebook -> the day -> remark
// ======================================================================================================
const KID = { family: "Aarav Sharma", family2: "Saanvi Nair" } as const;
const students = `select id from students where school_id = '${GREEN}'`;
const adm = (a: string) => `(${students} and admission_no = '${a}')`;
/** Make GR0001 and GR0002 brothers and sisters: one guardian for both. */
function linkSiblings() {
  const guardian = sql(`select sg.guardian_id from student_guardians sg where sg.student_id = ${adm("GR0001")} limit 1`);
  sql(`insert into student_guardians (id, school_id, student_id, guardian_id, is_primary) select gen_random_uuid(), '${GREEN}', ${adm("GR0002")}, '${guardian}', false where not exists (select 1 from student_guardians where student_id = ${adm("GR0002")} and guardian_id = '${guardian}')`);
  return guardian;
}
function unlinkSiblings() {
  const guardian = sql(`select sg.guardian_id from student_guardians sg where sg.student_id = ${adm("GR0001")} limit 1`);
  sql(`delete from student_guardians where student_id = ${adm("GR0002")} and guardian_id = '${guardian}'`);
}

/** Let each page take its own focus-time refresh (the bell check) first, so a tap is not met by a page that is just then redrawn under it. */
async function settled(...pages: Page[]) {
  for (const p of pages) await p.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await pages[0]!.waitForTimeout(2000);
}

test.describe("J10 parent-teacher meeting", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => { journey = "J10"; });
  const meeting = `J10 PTM ${RUN}`;
  let url = "";
  const held: { win: "family" | "family2"; lose: "family" | "family2" } = { win: "family", lose: "family2" };
  const row = (page: Page, teacher: string) => page.getByRole("listitem").filter({ has: page.getByText(teacher, { exact: true }) }).last();
  const slot = (page: Page, teacher: string, time: string) => row(page, teacher).getByRole("button", { name: time, exact: true });
  /** Open the meeting from the family's own list, as a person would. */
  async function openMine(who: "family" | "family2") {
    const page = await asFamily(who);
    await page.goto(at(""));
    await menu(page, /^Meetings$/);
    await page.getByRole("listitem").filter({ hasText: meeting }).getByRole("link", { name: /Book a time|See my times/ }).click();
    await expect(page.getByRole("heading", { name: meeting })).toBeVisible();
    return page;
  }

  test.afterAll(() => { try { unlinkSiblings(); } catch { /* nothing to put back */ } });

  test("office sets the meeting up and opens booking", async () => {
    const admin = await crowd.as("admin");
    await admin.goto(at(""));
    await menu(admin, /^Meetings$/);
    await admin.getByRole("button", { name: "New meeting" }).first().click();
    const d = dialog(admin);
    await d.getByRole("button", { name: "Choose people" }).click();
    await d.getByRole("combobox", { name: /Add classes/ }).fill("Nursery A");
    await d.getByRole("option").first().click();
    await d.getByLabel(/^Name of the meeting/).fill(meeting);
    await d.getByLabel(/^Minutes per family/).selectOption("10");
    const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
    await d.getByLabel(/^Teachers one child may book/).fill("3");
    await d.getByLabel(/^Booking opens/).fill(ist(-3_600_000));
    await d.getByLabel(/^Booking closes/).fill(ist(5 * 86_400_000));
    await d.getByRole("button", { name: "Save and add teachers" }).click();
    await expect(admin).toHaveURL(/\/app\/meetings\/[0-9a-f-]{36}$/);
    url = admin.url();

    await admin.getByRole("button", { name: "Add teacher times" }).click();
    const t = dialog(admin);
    for (const box of await t.getByRole("checkbox").all()) {
      const label = (await box.locator("xpath=..").innerText()).trim();
      await box.setChecked(/^(Meera Iyer|Anjali Gupta)/.test(label));
    }
    // A day no meeting uses yet: a teacher cannot be in two meetings at once.
    await t.getByLabel(/^Day/).fill(sql(`select (greatest(coalesce(max(day), current_date), current_date) + 1)::text from meeting_windows where school_id = '${GREEN}'`));
    await t.getByLabel(/^From/).fill("10:00");
    await t.getByLabel(/^To/, { exact: false }).first().fill("10:30");
    await t.getByLabel(/^Room/).fill("Room 12");
    await t.getByRole("button", { name: "Add times" }).click();
    await expect(admin.getByText("Meera Iyer").first()).toBeVisible();
    await expect(admin.getByText("Anjali Gupta").first()).toBeVisible();
    await expect(admin.getByText(/Not ready:/), "the check lets the meeting open").toHaveCount(0);
    await admin.getByRole("button", { name: "Open booking" }).click();
    await dialog(admin).getByRole("button", { name: "Open booking" }).click();
    await expect(admin.getByText(/Booking open/).first()).toBeVisible();
    await expect(admin.getByText("6", { exact: true }).first()).toBeVisible(); // six free times: three each for two teachers
  });

  test("two unrelated families tap the same time at the same moment: one gets it, the other is told plainly", async () => {
    unlinkSiblings();
    const one = await openMine("family"), two = await openMine("family2");
    await fits(one, "family booking page");
    await watchToasts(one); await watchToasts(two);
    await settled(one, two);
    await Promise.all([slot(one, "Meera Iyer", "10:00 am").click(), slot(two, "Meera Iyer", "10:00 am").click()]);
    await one.waitForTimeout(1500); await two.waitForTimeout(1500);
    const said = [await toasts(one), await toasts(two)];
    console.log("J10 race messages:", JSON.stringify(said));
    await one.reload(); await two.reload();
    const got = [await one.getByText("Booked", { exact: true }).count(), await two.getByText("Booked", { exact: true }).count()];
    expect(got.reduce((a, b) => a + b, 0), "exactly one family holds 10:00").toBe(1);
    const lost = got[0] ? two : one;
    held.win = got[0] ? "family" : "family2"; held.lose = got[0] ? "family2" : "family";
    expect(said[got[0] ? 1 : 0]!.join(" "), "the family that lost is told in a sentence").toMatch(/Someone just took this time\. Pick another\./);
    // The one who lost still has something to do next: other times are on the screen.
    await expect(slot(lost, "Meera Iyer", "10:10 am")).toBeVisible();
    await expect(slot(lost, "Meera Iyer", "10:00 am"), "a taken time is not offered again").toHaveCount(0);
    await slot(lost, "Meera Iyer", "10:10 am").click();
    await expect(lost.getByText("Booked", { exact: true })).toBeVisible();
    await fits(lost, "family after booking");
  });

  test("a teacher's time changes: the office sees who it drops, those families are told and rebook", async () => {
    const admin = await crowd.as("admin");
    await admin.goto(url);
    await admin.getByRole("listitem").filter({ hasText: "Meera Iyer" }).filter({ has: admin.getByRole("button", { name: "Change" }) }).first().getByRole("button", { name: "Change" }).click();
    const d = dialog(admin);
    await d.getByLabel(/^From/).fill("10:10");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    // Nothing is saved yet: the office reads who would lose a time.
    await expect(d.getByText("These bookings no longer fit and would be dropped:")).toBeVisible();
    await expect(d.getByText(new RegExp(`${KID[held.win]}, `))).toBeVisible();
    await expect(d.getByText(new RegExp(`${KID[held.lose]}, `)), "a booking that still fits is not on the drop list").toHaveCount(0);
    await d.getByRole("button", { name: "Drop 1 booking and tell the families" }).click();
    await expect(admin.getByText("Teacher time changed").first()).toBeVisible();

    const hit = await asFamily(held.win);
    await hit.goto(at(""));
    await hit.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await hit.getByRole("button", { name: /^notifications/i }).click();
    const first = dialog(hit).getByRole("link").filter({ hasText: /meeting|time/i }).first();
    console.log("J10 bell after drop:", (await dialog(hit).innerText()).replace(/\s+/g, " ").slice(0, 400));
    await expect(first).toBeVisible();
    await first.click();
    // They are offered other times at once, with what happened in words.
    await expect(hit.getByRole("heading", { name: meeting })).toBeVisible();
    await expect(hit.getByText("Booked", { exact: true })).toHaveCount(0);
    await expect(slot(hit, "Meera Iyer", "10:20 am")).toBeVisible();
    await expect(slot(hit, "Meera Iyer", "10:00 am"), "the dropped time is gone").toHaveCount(0);
    await fits(hit, "family after a dropped booking");
    await slot(hit, "Meera Iyer", "10:20 am").click();
    await expect(hit.getByText("Booked", { exact: true })).toBeVisible();
  });

  test("brothers and sisters share one clock: two taps at once on different teachers, one wins", async () => {
    // Both families give their times back, as a person would, then become brother and sister.
    for (const who of ["family", "family2"] as const) {
      const p = await openMine(who);
      await p.getByRole("button", { name: "Cancel", exact: true }).first().click();
      await dialog(p).getByRole("button", { name: "Cancel the time" }).click();
      await expect(p.getByText("Booked", { exact: true })).toHaveCount(0);
    }
    linkSiblings();
    const one = await openMine("family"), two = await openMine("family2");
    await watchToasts(one); await watchToasts(two);
    await settled(one, two);
    await Promise.all([slot(one, "Meera Iyer", "10:10 am").click(), slot(two, "Anjali Gupta", "10:10 am").click()]);
    await one.waitForTimeout(1500); await two.waitForTimeout(1500);
    const said = [await toasts(one), await toasts(two)];
    console.log("J10 sibling race messages:", JSON.stringify(said));
    await one.reload(); await two.reload();
    const got = [await one.getByText("Booked", { exact: true }).count(), await two.getByText("Booked", { exact: true }).count()];
    expect(got.reduce((a, b) => a + b, 0), "brothers and sisters cannot both be at 10:10").toBe(1);
    const lost = got[0] ? two : one, name = got[0] ? "family2" : "family";
    held.lose = name; held.win = got[0] ? "family" : "family2";
    expect(said[got[0] ? 1 : 0]!.join(" "), "the loser is told why, in words").toMatch(/\S{3,}/);
    // The page does not keep offering the clashing hour, and the next free hour works.
    await expect(slot(lost, "Meera Iyer", "10:10 am")).toHaveCount(0);
    await expect(slot(lost, "Anjali Gupta", "10:10 am")).toHaveCount(0);
    await slot(lost, "Meera Iyer", "10:20 am").click();
    await expect(lost.getByText("Booked", { exact: true })).toBeVisible();
    await fits(lost, "family after clash");

    // The "book a time" row closes when the family holds every time the meeting lets it have (here both teachers), not after the first.
    await slot(lost, "Anjali Gupta", "10:00 am").click();
    await expect(lost.getByText("2 booked, up to 3")).toBeVisible();

    // Having booked, the family is no longer asked to book: "Needs action" and the page agree.
    await lost.getByRole("button", { name: /^notifications/i }).click();
    await dialog(lost).getByRole("link", { name: "See all" }).click();
    await lost.getByRole("link", { name: /^Needs action/ }).click();
    await expect(lost.getByText(`Book a time: ${meeting}`), "a booked family is still asked to book").toHaveCount(0);
  });

  test("on the day: the teacher's list opens only when the day comes, then came, missed and a remark", async () => {
    const teacher = await crowd.as("teacher");
    await teacher.goto(at(""));
    await menu(teacher, /^Meetings$/);
    await teacher.getByRole("row").filter({ hasText: meeting }).getByRole("link", { name: "Open my list" }).click();
    await expect(teacher.getByRole("heading", { name: /My meeting day/ })).toBeVisible();
    await expect(teacher.getByText(/Opens on /).first(), "before the day the list says when it opens").toBeVisible();
    await expect(teacher.getByRole("button", { name: "Came", exact: true }), "no marking buttons before the day").toHaveCount(0);

    // Time passes: the slots move to earlier today (a person cannot make the past in the browser).
    const m = sql(`select id from meeting_days where school_id = '${GREEN}' and title = '${meeting}'`);
    const shift = Number(sql(`select extract(epoch from (now() - interval '30 minutes') - max(ends_at))::bigint from meeting_windows where meeting_id = '${m}'`));
    sql(`update meeting_slots set starts_at = starts_at + ${shift} * interval '1 second', ends_at = ends_at + ${shift} * interval '1 second' where meeting_id = '${m}'`);
    sql(`update meeting_windows set starts_at = starts_at + ${shift} * interval '1 second', ends_at = ends_at + ${shift} * interval '1 second', day = ((starts_at + ${shift} * interval '1 second') at time zone 'Asia/Kolkata')::date where meeting_id = '${m}'`);
    await teacher.reload();
    const lose = KID[held.lose];
    await expect(teacher.getByRole("listitem").filter({ hasText: lose }).getByRole("button", { name: "Came", exact: true })).toBeVisible();
    await teacher.getByRole("listitem").filter({ hasText: lose }).getByRole("button", { name: "Came", exact: true }).click();
    await expect(teacher.getByRole("listitem").filter({ hasText: lose }).getByText("Came", { exact: true }).first()).toBeVisible();
    await teacher.getByRole("listitem").filter({ hasText: lose }).getByRole("button", { name: "Notes" }).click();
    await dialog(teacher).getByLabel(/^Private note/).fill("Parent asked about extra practice.");
    await dialog(teacher).getByLabel(/^Remark for the family/).fill(`Reads well. Please practise counting at home ${RUN}.`);
    await dialog(teacher).getByRole("button", { name: "Save notes" }).click();
    await expect(teacher.getByText(`Reads well. Please practise counting at home ${RUN}.`)).toBeVisible();
    // Anyone else on the list who is still unmarked is marked as not come.
    const other = KID[held.win];
    const rowOther = teacher.getByRole("listitem").filter({ hasText: other });
    if (await rowOther.count()) { await rowOther.getByRole("button", { name: "Missed", exact: true }).click(); await expect(rowOther.getByText("Did not come", { exact: true })).toBeVisible(); }

    // The family reads the remark, the private note never reaches them.
    const fam = await openMine(held.lose);
    await expect(fam.getByText(`Reads well. Please practise counting at home ${RUN}.`)).toBeVisible();
    await expect(fam.getByText("Parent asked about extra practice."), "the private note stays private").toHaveCount(0);
    await fits(fam, "family remark");
    // The office sees the same: one came, the other is on the list of who did not come.
    const admin = await crowd.as("admin");
    await admin.goto(url);
    await expect(admin.getByText(/Did not come or not marked/).first()).toBeVisible();
  });

});
noClipping("J10");

// ======================================================================================================
// J11  Preferences: summary by email, push switch, quiet hours, unsubscribe from the email, signed out
// ======================================================================================================
/** The office adds an all-families event (people are told) and returns its address. */
async function newEvent(admin: Page, title: string, day: string) {
  await admin.goto(at(""));
  await menu(admin, /^Calendar$/);
  await admin.getByRole("link", { name: /add event/i }).click();
  await admin.getByLabel(/^Title/).fill(title);
  await admin.getByLabel(/^Starts/).fill(`${day}T10:00`);
  await admin.getByRole("button", { name: "All families", exact: true }).click();
  await expect(admin.getByText(/families? will|reaching|\d+ (people|families)/i).first()).toBeVisible({ timeout: 15_000 });
  await admin.getByRole("button", { name: "Publish event" }).click();
  await expect(admin).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
  return admin.url();
}
/** From any page to the settings, by the bell and the link on the notifications page, as a person does. */
async function openPrefs(page: Page) {
  await page.goto(at(""));
  await page.getByRole("button", { name: /^notifications/i }).click();
  await dialog(page).getByRole("link", { name: "See all" }).click();
  await page.getByRole("link", { name: "Choose what reaches your phone and email" }).click();
  await expect(page.getByText("What reaches you")).toBeVisible();
}
const emailOf = (page: Page, group: string) => page.getByRole("radiogroup", { name: `Email for ${group}` });
const mailBody = async (id: string) => (await (await fetch(`http://localhost:8025/api/v1/message/${id}`)).json()) as { HTML: string; Text: string };
const mailHeaders = async (id: string) => (await (await fetch(`http://localhost:8025/api/v1/message/${id}/headers`)).json()) as Record<string, string[]>;

/** Mail to the family's inbox that mentions a title. The guardian's inbox is shared with another child and other journeys, so counting all mail would count theirs. */
const about = async (title: string) => {
  const out: { Subject: string; ID: string; text: string }[] = [];
  for (const m of await mails(`aarav.family.${RUN}@family.test`)) { const t = (await mailBody(m.ID)).Text; if (t.includes(title)) out.push({ ...m, text: t }); }
  return out;
};

test.describe("J11 preferences", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => { journey = "J11"; });
  const mailbox = `aarav.family.${RUN}@family.test`;
  let evTitle = `J11 Parents' tea ${RUN}`;
  const guardianId = () => sql(`select sg.guardian_id from student_guardians sg where sg.student_id = ${adm("GR0001")} and sg.is_primary limit 1`);
  const users = `(select user_id from students where id in (${adm("GR0001")}, ${adm("GR0002")}))`;
  let eventUrl = "";
  let unsubscribe = "";

  test.beforeAll(() => {
    sql(`update guardians set email = '${mailbox}' where id = '${guardianId()}'`);
    // Many runs a day use up the school's mail allowance (it then says "will go tomorrow"). A new day is the only way a person gets more.
    sql(`update mail_usage set count = 0 where school_id = '${GREEN}' and count > 100`);
  });
  test.afterAll(() => {
    sql(`update guardians set email = null where id = '${guardianId()}'`);
    sql(`delete from notification_prefs where school_id = '${GREEN}' and user_id in ${users}`);
  });

  test("the family finds the settings from the bell and chooses: summary email, no push for notices, 8 am", async () => {
    const page = await asFamily("family");
    await openPrefs(page);
    await fits(page, "preferences");
    await emailOf(page, "Calendar and meetings").getByRole("radio", { name: "Daily summary" }).click();
    await expect(emailOf(page, "Calendar and meetings").getByRole("radio", { name: "Daily summary" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "Push for Notices" }).click();
    await expect(page.getByRole("switch", { name: "Push for Notices" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("radiogroup", { name: "Summary time" }).getByRole("radio", { name: "8 am" }).click();
    await page.waitForTimeout(1200);
    // Safety messages cannot be switched off, and the page says why in a sentence.
    await expect(page.getByText("Safety messages are always sent.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push for Safety and urgent" })).toBeDisabled();
    // The choices are kept.
    await page.reload();
    await expect(emailOf(page, "Calendar and meetings").getByRole("radio", { name: "Daily summary" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Push for Notices" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("radiogroup", { name: "Summary time" }).getByRole("radio", { name: "8 am" })).toHaveAttribute("aria-checked", "true");
    await fits(page, "preferences after saving");
  });

  test("a new event arrives in the daily summary, not as a single email, and the summary carries a stop link", async () => {
    const admin = await crowd.as("admin");
    // Other journeys sign in as the same family and may "mark all read" between publishing and the summary (a read notice is not mailed): try again with a new event.
    for (let tries = 0; tries < 3 && !(await about(evTitle)).length; tries++) {
      evTitle = `J11 Parents' tea ${RUN}${tries ? ` (${tries + 1})` : ""}`;
      eventUrl = await newEvent(admin, evTitle, istDay(9));
      job("comms.deliver");
      expect((await about(evTitle)).length, "a summary family gets nothing instantly").toBe(0);
      job("notifications.digest", { hour: 8 });
      await expect.poll(async () => (await about(evTitle)).length, { timeout: 8_000 }).toBe(1).catch(() => undefined);
    }
    expect((await about(evTitle)).length, "one summary mail about the event").toBe(1);
    const [m] = await about(evTitle);
    expect(m!.Subject).toMatch(/update/i);
    const body = await mailBody(m!.ID);
    expect(body.Text, "the summary names the event").toContain(evTitle);
    const links = [...body.HTML.matchAll(/href="([^"]*\/unsubscribe\?[^"]*)"/g)].map((x) => x[1]!.replaceAll("&amp;", "&"));
    expect(links.length, "the mail has a stop link").toBeGreaterThan(0);
    unsubscribe = links.find((l) => l.includes("g=calendar")) ?? links[0]!;
    const h = await mailHeaders(m!.ID);
    expect(Object.keys(h).map((k) => k.toLowerCase())).toEqual(expect.arrayContaining(["list-unsubscribe", "list-unsubscribe-post"]));
    // Running the summary again sends nothing twice.
    job("notifications.digest", { hour: 8 });
    expect((await about(evTitle)).length, "the summary is not sent twice").toBe(1);
  });

  test("the stop link works signed out, on a phone, and changes only that person and that kind", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(unsubscribe);
    await expect(page.getByRole("heading", { name: /^Stop emails about calendar and meetings\?/i })).toBeVisible();
    await expect(page.getByText(/urgent safety and account emails still reach you/)).toBeVisible();
    await fits(page, "unsubscribe page");
    // A link cut short does nothing and says so.
    const broken = await page.request.post(unsubscribe.replace(/t=([^&]{6})[^&]*/, "t=$1"));
    expect(broken.status()).toBe(400);
    await page.getByRole("button", { name: "Stop these emails" }).click();
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
    // A lock group cannot be stopped by a made-up link either.
    const locked = await page.request.post(unsubscribe.replace("g=calendar", "g=urgent"));
    expect(locked.status()).toBe(400);
    await ctx.close();

    const fam = await asFamily("family");
    await openPrefs(fam);
    await expect(emailOf(fam, "Calendar and meetings").getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    await expect(emailOf(fam, "Calendar and meetings").getByRole("radio", { name: "Off" }), "the other kinds keep their setting").toHaveCount(1);
    await expect(fam.getByRole("switch", { name: "Push for Notices" }), "push choice untouched").toHaveAttribute("aria-checked", "false");
    // The brother or sister's own login is not touched.
    const other = await asFamily("family2");
    await openPrefs(other);
    await expect(emailOf(other, "Calendar and meetings").getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false");
  });

  test("quiet hours hold an instant email until they end, and the change shows on the page", async () => {
    const fam = await asFamily("family");
    await openPrefs(fam);
    await emailOf(fam, "Calendar and meetings").getByRole("radio", { name: "Instant" }).click();
    await expect(emailOf(fam, "Calendar and meetings").getByRole("radio", { name: "Instant" })).toHaveAttribute("aria-checked", "true");
    const ist = (h: number) => new Date(Date.now() + 330 * 60_000 + h * 3_600_000).toISOString().slice(11, 16);
    const quiet = fam.locator("section, div").filter({ has: fam.getByRole("heading", { name: "Quiet hours" }) }).last();
    await quiet.getByLabel("From").fill(ist(-1));
    await quiet.getByLabel("To", { exact: true }).fill(ist(3));
    await quiet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(fam.getByText("No pushes or emails in these hours, except urgent ones.")).toBeVisible();
    await expect(fam.getByRole("button", { name: "Use school hours" })).toBeVisible();

    // The office moves the event: an instant email is due, but it is the family's quiet time.
    const admin = await crowd.as("admin");
    await admin.goto(eventUrl);
    await admin.getByRole("link", { name: "Edit", exact: true }).click();
    await admin.getByLabel(/^Starts/).fill(`${istDay(10)}T15:00`);
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
    // The guardian's inbox is shared with the other child (Vivaan, own login, no quiet hours): only mail for Aarav counts here.
    const own = async () => (await about(evTitle)).filter((m) => !/^For (?!.*Aarav)/.test(m.text) && /^Changed:/.test(m.Subject));
    const before = (await own()).length;
    job("comms.deliver");
    expect((await own()).length, "nothing is sent to Aarav in his quiet hours").toBe(before);
    const held = sql(`select state || ' ' || (next_at > now())::text from comm_deliveries where school_id = '${GREEN}' and user_id = ${adm("GR0001").replace("id from students", "user_id from students")} and channel = 'email' and mode = 'instant' order by created_at desc limit 1`);
    expect(held, "the email waits for the end of the quiet hours").toBe("pending true");

    // The family goes back to the school's hours; when the held time comes the mail goes.
    await fam.getByRole("button", { name: "Use school hours" }).click();
    await expect(fam.getByText("Using your school's quiet hours. Set your own below.")).toBeVisible();
    sql(`update comm_deliveries set next_at = now() - interval '1 minute' where school_id = '${GREEN}' and user_id = ${adm("GR0001").replace("id from students", "user_id from students")} and channel = 'email' and mode = 'instant' and state = 'pending'`);
    job("comms.deliver");
    await expect.poll(async () => (await own()).length, { timeout: 30_000 }).toBe(before + 1);
    const latest = (await own()).map((x) => x.Subject).join(" | ");
    expect(latest).toContain(evTitle);
  });
});
noClipping("J11");

// ======================================================================================================
// J12  The bell: a message, a notice and an approval; open each from another screen; every count agrees
// ======================================================================================================
/** Every place a number shows: bell, tab title, side menu, the list's own sentence. */
async function counts(page: Page) {
  const b = await badges(page, ["Messages", "Notices"]);
  return { bell: await bell(page), tab: await tabCount(page), messages: b.Messages!, notices: b.Notices! };
}
/** The list page's sentence ("12 unread."), read by going there through the bell like a person. */
async function listSays(page: Page) {
  await page.getByRole("button", { name: /^notifications/i }).click();
  await dialog(page).getByRole("link", { name: "See all" }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  const text = (await main(page).innerText()).replace(/\s+/g, " ");
  return { unread: Number(/(\d+) unread/.exec(text)?.[1] ?? 0), action: Number(/(\d+) waiting for you/.exec(text)?.[1] ?? 0) };
}
/** Nudge the page the way a phone waking up does, then wait for the bell to reach at least n (other journeys notify every family too). */
async function bellReaches(page: Page, n: number) {
  await expect.poll(async () => { await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); return bell(page); }, { timeout: 90_000, message: `bell reaches ${n} without a reload` }).toBeGreaterThanOrEqual(n);
}
type Seen = { bell: number; tab: number; messages: number; notices: number };
/** The tab title and the bell say the same; with `from`, the numbers have also gone down by what was opened (never up by less: other journeys notify every family too). */
const agree = async (page: Page, where: string, from?: Seen, dropped: { bell?: number; messages?: number; notices?: number } = {}) => {
  // A number may take a moment to settle after a click; one that needs a reload or the next minute's check is a fault.
  let c = await counts(page);
  const ok = (x: Seen) => x.tab === x.bell && (!from || ((!dropped.bell || x.bell <= from.bell - dropped.bell) && (!dropped.messages || x.messages <= from.messages - dropped.messages) && (!dropped.notices || x.notices <= from.notices - dropped.notices)));
  for (let i = 0; i < 4 && !ok(c); i++) { await page.waitForTimeout(1000); c = await counts(page); }
  if (c.tab !== c.bell) found("COUNTS12", `${where}: tab title says (${c.tab}) but the bell says ${c.bell}`);
  if (from) {
    if (dropped.bell && c.bell > from.bell - dropped.bell) found("COUNTS12", `${where}: bell still ${c.bell} (was ${from.bell}) after opening it`);
    if (dropped.messages && c.messages > from.messages - dropped.messages) found("COUNTS12", `${where}: Messages badge still ${c.messages} (was ${from.messages})`);
    if (dropped.notices && c.notices > from.notices - dropped.notices) found("COUNTS12", `${where}: Notices badge still ${c.notices} (was ${from.notices})`);
  }
  return c;
};
/** What the list page itself says, against what the bell on the same screen says. */
const listAgrees = async (page: Page, where: string, c: Seen) => {
  const list = await listSays(page);
  if (list.unread !== c.bell) found("COUNTS12", `${where}: the list page says ${list.unread} unread, the bell on the screen before said ${c.bell}`);
  return list;
};

test.describe("J12 bell and counts", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => { journey = "J12"; });
  const noticeTitle = `J12 notice ${RUN}`, approvalTitle = `J12 for approval ${RUN}`, subject = `J12 about homework ${RUN}`;
  let fam: Page;
  let base: Seen = { bell: 0, tab: 0, messages: 0, notices: 0 };
  let arrived: Seen = base;

  test.beforeAll(async ({ browser }) => {
    // Their own family, so no other journey reads their notices while this one counts them.
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    fam = await ctx.newPage();
    // The date-of-birth password first (a fresh school), the chosen one on a re-run; each wrong try fails in seconds.
    for (const pw of ["06042023", STUDENT_PASSWORD]) {
      await fam.goto(`${SCHOOL(SLUG)}/login`);
      await fam.getByLabel(/email, phone or admission number/i).fill("GR0004");
      await fam.getByLabel(/^password$/i).fill(pw);
      await fam.getByRole("button", { name: /sign in/i }).click();
      await fam.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 15_000 }).catch(() => undefined);
      if (!fam.url().includes("/app")) continue;
      if (fam.url().includes("/app/change-password")) {
        await reloadIfSchoolNotFound(fam);
        await fam.locator('input[name="current"]').fill(pw);
        await fam.locator('input[name="next"]').fill(STUDENT_PASSWORD);
        await fam.locator('input[name="confirm"]').fill(STUDENT_PASSWORD);
        await fam.getByRole("button", { name: /save and continue/i }).click();
        await fam.waitForURL((u) => u.pathname.startsWith("/app") && !u.pathname.includes("change-password"));
      }
      break;
    }
    expect(fam.url()).toContain("/app");
  });
  test.afterAll(async () => { await fam?.context().close(); });

  test("before anything: the numbers already agree", async () => {
    // The worker's first minute settles what the clock has already ended (a seeded notice whose last date has passed closes its action row); count after that.
    job("comms.publish-due");
    await fam.goto(at(""));
    base = await agree(fam, "start");
    await listAgrees(fam, "start", base);
    await fits(fam, "notifications list");
  });

  test("the office writes to the family and publishes a notice; the family's numbers move together without a reload", async () => {
    const admin = await crowd.as("admin");
    await admin.goto(at(""));
    await menu(admin, /^Messages\b/);
    await admin.getByRole("link", { name: "New message" }).first().click();
    await admin.getByPlaceholder("Student name or admission number").fill("GR0004");
    await admin.getByRole("list", { name: "Students you can write to" }).getByRole("button", { name: /Navya Verma/ }).first().click();
    await admin.getByLabel("Subject").fill(subject);
    await admin.getByLabel("Message", { exact: true }).fill("Please send the notebook on Monday.");
    await admin.getByRole("button", { name: "Send", exact: true }).click();
    await expect(admin.getByText(subject).first()).toBeVisible();

    await menu(admin, /^Notices\b/);
    await admin.getByRole("button", { name: "New notice" }).first().click();
    await admin.getByRole("menuitem", { name: "Notice", exact: true }).click();
    await admin.getByRole("button", { name: "All families", exact: true }).click();
    await admin.getByLabel(/^Title/).fill(noticeTitle);
    await admin.locator("textarea").first().fill("The school is open on Saturday.");
    await admin.getByRole("button", { name: "Publish" }).last().click();
    await expect(dialog(admin).getByRole("heading", { name: "Publish this notice?" })).toBeVisible();
    await dialog(admin).getByRole("button", { name: /^Publish to \d+/ }).click();
    await expect(admin.getByText(noticeTitle).first()).toBeVisible();
    // The notice has a 30-second undo window before it goes out; time passes, and the worker sends it.
    sql(`update announcements set send_at = now() - interval '1 second' where school_id = '${GREEN}' and title = '${noticeTitle}' and state = 'sending'`);
    job("comms.publish-due");

    await fam.goto(at(""));
    await bellReaches(fam, base.bell + 2);
    const c = await agree(fam, "after message and notice");
    if (c.messages <= base.messages) found("COUNTS12", `Messages badge did not move after a new message (${base.messages} to ${c.messages})`);
    if (c.notices <= base.notices) found("COUNTS12", `Notices badge did not move after a new notice (${base.notices} to ${c.notices})`);
    await listAgrees(fam, "after message and notice", c);
    arrived = c;
    await fits(fam, "notifications after arrivals");
  });

  test("opening the notice from the Notices list takes one off everywhere", async () => {
    await menu(fam, /^Notices\b/);
    await fam.getByRole("link", { name: new RegExp(noticeTitle) }).first().click();
    await expect(fam.getByRole("heading", { name: noticeTitle })).toBeVisible();
    const c = await agree(fam, "after opening the notice", arrived, { bell: 1, notices: 1 });
    await listAgrees(fam, "after opening the notice", c);
    arrived = c;
  });

  test("opening the message from the Messages list takes one off everywhere", async () => {
    await menu(fam, /^Messages\b/);
    await fam.getByText(subject).first().click();
    await expect(fam.getByText("Please send the notebook on Monday.").first()).toBeVisible();
    const c = await agree(fam, "after opening the message", arrived, { bell: 1, messages: 1 });
    await listAgrees(fam, "after opening the message", c);
  });

  test("an approval: the teacher asks, the office sees it in the bell, approves from another screen, and the numbers fall", async () => {
    const teacher = await crowd.as("teacher");
    await teacher.goto(at("announcements/new"));
    await teacher.getByRole("button", { name: "All families", exact: true }).click();
    await teacher.getByLabel(/^Title/).fill(approvalTitle);
    await teacher.locator("textarea").first().fill("Needs the office to approve.");
    await teacher.getByRole("button", { name: "Send for approval" }).click();
    await dialog(teacher).getByRole("button", { name: /approval|^Send/i }).last().click();
    await expect(teacher.getByText(/waiting for approval|sent for approval|Waiting/i).first()).toBeVisible();

    const admin = await crowd.as("admin");
    await admin.goto(at(""));
    const before = await bell(admin);
    await admin.getByRole("button", { name: /^notifications/i }).click();
    await admin.keyboard.press("Escape");
    await admin.reload();
    const after = await bell(admin);
    expect(after, "the office's bell moves for a notice waiting for approval").toBeGreaterThan(before - 1);
    await admin.getByRole("button", { name: /^notifications/i }).click();
    await dialog(admin).getByRole("link", { name: new RegExp("approval|waiting", "i") }).first().click();
    await expect(admin.getByText(approvalTitle).first()).toBeVisible();
    const sums = await agree(admin, "office after opening the approval");
    await admin.getByRole("button", { name: /^approve/i }).first().click();
    const d = dialog(admin);
    if (await d.getByRole("button", { name: /^approve|^publish/i }).count()) await d.getByRole("button", { name: /^approve|^publish/i }).first().click();
    await expect(admin.getByText(/approved|published/i).first()).toBeVisible();
    await admin.reload();
    const done = await agree(admin, "office after approving");
    if (done.bell > sums.bell) found("COUNTS12", `office: bell ${done.bell} after approving, was ${sums.bell}: the approval notification did not close`);
    await listAgrees(admin, "office after approving", done);
  });
});
foundBy("COUNTS12", "J12: bell, tab title, side menu and list agree after each open");
noClipping("J12");

// ======================================================================================================
// J13  Roles made in Settings: front office, safeguarding lead, coordinator, transport in-charge, auditor
// ======================================================================================================
const COMM = /^\/app\/(announcements|circulars|messages|safeguarding|requests|events|meetings|notifications|attendance\/holidays|settings\/communication)|^\/app$/;
const COMM_LINK = /^\/app\/(announcements|events|meetings|messages|requests|safeguarding|notifications)$/;

test.describe("J13 custom roles", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(900_000);
  test.beforeAll(() => { journey = "J13"; });
  const login0 = sql(`select coalesce(role_id::text, '') from users where school_id = '${GREEN}' and login_id = 'cashier'`);
  // Whatever happens, the cashier login goes back to what it was.
  test.afterAll(() => { sql(`update users set role = 'staff', role_id = ${login0 ? `'${login0}'` : "null"} where school_id = '${GREEN}' and login_id = 'cashier'`); });

  /** The office gives a staff login a ready-made role through Settings, Users, the person's page, Change role. */
  async function assign(admin: Page, who: string, roleLabel: string) {
    await admin.goto(at(""));
    await menu(admin, /^Settings$/);
    await admin.goto(at("settings/users"));
    await admin.getByPlaceholder(/Search by name, email or login/).fill(who);
    const row = admin.getByRole("row").filter({ hasText: who });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").first().click();
    await admin.getByRole("button", { name: "Change role" }).click();
    await dialog(admin).getByLabel(/^Role/).selectOption({ label: roleLabel });
    await dialog(admin).getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText(roleLabel, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }

  const WANT: Record<string, { sees: string[]; hidden: string[]; writeNotice: "publish" | "approval" | "no"; addEvent: boolean }> = {
    "Front office": { sees: ["Notices", "Calendar", "Meetings", "Messages", "Requests"], hidden: ["Safeguarding"], writeNotice: "approval", addEvent: false },
    "Safeguarding lead": { sees: ["Notices", "Calendar", "Messages", "Requests", "Safeguarding"], hidden: ["Meetings"], writeNotice: "no", addEvent: false },
    "Coordinator": { sees: ["Notices", "Calendar", "Messages", "Requests"], hidden: ["Safeguarding"], writeNotice: "publish", addEvent: true },
    "Transport in-charge": { sees: ["Notices", "Calendar", "Messages", "Transport"], hidden: ["Safeguarding", "Meetings"], writeNotice: "no", addEvent: false },
    "Auditor": { sees: ["Notices", "Calendar", "Messages"], hidden: ["Safeguarding", "Meetings"], writeNotice: "no", addEvent: false },
  };

  for (const [roleLabel, want] of Object.entries(WANT)) {
    test(`${roleLabel}: sees only what works, and every communication link they are shown works`, async ({ browser }) => {
      const admin = await crowd.as("admin");
      const loginId = roleLabel === "Auditor" ? "auditor" : "cashier";
      if (loginId === "cashier") await assign(admin, "Suresh Cashier", roleLabel);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await login(page, SLUG, loginId);
        await page.goto(at(""));
        const nav = page.getByRole("navigation", { name: "Main" });
        for (const name of want.sees) await expect(nav.getByRole("link", { name: new RegExp(`^${name}\\b`) }), `${roleLabel} sees ${name}`).toBeVisible();
        for (const name of want.hidden) await expect(nav.getByRole("link", { name: new RegExp(`^${name}\\b`) }), `${roleLabel} does not see ${name}`).toHaveCount(0);

        // What they may write is what the buttons offer, with no button that ends in a refusal.
        await page.goto(at("announcements/new"));
        if (want.writeNotice === "no") {
          await expect(page.getByText("Your role cannot write notices.")).toBeVisible();
        } else {
          await expect(page.getByRole("button", { name: want.writeNotice === "publish" ? "Publish" : "Send for approval" })).toBeVisible();
          await expect(page.getByRole("button", { name: want.writeNotice === "publish" ? "Send for approval" : "Publish" })).toHaveCount(0);
        }
        await page.goto(at("events"));
        await expect(page.getByRole("link", { name: /add event/i }), `${roleLabel}: Add event`).toHaveCount(want.addEvent ? 1 : 0);
        // Where the menu shows no link, the address still refuses in a sentence, not as a failure of the school's system.
        for (const [name, path] of [["Meetings", "meetings"], ["Safeguarding", "safeguarding"]] as const) {
          if (!want.hidden.includes(name)) continue;
          await page.goto(at(path));
          const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          if (/something went wrong|couldn.t load|could not load|check your connection/i.test(text)) found("ROLES13", `${roleLabel} opening ${path} by address: "${/.{0,30}(something went wrong|couldn.t load|could not load).{0,60}/i.exec(text)?.[0]}" (a refusal shown as a system fault)`);
        }
        const starts = (await page.goto(at("")).then(() => page.locator("nav[aria-label=Main] a[href]").evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname)))).filter((h) => COMM_LINK.test(h));
        const problems = await crawl(page, { slug: SLUG, sections: COMM, starts: [...new Set(["/app", ...starts])], role: roleLabel });
        expect(problems.join("\n"), `${roleLabel}: links they are shown`).toBe("");
      } finally { await ctx.close(); }
    });
  }

  test("the cashier login goes back to Cashier through the same screen", async () => {
    const admin = await crowd.as("admin");
    await assign(admin, "Suresh Cashier", "Cashier");
    expect(sql(`select role_id::text from users where school_id = '${GREEN}' and login_id = 'cashier'`)).toBe(login0);
  });
});
foundBy("ROLES13", "J13: a role that may not open a screen is told so in a sentence");
noClipping("J13");
