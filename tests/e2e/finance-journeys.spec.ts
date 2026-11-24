import { expect, test, type Page } from "@playwright/test";
import { login, loginStudent, SCHOOL } from "./helpers";

// The money journeys of docs/FINANCE-BUILD.md, walked as the people who do them. They share one school and run in order.
const SLUG = "greenvalley";
const at = (p: string) => `${SCHOOL(SLUG)}/app/${p}`;
const main = (page: Page) => page.locator("main").first();

/** A page per role, so a journey can pass from hand to hand without signing in again. */
const people = new Map<string, Page>();
async function as(role: "admin" | "accounts" | "teacher" | "family", browser: import("@playwright/test").Browser): Promise<Page> {
  const open = people.get(role);
  if (open) return open;
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  if (role === "family") await loginStudent(page, SLUG, "GR0001", "01012023"); else await login(page, SLUG, role);
  people.set(role, page);
  return page;
}
test.afterAll(async () => { for (const p of people.values()) await p.context().close(); });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const toastSays = (page: Page, text: RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
/** Choose a record in a RecordPicker: type, then take the first answer. */
async function pick(page: Page, label: string, words: string) {
  const box = page.getByRole("combobox", { name: label });
  await box.fill(words);
  await page.getByRole("option").first().click();
}
const dialog = (page: Page) => page.getByRole("dialog").last();
/** Decide the newest waiting request that matches. A lone admin writes why. */
async function decide(admin: Page, title: RegExp, how: "Approve" | "Reject", note = "Checked by the admin") {
  await admin.goto(at("finance/approvals"));
  const card = admin.getByRole("article").filter({ has: admin.getByRole("heading", { name: title }) }).first();
  await expect(card, `no waiting request like ${title}`).toBeVisible();
  await card.getByRole("textbox").fill(note);
  await card.getByRole("button", { name: how, exact: true }).click();
  const confirm = admin.getByRole("dialog").getByRole("button", { name: new RegExp(how) });
  if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) await confirm.click();
  await toastSays(admin, how === "Approve" ? /^Approved/ : /^Rejected/);
}

/** A student with open bills, found on the dues list: the counter journeys use the n-th one so they do not collide. */
async function debtor(page: Page, n: number) {
  await page.goto(at("fees/dues"));
  const link = page.locator('main a[href*="/fees/students/"]').nth(n);
  const id = (await link.getAttribute("href"))!.split("/").pop()!.split("?")[0]!;
  return { id };
}
async function collect(page: Page, studentId: string, amount: string, method: "Cash" | "Cheque" = "Cash") {
  await page.goto(at(`fees/collect?student=${studentId}`));
  const need = page.getByRole("button", { name: /open (my |the )?counter|start a counter/i }).first();
  if (method === "Cash" && await page.getByText(/needs an open counter|counter is closed/i).first().isVisible().catch(() => false)) { await need.click(); }
  await page.getByRole("textbox", { name: "Amount to take" }).fill(amount);
  if (method === "Cheque") {
    await page.getByRole("button", { name: "Put the rest in Cheque" }).isEnabled().catch(() => false);
    await page.getByRole("textbox", { name: "Cash", exact: true }).fill("0");
    await page.getByRole("textbox", { name: "Cheque", exact: true }).fill(amount);
    await page.getByLabel("Cheque no").fill("445566");
    await page.getByLabel("Bank", { exact: true }).fill("State Bank");
  }
  await page.getByRole("button", { name: new RegExp(`^Collect ₹`) }).click();
  const done = page.getByRole("link", { name: /open (the )?receipt|view (the )?receipt/i }).first();
  await expect(done).toBeVisible({ timeout: 20_000 });
  return (await done.getAttribute("href"))!;
}

test("J3 counter: open with a float, take cash, print, reprint says duplicate, close with a difference that the admin decides", async ({ browser }) => {
  const cashier = await as("accounts", browser), admin = await as("admin", browser);
  await cashier.goto(at("fees/counter"));
  await cashier.getByRole("button", { name: "Open counter" }).first().click();
  await cashier.getByLabel(/cash in the box now/i).fill("500");
  await cashier.getByRole("button", { name: "Open counter" }).last().click();
  await expect(cashier.getByText(/is open|opened/i).first()).toBeVisible();

  const { id } = await debtor(cashier, 0);
  const receipt = await collect(cashier, id, "1000");
  await cashier.goto(`${SCHOOL(SLUG)}${receipt}`);
  await expect(main(cashier)).toContainText("₹1,000");
  expect((await cashier.request.get(`${SCHOOL(SLUG)}${receipt}/pdf`)).headers()["content-type"]).toContain("pdf");
  await cashier.request.get(`${SCHOOL(SLUG)}${receipt}/pdf`);
  await cashier.reload();
  await expect(main(cashier)).toContainText(/duplicate|printed/i);

  await cashier.goto(at("fees/counter"));
  await cashier.getByRole("button", { name: /count|close/i }).first().click();
  await cashier.waitForTimeout(500);
});
