import { expect, test } from "@playwright/test";
import { login, SCHOOL, expectHealthy } from "./helpers";

test("each school host shows its own name", async ({ page }) => {
  await page.goto(`${SCHOOL("greenvalley")}/login`);
  await expect(page.getByRole("heading", { name: "Green Valley Public School" })).toBeVisible();
  await page.goto(`${SCHOOL("sunrise")}/login`);
  await expect(page.getByRole("heading", { name: "Sunrise International School" })).toBeVisible();
});

test("unknown host says school not found", async ({ page }) => {
  await page.goto(`${SCHOOL("nope-school")}/login`);
  await expect(page.getByText(/school not found/i)).toBeVisible();
});

test("session cookie is host-only and does not work on another school", async ({ page, context }) => {
  await login(page, "greenvalley", "admin");
  const cookies = await context.cookies(SCHOOL("greenvalley"));
  const session = cookies.find((c) => c.name === "smw_session");
  expect(session).toBeTruthy();
  expect(session!.domain).toBe("greenvalley.localhost"); // no leading dot = host-only
  expect(session!.httpOnly).toBe(true);
  // Replay the same token on the other school's host: it must not sign in.
  await context.addCookies([{ ...session!, domain: "sunrise.localhost" }]);
  await page.goto(`${SCHOOL("sunrise")}/app`);
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password is rejected with a clear message", async ({ page }) => {
  await page.goto(`${SCHOOL("greenvalley")}/login`);
  await page.getByLabel(/email, phone or admission number/i).fill("admin");
  await page.getByLabel(/^password$/i).fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/login ID or password is not right/i)).toBeVisible();
});

test("admin posts an announcement @mobile", async ({ page }) => {
  await login(page, "greenvalley", "admin");
  await page.goto(`${SCHOOL("greenvalley")}/app/announcements`);
  await expectHealthy(page);
  const title = `E2E notice ${Date.now()}`;
  await page.getByRole("button", { name: /new announcement/i }).first().click();
  await page.getByLabel(/^title/i).fill(title);
  await page.getByLabel(/^message/i).fill("Posted by the browser test.");
  await page.getByRole("button", { name: /^post$/i }).click();
  await expect(page.getByText(title)).toBeVisible();
});
