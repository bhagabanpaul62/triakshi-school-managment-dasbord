import { execFileSync } from "node:child_process";
import { expect, type Browser, type Page } from "@playwright/test";
import { login, loginStudent, SCHOOL } from "./helpers";

export const SLUG = "greenvalley";
export const at = (p: string) => `${SCHOOL(SLUG)}/app/${p}`;
export const main = (page: Page) => page.locator("main").first();
export const dialog = (page: Page) => page.getByRole("dialog").last();
/** Two families of Nursery A (GR0001, GR0002) sign in with the date of birth the seed gave them. */
export const FAMILIES = { family: ["GR0001", "01012023"], family2: ["GR0002", "12062023"] } as const;
export type Who = "admin" | "accounts" | "teacher" | "cashier" | "bursar" | "auditor" | keyof typeof FAMILIES;

/** A signed-in page per person, so a journey passes from hand to hand. Call `close()` in afterAll. */
export class People {
  private open = new Map<Who, Page>();
  constructor(private browser: Browser, private phone: readonly Who[] = ["family", "family2"]) {}
  async as(who: Who): Promise<Page> {
    const have = this.open.get(who);
    if (have) return have;
    const ctx = await this.browser.newContext({ acceptDownloads: true, ...(this.phone.includes(who) ? { viewport: { width: 375, height: 812 } } : {}) });
    const page = await ctx.newPage();
    if (who in FAMILIES) { const [adm, dob] = FAMILIES[who as keyof typeof FAMILIES]; await loginStudent(page, SLUG, adm, dob); } else await login(page, SLUG, who);
    this.open.set(who, page);
    return page;
  }
  async close() { for (const p of this.open.values()) await p.context().close(); }
}

/** Run one worker job now, as the worker would. */
export const job = (name: string, data: object = {}) => execFileSync("pnpm", ["--filter", "@smw/worker", "job", name, JSON.stringify(data)], { stdio: "pipe" }).toString();
/** Read or nudge the local database (dates in the past cannot be made in the UI). Never use it to skip a step a person would take. */
export const sql = (q: string) => execFileSync("docker", ["exec", "smw-dev-postgres-1", "psql", "-U", "postgres", "-d", "smw", "-Atc", q]).toString().trim();
export const says = (page: Page, text: RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
export async function mails(to: string): Promise<{ Subject: string; ID: string }[]> {
  const r = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
  return (await r.json()).messages;
}
