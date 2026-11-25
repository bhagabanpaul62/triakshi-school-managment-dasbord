import { expect, test, type Page } from "@playwright/test";
import { CONSOLE, consoleLogin, SCHOOL } from "./helpers";
import { at, dialog, job, main, mails, People, says, SLUG, sql } from "./comm-lib";

/**
 * Communication journeys J5, J6, J7, J8, J15 (PRD 13.1): talk, concerns, requests, complaints, support session.
 * Each is done as a person would: click what is on screen, never jump by URL where a link exists. Families are on a 375 px phone.
 * Uses expect.soft for the "does this read well" checks so one journey reports every problem, and hard expects for steps that must work.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });
// Tracing keeps DOM snapshots of every step and crashed the long-lived phone tabs of these journeys; the failure screenshot is enough.
test.use({ trace: "off" });

/** Log a crashed tab or a page error so a failure says which person's screen it was. */
const watch = (page: Page, who: string) => { page.on("console", (m) => { if (process.env.DEBUGTAB) console.log(`${who} ${m.type()}: ${m.text().slice(0, 160)}`); }); page.on("crash", () => console.log(`CRASH: ${who} tab`)); page.on("pageerror", (e) => console.log(`PAGEERROR ${who}: ${String(e).slice(0, 200)}`)); return page; };
const STAMP = Date.now().toString().slice(-6);
let people: People;
test.beforeAll(({ browser }) => { people = new People(browser, ["family", "family2"]); });
test.afterAll(async () => { await people.close(); });

// ---------- helpers ----------
const SCHOOL_ID = () => sql(`select id from schools where slug = '${SLUG}'`);
const userId = (login: string) => sql(`select id from users where school_id = '${SCHOOL_ID()}' and login_id = '${login}'`);
const q = (s: string) => s.replace(/'/g, "''");

/** Click a link in the main menu: the side bar on a desktop, the menu sheet on a phone. */
async function via(page: Page, name: RegExp) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name }).click();
  } else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
}
/** Nothing on a phone may run past the screen edge or be cut off. Soft, so the journey goes on. */
async function fits(page: Page, where: string) {
  if ((page.viewportSize()?.width ?? 1280) > 500) return;
  const bad = await page.evaluate(() => {
    const w = document.documentElement.clientWidth, out: string[] = [];
    if (document.documentElement.scrollWidth > w + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${w})`);
    const scrolls = (el: Element) => { for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main button, main a, main h1, main h2, main input, main textarea, main select, header button, [role=\"dialog\"] button, [role=\"dialog\"] select, [role=\"dialog\"] textarea, [role=\"dialog\"] h2"))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2 || getComputedStyle(el).visibility === "hidden" || scrolls(el)) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
      if (r.right > w + 1 || r.left < -1) out.push(`"${label}" is outside the screen`);
      else if ((el.tagName === "BUTTON" || /^H\d$/.test(el.tagName)) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") out.push(`"${label}" is cut off`);
    }
    return out;
  });
  if (bad.length && process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/clip-${where.replace(/\W+/g, "-")}.png`, fullPage: true });
  expect.soft(bad, `${where}: clipped at 375 px`).toEqual([]);
}
/** A button just pressed must not have ended in a refusal toast or alert. */
async function noRefusal(page: Page, where: string) {
  await page.waitForTimeout(600);
  const texts = await page.locator('[role="status"], [role="alert"]').allInnerTexts();
  expect.soft(texts.filter((t) => /could not|cannot|can't|not allowed|not available|no permission|forbidden|not found|try again|went wrong/i.test(t)), `${where}: a button ended in a refusal`).toEqual([]);
}
/**
 * An open conversation refreshes itself every 10 s (PRD M16), so a person watching it sees news without reloading.
 * The specs wait for that instead of reloading: a reload right after a refresh crashed the phone tab in this Chromium.
 */
const LIVE = { timeout: 35_000 };
/** The whole visible screen, for "this must not appear" checks. */
const screen = (page: Page) => page.locator("body").innerText();
const bell = async (page: Page) => Number(((await page.getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label")) ?? "").match(/(\d+) unread/)?.[1] ?? 0);
/** Open a conversation from the inbox by its subject, the way a person taps the row. */
async function openThread(page: Page, subject: string | RegExp) {
  await main(page).getByRole("link", { name: subject }).first().click();
  await expect(page.getByRole("heading", { name: subject, level: 2 })).toBeVisible({ timeout: 20_000 });
}
async function typeAndSend(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: /^send/i }).click();
}
const istNow = () => new Date(Date.now() + 330 * 60_000);
const hm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const clock12 = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, "0")}\\s?${h < 12 ? "am" : "pm"}`;
const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

// =====================================================================================================================
// J5  Family asks a teacher at night, is told it will be delivered in the morning, teacher is away, answers, family sees Seen
// =====================================================================================================================
test("J5 family writes at night: told when it is delivered, teacher away, answer, Seen", async () => {
  const subject = `Night question ${STAMP}`, body = `Is homework ${STAMP} due Monday?`, answer = `Yes, Monday ${STAMP}. I am away but I will read it.`;
  const school = SCHOOL_ID(), teacherId = userId("teacher");
  // A family may start 10 conversations a day; earlier runs of this journey must not use it up.
  sql(`delete from message_threads where school_id = '${school}' and subject like 'Night question %'`);
  const old = sql(`select settings::text from comm_settings where school_id = '${school}'`);
  const prefs = sql(`select coalesce(quiet_from,'') || '|' || coalesce(away_until::text,'') from notification_prefs where user_id = '${teacherId}'`);
  // Make "now" the middle of the night for the school: from an hour ago to two hours ahead. The morning is then `to`.
  const now = istNow(), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const from = hm(mins - 60), to = hm(mins + 120), toH = Math.floor((((mins + 120) % 1440) + 1440) % 1440 / 60), toM = (mins + 120) % 60;
  const settings = JSON.stringify({ ...(old ? JSON.parse(old) : {}), quietFrom: from, quietTo: to, quietSundays: false });
  sql(`insert into comm_settings (id, school_id, settings) values (gen_random_uuid(), '${school}', '${q(settings)}') on conflict (school_id) do update set settings = excluded.settings`);
  const restore = () => {
    if (old) sql(`update comm_settings set settings = '${q(old)}' where school_id = '${school}'`); else sql(`delete from comm_settings where school_id = '${school}'`);
    const [qf, au] = prefs.split("|");
    sql(`update notification_prefs set quiet_from = ${qf ? `'${qf}'` : "null"}, away_until = ${au ? `'${au}'` : "null"}, away_text = null where user_id = '${teacherId}'`);
  };
  try {
    const fam = watch(await people.as("family"), "family"), teacher = watch(await people.as("teacher"), "teacher");
    await fam.goto(at(""));
    const teacherBellBefore = await bell(teacher);

    // The family opens Messages from the menu and starts a new message to the class teacher.
    await via(fam, /^Messages/);
    await expect(main(fam).getByRole("heading", { name: "Messages" })).toBeVisible();
    await fits(fam, "family inbox");
    await main(fam).getByRole("link", { name: "New message" }).first().click();
    await expect(main(fam).getByRole("heading", { name: "New message" })).toBeVisible();
    await expect(fam.getByRole("button", { name: "Send" })).toBeVisible();
    await fits(fam, "family new message");
    await main(fam).getByRole("checkbox", { name: /Meera Iyer/ }).check();
    await fam.getByLabel("Subject").fill(subject);
    await fam.getByLabel("Message", { exact: true }).fill(body);
    await fam.getByRole("button", { name: "Send" }).click();
    await noRefusal(fam, "family send at night");

    // They land in the conversation and are told, in plain words, when it will be delivered.
    await expect(fam.getByRole("heading", { name: subject, level: 2 })).toBeVisible({ timeout: 20_000 });
    await expect(fam.getByText(body, { exact: true })).toBeVisible();
    await fam.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/j5-thread.png` });
    await says(fam, new RegExp(`Will be delivered at ${clock12(toH, toM)}`, "i"));
    await expect.soft(fam.getByText(/They can read it in the app now/i).first(), "family is told the teacher can already read it in the app").toBeVisible();
    await expect.soft(fam.getByText(/This message is not delivered|not delivered/i)).toHaveCount(0);
    await fits(fam, "family thread at night");

    const threadId = sql(`select id from message_threads where school_id = '${school}' and subject = '${q(subject)}'`);
    const mine = (state: string) => sql(`select count(*) from comm_deliveries d join notifications n on n.id = d.notification_id where d.user_id = '${teacherId}' and n.subject_id = '${threadId}' and d.state = '${state}'`);
    expect(Number(mine("pending")), "the teacher's email and push for it are waiting for the morning, not sent").toBeGreaterThan(0);
    expect(sql(`select count(*) from comm_deliveries d join notifications n on n.id = d.notification_id where d.user_id = '${teacherId}' and n.subject_id = '${threadId}' and d.next_at < now() and d.state = 'pending'`), "nothing for the teacher is due while it is night").toBe("0");
    expect((await mails("teacher@greenvalley.test")).filter((m) => m.Subject.includes(STAMP)), "no email reached the teacher at night").toHaveLength(0);
    // The teacher sees it at once in the app: sidebar count, bell, inbox row, the message itself. Email and push wait.
    await via(teacher, /^Messages/);
    // The bell checks every 60 s (PRD 12), so it may take a minute to count the new message; it must not stay behind.
    await expect.poll(() => bell(teacher), { message: "the teacher's bell counts the new message within its 60 s check", timeout: 75_000, intervals: [2000] }).toBeGreaterThan(teacherBellBefore);
    await expect(main(teacher).getByRole("link", { name: new RegExp(subject) })).toBeVisible();
    await openThread(teacher, subject);
    await expect(teacher.getByText(body, { exact: true })).toBeVisible();
    expect(Number(mine("sent")), "nothing was sent to the teacher while it is night").toBe(0);
    // In quiet hours the family must not yet see "Seen".
    await fam.waitForTimeout(12_000); // one refresh of the family's open conversation
    await expect(fam.getByText(/^Seen\b/)).toHaveCount(0);
    await expect.soft(fam.getByText(/Delivered/).first(), "the family sees a state for the message while the teacher has read it at night").toBeVisible();

    // The teacher goes away: More, My hours, a date and a note. The family reads it under the box.
    await via(teacher, /^Messages/);
    await main(teacher).getByRole("button", { name: "More" }).click();
    await teacher.getByRole("menuitem", { name: /My hours/ }).or(teacher.getByRole("link", { name: /My hours/ })).first().click();
    await expect(main(teacher).getByRole("heading", { name: /My hours and replies/ })).toBeVisible();
    await teacher.getByLabel("Back on").fill(tomorrow());
    await teacher.getByLabel("Note").fill(`Away for a trip ${STAMP}. For anything urgent, call the office.`);
    await teacher.getByRole("button", { name: "Save", exact: true }).click();
    await says(teacher, /^Saved$/);
    await expect(teacher.getByRole("button", { name: "I am back" })).toBeVisible();
    await noRefusal(teacher, "teacher away save");
    await teacher.getByRole("link", { name: "Back to messages" }).click();
    await openThread(teacher, subject);

    // The family opens the conversation again from Messages: the away note sits under the box.
    await via(fam, /^Messages/);
    await openThread(fam, subject);
    await expect(fam.getByText(new RegExp(`Meera Iyer is away until .*Away for a trip ${STAMP}`))).toBeVisible();
    await fits(fam, "family thread, teacher away");

    // The teacher answers.
    await typeAndSend(teacher, answer);
    await expect(teacher.getByText(answer, { exact: true })).toBeVisible();
    await noRefusal(teacher, "teacher answer");
    await expect(fam.getByText(answer, { exact: true })).toBeVisible(LIVE);
    // While it is still night "Seen" is held back; the morning (the window ends) releases it with a time.
    await expect(fam.getByText(/^Seen\b/)).toHaveCount(0);
    // Morning comes: the held times pass, the settings are back, the worker runs.
    sql(`update messages set deliver_after = now() - interval '1 minute' where thread_id = '${threadId}' and deliver_after is not null`);
    sql(`update comm_deliveries set next_at = now() - interval '1 minute' where state = 'pending' and notification_id in (select id from notifications where subject_id = '${threadId}')`);
    restore();
    job("comms.deliver", { schoolId: school });
    expect(Number(mine("pending")), "after the morning job nothing is left waiting for the teacher").toBe(0);
    expect((await mails("teacher@greenvalley.test")).filter((m) => m.Subject.includes(STAMP) || m.Subject.includes(body)), "no private text in any email subject").toHaveLength(0);
    await via(fam, /^Messages/);
    await openThread(fam, subject);
    await expect(fam.getByText(/Seen\s+\d{1,2}:\d{2}\s?[ap]m/i).first(), "after the night ends the family sees Seen with a time").toBeVisible();
    await expect(fam.getByText(/Will be delivered at/)).toHaveCount(0);
    await fits(fam, "family thread in the morning");
  } finally { restore(); }
});

// =====================================================================================================================
// J6  Teacher messages every family of her sections, private replies, one family reports a concern, the lead reviews, limits, closes
// =====================================================================================================================
test("J6 teacher messages all families: private replies, a concern, review, limit, closed", async () => {
  const subject = `Unit test notes ${STAMP}`, hello = `Please bring the notebook on Monday ${STAMP}.`;
  const reply1 = `Noted, thank you ${STAMP} from the Sharma family.`, reply2 = `We have a worry ${STAMP} about extra lessons.`;
  const school = SCHOOL_ID(), teacherId = userId("teacher");
  const clean = () => sql(`delete from message_threads t where t.school_id = '${school}' and t.subject like 'Unit test notes %' and t.held_at is null
    and not exists (select 1 from message_reports r where r.thread_id = t.id) and not exists (select 1 from message_reviews v where v.thread_id = t.id)`);
  clean();
  const lift = () => sql(`update message_restrictions set lifted_at = now() where user_id = '${teacherId}' and lifted_at is null`);
  lift();
  try {
    const teacher = watch(await people.as("teacher"), "teacher"), admin = await people.as("admin");
    const fam = watch(await people.as("family"), "family"), fam2 = watch(await people.as("family2"), "family2");

    // ---- the teacher writes to all her families: Messages, More, Message families, three steps ----
    await via(teacher, /^Messages/);
    await main(teacher).getByRole("button", { name: "More" }).click();
    await teacher.getByRole("menuitem", { name: /Message families/ }).or(teacher.getByRole("link", { name: /Message families/ })).first().click();
    await expect(main(teacher).getByRole("heading", { name: "Message families" })).toBeVisible();
    await expect(main(teacher).getByText(/\b24 families\b/).first()).toBeVisible();
    await teacher.getByRole("button", { name: "Next: what to say" }).click();
    await teacher.getByLabel("Subject").fill(subject);
    await teacher.getByLabel("Message", { exact: true }).fill(hello);
    await teacher.getByRole("button", { name: "Next: check" }).click();
    await expect(main(teacher).getByText(/^24 families$/)).toBeVisible();
    await expect(main(teacher).getByText(hello)).toBeVisible();
    await teacher.getByRole("button", { name: /^Send to 24 families$/ }).click();
    await expect(main(teacher).getByRole("heading", { name: subject })).toBeVisible({ timeout: 60_000 });
    await expect(main(teacher).getByText(/0 seen, 0 replied, of 24/)).toBeVisible();
    await noRefusal(teacher, "send to 24 families");

    // ---- two families on phones: each finds its own private conversation ----
    for (const [who, page, reply, other] of [["family", fam, reply1, reply2], ["family2", fam2, reply2, reply1]] as const) {
      await via(page, /^Messages/);
      await expect(main(page).getByRole("link", { name: new RegExp(subject) })).toBeVisible(LIVE);
      await fits(page, `${who} inbox with the teacher's message`);
      await openThread(page, subject);
      await expect(page.getByText(hello, { exact: true })).toBeVisible();
      await expect(page.getByText(/The school can review this conversation/).first()).toBeVisible();
      await fits(page, `${who} thread from a batch`);
      await typeAndSend(page, reply);
      await expect(page.getByText(reply, { exact: true })).toBeVisible();
      await noRefusal(page, `${who} private reply`);
      // Nobody else's family is in it: not the other family's reply, not "24 families", not a list of names.
      const text = await screen(page);
      expect(text, `${who} must not see the other family's reply`).not.toContain(other);
      expect(text, `${who} must not learn how many families got it`).not.toMatch(/24 famil|families never see|Message families/i);
    }
    await expect(fam2.getByText(/^About Saanvi Nair · Meera Iyer \(Teacher\)/)).toBeVisible();
    await expect(fam.getByText(/^About Aarav Sharma · Meera Iyer \(Teacher\)/)).toBeVisible();
    expect(await screen(fam), "GR0001's screen must not name GR0002's child").not.toContain("Saanvi");

    // ---- the teacher sees both replies, one by one, and the count on the sent page ----
    await via(teacher, /^Messages/);
    await main(teacher).getByRole("button", { name: "More" }).click();
    await teacher.getByRole("menuitem", { name: /Message families/ }).or(teacher.getByRole("link", { name: /Message families/ })).first().click();
    await main(teacher).getByRole("link", { name: "Sent before" }).click();
    await main(teacher).getByRole("link", { name: new RegExp(subject) }).first().click();
    await expect(main(teacher).getByText(/\b2 seen, 2 replied, of 24\b/), "the sent page counts who has seen and who has answered").toBeVisible();
    const row = main(teacher).locator("tr", { hasText: "Saanvi Nair" });
    await expect(row).toContainText(/Seen/);
    await expect(row).toContainText(/Replied/);
    await row.getByRole("link", { name: "Open" }).click();
    await expect(teacher.getByText(reply2, { exact: true })).toBeVisible();
    expect(await teacher.getByRole("log").innerText(), "the teacher reads one family's conversation at a time").not.toContain(reply1);

    // ---- GR0002 reports a concern about the teacher: What happened, Tell us more, who it is about ----
    await fam2.getByRole("button", { name: "Report a concern" }).click();
    let d = dialog(fam2);
    await expect(d.getByText(/The people it is about are not told/)).toBeVisible();
    await fits(fam2, "report a concern on a phone");
    await d.getByRole("button", { name: "Send report" }).click();
    await expect.soft(d.getByText("Choose what happened"), "an empty report says what is missing").toBeVisible();
    // Naming the teacher is only offered on one message, not on the whole conversation: the family uses the Report link under her message.
    expect.soft(await d.getByLabel(/someone else in this conversation/).count(), "reporting the whole 1:1 conversation gives no way to name the teacher it is about").toBeGreaterThan(0);
    await d.getByRole("button", { name: "Cancel" }).click();
    await fam2.getByRole("button", { name: "Report", exact: true }).first().click();
    d = dialog(fam2);
    await expect(d.getByText(/About this message/)).toBeVisible();
    await fits(fam2, "report one message on a phone");
    await d.getByLabel("What happened").selectOption({ label: "Pressure, threat or money" });
    await d.getByLabel("Tell us more").fill(`She asked us to pay for private lessons ${STAMP}.`);
    await d.getByLabel(/someone else in this conversation/).selectOption({ label: "Meera Iyer" });
    await d.getByRole("button", { name: "Send report" }).click();
    await expect(d.getByText(/the school's safeguarding lead has been told/i)).toBeVisible();
    await expect.soft(d.getByRole("button", { name: "Close", exact: true }).first(), "after reporting the family can close the box").toBeVisible();
    await d.getByRole("button", { name: "Close", exact: true }).first().click();
    await noRefusal(fam2, "report a concern");

    // ---- "You can follow it under Messages, My concerns": there must be a way to get there ----
    await via(fam2, /^Messages/);
    const concernsLink = main(fam2).getByRole("link", { name: /My concerns/ });
    expect.soft(await concernsLink.count(), "the family was told to look under Messages, My concerns: that link must be on the Messages screen").toBeGreaterThan(0);

    // ---- the named teacher is told nothing: bell, notifications, e-mail, sidebar ----
    await teacher.getByRole("button", { name: /^Notifications/ }).click();
    await teacher.getByRole("link", { name: "See all" }).click();
    await teacher.getByRole("link", { name: /^Everything/ }).click();
    const tNotes = await screen(teacher);
    expect(tNotes, "the teacher's notifications say nothing about a concern").not.toMatch(/concern|reported|safeguard/i);
    await expect(teacher.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Safeguarding/ })).toHaveCount(0);
    expect(sql(`select count(*) from notifications where user_id = '${teacherId}' and (title || ' ' || coalesce(body, '')) ilike '%concern%'`), "no concern notification row for the named teacher").toBe("0");
    expect((await mails("teacher@greenvalley.test")).filter((m) => /concern|safeguard/i.test(m.Subject)), "no concern email to the named teacher").toHaveLength(0);

    // ---- the lead (admin) finds it: sidebar Safeguarding, the row, the report ----
    await via(admin, /^Safeguarding/);
    await expect(main(admin).getByRole("heading", { name: "Safeguarding" })).toBeVisible();
    const concern = main(admin).locator("tr", { hasText: subject }).first();
    await expect(concern).toContainText(/Saanvi Nair|Aarav/);
    await expect(concern).toContainText(/Received/);
    await concern.getByRole("link", { name: "Pressure, threat or money" }).click();
    await expect(main(admin).getByText(`She asked us to pay for private lessons ${STAMP}.`)).toBeVisible();
    await expect(main(admin).getByText(/The concern names: Meera Iyer/)).toBeVisible();
    // No reason, no reading: the refusal is a plain sentence.
    await main(admin).getByRole("button", { name: "Open the conversation" }).click();
    await expect(main(admin).locator('[role="alert"]').filter({ hasText: /reason|why/i }).first(), "opening without a reason says a reason is needed").toBeVisible();
    await main(admin).getByLabel("Why are you opening this conversation?").fill("A family reported pressure to pay for private lessons");
    await main(admin).getByRole("button", { name: "Open the conversation" }).click();
    await expect(admin.getByText(/You are reading as a reviewer/)).toBeVisible({ timeout: 30_000 });
    await expect(admin.getByText(reply2, { exact: true })).toBeVisible();
    const reviewText = await screen(admin);
    // Review logged on the report page and in the review log.
    const dl = admin.waitForEvent("download");
    await admin.getByLabel(/Reason for a PDF copy/).fill("Copy for the file of the concern");
    await admin.getByRole("button", { name: "Download PDF" }).click();
    expect((await dl).suggestedFilename(), "the reviewer gets a PDF").toMatch(/\.pdf$/);
    await admin.getByRole("link", { name: "Back to concerns" }).click();
    await admin.getByRole("link", { name: "Review log" }).click();
    await expect(main(admin).locator("tr", { hasText: subject }).filter({ hasText: "A family reported pressure" }).first(), "the review log shows who opened it and why").toContainText(/Opened/);
    await expect(main(admin).locator("tr", { hasText: subject }).filter({ hasText: "Copy for the file of the concern" }).first(), "the PDF copy is logged with its reason").toContainText(/Exported/);
    // The screens say "both sides were told". If they say so, the family must really have been told.
    if (/both sides (were|are) told/i.test(reviewText)) {
      await via(fam2, /^Messages/);
      await openThread(fam2, subject);
      await expect.soft(fam2.getByText(/The school reviewed this conversation/), "the review screen says both sides were told: the family must see it").toBeVisible(LIVE);
    }

    // ---- the lead limits the teacher: she is told and can still answer, but cannot start new ones ----
    await admin.getByRole("link", { name: "Limits" }).click();
    await admin.getByPlaceholder(/Name of the staff member/).fill("Meera");
    await admin.getByRole("button", { name: /Meera Iyer\s*Teacher/ }).click();
    await expect(admin.getByLabel("Can reply, cannot start new conversations")).toBeChecked();
    await admin.getByLabel("Until (last day)").fill(tomorrow());
    await admin.getByLabel(/^Reason \(they are told/).fill(`Please keep messages to school matters ${STAMP}.`);
    await admin.getByRole("button", { name: "Set the limit" }).click();
    await says(admin, /Limit set\. They were told\./);
    await expect(main(admin).getByText(new RegExp(`Please keep messages to school matters ${STAMP}`))).toBeVisible();
    await noRefusal(admin, "set a limit");

    await via(teacher, /^Messages/);
    await expect(main(teacher).getByRole("link", { name: new RegExp(subject) }).first()).toBeVisible();
    // A button must not lead to a refusal: with "cannot start", "New message" and "Message families" are either gone or say why before the click.
    const newBtn = main(teacher).getByRole("link", { name: "New message" });
    if (await newBtn.count()) {
      await newBtn.first().click();
      expect.soft(await screen(teacher), "the New message button led to a refusal page: hide it or say why on the Messages screen").not.toMatch(/cannot start a message|can't start a message/i);
      await teacher.goBack();
    }
    // She can still answer in a conversation she is already in.
    await openThread(teacher, subject);
    await typeAndSend(teacher, `I will keep to school matters ${STAMP}.`);
    await expect(teacher.getByText(`I will keep to school matters ${STAMP}.`, { exact: true })).toBeVisible();
    await noRefusal(teacher, "limited teacher answers in an existing conversation");
    const limitNote = sql(`select count(*) from notifications where user_id = '${teacherId}' and title ilike '%limit%' or (user_id = '${teacherId}' and body ilike '%school matters ${STAMP}%')`);
    expect(Number(limitNote), "the teacher was told of the limit with its reason").toBeGreaterThan(0);

    // ---- the lead closes the concern: Action taken, a private note; the reporter is told the state only ----
    await via(admin, /^Safeguarding/);
    await main(admin).locator("tr", { hasText: subject }).first().getByRole("link", { name: "Pressure, threat or money" }).click();
    await main(admin).getByLabel("Action taken").check();
    await main(admin).getByLabel(/What was decided/).fill(`Spoke to the teacher, private lessons stopped ${STAMP}`);
    await main(admin).getByRole("button", { name: "Save", exact: true }).click();
    await says(admin, /Saved\. The reporter was told\./);
    // Lift the limit again as a person would, then check it ends.
    await admin.getByRole("link", { name: "All concerns" }).click();
    await admin.getByRole("link", { name: "Limits" }).click();
    await main(admin).locator("li", { hasText: "Meera Iyer" }).first().getByRole("button", { name: "Lift now" }).click();
    await says(admin, /Limit lifted/);

    // The family reads only the state, never what was decided about the person.
    await via(fam2, /^Messages/);
    await fam2.getByRole("button", { name: /^Notifications/ }).click();
    await fam2.getByRole("link", { name: "See all" }).click();
    await main(fam2).getByRole("link", { name: /^Everything/ }).click();
    await main(fam2).getByRole("link", { name: /Update on your concern/ }).first().click();
    await expect(main(fam2).getByRole("heading", { name: "My concerns" })).toBeVisible();
    await expect(main(fam2).getByText(subject).first()).toBeVisible();
    await expect(main(fam2).getByText(/Action taken/).first()).toBeVisible();
    expect(await screen(fam2), "the family must not read what was decided").not.toContain("private lessons stopped");
    await fits(fam2, "my concerns on a phone");
    // After it is closed, the teacher is still told nothing about the concern.
    expect(sql(`select count(*) from notifications where user_id = '${teacherId}' and (title || ' ' || coalesce(body, '')) ilike '%concern%'`)).toBe("0");
  } finally { lift(); }
});

// =====================================================================================================================
// J7  Certificate request: claimed, asked, answered, resolved, not solved, reopened, closed. And one that goes late and escalates.
// =====================================================================================================================
const REQ_NO = /REQ\/\d{4}-\d{2}\/\d{4}/;
/** The family's "Ask the school" form: category first, then the rest. Returns the number of the new request. */
async function ask(page: Page, category: string, subject: string, details: string, extra?: (p: Page) => Promise<void>) {
  await via(page, /^Requests/);
  await expect(main(page).getByRole("heading", { name: "Ask the school" })).toBeVisible();
  await main(page).getByRole("link", { name: "Ask the school" }).first().click();
  await expect(main(page).getByText("Choose a category above to continue.")).toBeVisible();
  await fits(page, `ask the school, nothing chosen (${category})`);
  await main(page).getByRole("radio", { name: category, exact: true }).click();
  await expect(main(page).getByLabel("Short title")).toBeVisible();
  await main(page).getByLabel("Short title").fill(subject);
  await main(page).getByLabel("Tell us what you need").fill(details);
  if (extra) await extra(page);
  await fits(page, `ask the school, ${category} form`);
  return async () => {
    await main(page).getByRole("button", { name: "Send to the school" }).click();
    await expect(main(page).getByRole("heading", { name: subject })).toBeVisible({ timeout: 30_000 });
    return (await main(page).getByText(REQ_NO).first().innerText()).match(REQ_NO)![0];
  };
}
/** Staff: open the Requests queue in a view and click the row. */
async function openRequest(page: Page, view: string, subject: string) {
  await via(page, /^Requests/);
  await main(page).getByRole("link", { name: new RegExp(`^${view}`) }).click();
  await main(page).getByText(subject).first().click();
  await expect(main(page).getByRole("heading", { name: subject })).toBeVisible();
}

test("J7 certificate request: claim, ask, answer, resolve, not solved, reopen, close; late request escalates", async () => {
  const subject = `Bonafide certificate ${STAMP}`, details = `A bonafide certificate for a bank form ${STAMP}.`;
  const school = SCHOOL_ID();
  const fam = watch(await people.as("family"), "family"), admin = await people.as("admin");

  // ---- family: Requests, Ask the school, an empty send says what is missing, then a real one ----
  const send = await ask(fam, "Certificate", subject, details, async (p) => {
    await p.getByRole("button", { name: "Send to the school" }).click();
    await expect.soft(main(p).locator('[role="alert"]').first(), "sending the form without 'Which certificate' says what is missing").toBeVisible();
    await main(p).getByLabel("Which certificate").selectOption("Bonafide");
  });
  const no = await send();
  await noRefusal(fam, "family sends the request");
  await expect(main(fam).getByText(/Received/).first()).toBeVisible();
  await expect(main(fam).getByText(/The school aims to answer by/)).toBeVisible();
  await expect(main(fam).getByText(details, { exact: true })).toBeVisible();
  await fits(fam, "family request just sent");

  // ---- the office: Requests, Mine (the one admin owns Certificate requests, so it lands there), the row ----
  await openRequest(admin, "Mine", subject);
  await expect(main(admin).getByText(no).first()).toBeVisible();
  await expect(main(admin).getByText("Which certificate").first()).toBeVisible();
  await expect(main(admin).getByText("Anita Rao").first(), "the office sees who owns it").toBeVisible();
  // Staff are told what to do next: one primary button, and no "Claim" that would end in a refusal for something already owned.
  await expect(main(admin).getByRole("button", { name: /Start work|Resolve/ }).first()).toBeVisible();
  if (await main(admin).getByRole("button", { name: "Claim", exact: true }).count()) { await main(admin).getByRole("button", { name: "Claim", exact: true }).click(); await noRefusal(admin, "claim"); }
  await main(admin).getByRole("button", { name: "Start work" }).click().catch(() => {});

  // ---- the office asks the family a question: the Ask tab says who sees it and that the clock waits ----
  await admin.getByRole("tab", { name: "Ask" }).click();
  await expect(admin.getByText(/The family sees this\. The school's clock waits for their reply/)).toBeVisible();
  const question = `Which name should the certificate carry? ${STAMP}`;
  await typeAndSend(admin, question);
  await expect(admin.getByText(question, { exact: true })).toBeVisible();
  await expect(main(admin).getByText(/Waiting for the family/).first()).toBeVisible();
  await noRefusal(admin, "ask the family");

  // ---- the family sees it waiting for them: in the list and in the request; both say the same ----
  await via(fam, /^Requests/);
  const card = main(fam).locator("li", { hasText: subject });
  await expect(card).toContainText("Waiting for you");
  await expect(card).toContainText("The school is waiting for your answer. Open it to reply.");
  await fits(fam, "family request list, waiting for you");
  await card.getByRole("link").first().click();
  await expect(main(fam).getByText("The school is waiting for your answer. Reply below.")).toBeVisible();
  await expect(main(fam).getByText(question, { exact: true })).toBeVisible();
  await expect(main(fam).getByText(/Waiting for you/).first()).toBeVisible();
  const answer = `The name on the school record, Aarav Sharma ${STAMP}`;
  await typeAndSend(fam, answer);
  await expect(fam.getByText(answer, { exact: true })).toBeVisible();
  await noRefusal(fam, "family answers the question");
  await expect(main(fam).getByText("The school is waiting for your answer. Reply below.")).toHaveCount(0);
  await fits(fam, "family request after answering");

  // ---- the office resolves: Resolve says what happens next ----
  await admin.getByRole("button", { name: "Resolve", exact: true }).first().click();
  await expect(dialog(admin).getByText(/The family is told and asked if it is solved\. It closes by itself after 7 days\./)).toBeVisible();
  await dialog(admin).getByLabel(/Closing message to the family/).fill(`The certificate is ready, please collect it ${STAMP}.`);
  await dialog(admin).getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(main(admin).getByText(/Resolved/).first()).toBeVisible();
  await noRefusal(admin, "resolve");

  // ---- the family: told it is answered, and "Is it solved?" is the one thing to do; they say no ----
  await via(fam, /^Requests/);
  await expect(main(fam).locator("li", { hasText: subject })).toContainText("The school answered. Open it and tell us if it is solved.");
  await main(fam).locator("li", { hasText: subject }).getByRole("link").first().click();
  await expect(main(fam).getByText(/The school has answered\. Is it solved\?/)).toBeVisible();
  await expect(main(fam).getByText(`The certificate is ready, please collect it ${STAMP}.`)).toBeVisible();
  await fits(fam, "family request answered");
  await main(fam).getByRole("button", { name: "Is it solved?" }).click();
  await fits(fam, "is it solved dialog");
  await dialog(fam).getByLabel("Is it solved?").selectOption({ label: "No, it is not solved" });
  await dialog(fam).getByLabel("Anything to add").fill(`The surname is spelled wrong ${STAMP}`);
  await dialog(fam).getByRole("button", { name: "Send", exact: true }).click();
  await noRefusal(fam, "family says not solved");
  await expect(main(fam).getByText(/Being looked at/).first(), "not solved opens it again and the family sees it being looked at").toBeVisible();
  await expect(main(fam).getByText(/Is it solved\?/)).toHaveCount(0);

  // ---- the office sees it reopened, with the reason, and the family said not solved ----
  await via(admin, /^Requests/);
  await main(admin).getByRole("link", { name: /^Mine/ }).click();
  await main(admin).getByText(subject).first().click();
  await expect(main(admin).getByText(`The surname is spelled wrong ${STAMP}`).first()).toBeVisible();
  await expect(main(admin).getByText(/Opened again/).first()).toBeVisible();
  await expect(main(admin).getByText(/Not solved/).first()).toBeVisible();
  await noRefusal(admin, "open the reopened request");
  await typeAndSend(admin, `Fixed the spelling ${STAMP}.`);
  await admin.getByRole("button", { name: "Resolve", exact: true }).first().click();
  await dialog(admin).getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(main(admin).getByText(/Resolved/).first()).toBeVisible();

  // ---- family says solved: it is closed, on both screens ----
  await via(fam, /^Requests/);
  await main(fam).locator("li", { hasText: subject }).getByRole("link").first().click();
  await main(fam).getByRole("button", { name: "Is it solved?" }).click();
  await dialog(fam).getByLabel("Is it solved?").selectOption({ label: "Yes, it is solved" });
  await dialog(fam).getByRole("button", { name: "Send", exact: true }).click();
  await expect(main(fam).getByText(/Closed/).first()).toBeVisible();
  await expect(main(fam).getByText(/This request is closed\. Open it again, or ask a new question\./)).toBeVisible();
  await fits(fam, "family request closed");
  await via(admin, /^Requests/);
  await main(admin).getByRole("link", { name: /^All/ }).click();
  await expect(main(admin).locator("tr", { hasText: subject }).first(), "the office queue says Closed too").toContainText("Closed");
  await via(fam, /^Requests/);
  await expect(main(fam).locator("li", { hasText: subject }), "the family list says Closed too").toContainText("Closed");

  // ---- the second request goes late: Academics belongs to the class teacher; after the target it climbs to the office ----
  const fam2 = watch(await people.as("family2"), "family2"), teacher = await people.as("teacher");
  const lateSubject = `Test marks look wrong ${STAMP}`;
  const send2 = await ask(fam2, "Academics", lateSubject, `The maths marks do not match the paper ${STAMP}.`);
  const no2 = await send2();
  await expect(main(fam2).getByText(/The school aims to answer by/)).toBeVisible();
  // Time passes: five days without an answer.
  sql(`update requests set created_at = now() - interval '5 days', due_at = now() - interval '2 days' where school_id = '${school}' and number = '${no2}'`);
  await openRequest(teacher, "Mine", lateSubject);
  await expect(main(teacher).getByText(/days? late\. It goes to Office if nobody answers\./)).toBeVisible();
  await expect(main(teacher).getByText(/Owner/).first()).toBeVisible();
  await fits(teacher, "teacher late request");
  job("requests.clock");
  // The family hears that someone senior has it.
  await via(fam2, /^Requests/);
  await fam2.getByRole("button", { name: /^Notifications/ }).click();
  await fam2.getByRole("link", { name: "See all" }).click();
  await main(fam2).getByRole("link", { name: /^Everything/ }).click();
  await expect(main(fam2).getByText(new RegExp(`Request ${no2.replace(/\//g, "\\/")} was sent to Office`))).toBeVisible();
  await main(fam2).getByText(new RegExp(`Request ${no2.replace(/\//g, "\\/")} was sent to Office`)).first().click();
  await expect(main(fam2).getByRole("heading", { name: lateSubject })).toBeVisible();
  await fits(fam2, "family request after it was escalated");
  // The office has it, says it reached the Office level, and is told in the bell list.
  await openRequest(admin, "Mine", lateSubject).catch(async () => { await main(admin).getByRole("link", { name: /^Unassigned|^All/ }).first().click(); await main(admin).getByText(lateSubject).first().click(); });
  await expect.soft(main(admin).getByText(/Office \(escalated\)/), "Details > Level names the level it reached (Office), not a number").toBeVisible();
  await expect(main(admin).getByText(/Sent to Office/).first(), "the history says it was sent to the Office").toBeVisible();
  // The teacher who was late no longer has it in her queue: it moved up, and the screen says so rather than leaving a ghost.
  await via(teacher, /^Requests/);
  await main(teacher).getByRole("link", { name: /^All/ }).click();
  await expect.soft(main(teacher).getByText(lateSubject), "after it moved up the teacher's queue no longer lists it").toHaveCount(0);
});

// =====================================================================================================================
// J8  Complaint about a teacher: invisible to that teacher everywhere, the principal handles it
// =====================================================================================================================
test("J8 complaint about a teacher: the teacher sees nothing, the principal handles it", async () => {
  const subject = `Complaint about extra fees ${STAMP}`, details = `The teacher keeps asking for money for extra classes ${STAMP}.`;
  const school = SCHOOL_ID(), teacherId = userId("teacher");
  const fam = watch(await people.as("family"), "family"), teacher = watch(await people.as("teacher"), "teacher"), admin = await people.as("admin");
  const sidebarCount = async (p: Page, name: string) => Number((await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${name}`) }).innerText()).match(/\d+/)?.[0] ?? 0);
  const requestsBefore = await sidebarCount(teacher, "Requests"), messagesBefore = await sidebarCount(teacher, "Messages");
  const noticesFor = () => sql(`select count(*) from notifications where user_id = '${teacherId}' and (title || ' ' || coalesce(body, '') || ' ' || coalesce(subject_id, '')) ilike '%${STAMP}%'`);

  // ---- the family: Ask the school, Complaint, picks the person it is about ----
  const send = await ask(fam, "Complaint", subject, details, async (p) => {
    await expect(main(p).getByText("Is it about a person? (optional)")).toBeVisible();
    await expect(main(p).getByText(/The person you choose will not see this request, and is not told about it\./)).toBeVisible();
    await main(p).getByRole("checkbox", { name: "Meera Iyer" }).check();
  });
  const no = await send();
  const requestId = fam.url().split("/").pop()!;
  await noRefusal(fam, "family sends the complaint");
  await fits(fam, "family complaint sent");

  // ---- the teacher sees nothing: Requests (every view), counts, search, Messages, bell, notifications, mail, the address itself ----
  await via(teacher, /^Requests/);
  for (const view of ["Mine", "Unassigned", "Team", "Overdue", "All"]) {
    await main(teacher).getByRole("link", { name: new RegExp(`^${view}`) }).click();
    await expect(main(teacher).getByRole("link", { name: new RegExp(`^${view}`) })).toHaveAttribute("aria-current", /.+/);
    await expect(main(teacher).getByText(subject), `the named teacher must not see the complaint in ${view}`).toHaveCount(0);
  }
  const viewCounts = await main(teacher).getByRole("link", { name: /^(Mine|Unassigned|Team|Overdue|All)/ }).allInnerTexts();
  expect(await sidebarCount(teacher, "Requests"), "the teacher's Requests count in the side bar did not grow").toBeLessThanOrEqual(requestsBefore);
  await main(teacher).getByPlaceholder("Search number, title or child").fill(STAMP);
  await main(teacher).getByPlaceholder("Search number, title or child").press("Enter");
  await teacher.waitForTimeout(1500);
  await expect(main(teacher).getByText(subject), "searching the complaint's words finds nothing for the named teacher").toHaveCount(0);
  await main(teacher).getByPlaceholder("Search number, title or child").fill(no);
  await main(teacher).getByPlaceholder("Search number, title or child").press("Enter");
  await teacher.waitForTimeout(1500);
  await expect(main(teacher).locator("a[href*='/app/requests/']").filter({ hasText: no }), "searching by the request number finds nothing for the named teacher").toHaveCount(0);
  await via(teacher, /^Messages/);
  await main(teacher).getByLabel("Search your messages").fill(STAMP);
  await main(teacher).getByLabel("Search your messages").press("Enter");
  await teacher.waitForTimeout(1500);
  await expect(main(teacher).getByText(subject), "the complaint is not in the teacher's messages").toHaveCount(0);
  expect(await sidebarCount(teacher, "Messages"), "the teacher's Messages count did not grow").toBeLessThanOrEqual(messagesBefore);
  await teacher.getByRole("button", { name: /^Notifications/ }).click();
  await teacher.getByRole("link", { name: "See all" }).click();
  await teacher.getByRole("link", { name: /^Everything/ }).click();
  await expect(main(teacher).getByText(new RegExp(`${STAMP}|${no.replace(/\//g, "\\/")}|complaint`, "i")), "no notification about the complaint for the named teacher").toHaveCount(0);
  expect(noticesFor(), "no notification row at all for the named teacher").toBe("0");
  expect(sql(`select count(*) from comm_deliveries d join notifications n on n.id = d.notification_id where d.user_id = '${teacherId}' and n.subject_id = '${requestId}'`), "no email or push waiting for the named teacher").toBe("0");
  // The teacher opens the address from an old link: a plain sentence, not a crash and not a hint.
  await teacher.goto(at(`requests/${requestId}`));
  await expect(main(teacher).getByText("This request does not exist, or you cannot see it.")).toBeVisible();
  await expect(main(teacher).getByText(subject)).toHaveCount(0);

  // ---- the principal handles it: Requests, Unassigned, Claim, sees who it is about, answers, resolves ----
  await openRequest(admin, "Unassigned", subject);
  await expect(main(admin).getByText(details, { exact: true })).toBeVisible();
  await expect.soft(main(admin).getByText(/Meera Iyer/).first(), "the principal sees which teacher the complaint is about").toBeVisible();
  await main(admin).getByRole("button", { name: "Claim" }).click();
  await expect(main(admin).getByText(/Anita Rao/).first()).toBeVisible();
  const reply = `Thank you for telling us. I am looking into it myself ${STAMP}.`;
  await typeAndSend(admin, reply);
  await expect(admin.getByText(reply, { exact: true })).toBeVisible();
  await noRefusal(admin, "principal answers the complaint");
  await expect(main(admin).getByText(/Nobody at the school can take this complaint/)).toHaveCount(0);
  // The family reads the answer and does not read the name of a person being handled or any staff note.
  await via(fam, /^Requests/);
  await main(fam).locator("li", { hasText: subject }).getByRole("link").first().click();
  await expect(main(fam).getByText(reply, { exact: true })).toBeVisible();
  await fits(fam, "family complaint answered");
  await admin.getByRole("tab", { name: "Note" }).click();
  await expect(admin.getByText("Only staff see this")).toBeVisible();
  await typeAndSend(admin, `Private note: meeting the teacher on Friday ${STAMP}`);
  await expect(admin.getByText(`Private note: meeting the teacher on Friday ${STAMP}`, { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Resolve", exact: true }).first().click();
  await dialog(admin).getByLabel(/Closing message to the family/).fill(`We have spoken to everyone concerned ${STAMP}.`);
  await dialog(admin).getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(main(admin).getByText(/Resolved/).first()).toBeVisible();
  await via(fam, /^Requests/);
  await main(fam).locator("li", { hasText: subject }).getByRole("link").first().click();
  await expect(main(fam).getByText(`We have spoken to everyone concerned ${STAMP}.`)).toBeVisible();
  expect(await screen(fam), "the family never sees a staff note").not.toContain("Private note");

  // ---- after all of that the teacher still sees nothing: lists, counts, bell, mail ----
  await via(teacher, /^Requests/);
  await main(teacher).getByRole("link", { name: /^All/ }).click();
  await expect(main(teacher).getByText(subject)).toHaveCount(0);
  expect(noticesFor(), "still no notification row for the named teacher after it was handled").toBe("0");
  expect((await mails("teacher@greenvalley.test")).filter((m) => m.Subject.includes(STAMP) || m.Subject.includes(no)), "no email to the named teacher").toHaveLength(0);
  job("comms.deliver", { schoolId: school });
  expect((await mails("teacher@greenvalley.test")).filter((m) => m.Subject.includes(STAMP) || m.Subject.includes(no)), "no email to the named teacher after delivery ran").toHaveLength(0);
  void viewCounts;
});

// =====================================================================================================================
// J15  Support session: every private screen refuses with a plain sentence
// =====================================================================================================================
test("J15 support session: messages, requests, safeguarding, responses, notifications, export all refuse plainly", async ({ browser }) => {
  const school = SCHOOL_ID();
  // Real private words from this database: whatever a person typed in a conversation, a request or a report. None may reach the screen.
  const secrets = sql(`select left(body, 28) from (select body from messages where school_id = '${school}' and kind = 'text' and length(body) > 25 order by created_at desc limit 60) m
    union select left(note, 28) from message_reports where school_id = '${school}' and length(note) > 25`).split("\n").filter(Boolean);
  expect(secrets.length, "there is private text in the database to look for").toBeGreaterThan(5);
  const threadId = sql(`select id from message_threads where school_id = '${school}' and kind = 'student' order by last_message_at desc limit 1`);
  const noticeId = sql(`select id from announcements where school_id = '${school}' and title like 'School closed tomorrow%' order by created_at desc limit 1`);
  const requestId = sql(`select id from requests where school_id = '${school}' order by created_at desc limit 1`);

  // ---- the console owner makes a support login for Green Valley ----
  const cctx = await browser.newContext(), cpage = await cctx.newPage();
  await consoleLogin(cpage);
  await cpage.goto(`${CONSOLE}/schools`);
  await cpage.getByRole("link", { name: /green valley/i }).first().click();
  await cpage.waitForURL(/\/schools\/[0-9a-f-]+/);
  await cpage.getByRole("button", { name: /support login/i }).click();
  await cpage.getByLabel(/why are you logging in/i).fill(`Checking that private talk stays private ${STAMP}`);
  await cpage.getByRole("button", { name: /create link/i }).click();
  const link = cpage.locator("p.select-all");
  await expect(link).toBeVisible({ timeout: 60_000 });
  const url = (await link.textContent())!.trim();
  await cctx.close();

  // ---- the support person opens the panel: one click, then a banner says what this is ----
  const sctx = await browser.newContext(), sup = await sctx.newPage();
  watch(sup, "support");
  await sup.goto(url);
  await sup.getByRole("button", { name: /open the panel/i }).click();
  await sup.waitForURL(/\/app/);
  await expect(sup.getByText(/support (session|login|mode)/i).first()).toBeVisible();

  const quiet = async (where: string) => {
    await sup.waitForLoadState("domcontentloaded");
    await sup.waitForTimeout(800);
    await expect(sup.locator("[data-nextjs-dialog]")).toHaveCount(0);
    const text = await screen(sup);
    expect(text, `${where}: an error page or a stack trace is on screen`).not.toMatch(/application error|unhandled runtime error|something went wrong|internal server error|\bat \w+ \(|TypeError|ForbiddenError|digest/i);
    for (const s of secrets) expect(text, `${where}: private text on a support screen: "${s}"`).not.toContain(s);
    return text;
  };
  /** A refusal a person can read: it says what, why, and gives a way on. */
  const refused = async (where: string) => {
    const text = await quiet(where);
    const area = (await main(sup).innerText()).trim();
    expect.soft(area, `${where}: says in plain words that this is not available in a support session`).toMatch(/not available in a support session|support session/i);
    expect.soft(area.length, `${where}: a short plain sentence, not a wall of text`).toBeLessThan(600);
    expect.soft(await main(sup).getByRole("link").count() + await main(sup).getByRole("button").count(), `${where}: a way on (a link or button), not a dead end`).toBeGreaterThan(0);
    return text;
  };

  // Messages
  await via(sup, /^Messages/);
  await refused("support: Messages");
  // The conversation by its address, as a bookmark or a shared link would open it.
  await sup.goto(at(`messages?thread=${threadId}`));
  await refused("support: one conversation");
  await sup.goto(at("messages/families"));
  await refused("support: Message families");
  // Requests
  await via(sup, /^Requests/);
  await refused("support: Requests");
  await sup.goto(at(`requests/${requestId}`));
  await refused("support: one request");
  // Safeguarding
  await via(sup, /^Safeguarding/);
  await refused("support: Safeguarding");
  await sup.goto(at("safeguarding/log"));
  await refused("support: review log");
  // A notice's responses
  await via(sup, /^Notices/);
  await quiet("support: Notices list");
  await main(sup).getByText(/School closed tomorrow/).first().click();
  await expect(main(sup).getByRole("heading", { name: /School closed tomorrow/ })).toBeVisible();
  await main(sup).getByRole("link", { name: /^Who has answered|^Responses/ }).first().click();
  await refused("support: a notice's responses");
  // Notifications: rows are "Private", with no names, numbers or words
  await sup.getByRole("button", { name: /^Notifications/ }).click();
  await sup.getByRole("link", { name: "See all" }).click();
  await sup.getByRole("link", { name: /^Everything/ }).click();
  const notes = await quiet("support: Notifications");
  expect.soft(notes, "support: notification rows give no names or request numbers of private talk").not.toMatch(/New message from|Update on your concern|REQ\/\d{4}/);
  // Export: the files behind those screens refuse too, in a sentence, with nothing inside.
  for (const [what, path] of [
    ["the requests CSV", "/api/requests/csv?view=all"],
    ["the notice responses CSV", `/api/notices/${noticeId}/report.csv`],
    ["a conversation PDF", `/api/messages/export/${threadId}`],
    ["a message file", "/api/messages/files/00000000-0000-0000-0000-000000000000"],
  ] as const) {
    const r = await sup.request.get(`${SCHOOL(SLUG)}${path}`);
    const body = await r.text();
    expect.soft([401, 403, 404], `${what} must be refused in a support session (got ${r.status()})`).toContain(r.status());
    expect.soft(body.length, `${what} refusal is a short sentence`).toBeLessThan(400);
    for (const s of secrets) expect(body, `${what} leaked private text`).not.toContain(s);
    expect.soft(body, `${what}: no stack trace`).not.toMatch(/\bat \w+ \(|TypeError|Error:/);
  }
  await sctx.close();
});
