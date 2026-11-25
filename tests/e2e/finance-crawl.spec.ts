import { expect, test } from "@playwright/test";
import { crawl } from "./crawl-lib";
import { login, loginStudent } from "./helpers";

// Follows every link inside the money screens as each role. A dead link, an error page, a refusal reached by a link the
// person was shown, or a page wider than a phone fails the run.
const SLUG = "greenvalley";
const SECTIONS = /^\/app\/(finance|fees|expenses|payroll|billing|attendance\/(leave|my-leave))/;

for (const [role, id, starts] of [
  ["admin", "admin", ["/app/finance", "/app/fees", "/app/expenses", "/app/payroll", "/app/billing"]],
  ["accountant", "accounts", ["/app/finance", "/app/fees", "/app/expenses", "/app/payroll", "/app/billing"]],
  ["cashier", "cashier", ["/app"]],
  ["bursar", "bursar", ["/app"]],
  ["auditor", "auditor", ["/app"]],
  ["teacher", "teacher", ["/app/expenses/claims", "/app/payroll/me", "/app/attendance/my-leave"]],
] as const) {
  test(`${role}: every link works`, async ({ page }) => {
    test.setTimeout(1_200_000);
    await login(page, SLUG, id);
    const problems = await crawl(page, { slug: SLUG, sections: SECTIONS, starts: [...starts], role });
    expect(problems.join("\n")).toBe("");
  });
}

test("family: every link works", async ({ page }) => {
  test.setTimeout(600_000);
  await loginStudent(page, SLUG, "GR0001", "01012023");
  expect((await crawl(page, { slug: SLUG, sections: SECTIONS, starts: ["/app/fees"], role: "family" })).join("\n")).toBe("");
});
