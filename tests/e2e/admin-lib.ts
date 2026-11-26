import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { login, loginStudent, SCHOOL } from "./helpers";

export const SLUG = "greenvalley";
export const at = (p: string) => `${SCHOOL(SLUG)}/app${p ? `/${p}` : ""}`;
export type Person = "admin" | "accounts" | "cashier" | "teacher" | "librarian" | "frontoffice" | "family";
export const PASSWORD = "Quill-Harbor-Desk-7421";
const CACHE = join(tmpdir(), `smw-admin-logins-${process.env.E2E_DB ?? "smw"}.json`);
const CUSTOM = { librarian: "Librarian", frontoffice: "Front office" } as const;
type Made = Record<"librarian" | "frontoffice", string>; // email by person

let ip = Math.floor(Math.random() * 200) + 20;
/** Each person gets their own forwarded address, so the sign-in limit per address never gets in the way. */
const ctxFor = (browser: Browser, w = 1440, h = 900) => browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 1}.${++ip % 250}` } });

async function canSignIn(browser: Browser, email: string) {
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000); // a cached login that a fresh database no longer has must fail fast, not wait out the test
  try { await login(page, SLUG, email, PASSWORD); return true; } catch { return false; } finally { await ctx.close(); }
}

/** Two custom-role logins, made once through Settings, Users, Add a login (a link, no mail) with unique names, and kept for the next spec. */
export async function customLogins(browser: Browser): Promise<Made> {
  if (existsSync(CACHE)) {
    const made = JSON.parse(readFileSync(CACHE, "utf8")) as Made;
    if ((await canSignIn(browser, made.librarian)) && (await canSignIn(browser, made.frontoffice))) return made;
  }
  const run = Date.now().toString(36);
  const ctx = await ctxFor(browser);
  const admin = await ctx.newPage();
  admin.setDefaultTimeout(60_000);
  await login(admin, SLUG, "admin");
  const made = {} as Made;
  for (const [who, role] of Object.entries(CUSTOM) as [keyof Made, string][]) {
    const name = `${role} Test ${run}`, email = `${who}.${run}@greenvalley.example`;
    await admin.goto(at("settings/users"));
    await admin.getByRole("button", { name: "Add a login" }).click();
    const d = admin.getByRole("dialog");
    await d.getByLabel(/full name/i).fill(name);
    await d.getByLabel(/^email/i).fill(email);
    await d.getByLabel(/^Role/).selectOption({ label: role });
    await d.getByLabel(/how do they get in/i).selectOption({ label: "I will give them a link" });
    await d.getByRole("button", { name: "Add login" }).click();
    const link = await admin.locator('input[aria-label="Access link"]').inputValue();
    const c2 = await ctxFor(browser);
    const p2 = await c2.newPage();
    await p2.goto(link);
    await p2.getByLabel("New password").fill(PASSWORD);
    await p2.getByLabel("Type it again").fill(PASSWORD);
    await p2.getByRole("button", { name: /set password and sign in/i }).click();
    await p2.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 60_000 });
    await c2.close();
    made[who] = email;
  }
  await ctx.close();
  writeFileSync(CACHE, JSON.stringify(made));
  return made;
}

/** A signed-in context for one person, at the given width. */
export async function as(browser: Browser, who: Person, w = 1440, h = 900): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await ctxFor(browser, w, h);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  if (who === "family") await loginStudent(page, SLUG, "GR0001", "01012023");
  else if (who === "librarian" || who === "frontoffice") await login(page, SLUG, (await customLogins(browser))[who], PASSWORD);
  else await login(page, SLUG, who);
  expect(new URL(page.url()).pathname.startsWith("/app")).toBe(true);
  return { ctx, page };
}

export const settled = (page: Page) => page.waitForFunction(() => !document.querySelector("main [aria-busy=true], main .animate-pulse"), undefined, { timeout: 20_000 }).catch(() => {});
export const REFUSAL = /something went wrong|application error|school not found|page not found|could not load|couldn.t load|do not have permission|not allowed|ask an admin if you need access/i;
