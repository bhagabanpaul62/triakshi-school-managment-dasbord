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
export const sql = (q: string) => execFileSync("docker", ["exec", "smw-dev-postgres-1", "psql", "-U", "postgres", "-d", process.env.E2E_DB ?? "smw", "-Atc", q]).toString().trim();
export const says = (page: Page, text: RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
export async function mails(to: string): Promise<{ Subject: string; ID: string }[]> {
  const r = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
  return (await r.json()).messages;
}

/** Today's mail budget back to zero, as a new day would: a full run sends about a hundred mails, so a second run on the same day would meet the daily limit. */
export const newMailDay = () => sql(`update mail_usage set count = 0 where day::text = to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`);

/** School hours for the demo school: quiet hours far from now and no quiet Sunday, so mail goes out whatever the clock says when the tests run. Returns what puts the school's own setting back. */
export function schoolAwake(): () => void {
  const id = sql(`select id from schools where slug = '${SLUG}'`);
  const was = sql(`select coalesce(jsonb_object_agg(k, settings -> k) filter (where settings ? k), '{}')::text from comm_settings, unnest(array['quietFrom', 'quietTo', 'quietSundays']) k where school_id = '${id}'`) || "{}";
  const ist = (h: number) => new Date(Date.now() + 330 * 60_000 + h * 3_600_000).toISOString().slice(11, 16);
  const now = JSON.stringify({ quietFrom: ist(10), quietTo: ist(12), quietSundays: false });
  sql(`insert into comm_settings (id, school_id, settings) values (gen_random_uuid(), '${id}', '${now}') on conflict (school_id) do update set settings = comm_settings.settings || excluded.settings`);
  return () => { sql(`update comm_settings set settings = (settings - array['quietFrom', 'quietTo', 'quietSundays']) || '${was}'::jsonb where school_id = '${id}'`); };
}
