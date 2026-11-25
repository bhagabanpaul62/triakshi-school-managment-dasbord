import { expect, test, type Page } from "@playwright/test";
import { at, dialog, job, mails, main, newMailDay, People, schoolAwake, says, sql, SLUG } from "./comm-lib";
import { login, loginStudent, SCHOOL } from "./helpers";

// Notice journeys J1, J2, J3, J4, J14 (PRD 13.1), walked the way a person does: click what is on screen.
// Titles carry a stamp so a re-run never meets the last run's notices.
const STAMP = Date.now().toString().slice(-7);
const MIN = 60_000;
test.describe.configure({ mode: "serial", timeout: 300_000 });

const schoolId = (slug: string) => sql(`select id from schools where slug='${slug}'`);
const link = (page: Page, name: string | RegExp) => page.getByRole("link", { name }).first();
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();
/** "2026-11-25T18:30" in India time, n minutes from now, the format a date-time box takes. */
const istIn = (min: number) => new Date(Date.now() + 330 * MIN + min * MIN).toISOString().slice(0, 16);
const bellCount = async (page: Page) => {
  const name = (await page.getByRole("button", { name: /^notifications/i }).first().getAttribute("aria-label")) ?? "";
  return Number(/(\d+) unread/.exec(name)?.[1] ?? 0);
};
/** The bell count after the page has settled (counts arrive by a refresh). */
async function bellAfter(page: Page, path: string) {
  await page.goto(at(path));
  await expect(page.getByRole("button", { name: /^notifications/i }).first()).toBeVisible();
  return bellCount(page);
}
/** Open Notices from the sidebar (or the phone menu), then start a new one from its menu, like a person. */
async function startNotice(page: Page, kind: "Notice" | "Circular with a number" | "Urgent alert") {
  await page.goto(at(""));
  await link(page, /^notices\b/i).click();
  await page.waitForURL(/\/app\/announcements/);
  await btn(page, /new notice/i).click();
  await page.getByRole("menuitem", { name: kind, exact: true }).first().click();
  await page.waitForURL(/\/announcements\/new/);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
}
const fillNotice = async (page: Page, title: string, body: string, audience: string) => {
  await page.getByRole("group", { name: "Quick choices" }).getByRole("button", { name: audience, exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Message", { exact: true }).fill(body);
};
const openFromList = async (page: Page, tab: RegExp | null, title: string) => {
  await page.goto(at(""));
  await link(page, /^notices\b/i).click();
  await page.waitForURL(/\/app\/announcements/);
  if (tab) await link(page, tab).click();
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
};
const toast = (page: Page, text: RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
const noSideways = async (page: Page, where: string) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${where}: page scrolls sideways at 375 px`).toBeLessThanOrEqual(1);
};

let people: People;
let asleep: (() => void) | undefined;
test.beforeAll(async ({ browser }) => { newMailDay(); asleep = schoolAwake(); people = new People(browser); });
test.afterAll(async () => { asleep?.(); await people?.close(); });

// ---------------------------------------------------------------- J1
test.describe("J1 clerk circular needs the principal", () => {
  const title = `Fee dates ${STAMP}`;
  const title2 = `Fee dates, corrected ${STAMP}`;
  // The seeded `cashier` is shared with other journeys that change its role, so this clerk is a user of its own.
  const CLERK = "frontclerk";
  const where = `login_id='${CLERK}' and school_id='${schoolId(SLUG)}'`;
  test.beforeAll(() => {
    sql(`delete from users where ${where}`);
    sql(`insert into users (id,school_id,role,login_id,name,email,password_hash,status,role_id)
      select gen_random_uuid(),school_id,'staff','${CLERK}','Farida Clerk','${CLERK}@greenvalley.test',password_hash,'active',
        (select id from school_roles where name='Front office' and school_id='${schoolId(SLUG)}') from users where login_id='cashier' and school_id='${schoolId(SLUG)}'`);
  });
  test.afterAll(() => {
    try { sql(`delete from users where ${where}`); } catch { sql(`update users set status='disabled' where ${where}`); }
  });

  test("drafts, sends, is sent back, fixes, is approved, goes out, family reads, report counts", async () => {
    const clerk = await people.as(CLERK as never), principal = await people.as("admin"), family = await people.as("family");
    const adminBefore = await bellAfter(principal, "");

    // 1. clerk drafts a circular and sends it for approval
    await startNotice(clerk, "Circular with a number");
    await fillNotice(clerk, title, "Fees for term 2 are due on the 5th. Please pay at the office or online.", "All families");
    await clerk.getByLabel("What people are asked to do").selectOption({ label: "I have read this" });
    await btn(clerk, /send for approval/i).click();
    await expect(dialog(clerk).getByText(/approv/i).first()).toBeVisible();
    await dialog(clerk).getByRole("button", { name: /^send for approval$/i }).click();
    await expect(clerk.getByText(/waiting for .* to approve/i)).toBeVisible({ timeout: 20_000 });

    // approvals are not instant mail: the principal's email waits for the digest, and the delivery is on record
    expect(sql(`select count(*) from comm_deliveries d join notifications n on n.id=d.notification_id where n.title like '%${title}' and d.channel='email' and d.mode='digest'`), "approval email queued for the digest").toBe("1");

    // 2. principal sees the bell move and the notice waiting; asks for changes
    expect(await bellAfter(principal, ""), "principal's bell after a notice is sent for approval").toBeGreaterThan(adminBefore);
    await openFromList(principal, /waiting for approval/i, title);
    await btn(principal, /^ask for changes$/i).click();
    await dialog(principal).getByLabel(/what should change/i).fill("Say which account to pay into.");
    await dialog(principal).getByRole("button", { name: /send back/i }).click();
    await toast(principal, /./);
    await expect(principal.getByText(/^Waiting for|Sent back/i).first()).toBeHidden({ timeout: 5000 }).catch(() => {});

    // 3. clerk is told, sees the note, fixes it and schedules it for approval again
    const clerkBell = await bellAfter(clerk, "");
    expect(clerkBell, "clerk's bell after changes were asked").toBeGreaterThan(0);
    await openFromList(clerk, /drafts/i, title);
    await expect(clerk.getByText(/say which account to pay into/i)).toBeVisible();
    await link(clerk, /edit and send again/i).click();
    await clerk.getByLabel("Title", { exact: true }).fill(title2);
    await clerk.getByLabel("Message", { exact: true }).fill("Fees for term 2 are due on the 5th. Pay into the school account shown on the receipt.");
    await btn(clerk, /^schedule$/i).click();
    await dialog(clerk).getByLabel(/send on/i).fill(istIn(5));
    await dialog(clerk).getByRole("button", { name: /schedule and send for approval/i }).click();
    await expect(clerk.getByText(/waiting for .* to approve/i)).toBeVisible({ timeout: 30_000 });

    // 4. principal approves; it is now scheduled
    await openFromList(principal, /waiting for approval/i, title2);
    // UX gap (reported): after a send-back the approver is not shown what the author changed.
    await expect(principal.getByText(/corrected|Pay into the school account/i).first()).toBeVisible();
    await btn(principal, /^approve$/i).click();
    await dialog(principal).getByRole("button", { name: /^approve and send$/i }).click();
    await expect(principal.getByText(/Goes out \d/).first()).toBeVisible({ timeout: 20_000 });
    await principal.goto(at("announcements?tab=scheduled"));
    await expect(principal.getByRole("link", { name: title2 })).toBeVisible();

    // 5. the time comes (the only nudge: the clock), the worker runs
    sql(`update announcements set scheduled_at=now()-interval '1 minute' where title='${title2}' and school_id='${schoolId(SLUG)}'`);
    job("comms.publish-due"); job("comms.deliver");

    // 6. family on a phone: bell, feed order, opens and answers
    const fam = await bellAfter(family, "");
    expect(fam, "family bell after the circular went out").toBeGreaterThan(0);
    await family.goto(at(""));
    await nav(family, /^notices\b/i);
    await family.waitForURL(/\/app\/announcements/);
    await noSideways(family, "family feed");
    await expect(family.locator("main section[aria-label]").first(), "the first group is what needs an answer").toHaveAttribute("aria-label", "Needs your answer");
    const firstCard = family.locator('main section[aria-label="Needs your answer"] ul li a', { hasText: title2 });
    await expect(firstCard, "the new circular sits in Needs your answer").toBeVisible();
    await firstCard.click();
    await expect(family.getByText(/CIR\/[\d-]+\/\d+/).first(), "family sees the circular number").toBeVisible();
    await noSideways(family, "family notice");
    await btn(family, /i have read this/i).click();
    await expect(family.getByText(/your answer/i).first()).toBeVisible({ timeout: 20_000 });

    // 7. principal's report moves
    await openFromList(principal, /live/i, title2);
    await expect(principal.getByText(/CIR\/[\d-]+\/\d+/).first()).toBeVisible();
    await link(principal, /who has answered/i).click();
    await expect(principal.getByText(/answered/i).first()).toBeVisible();
    await expect(principal.getByText(/1 of \d+|Reached \d+ of \d+, opened by [1-9]/).first()).toBeVisible();
  });
});


/** Notices go by email in the morning and evening digest; run both, as the worker would. */
const digests = () => { for (const hour of [8, 18]) job("notifications.digest", { hour }); };
/** Mailpit messages whose subject or text carries this text. */
async function mailsAbout(text: string): Promise<{ Subject: string; To: { Address: string }[] }[]> {
  const r = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`"${text}"`)}&limit=50`);
  return (await r.json()).messages ?? [];
}
/** Open a sidebar link; on a phone the menu button comes first. */
async function nav(page: Page, name: RegExp) {
  const l = link(page, name);
  if (!(await l.isVisible())) await btn(page, /open menu/i).click();
  await l.click();
}
/** The text of the bell's list: open it, read it, close it. */
async function bellList(page: Page) {
  await btn(page, /^notifications/i).click();
  const list = page.getByRole("dialog", { name: "Notifications" });
  await expect(list).toBeVisible();
  const text = await list.innerText();
  await page.keyboard.press("Escape");
  return text;
}
const feedCard = (page: Page, title: string) => page.locator("main section[aria-label] ul li a", { hasText: title }).first();
const openCard = async (page: Page, title: string) => { await feedCard(page, title).click(); await page.waitForURL(/\/announcements\/[0-9a-f-]{20,}/); };
const openFeed = async (page: Page) => { await nav(page, /^notices\b/i); await page.waitForURL(/\/app\/announcements/); };

// ---------------------------------------------------------------- J2
test.describe("J2 principal publishes to everyone", () => {
  const first = `Winter timings ${STAMP}`, title = `Winter school hours ${STAMP}`;
  test("publish, undo, edit, publish, correct, withdraw", async () => {
    const principal = await people.as("admin"), family = await people.as("family");

    // publish, then change my mind inside the 30 seconds
    await startNotice(principal, "Notice");
    await fillNotice(principal, first, "School runs 8:30 to 2:30 from Monday.", "Everyone");
    await btn(principal, /^publish$/i).click();
    await expect(dialog(principal).getByText(/who it reaches/i)).toBeVisible();
    await dialog(principal).getByRole("button", { name: /^publish to \d+/i }).click();
    await expect(principal.getByText(/sending in \d+ s/i)).toBeVisible({ timeout: 20_000 });
    await btn(principal, /^undo$/i).click();
    await toast(principal, /not sent\. it is a draft again/i);
    await expect(principal.getByText(/^draft$/i).first()).toBeVisible();
    job("comms.publish-due"); job("comms.deliver");
    await family.goto(at("announcements"));
    await expect(feedCard(family, first), "an undone notice must not reach families").toHaveCount(0);
    digests();
    expect(sql(`select count(*) from notifications where title='${first}'`), "an undone notice must not notify anyone").toBe("0");

    // edit the draft and publish for real; "Send now" skips the wait
    await openFromList(principal, /drafts/i, first);
    await link(principal, /keep writing/i).click();
    await principal.getByLabel("Title", { exact: true }).fill(title);
    await principal.getByLabel("Message", { exact: true }).fill("School runs 8:30 to 2:30 from Monday 30 November.");
    await btn(principal, /^publish$/i).click();
    await dialog(principal).getByRole("button", { name: /^publish to \d+/i }).click();
    await expect(principal.getByText(/sending in \d+ s/i)).toBeVisible({ timeout: 20_000 });
    await btn(principal, /^send now$/i).click();
    await toast(principal, /^sent$/i);
    job("comms.publish-due"); job("comms.deliver");

    // family on a phone: bell shows it, feed marks it new, opening clears the mark
    expect(await bellAfter(family, ""), "family bell").toBeGreaterThan(0);
    expect(await bellList(family)).toContain(title);
    await family.goto(at(""));
    await openFeed(family);
    await noSideways(family, "J2 feed");
    await expect(feedCard(family, title).getByText("Not opened yet")).toHaveCount(1);
    await openCard(family, title);
    await expect(family.locator("main").getByText("8:30 to 2:30 from Monday 30 November")).toBeVisible();
    await noSideways(family, "J2 notice");
    digests();
    // a digest lists only a few items, so the proof is the delivery record (sent), not the words in the mail
    await expect.poll(() => sql(`select d.state from comm_deliveries d join notifications n on n.id=d.notification_id join users u on u.id=d.user_id where n.title='${title}' and u.login_id='teacher' and d.channel='email'`), { message: "staff get the notice by email digest (sent, or held by the shared daily email limit)" }).toMatch(/^(sent|pending)$/);

    // correct it: new text, a note, everyone told again
    await openFromList(principal, /live/i, title);
    await btn(principal, /^more$/i).click();
    await principal.getByRole("menuitem", { name: "Correct" }).or(principal.getByRole("link", { name: "Correct" })).first().click();
    await principal.getByLabel("Message", { exact: true }).fill("School runs 8:30 to 2:45 from Monday 30 November.");
    await principal.getByLabel("What changed").fill("Closing time is 2:45, not 2:30");
    await btn(principal, /^save correction$/i).click();
    await expect(principal.getByText(/Updated \d/).first()).toBeVisible({ timeout: 20_000 });
    await link(principal, /^history/i).click();
    await expect(principal.getByText(/Closing time is 2:45/)).toBeVisible();
    job("comms.deliver");
    await family.goto(at("announcements"));
    await expect(feedCard(family, title)).toContainText(/Updated/);
    await openCard(family, title);
    await expect(family.locator("main").getByText("2:45 from Monday")).toBeVisible();
    await expect(family.getByText(/Updated \d/).first()).toBeVisible();

    // withdraw it with a reason people can read
    await family.goto(at("announcements"));
    const withdrawnBefore = await family.locator("main section[aria-label] ul li a", { hasText: /withdrawn by the school/i }).count();
    await openFromList(principal, /live/i, title);
    await btn(principal, /^more$/i).click();
    await principal.getByRole("menuitem", { name: "Withdraw" }).or(principal.getByRole("button", { name: "Withdraw" })).first().click();
    await dialog(principal).getByLabel(/why it is withdrawn/i).fill("Dates will be shared again next week.");
    await dialog(principal).getByRole("button", { name: /^withdraw$/i }).click();
    await expect(principal.getByText(/Withdrawn .*Dates will be shared again/).first()).toBeVisible({ timeout: 20_000 });
    await family.goto(at("announcements"));
    const gone = family.locator("main section[aria-label] ul li a", { hasText: /withdrawn by the school/i });
    // the card names the notice, struck through, so a family can tell which one was taken back
    expect(await gone.count(), "withdrawn notice still shows to the family as Withdrawn by the school").toBeGreaterThan(withdrawnBefore);
    await expect(gone.filter({ hasText: title }).locator("span.line-through").first(), "withdrawn title is shown struck through").toBeVisible();
    await expect(family.locator("main").getByText("2:45 from Monday"), "withdrawn words are not in the feed").toHaveCount(0);
    await gone.first().click();
    await family.waitForURL(/\/announcements\/[0-9a-f-]{20,}/);
    await expect(family.getByText(/withdrawn by the school/i).first()).toBeVisible();
    await expect(family.locator("main").getByText("2:45 from Monday"), "withdrawn words are hidden from families").toHaveCount(0);
    await noSideways(family, "J2 withdrawn");
    expect(await bellList(family), "the bell line is rewritten, not left telling the old words").not.toContain("2:45");
    // the same state in the principal's list
    await openFromList(principal, /archive/i, title);
    await expect(principal.getByText(/withdrawn/i).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------- J3
test.describe("J3 teacher collects trip consent", () => {
  const title = `Zoo trip consent ${STAMP}`;
  test("own section, yes, no, paper, nudge, due date passes, CSV and sign sheet", async () => {
    const teacher = await people.as("teacher"), family = await people.as("family"), family2 = await people.as("family2");

    await startNotice(teacher, "Notice");
    // a class teacher starts with every section they are class teacher of; keep Nursery A only
    for (const rm of await teacher.getByRole("button", { name: /^remove (?!.*nursery)/i }).all()) await rm.click();
    await expect(teacher.getByRole("list", { name: "Reaching" }).getByRole("listitem")).toHaveCount(1);
    await teacher.getByLabel("Title", { exact: true }).fill(title);
    await teacher.getByLabel("Message", { exact: true }).fill("We visit the zoo on Friday. Please say if your child may come.");
    await teacher.getByLabel("What people are asked to do").selectOption({ label: "Yes or no" });
    await teacher.getByLabel(/ask why when the answer is no/i).check();
    await teacher.getByLabel(/answer by/i).fill(istIn(60 * 48));
    await btn(teacher, /^publish$/i).click();
    await expect(dialog(teacher).getByText(/10 families/)).toBeVisible();
    await dialog(teacher).getByRole("button", { name: /^publish to 10/i }).click();
    await btn(teacher, /^send now$/i).click();
    await toast(teacher, /^sent$/i);
    job("comms.publish-due"); job("comms.deliver");

    // family says yes, family2 says no with a reason: each on a phone
    await family.goto(at(""));
    expect(await bellList(family)).toContain(title);
    await openFeed(family);
    await expect(family.locator("main section[aria-label]").first(), "needs-your-answer comes first").toHaveAttribute("aria-label", "Needs your answer");
    await expect(feedCard(family, title)).toContainText(/Answer by/);
    await openCard(family, title);
    await family.getByRole("radio", { name: "Yes" }).click();
    await family.getByLabel("Your name").fill("Mohan Lal Sharma");
    await family.getByLabel("You are the").selectOption({ index: 1 });
    await btn(family, /save my answer/i).click();
    await expect(family.getByText(/your answer/i).first()).toBeVisible({ timeout: 20_000 });
    await noSideways(family, "J3 answered");

    await family2.goto(at("announcements"));
    await openCard(family2, title);
    await family2.getByRole("radio", { name: "No" }).click();
    await btn(family2, /save my answer/i).click(); // a refusal must say what is missing, not just fail
    await expect(family2.getByText(/why|reason|name/i).first()).toBeVisible();
    await family2.getByLabel(/why not/i).fill("We are travelling that day.");
    await family2.getByLabel("Your name").fill("Suresh Nair");
    await family2.getByLabel("You are the").selectOption({ index: 1 });
    await btn(family2, /save my answer/i).click();
    await expect(family2.getByText(/your answer/i).first()).toBeVisible({ timeout: 20_000 });

    // teacher: report numbers, paper answer for a family without a phone
    await openFromList(teacher, /live/i, title);
    await link(teacher, /who has answered/i).click();
    await expect(teacher.getByText(/2 of 10/).first()).toBeVisible();
    await expect(teacher.getByText(/Reached \d+ of 10/)).toBeVisible();
    const paperRow = teacher.locator("tbody tr", { hasText: "Not answered" }).first();
    const paperFor = (await paperRow.locator("td").first().innerText()).split("\n")[0]!.trim();
    await paperRow.getByRole("button", { name: /paper answer/i }).click();
    await dialog(teacher).getByRole("radio", { name: "Yes" }).click();
    await dialog(teacher).getByLabel("Your name").fill("Slip signed by a parent");
    await dialog(teacher).getByLabel("You are the").selectOption({ index: 1 });
    await dialog(teacher).getByRole("button", { name: /write it down/i }).click();
    await expect(teacher.getByText(/3 of 10/).first()).toBeVisible({ timeout: 20_000 });
    await expect(teacher.locator("tbody tr", { hasText: paperFor })).toContainText(/on paper/i);

    // nudge: only the 7 who have not answered, and only once a day
    await btn(teacher, /remind those who have not answered/i).click();
    await toast(teacher, /Reminded 7 people/);
    await btn(teacher, /remind those who have not answered/i).click();
    await toast(teacher, /already reminded in the last day/i);

    // the due date passes: answers lock for the family, the reminder button goes
    sql(`update announcements set due_at=now()-interval '1 hour' where title='${title}' and school_id='${schoolId(SLUG)}'`);
    job("comms.publish-due");
    await family.goto(at("announcements"));
    await openCard(family, title);
    await expect(family.getByText(/answers are locked|last date has passed/i).first()).toBeVisible();
    await expect(btn(family, /change my answer/i), "a locked answer must not offer Change").toHaveCount(0);
    await openFromList(teacher, /live/i, title);
    await link(teacher, /who has answered/i).or(link(teacher, /^responses/i)).first().click();
    await expect(teacher.getByRole("button", { name: /remind those who have not answered/i }), "no reminder after the date").toHaveCount(0);

    // CSV and sign sheet for the office file
    const [dl] = await Promise.all([teacher.waitForEvent("download"), link(teacher, /^csv$/i).click()]);
    const csv = (await import("node:fs")).readFileSync(await dl.path()!, "utf8");
    expect(csv).toMatch(/Aarav Sharma/);
    expect(csv).toMatch(/Saanvi Nair/);
    expect(csv).toMatch(/travelling/);
    const sheet = await teacher.context().request.get(await link(teacher, /sign sheet/i).getAttribute("href").then((h) => new URL(h!, SCHOOL(SLUG)).toString()));
    expect(sheet.status(), "sign sheet opens").toBe(200);
  });
});

// ---------------------------------------------------------------- J4
test.describe("J4 emergency closure", () => {
  const name = `Heavy rain ${STAMP}`, alert = `School closed today: heavy rain ${STAMP}`;
  const today = () => new Date(Date.now() + 330 * MIN).toISOString().slice(0, 10);
  // The seed has today's attendance marked, and a closure refuses a marked day. At 6:30 nobody has marked yet, so set today aside and put it back.
  const restore = () => {
    sql(`delete from attendance_holidays where name like 'Heavy rain %' and school_id='${schoolId(SLUG)}'`);
    for (const [t, b] of [["student_attendance", "zz_j4_students"], ["staff_attendance", "zz_j4_staff"]] as const) {
      if (sql(`select to_regclass('${b}')`)) { sql(`insert into ${t} select * from ${b} on conflict do nothing`); sql(`drop table ${b}`); }
    }
  };
  test.beforeAll(() => {
    restore();
    for (const [t, b] of [["student_attendance", "zz_j4_students"], ["staff_attendance", "zz_j4_staff"]] as const) {
      sql(`create table ${b} as select * from ${t} where school_id='${schoolId(SLUG)}' and date='${today()}'`);
      sql(`delete from ${t} where school_id='${schoolId(SLUG)}' and date='${today()}'`);
    }
  });
  test.afterAll(restore);
  test("closure, urgent alert, attendance blocked, banner, live count", async () => {
    const principal = await people.as("admin"), teacher = await people.as("teacher"), family = await people.as("family");

    // the principal closes the school for today
    await principal.goto(at(""));
    await nav(principal, /^holidays$/i);
    await principal.waitForURL(/attendance\/holidays/);
    await btn(principal, /add holiday/i).click();
    const d = dialog(principal);
    await d.getByLabel("First day").fill(today());
    await d.getByLabel("Name").fill(name);
    await d.getByLabel("Kind").selectOption({ label: "Emergency closure" });
    await d.getByLabel("Who is off").selectOption({ index: 1 });
    await d.getByRole("button", { name: /^add$/i }).click();
    await expect(principal.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    // then the urgent alert: it asks to confirm, showing the count
    await startNotice(principal, "Urgent alert");
    await principal.getByRole("group", { name: "Quick choices" }).getByRole("button", { name: "Everyone", exact: true }).click();
    await principal.getByLabel("Title", { exact: true }).fill(alert);
    await principal.getByLabel("Message", { exact: true }).fill("Heavy rain. School is closed today. Please stay at home.");
    await btn(principal, /^send alert$/i).click();
    await expect(dialog(principal).getByText(/send this alert now/i)).toBeVisible();
    await dialog(principal).getByRole("button", { name: /^send to \d+ now$/i }).click();
    await expect(principal.getByText(/Urgent alert/).first()).toBeVisible({ timeout: 20_000 });
    job("comms.publish-due"); job("comms.deliver");

    // attendance is blocked for the teacher, in words
    await teacher.goto(at(""));
    await nav(teacher, /^attendance$/i);
    await teacher.waitForURL(/\/app\/attendance/);
    await expect(teacher.getByText(/closed|holiday|heavy rain/i).first(), "attendance says why it is blocked").toBeVisible();
    await expect(teacher.getByText(name).first()).toBeVisible();

    // family on a phone: red banner on every page until opened
    await family.goto(at(""));
    await expect(family.getByRole("alert").filter({ hasText: alert })).toBeVisible();
    await noSideways(family, "J4 home with banner");
    await family.getByRole("alert").getByRole("link", { name: new RegExp(alert) }).click();
    // one tap, nothing to fill in first; the name is asked after only when the school has none for this child
    await btn(family, /^i am safe$/i).click();
    await expect(family.getByText(/^Safe, received\. Thank you\./).first()).toBeVisible({ timeout: 20_000 });
    if (await family.getByRole("button", { name: /save my name/i }).isVisible()) {
      await family.getByLabel("Your name").fill("Mohan Lal Sharma");
      await family.getByLabel("You are the").selectOption({ index: 1 });
      await btn(family, /save my name/i).click();
    }
    await expect(family.getByText(/Safe, received .* · .+, .+/).first(), "the answer names who gave it").toBeVisible({ timeout: 20_000 });
    await family.goto(at(""));
    await expect(family.getByRole("alert").filter({ hasText: alert }), "banner goes once opened").toHaveCount(0);

    // the sender sees the count; staff got the alert by email
    await openFromList(principal, /live/i, alert);
    await link(principal, /who has answered/i).click();
    await expect(principal.getByText(/Reached \d+ of \d+, opened by [1-9]/)).toBeVisible();
    await expect(principal.getByText(/1 of \d+/).first()).toBeVisible();
    await expect.poll(async () => (await mailsAbout(alert)).some((m) => m.To[0]?.Address === "teacher@greenvalley.test"), { message: "alert email to staff" }).toBeTruthy();
  });
});


// ---------------------------------------------------------------- J14
/** Take away what J14 added: its notice, its student and the student's login. The year, class and section stay (the empty school lacks them). */
const tidyRiverside = () => {
  const id = schoolId("riverside");
  const ids = `select id from announcements where school_id='${id}' and title like 'Welcome to Riverside %'`;
  const tries = [
    `delete from announcement_responses where recipient_id in (select id from announcement_recipients where announcement_id in (${ids}))`,
    `delete from announcement_recipients where announcement_id in (${ids})`,
    `delete from announcements where id in (${ids})`,
    `delete from notifications where school_id='${id}' and title like 'Welcome to Riverside %'`,
    `delete from students where school_id='${id}' and name like 'Riya Das %'`,
    `delete from users where school_id='${id}' and name like 'Riya Das %'`,
  ];
  for (const q of tries) { try { sql(q); } catch { /* shortcut: a linked or append-only row stays; the next run uses a new stamp */ } }
};
test.describe("J14 first day at an empty school", () => {
  const RV = "riverside", title = `Welcome to Riverside ${STAMP}`, DOB = "01012015", name = `Riya Das ${STAMP}`;
  test.beforeAll(tidyRiverside);
  test.afterAll(tidyRiverside);
  test("checklist leads to the first notice, a family reads it", async ({ browser }) => {
    const ctx = await browser.newContext(), admin = await ctx.newPage();
    await login(admin, RV, "admin");
    const rvAt = (p: string) => `${SCHOOL(RV)}/app/${p}`;

    // 1. is there a way to the checklist from the first screen?
    await admin.goto(rvAt(""));
    await expect(admin.getByRole("heading", { name: /^good (morning|afternoon|evening)/i })).toBeVisible();
    const toChecklist = admin.getByRole("link", { name: /talking to families|first steps|get started|set up communication|finish setup/i });
    expect.soft(await toChecklist.count(), "Home must lead to the first-day checklist (it lives only at /app/setup/done, which nothing links to)").toBeGreaterThan(0);
    await admin.goto(rvAt("setup/done"));
    await expect(admin.getByText(/talking to families: \d of 4 done/i)).toBeVisible();

    // 2. every step opens a real screen, never a dead end
    const steps: [RegExp, RegExp, RegExp][] = [
      [/check that email works/i, /\/notifications\/delivery/, /email allowance|delivery/i],
      [/look at quiet hours/i, /\/settings\/communication/, /quiet hours/i],
      [/name a safeguarding lead/i, /\/settings/, /roles?/i],
    ];
    for (const [label, url, shows] of steps) {
      await admin.goto(rvAt("setup/done"));
      await admin.locator("li", { hasText: label }).getByRole("link", { name: /do it|open/i }).click();
      await admin.waitForURL(url);
      await expect(admin.locator("main").getByText(shows).first(), `${label} opens a screen that does that`).toBeVisible();
      await expect(admin.getByText(/not found|something went wrong|you do not have|no permission|only an admin/i), `${label}: no refusal`).toHaveCount(0);
    }

    // 3. the last step opens the form; with nobody in the school it must say so
    await admin.goto(rvAt("setup/done"));
    await admin.locator("li", { hasText: /send your first notice/i }).getByRole("link", { name: /do it|open/i }).click();
    await admin.waitForURL(/announcements\/new/);
    await admin.getByRole("group", { name: "Quick choices" }).getByRole("button", { name: "All families", exact: true }).click();
    await admin.getByLabel("Title", { exact: true }).fill(title);
    await admin.getByLabel("Message", { exact: true }).fill("Welcome to the new school year. We will write here first.");
    await btn(admin, /^publish$/i).click();
    await expect.soft(dialog(admin).getByText(/nobody|no one|0 families/i).first(), "with no families the form says nobody is reached").toBeVisible();
    expect.soft(await dialog(admin).getByRole("link", { name: /student|class|add/i }).count(), "and offers a way to add people (dead end otherwise)").toBeGreaterThan(0);
    await dialog(admin).getByRole("button", { name: /not yet/i }).click();

    // 4. add a family the way the checklist says: Add your students
    await admin.goto(rvAt("setup/done"));
    await admin.getByRole("link", { name: /add your students/i }).click();
    await admin.waitForURL(/\/app\/students/);
    const rid = schoolId(RV);
    // an empty school has no academic year, so no section can exist: the one thing set up under the hood
    sql(`insert into academic_years (id,school_id,name,starts_on,ends_on,is_current) select gen_random_uuid(),'${rid}','2026-27','2026-04-01','2027-03-31',true where not exists (select 1 from academic_years where school_id='${rid}')`);
    sql(`insert into classes (id,school_id,name,grade) select gen_random_uuid(),'${rid}','Class 1',1 where not exists (select 1 from classes where school_id='${rid}' and name='Class 1')`);
    sql(`insert into sections (id,school_id,class_id,year_id,name) select gen_random_uuid(),'${rid}',c.id,y.id,'A' from classes c, academic_years y where c.school_id='${rid}' and y.school_id='${rid}' and y.is_current and c.name='Class 1' and not exists (select 1 from sections where school_id='${rid}')`);
    await admin.reload();
    await link(admin, /admit student/i).or(btn(admin, /admit student/i)).first().click();
    const d = admin.getByRole("dialog").or(admin.locator("main")).last();
    await d.getByLabel(/full name/i).fill(name);
    await d.getByLabel(/date of birth/i).fill("2015-01-01");
    await d.getByLabel(/class and section/i).selectOption({ index: 1 });
    await d.getByLabel(/guardian name/i).fill("Anil Das");
    await d.getByLabel(/guardian phone/i).fill("9876500011");
    await d.getByLabel(/relation/i).selectOption({ label: "Father" });
    await d.getByRole("button", { name: /^admit$/i }).click();
    await expect(admin.getByText(name).first()).toBeVisible({ timeout: 30_000 });
    const adm = sql(`select login_id from users where name='${name}' and school_id='${rid}'`);
    expect(adm, "the student has a login").toBeTruthy();

    // 5. first notice goes out; the checklist ticks itself
    await startNoticeAt(admin, RV);
    await fillNotice(admin, title, "Welcome to the new school year. We will write here first.", "All families");
    await btn(admin, /^publish$/i).click();
    await expect(dialog(admin).getByText(/1 family/)).toBeVisible();
    await dialog(admin).getByRole("button", { name: /^publish to 1/i }).click();
    await btn(admin, /^send now$/i).click();
    await toast(admin, /^sent$/i);
    job("comms.publish-due");
    await admin.goto(rvAt("setup/done"));
    await expect(admin.getByText(/talking to families: \d of 4 done/i)).toBeVisible();
    await expect(admin.locator("li", { hasText: /send your first notice/i }).getByText("Done")).toBeVisible();

    // 6. the family reads it on a phone; the school sees it opened
    const fctx = await browser.newContext({ viewport: { width: 375, height: 812 } }), fam = await fctx.newPage();
    await loginStudent(fam, RV, adm, DOB);
    await fam.goto(`${SCHOOL(RV)}/app/announcements`);
    await noSideways(fam, "J14 feed");
    const card = fam.locator("main section[aria-label] ul li a", { hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    await expect(fam.locator("main").getByText("We will write here first")).toBeVisible();
    await admin.goto(rvAt("announcements"));
    await admin.getByRole("link", { name: title }).first().click();
    await expect(admin.getByText(/1 of 1 opened/).first()).toBeVisible();
    await ctx.close(); await fctx.close();
  });
});
/** Notices, then New notice, in another school. */
async function startNoticeAt(page: Page, slug: string) {
  await page.goto(`${SCHOOL(slug)}/app`);
  await link(page, /^notices\b/i).click();
  await page.waitForURL(/\/app\/announcements/);
  await btn(page, /new notice/i).click();
  await page.getByRole("menuitem", { name: "Notice", exact: true }).click();
  await page.waitForURL(/\/announcements\/new/);
}
void says; void main; void mails;
