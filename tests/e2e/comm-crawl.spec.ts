import { expect, test } from "@playwright/test";
import { crawl } from "./crawl-lib";
import { login, loginStudent } from "./helpers";

const SLUG = "greenvalley";
const SECTIONS = /^\/app\/(announcements|circulars|messages|safeguarding|requests|events|meetings|notifications|attendance\/holidays|settings\/communication)|^\/app$/;
const ALL = ["/app", "/app/announcements", "/app/circulars", "/app/messages", "/app/safeguarding", "/app/requests", "/app/events", "/app/meetings", "/app/notifications", "/app/notifications/preferences", "/app/notifications/delivery", "/app/attendance/holidays", "/app/settings/communication"];
const EVERYONE = ["/app", "/app/announcements", "/app/messages", "/app/requests", "/app/events", "/app/notifications", "/app/notifications/preferences"];

for (const [role, id, starts] of [
  ["admin", "admin", ALL],
  ["accountant", "accounts", EVERYONE],
  ["teacher", "teacher", [...EVERYONE, "/app/meetings"]],
  ["cashier", "cashier", EVERYONE],
  ["auditor", "auditor", EVERYONE],
] as const) {
  test(`${role}: every communication link works`, async ({ page }) => {
    test.setTimeout(1_200_000);
    await login(page, SLUG, id);
    expect((await crawl(page, { slug: SLUG, sections: SECTIONS, starts: [...starts], role })).join("\n")).toBe("");
  });
}

test("family: every communication link works", async ({ page }) => {
  test.setTimeout(1_200_000);
  await loginStudent(page, SLUG, "GR0001", "01012023");
  expect((await crawl(page, { slug: SLUG, sections: SECTIONS, starts: [...EVERYONE, "/app/meetings"], role: "family" })).join("\n")).toBe("");
});
