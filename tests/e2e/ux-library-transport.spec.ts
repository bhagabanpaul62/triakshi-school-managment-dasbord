import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { SCHOOL, expectHealthy, login, loginStudent } from "./helpers";

const SLUG = "greenvalley";
const SHOTS = "test-results/ux-library-transport";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ navigationTimeout: 120_000, actionTimeout: 60_000 });

async function shoot(page: Page, name: string) {
  for (const [label, size] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${label}.png`, fullPage: true });
    if (label === "phone") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name}: no horizontal page scroll on a phone`).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize(DESKTOP);
}

const go = async (page: Page, path: string) => { await page.goto(`${SCHOOL(SLUG)}${path}`, { waitUntil: "domcontentloaded" }); await expectHealthy(page); };

test("librarian issues a book from one desk, then takes it back", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await login(page, SLUG, "teacher");
  await go(page, "/app/library");
  const desk = page.locator("section,div").filter({ has: page.getByText("Issue a book", { exact: true }) }).last();
  await expect(page.getByText("Issue a book", { exact: true })).toBeVisible({ timeout: 90_000 });
  await shoot(page, "library-home");

  // Book: results list fills in on its own; pick the first one.
  const bookBtn = page.getByRole("list", { name: "Book results" }).getByRole("button").first();
  await expect(bookBtn).toBeVisible({ timeout: 60_000 });
  const bookTitle = (await bookBtn.locator("span span").first().innerText()).trim();
  await bookBtn.click();
  await expect(page.getByRole("button", { name: /change book/i })).toBeVisible();

  // Student: search by admission prefix, take the first student who is under the limit.
  // Green Valley admission numbers are GR0001...; search inside the borrower picker only.
  await page.getByPlaceholder(/name or admission number/i).fill("GR");
  const free = page.getByRole("list", { name: "Student or staff results" }).locator("button:not([disabled])").first();
  await expect(free).toBeVisible({ timeout: 60_000 });
  const who = (await free.locator("span span").first().innerText()).trim();
  await free.click();
  await expect(page.getByRole("button", { name: /^change student or staff/i })).toBeVisible();
  await shoot(page, "library-desk-ready");
  void desk;

  const issue = page.getByRole("button", { name: /^issue to /i });
  await expect(issue).toBeEnabled();
  await issue.click();
  await expect(page.getByText(new RegExp(`issued to ${who.split(" ")[0]}`, "i")).first()).toBeVisible({ timeout: 60_000 });

  // Return it from Loans: find it, take it back.
  await go(page, `/app/library/loans?status=open&q=${encodeURIComponent(bookTitle)}`);
  const row = page.getByRole("row").filter({ hasText: who }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await shoot(page, "library-loans");
  await row.getByRole("button", { name: /^return$/i }).click();
  await expect(page.getByText(/book returned/i).first()).toBeVisible({ timeout: 60_000 });
});

test("overdue list says who to chase, and a fine is explained before the return", async ({ page }) => {
  await login(page, SLUG, "teacher");
  await go(page, "/app/library");
  await expect(page.getByText("Overdue books")).toBeVisible({ timeout: 90_000 });
  const overdue = page.locator("li").filter({ hasText: /\d+ days? late/ });
  if (await overdue.count()) {
    await expect(overdue.first().getByText(/due \d{1,2} [A-Z][a-z]{2}/)).toBeVisible();
    await overdue.first().getByRole("button", { name: /^return$/i }).click();
    if (await page.getByText(/is \d+ days? late\. .* owes a fine of/i).count()) await expect(page.getByRole("button", { name: /^return, fine/i })).toBeVisible();
    await shoot(page, "library-overdue-confirm");
    await page.keyboard.press("Escape");
  }
  await shoot(page, "library-overdue");
});

test("admin adds a book with copies and sees real counts", async ({ page }) => {
  await login(page, SLUG, "admin");
  await go(page, "/app/library");
  await expect(page.getByText("Issued now")).toBeVisible({ timeout: 90_000 });
  await go(page, "/app/library/books");
  await page.getByRole("button", { name: /add book/i }).click();
  const title = `UX test book ${Date.now() % 100000}`;
  const add = page.getByRole("dialog"); // the list behind it has its own Category filter
  await add.getByLabel(/^title/i).fill(title);
  await add.getByLabel(/^author/i).fill("Test Author");
  await add.getByLabel(/^category/i).selectOption("Fiction");
  await add.getByLabel(/copies to add/i).fill("3");
  await shoot(page, "library-add-book");
  await page.getByRole("button", { name: /^add book$/i }).last().click();
  await expect(page.getByText("Book added")).toBeVisible({ timeout: 60_000 });
  await go(page, `/app/library/books?q=${encodeURIComponent(title)}`);
  await expect(page.getByText("3 of 3 in")).toBeVisible({ timeout: 60_000 });
  await page.getByText(title).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
  await shoot(page, "library-book");
  // clean up the test book
  await page.getByRole("button", { name: /delete book/i }).click();
  await page.getByRole("button", { name: /^delete$/i }).last().click();
  await page.waitForURL(/library\/books$/, { timeout: 60_000 });
});

test("admin sees transport occupancy, route page and the route PDF", async ({ page }) => {
  await login(page, SLUG, "admin");
  await go(page, "/app/transport");
  await expect(page.getByText("Students riding")).toBeVisible({ timeout: 90_000 });
  await shoot(page, "transport-home");
  const open = page.getByRole("link", { name: /^open /i }).first();
  await expect(open).toBeVisible();
  const href = await open.getAttribute("href");
  await go(page, href!);
  await expect(page.getByText(/^Students \(\d+\)/)).toBeVisible({ timeout: 90_000 });
  await shoot(page, "transport-route");

  const pdf = await page.request.get(`${SCHOOL(SLUG)}${href}/roster`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // The assign form shows what the choice means: seats left and the stop's times and fee.
  const add = page.getByRole("button", { name: /add student/i });
  if (await add.count()) {
    await add.click();
    await expect(page.getByText(/seats free on|not limited/i)).toBeVisible();
    await shoot(page, "transport-assign");
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByText(/Full: \d+ of \d+ seats|Every student has a seat/)).toBeVisible();
  }
});

// No parent logins: the student's own login shows their bus, stop and times.
test("student sees their bus, stop and times on a phone", async ({ page }) => {
  const psql = (q: string) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d smw -tAc "${q}"`, { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
  const row = psql("select s.admission_no || '|' || to_char(s.dob,'DDMMYYYY') from student_transport t join students s on s.id=t.student_id join schools sc on sc.id=s.school_id where sc.slug='greenvalley' and s.dob is not null order by s.admission_no limit 1");
  test.skip(!row, "no student on a seeded route");
  const [no, dob] = row.split("|");
  await page.setViewportSize(PHONE);
  await loginStudent(page, SLUG, no!, dob!);
  await go(page, "/app/transport");
  await expect(page.getByText("Morning pickup").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Evening drop").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /call driver/i }).first()).toBeVisible();
  await shoot(page, "transport-student");
});
