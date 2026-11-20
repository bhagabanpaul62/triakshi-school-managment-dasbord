import { expect, test, type Page } from "@playwright/test";
import { SCHOOL, expectHealthy, login, loginStudent } from "./helpers";

const SHOTS = "test-results/ux-fees";
const SLUG = "greenvalley";
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

test.setTimeout(400_000);

async function shot(page: Page, name: string) {
  for (const [k, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${k}.png`, fullPage: true });
  }
  await page.setViewportSize(SIZES.desktop);
}

async function noHorizontalScroll(page: Page) {
  await page.setViewportSize(SIZES.phone);
  await page.waitForTimeout(300); // let charts and tables re-measure at the new width
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = over > 1 ? await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !e.closest(".overflow-x-auto")).slice(0, 6).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)} "${(e.textContent ?? "").slice(0, 40)}" ${Math.round(e.getBoundingClientRect().right)}`)) : [];
  expect(over, `page is ${over}px too wide: ${wide.join(" | ")}`).toBeLessThanOrEqual(1);
  await page.setViewportSize(SIZES.desktop);
}

// Under a loaded dev server the login redirect can still be in flight; retry a navigation it aborts.
async function open(page: Page, path: string) {
  await page.waitForLoadState("load").catch(() => {});
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(`${SCHOOL(SLUG)}${path}`, { timeout: 240_000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.waitForTimeout(2_000); }
  }
}
const MONEY = /₹\d{1,3}(,\d{2})*(,\d{3})?(\.\d{2})?|₹\d+(\.\d)?(K|L|Cr)/;

test.describe("fees journeys", () => {
  test("accountant: find, see dues, record a payment, print the receipt, see the day's collection", async ({ page, context }) => {
    await login(page, SLUG, "accounts");
    await open(page, "/app/fees");
    await expect(page.getByRole("heading", { name: "Fees", exact: true })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole("heading", { name: "Today's collection" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dues by class" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who to chase" })).toBeVisible();
    await expect(page.getByText(MONEY).first()).toBeVisible();
    await expectHealthy(page);
    await shot(page, "dashboard");
    await noHorizontalScroll(page);

    // One box: name or admission number, Enter opens the ledger with the payment form ready.
    const finder = page.getByRole("combobox", { name: /find a student/i });
    await finder.fill("Aarav");
    await expect(page.getByRole("listbox", { name: /matching students/i }).getByRole("option").first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "finder");
    await finder.press("Enter");
    await expect(page).toHaveURL(/\/app\/fees\/students\/.+/, { timeout: 200_000 });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Record payment")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByLabel(/amount/i)).not.toHaveValue("");
    await shot(page, "record-open");

    // Method switch asks for a reference; the footer says where the money goes.
    await dialog.getByRole("radio", { name: "UPI" }).click();
    await expect(dialog.getByLabel(/upi reference/i)).toBeVisible();
    await expect(dialog.getByText(/allocates/i).last()).toBeVisible();
    await dialog.getByLabel(/upi reference/i).fill(`UPI${Date.now()}`);
    await dialog.getByRole("button", { name: /save and number receipt/i }).click();
    await expect(dialog.getByText(/RCPT\//).first()).toBeVisible({ timeout: 60_000 });
    await shot(page, "recorded");
    const popup = context.waitForEvent("page");
    await dialog.getByRole("button", { name: /print receipt/i }).click();
    const receipt = await popup;
    await receipt.close().catch(() => {});
    await dialog.getByRole("button", { name: "Done" }).click();

    // The ledger tells the next step and has a receipt link per payment.
    await expect(page.getByText(/What to pay next|All paid/)).toBeVisible();
    const link = page.getByRole("link", { name: /open receipt/i }).first();
    await expect(link).toBeVisible();
    const pdf = await context.request.get(`${SCHOOL(SLUG)}${await link.getAttribute("href")}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    await shot(page, "ledger");
    await noHorizontalScroll(page);

    // The day's collection shows it.
    await open(page, "/app/fees");
    await expect(page.getByText(/RCPT\//).first()).toBeVisible({ timeout: 60_000 });

    // Dues by class links into a filtered report; overdue KPI too.
    await open(page, "/app/fees?overdue=1");
    await expect(page.getByRole("heading", { name: "Dues by student" })).toBeVisible({ timeout: 60_000 });
    await shot(page, "overdue");
  });

  test("accountant: set up a structure with clear validation", async ({ page }) => {
    await login(page, SLUG, "accounts");
    await open(page, "/app/fees/setup");
    await expect(page.getByRole("heading", { name: "Fee setup" })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByText("Classes billed")).toBeVisible();
    await shot(page, "setup");
    await noHorizontalScroll(page);

    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Installments", { exact: true })).toBeVisible();
    await shot(page, "editor");
    // Break the sum: the footer says by how much and Save is blocked.
    await dialog.getByLabel("Installment 1 amount in rupees").fill("1");
    await expect(dialog.getByText(/short|extra/).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: /save fees/i })).toBeDisabled();
    await shot(page, "editor-mismatch");
    await dialog.getByRole("button", { name: /split the fees equally/i }).click();
    await expect(dialog.getByText("Matches")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /save fees/i })).toBeEnabled();
  });

  // No parent logins: the student login is the family login, and one child goes straight to their fees page.
  test("student: what is due, by when, receipts", async ({ page }) => {
    await loginStudent(page, SLUG, "GR0001", "01012023");
    await expect(page).toHaveURL(/\/app/);
    await open(page, "/app/fees");
    await expect(page).toHaveURL(/\/app\/fees\/students\//, { timeout: 240_000 });
    await expect(page.getByText(/What to pay next|All paid/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Pay at the school fee counter|Every installment is paid/)).toBeVisible();
    await expect(page.getByRole("button", { name: /record payment/i })).toHaveCount(0);
    await expectHealthy(page);
    await shot(page, "student");
    await noHorizontalScroll(page);
  });
});
