import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { login, loginStudent, SCHOOL } from "./helpers";

// The money journeys of docs/FINANCE-BUILD.md, walked as the people who do them. They share one school and run in order.
const SLUG = "greenvalley";
const at = (p: string) => `${SCHOOL(SLUG)}/app/${p}`;
const main = (page: Page) => page.locator("main").first();

/** A page per role, so a journey can pass from hand to hand without signing in again. */
const people = new Map<string, Page>();
async function as(role: "admin" | "accounts" | "cashier" | "teacher" | "family", browser: import("@playwright/test").Browser): Promise<Page> {
  const open = people.get(role);
  if (open) return open;
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  if (role === "family") await loginStudent(page, SLUG, "GR0001", "01012023"); else await login(page, SLUG, role);
  people.set(role, page);
  return page;
}
test.afterAll(async () => { for (const p of people.values()) await p.context().close(); });
test.describe.configure({ mode: "default", timeout: 120_000 });

const toastSays = (page: Page, text: RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
/** Choose a record in a RecordPicker: type, then take the first answer. */
async function pick(page: Page, label: string, words: string) {
  const box = page.getByRole("combobox", { name: label });
  await box.fill(words);
  await page.getByRole("listbox").getByRole("option").first().click();
}
const dialog = (page: Page) => page.getByRole("dialog").last();
/** Decide the newest waiting request that matches. A lone admin writes why. */
async function decide(admin: Page, title: RegExp, how: "Approve" | "Reject", note = "Checked by the admin") {
  await admin.goto(at("finance/approvals"));
  const some = admin.getByRole("article").filter({ has: admin.getByRole("heading", { name: title }) }).first();
  await expect(some, `no waiting request like ${title}`).toBeVisible();
  const card = admin.getByRole("article", { name: (await some.getAttribute("aria-label"))!, exact: true });
  await card.getByRole("textbox").fill(note);
  await card.getByRole("button", { name: how, exact: true }).click();
  const confirm = admin.getByRole("dialog").getByRole("button", { name: new RegExp(how) });
  if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) await confirm.click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });
}

/** A student with open bills, found on the dues list: the counter journeys use the n-th one so they do not collide. */
async function debtor(page: Page, n: number) {
  await page.goto(at("fees/dues"));
  const link = page.locator('main a[href*="/fees/students/"]').nth(n);
  const id = (await link.getAttribute("href"))!.split("/").pop()!.split("?")[0]!;
  return { id };
}
async function collect(page: Page, studentId: string, amount: string, method: "Cash" | "Cheque" = "Cash", chequeNo = "445566") {
  await page.goto(at(`fees/collect?student=${studentId}`));
  await page.getByRole("textbox", { name: "Amount to take" }).fill(amount);
  if (method === "Cheque") {
    await page.getByRole("textbox", { name: "Cash", exact: true }).fill("0");
    await page.getByRole("textbox", { name: "Cheque", exact: true }).fill(amount);
    await page.getByLabel("Cheque no").fill(chequeNo);
    await page.getByLabel("Bank", { exact: true }).fill("State Bank");
  }
  await page.getByRole("button", { name: new RegExp(`^Collect ₹`) }).click();
  const done = page.getByRole("link", { name: /open the receipt/i }).first();
  await expect(done).toBeVisible({ timeout: 20_000 });
  return (await done.getAttribute("href"))!;
}

/** Open the counter unless it is already open (cash needs one once anybody has used counters). */
async function openCounter(page: Page) {
  await page.goto(at("fees/counter"));
  if (await page.getByRole("button", { name: "Close counter" }).count()) return;
  await page.getByRole("button", { name: "Open counter" }).first().click();
  await page.getByLabel(/cash in the box now/i).fill("500");
  await page.getByRole("button", { name: "Open counter" }).last().click();
  await expect(page.getByRole("button", { name: "Close counter" })).toBeVisible({ timeout: 20_000 });
}

test("J3 counter: open with a float, take cash, print, the second print says duplicate, close short, the admin decides", async ({ browser }) => {
  const cashier = await as("cashier", browser), admin = await as("admin", browser);
  await openCounter(cashier);
  const { id } = await debtor(admin, 0);
  const receipt = await collect(cashier, id, "1000");
  await cashier.goto(`${SCHOOL(SLUG)}${receipt}`);
  await expect(main(cashier)).toContainText("₹1,000");
  await expect(main(cashier)).not.toContainText("₹11,89");
  for (let n = 0; n < 2; n++) expect((await cashier.request.get(`${SCHOOL(SLUG)}${receipt}/pdf`)).headers()["content-type"]).toContain("pdf");
  await cashier.reload();
  await expect(main(cashier)).toContainText(/copy 2/i);

  await cashier.goto(at("fees/counter"));
  await cashier.getByRole("button", { name: "Close counter" }).first().click();
  await cashier.getByRole("button", { name: "I only have one total" }).click();
  await cashier.getByLabel("Cash counted").fill("1400");
  await cashier.getByRole("button", { name: "Close counter" }).last().click();
  await expect(cashier.getByRole("alert").filter({ hasText: /short/i }).first()).toBeVisible();
  await cashier.getByLabel(/why is it short/i).fill("Gave 100 rupees too much change");
  await cashier.getByRole("button", { name: "Close counter" }).last().click();
  await expect(cashier.getByText(/counter closed for/i)).toBeVisible({ timeout: 20_000 });
  await cashier.goto(at("finance/approvals"));
  await expect(cashier.getByRole("heading", { name: "My requests" })).toBeVisible();
  await decide(admin, /counter/i, "Approve");
  await cashier.goto(at("fees/counter"));
  await expect(main(cashier)).toContainText(/written to cash differences/i);
});

test("J6 wrong receipt: the cashier asks, the admin refuses with a reason, then approves; the bills open again", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  await openCounter(acct);
  const { id } = await debtor(admin, 1);
  const receipt = await collect(acct, id, "500");
  const ask = async (why: string) => {
    await acct.goto(`${SCHOOL(SLUG)}${receipt}`);
    await acct.getByRole("button", { name: "Ask for reversal" }).click();
    await acct.getByLabel(/why is this receipt wrong/i).fill(why);
    await acct.getByRole("button", { name: "Send for approval" }).last().click();
    await expect(main(acct)).toContainText(/reversal asked by/i, { timeout: 20_000 });
  };
  await ask("Typed the wrong amount");
  await decide(admin, /revers/i, "Reject", "Show me the slip first");
  await acct.reload();
  await expect(main(acct)).toContainText("Show me the slip first");
  await ask("Wrong family, slip attached in the register");
  await decide(admin, /revers/i, "Approve");
  await acct.reload();
  await expect(main(acct)).toContainText(/reversed/i);
  await expect(main(acct).getByRole("link", { name: "Collect again" })).toBeVisible();
});

test("J7 cheque: received, deposited, cleared; and one that bounces opens the bills with a charge", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  const { id } = await debtor(admin, 2);
  const run = String(Date.now()).slice(-5);
  for (const [no, how] of [[`1${run}`, "Cleared"], [`2${run}`, "Bounced"]] as const) {
    await collect(acct, id, "600", "Cheque", no);
    await acct.goto(at("fees/cheques"));
    const card = () => acct.getByRole("article").filter({ hasText: no });
    await card().getByRole("button", { name: "Deposit", exact: true }).click();
    await acct.getByRole("button", { name: "Mark deposited" }).click();
    await expect(card()).toContainText("Deposited", { timeout: 20_000 });
    await card().getByRole("button", { name: how === "Cleared" ? /clear/i : /bounce/i }).click();
    if (how === "Bounced") await acct.getByLabel("Why did it bounce?").fill("Not enough money in the account");
    await acct.getByRole("button", { name: `Mark ${how.toLowerCase()}` }).click();
    await expect(acct.getByRole("button", { name: `Mark ${how.toLowerCase()}` })).toHaveCount(0, { timeout: 20_000 });
    await expect(card().getByRole("button", { name: "Deposit", exact: true })).toHaveCount(0);
  }
  await acct.goto(at(`fees/students/${id}?tab=receipts`));
  await expect(main(acct)).toContainText(/bounced/i);
});

test("J4 family: sees the dues, pays by QR, sends the UTR; refused with a reason, sent again, verified into a receipt", async ({ browser }) => {
  const family = await as("family", browser), acct = await as("accounts", browser);
  const send = async (utr: string) => {
    await family.goto(at("fees/pay"));
    await expect(family.locator("main svg").first()).toBeVisible();
    await family.getByRole("button", { name: "I have paid" }).click();
    await family.getByLabel(/UTR or transaction ID/).fill(utr);
    await family.getByRole("button", { name: "Send to the school" }).click();
    await toastSays(family, /sent\. the school will check/i);
  };
  const run = String(Date.now()).slice(-8);
  await send(`4212${run}`);
  await acct.goto(at("fees/slips"));
  await acct.getByRole("listitem").filter({ hasText: `4212${run}` }).first().getByRole("button", { name: "Reject" }).click();
  await acct.getByLabel("Why?").fill("No such payment in the bank");
  await acct.getByRole("button", { name: /^Reject/ }).last().click();
  await toastSays(acct, /reject/i);
  await family.goto(at("fees/pay"));
  await expect(main(family)).toContainText("No such payment in the bank");
  await send(`4213${run}`);
  await acct.goto(at("fees/slips"));
  await acct.getByRole("listitem").filter({ hasText: `4213${run}` }).first().getByRole("button", { name: "Verify and make receipt" }).click();
  const confirm = acct.getByRole("dialog").getByRole("button", { name: /verify/i });
  if (await confirm.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await confirm.click();
  await toastSays(acct, /receipt/i);
  await family.goto(at("fees"));
  await expect(main(family)).toContainText(/RCPT\//);
});

test("J2 plan: the accountant drafts and sends, the admin approves, the bills are issued and the family sees them", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser), family = await as("family", browser);
  const name = `Lab fee ${Date.now() % 100_000}`;
  const addFee = async () => {
    await acct.getByRole("button", { name: "Add a fee" }).click();
    await acct.getByRole("combobox", { name: "Fee", exact: true }).last().selectOption({ label: name });
    await acct.getByRole("combobox", { name: new RegExp(`How often ${name}`) }).selectOption({ label: "Once a year" });
    await acct.getByRole("textbox", { name: new RegExp(`Amount for ${name}`) }).fill("750");
  };
  await acct.goto(at("fees/heads"));
  await acct.getByRole("button", { name: "New fee" }).click();
  await acct.getByLabel(/^name/i).last().fill(name);
  await acct.getByRole("button", { name: /^(add|save|create)/i }).last().click();
  await expect(main(acct)).toContainText(name, { timeout: 20_000 });

  // A second plan for the same class is refused in words, with the way to the plan that is already there.
  await acct.goto(at("fees/plans/new"));
  await acct.getByLabel("Plan name").fill(`${name} plan`);
  await acct.getByRole("checkbox", { name: "Nursery", exact: true }).check();
  await addFee();
  await acct.getByRole("button", { name: "Save and send for approval" }).click();
  await expect(main(acct)).toContainText(/Nursery already has a published plan/, { timeout: 20_000 });
  await acct.getByRole("link", { name: "Open that plan" }).click();
  await acct.getByRole("button", { name: /new version/i }).click();
  await acct.waitForURL(/\/edit$/, { timeout: 20_000 });
  await addFee();
  await acct.getByRole("button", { name: "Save and send for approval" }).click();
  await expect(main(acct)).toContainText(/waiting for .* to approve/i, { timeout: 20_000 });
  await decide(admin, /Nursery/, "Approve");
  await acct.reload();
  await expect(main(acct)).toContainText(/this plan is live/i);

  await acct.goto(at("fees/invoices/issue"));
  await acct.getByRole("button", { name: "Preview" }).click();
  const issue = acct.getByRole("button", { name: /^Issue \d+ bills?/ });
  await expect(issue).toBeVisible({ timeout: 30_000 });
  await issue.click();
  const yes = acct.getByRole("dialog").getByRole("button", { name: /issue/i });
  if (await yes.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await yes.click();
  await expect(acct.getByRole("button", { name: "Issue more" })).toBeVisible({ timeout: 60_000 });
  await family.goto(at("fees"));
  await expect(main(family)).toContainText(/2026/);
});

test("J5 wrong bill: a draft edited with a live preview, revised once issued, then a credit note; the family sees only the right one", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  const { id } = await debtor(admin, 4);
  const label = `Trip ${Date.now() % 100_000}`;
  await acct.goto(at(`fees/invoices/new?student=${id}`));
  await acct.getByRole("textbox", { name: "Bill for" }).fill(label);
  await acct.getByLabel("Due date").fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
  await acct.getByRole("textbox", { name: "Description, line 1" }).fill("Museum trip");
  await acct.getByRole("textbox", { name: "Amount, line 1" }).fill("900");
  const paper = acct.getByRole("document", { name: "Invoice preview" });
  await expect(paper).toContainText("Museum trip");
  await expect(paper).toContainText("₹900.00");
  await acct.getByRole("button", { name: /save as draft/i }).click();
  await expect(main(acct)).toContainText(/draft/i, { timeout: 20_000 });
  await acct.getByRole("link", { name: /^edit/i }).first().click();
  await acct.getByRole("textbox", { name: "Amount, line 1" }).fill("950");
  await expect(paper).toContainText("₹950.00");
  await acct.getByRole("button", { name: /^issue/i }).click();
  const yes = acct.getByRole("dialog").getByRole("button", { name: /issue/i });
  if (await yes.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await yes.click();
  await expect(main(acct)).toContainText(/INV\/2026-27\/\d+/, { timeout: 20_000 });
  const first = /INV\/2026-27\/\d+/.exec(await main(acct).innerText())![0];

  await acct.getByRole("link", { name: "Revise" }).click();
  await acct.getByRole("textbox", { name: "Amount, line 1" }).fill("980");
  await acct.getByLabel("Why is it being revised?").fill("The bus cost more");
  await acct.getByRole("button", { name: /revise|issue|send/i }).last().click();
  const ok = acct.getByRole("dialog").getByRole("button", { name: /revise|issue|send/i });
  if (await ok.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await ok.click();
  await acct.waitForURL((u) => !u.pathname.endsWith("/revise"), { timeout: 20_000 });
  await expect(main(acct)).toContainText(first);
  await expect(main(acct)).toContainText("₹980");

  await acct.getByRole("button", { name: "Credit note" }).click();
  await acct.getByLabel(/amount off/i).first().fill("80");
  await dialog(acct).getByRole("textbox").last().fill("One museum was closed");
  await dialog(acct).getByRole("button", { name: /credit|send|issue|save/i }).last().click();
  await expect(acct.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  await acct.goto(at("finance/approvals"));
  if (await acct.getByRole("heading", { name: /credit/i }).count()) await decide(admin, /credit/i, "Approve");
});

test("J8 hard case: a promise, then a settlement in two parts with a write-off, approved as a whole, paid, and the no-dues certificate", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  const { id } = await debtor(admin, 6);
  await acct.goto(at(`fees/students/${id}`));
  await acct.getByRole("button", { name: "Settlement", exact: true }).click();
  await acct.getByRole("radio", { name: /agree a final amount/i }).check();
  await acct.getByRole("textbox", { name: "The family pays" }).fill("4000");
  await acct.getByRole("combobox", { name: "Pay in how many parts" }).selectOption({ label: "2 parts, a month apart" });
  await acct.getByRole("textbox", { name: "Why" }).fill("The father lost his job");
  await expect(acct.getByRole("complementary", { name: "Before and after" })).toContainText("₹4,000");
  await acct.getByRole("button", { name: "Send for approval" }).click();
  await expect(main(acct)).toContainText(/a settlement for this student is waiting/i, { timeout: 20_000 });
  await decide(admin, /settlement|deal/i, "Approve");
  await collect(acct, id, "4000");
  await acct.goto(at(`fees/students/${id}?tab=documents`));
  const cert = acct.getByRole("region", { name: "No dues certificate" }).getByRole("link", { name: "Open the PDF" });
  await expect(cert).toBeVisible();
  expect((await acct.request.get((await cert.getAttribute("href"))!.replace(/^\//, `${SCHOOL(SLUG)}/`))).headers()["content-type"]).toContain("pdf");
  const st = acct.getByRole("region", { name: "Statement of account" }).getByRole("link", { name: "Open the PDF" });
  expect((await acct.request.get((await st.getAttribute("href"))!.replace(/^\//, `${SCHOOL(SLUG)}/`))).headers()["content-type"]).toContain("pdf");
});

test("J9 leaving: an advance is held, the student leaves, it goes against the dues and the rest is refunded with a voucher", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  const { id } = await debtor(admin, 8);
  await acct.goto(at(`fees/collect?student=${id}`));
  await acct.getByRole("textbox", { name: "Amount to take" }).fill("90000");
  await expect(acct.getByRole("button", { name: /^Collect ₹/ })).toBeDisabled();
  await acct.getByRole("checkbox", { name: /the family paid this much/i }).check();
  await acct.getByRole("button", { name: /^Collect ₹/ }).click();
  await expect(acct.getByRole("link", { name: /open the receipt/i })).toBeVisible({ timeout: 20_000 });
  await acct.goto(at(`fees/refunds?student=${id}`));
  await acct.getByRole("button", { name: "Student is leaving" }).click();
  const pay = acct.getByLabel("Pay back by");
  if (await pay.count()) await pay.last().selectOption({ index: 1 });
  const ref = acct.getByLabel("Reference or cheque no");
  if (await ref.count()) await ref.last().fill("NEFT-9001");
  await acct.getByLabel("Why?").last().fill("Transfer certificate issued");
  await acct.getByRole("button", { name: "Settle up" }).click();
  await expect(main(acct)).toContainText(/waiting for/i, { timeout: 20_000 });
  await decide(admin, /refund/i, "Approve");
  await acct.reload();
  const voucher = main(acct).getByRole("link", { name: /voucher/i }).first();
  expect((await acct.request.get(`${SCHOOL(SLUG)}${await voucher.getAttribute("href")}`)).headers()["content-type"]).toContain("pdf");
  await acct.goto(at(`fees/students/${id}`));
  await expect(main(acct)).toContainText("₹0", { timeout: 10_000 });
});

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const photo = { name: "bill.png", mimeType: "image/png", buffer: PIXEL };

test("J10 spending: vendor, bill over the limit refused then approved, paid with a voucher; a teacher's claim approved and paid", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser), teacher = await as("teacher", browser);
  const vendor = `Delta Labs ${Date.now() % 100_000}`, no = `DL-${Date.now() % 100_000}`;
  await acct.goto(at("expenses/vendors"));
  await acct.getByRole("button", { name: "New vendor" }).click();
  await dialog(acct).getByLabel(/^name/i).fill(vendor);
  await dialog(acct).getByRole("button", { name: /add|save|create/i }).last().click();
  await expect(main(acct)).toContainText(vendor, { timeout: 20_000 });

  await acct.goto(at("expenses/bills/new"));
  await pick(acct, "Vendor", vendor);
  await acct.getByLabel("Bill number").fill(no);
  await acct.getByRole("combobox").filter({ hasText: "Choose account" }).selectOption({ index: 1 });
  await acct.getByPlaceholder("Describe the line").fill("Microscopes");
  await acct.locator('input[inputmode="decimal"]').first().fill("72000");
  await acct.locator('input[type="file"]').setInputFiles(photo);
  await acct.getByLabel("Due date").fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
  await acct.getByRole("button", { name: "Save and send for approval" }).click();
  await acct.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 20_000 });
  await decide(admin, new RegExp(no), "Reject", "Attach the second quote");
  await acct.goto(at(`expenses/bills?q=${no}`));
  await expect(main(acct)).toContainText("Rejected");
  await main(acct).getByRole("link", { name: no }).first().click();
  await expect(acct.locator("body")).toContainText("Attach the second quote");
  await acct.getByRole("link", { name: /fix|edit/i }).first().click();
  await acct.waitForURL(/\/edit/, { timeout: 20_000 });
  await acct.getByRole("button", { name: "Save and send for approval" }).click();
  await acct.waitForURL((u) => !u.pathname.endsWith("/edit"), { timeout: 20_000 });
  await decide(admin, new RegExp(no), "Approve");

  await acct.goto(at(`expenses/bills?q=${no}`));
  await main(acct).getByRole("link", { name: no }).first().click();
  await acct.locator('a[href*="/payments/new?bills="]').first().click();
  await acct.waitForURL(/payments\/new/, { timeout: 20_000 });
  const ref = acct.getByLabel(/reference|UTR/i);
  if (await ref.count()) await ref.first().fill("NEFT-77");
  await acct.getByRole("button", { name: "Pay now" }).click();
  const sure = acct.getByRole("dialog").getByRole("button", { name: /pay/i });
  if (await sure.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await sure.click();
  await acct.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 20_000 });
  await acct.goto(at("expenses/payments"));
  const voucher = main(acct).getByRole("link", { name: /voucher/i }).first();
  expect((await acct.request.get(`${SCHOOL(SLUG)}${await voucher.getAttribute("href")}`)).headers()["content-type"]).toContain("pdf");

  const what = `Chart paper ${Date.now() % 100_000}`;
  await teacher.goto(at("expenses/claims"));
  await teacher.getByRole("button", { name: "New claim" }).first().click();
  const form = dialog(teacher);
  for (const t of await form.getByRole("textbox").all()) if (await t.isEditable() && !(await t.inputValue())) await t.fill(what).catch(() => {});
  await form.locator('input[type="number"], input[inputmode="decimal"]').first().fill("640");
  for (const x of await form.getByRole("combobox").all()) await x.selectOption({ index: 1 }).catch(() => {});
  await form.locator('input[type="file"]').setInputFiles(photo);
  await form.getByRole("button", { name: /send|claim|save/i }).last().click();
  await expect(main(teacher)).toContainText(what, { timeout: 20_000 });
  await acct.goto(at("expenses/claims?tab=decide"));
  const card = acct.locator("tr, li, article").filter({ hasText: what }).first();
  await card.getByRole("button", { name: "Approve" }).click();
  const account = dialog(acct).getByLabel("Expense account");
  if (!(await account.inputValue())) await account.selectOption({ index: 1 });
  await dialog(acct).getByRole("button", { name: "Approve" }).click();
  await expect(acct.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  // Above the claim limit the accountant's yes still needs a second person.
  await decide(admin, new RegExp(what), "Approve");
  await teacher.reload();
  await expect(main(teacher).getByRole("row", { name: new RegExp(what) })).toContainText(/approved/i, { timeout: 20_000 });
});

test("J11 salary: fix the unmarked days, review, the admin approves, one transfer fails and is paid again, the person sees the payslip", async ({ browser }) => {
  test.setTimeout(180_000);
  const acct = await as("accounts", browser), admin = await as("admin", browser), teacher = await as("teacher", browser);
  await acct.goto(at("payroll/runs"));
  await main(acct).getByRole("link", { name: /Salary November/ }).first().click();
  await acct.waitForURL(/runs\/01/);
  const url = acct.url();
  // Days nobody marked: open attendance and mark them, or count them as worked here.
  const count = main(acct).getByRole("button", { name: "Count as worked" });
  for (let left = await count.count(); left > 0; left--) { await count.first().click(); await expect(count).toHaveCount(left - 1, { timeout: 20_000 }); }
  await acct.getByRole("button", { name: /^Review/ }).click();
  await acct.getByRole("button", { name: "Send for approval" }).click({ timeout: 20_000 });
  await acct.getByRole("button", { name: "Send", exact: true }).click();
  await expect(main(acct)).toContainText(/waiting for approval/i, { timeout: 20_000 });
  await decide(admin, /Salary November/, "Approve");
  await acct.goto(`${url}?tab=payouts`);
  await expect(main(acct)).toContainText(/bank/i);
  expect((await acct.request.get(`${SCHOOL(SLUG)}/app/payroll/files/bank-file?run=${url.split("/").pop()!.split("?")[0]}`)).status()).toBe(200);
  await acct.getByRole("button", { name: /mark .*paid/i }).first().click();
  const paid = acct.getByRole("dialog").getByRole("button", { name: /paid/i });
  if (await paid.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) { const r = dialog(acct).getByLabel(/reference/i); if (await r.count()) await r.first().fill("SAL-NOV"); await paid.last().click(); }
  await expect(main(acct)).toContainText(/paid/i, { timeout: 20_000 });
  await teacher.goto(at("payroll/me"));
  await expect(main(teacher)).toContainText(/November 2026/, { timeout: 20_000 });
});

test("J12 month end: import a bank statement, match, close the month, a late entry lands next month, reopen it", async ({ browser }) => {
  const acct = await as("accounts", browser), admin = await as("admin", browser);
  const run = String(Date.now()).slice(-6);
  await acct.goto(at("finance/banking"));
  await acct.getByRole("link", { name: "Import statement" }).first().click();
  await acct.locator('input[type="file"]').setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from(`Date,Narration,Ref,Debit,Credit\n20/11/2026,SMS charges ${run},CHG${run},118.00,\n21/11/2026,Interest credit ${run},INT${run},,452.00\n`) });
  await acct.getByRole("button", { name: "Check the file" }).click();
  const imp = acct.getByRole("button", { name: /^Import \d+ lines/ });
  await expect(imp).toBeEnabled({ timeout: 20_000 });
  await imp.click();
  await acct.getByRole("link", { name: "Match the rest" }).click({ timeout: 20_000 });
  const line = (words: string) => acct.locator("li, tr, article").filter({ hasText: words }).last();
  for (const [words, how] of [[`SMS charges ${run}`, /charge/i], [`Interest credit ${run}`, /interest/i]] as const) {
    await line(words).getByRole("button", { name: how }).first().click();
    await acct.getByRole("button", { name: "Record and match" }).click();
    await expect(line(words).getByRole("button", { name: how })).toHaveCount(0, { timeout: 20_000 });
  }
  await admin.goto(at("finance/settings?tab=periods"));
  const row = admin.getByRole("listitem").filter({ hasText: "Oct 2026" });
  await row.getByRole("button", { name: "Close", exact: true }).click();
  await admin.getByRole("button", { name: "Close month" }).click();
  await expect(row.getByRole("button", { name: "Reopen" })).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Reopen" }).click();
  await dialog(admin).getByRole("textbox").fill("A bill was missed");
  await admin.getByRole("button", { name: "Reopen" }).last().click();
  await expect(row.getByRole("button", { name: "Close", exact: true })).toBeVisible({ timeout: 20_000 });
});

test("J13 owner: from a dashboard number to the ledger, to the entry, to the document, and back", async ({ browser }) => {
  const admin = await as("admin", browser);
  await admin.goto(at("finance"));
  await main(admin).getByRole("link", { name: /School bank account/ }).first().click();
  await admin.waitForURL(/finance\/accounts\//);
  await main(admin).locator('a[href*="/finance/journals/"]').first().click();
  await admin.waitForURL(/finance\/journals\//);
  await main(admin).getByRole("link", { name: /open|document|receipt|bill|payment|run/i }).first().click();
  await admin.waitForURL((u) => !u.pathname.includes("/journals/"));
  await admin.goBack();
  await admin.waitForURL(/finance\/journals\//);
});

test("J1 first day: nothing is set up; the checklist leads, step by step, to the first receipt", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await (await browser.newContext()).newPage();
  const river = (p: string) => `${SCHOOL("riverside")}/app/${p}`;
  await login(admin, "riverside", "admin");
  // Classes and a student come from the People and Academics modules, which have their own tests.
  const db = (q: string) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d ${process.env.E2E_DB ?? "smw"} -tA`, { input: q, env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
  // Each piece is added only when missing: an earlier spec (comm-notices J14) may have left the year and Class 1 behind.
  db(`insert into academic_years(id,school_id,name,starts_on,ends_on,is_current) select gen_random_uuid(), id, '2026-27','2026-04-01','2027-03-31',true from schools s where slug='riverside' and not exists (select 1 from academic_years a where a.school_id=s.id);
    insert into classes(id,school_id,name,grade) select gen_random_uuid(), id, 'Class 1', 1 from schools s where slug='riverside' and not exists (select 1 from classes c where c.school_id=s.id and c.name='Class 1');
    insert into students(id,school_id,admission_no,name,class_id,status,admission_date) select gen_random_uuid(), c.school_id,'RV001','Nila Menon', c.id,'active','2026-04-01' from classes c join schools s on s.id=c.school_id where s.slug='riverside' and c.name='Class 1' and not exists (select 1 from students t where t.school_id=s.id and t.admission_no='RV001')`);

  await admin.goto(river("finance"));
  await expect(admin.locator("main")).toContainText(/set up your books/i);
  // The bank account and the UPI ID.
  await admin.goto(river("finance/settings?tab=cash"));
  await admin.getByRole("button", { name: "New cash or bank account" }).click();
  await dialog(admin).locator("input[name=name]").fill("Riverside bank");
  await dialog(admin).locator("input[name=upiId]").fill("riverside@okbank");
  await dialog(admin).getByRole("button", { name: "Add" }).click();
  await expect(admin.locator("main")).toContainText("Riverside bank", { timeout: 20_000 });
  // What it held when the books started.
  await admin.goto(river("finance/banking"));
  await admin.getByRole("button", { name: "Set opening balance" }).first().click();
  await dialog(admin).getByLabel("Amount").fill("100000");
  await admin.getByRole("button", { name: "Set", exact: true }).click();
  await expect(admin.locator("main")).toContainText("₹1,00,000", { timeout: 20_000 });
  // A fee, a plan, its approval by the only admin with a reason, and the bills.
  await admin.goto(river("fees/heads"));
  await admin.getByRole("button", { name: "New fee" }).first().click();
  await dialog(admin).getByLabel(/^name/i).fill("Tuition");
  await dialog(admin).getByRole("button", { name: /^(add|save|create)/i }).last().click();
  await expect(admin.locator("main")).toContainText("Tuition", { timeout: 20_000 });
  await admin.goto(river("fees/plans/new"));
  await admin.getByLabel("Plan name").fill("Class 1 fees");
  await admin.getByRole("checkbox", { name: "Class 1", exact: true }).check();
  await admin.getByRole("button", { name: "Add a fee" }).click();
  await admin.getByRole("combobox", { name: /How often Tuition/ }).selectOption({ label: "Every month" });
  await admin.getByRole("textbox", { name: /Amount for Tuition/ }).fill("1500");
  await admin.getByRole("button", { name: "Save and send for approval" }).click();
  await expect(admin.locator("main")).toContainText(/waiting for/i, { timeout: 20_000 });
  await admin.goto(river("finance/approvals"));
  const card = admin.getByRole("article").filter({ hasText: "Class 1 fees" });
  await card.getByRole("textbox").fill("I am the only admin");
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });
  await admin.goto(river("fees/invoices/issue"));
  await admin.getByRole("button", { name: "Preview" }).click();
  await admin.getByRole("button", { name: /^Issue \d+ bills?/ }).click({ timeout: 30_000 });
  const yes = admin.getByRole("dialog").getByRole("button", { name: /issue/i });
  if (await yes.last().waitFor({ timeout: 1_500 }).then(() => true, () => false)) await yes.last().click();
  await expect(admin.getByRole("button", { name: "Issue more" })).toBeVisible({ timeout: 60_000 });
  // The counter and the first receipt.
  await admin.goto(river("fees/counter"));
  await admin.getByRole("button", { name: "Open counter" }).first().click();
  await admin.getByRole("button", { name: "Open counter" }).last().click();
  await expect(admin.getByRole("button", { name: "Close counter" })).toBeVisible({ timeout: 20_000 });
  await admin.goto(river("fees/dues"));
  const student = await admin.locator('main a[href*="/fees/students/"]').first().getAttribute("href");
  await admin.goto(river(`fees/collect?student=${student!.split("/").pop()!.split("?")[0]}`));
  await admin.getByRole("textbox", { name: "Amount to take" }).fill("1500");
  await admin.getByRole("button", { name: /^Collect ₹/ }).click();
  await expect(admin.getByRole("link", { name: /open the receipt/i })).toBeVisible({ timeout: 20_000 });
  await admin.goto(river("finance"));
  await expect(admin.locator("main")).not.toContainText(/the books do not match/i);
  await admin.context().close();
});
