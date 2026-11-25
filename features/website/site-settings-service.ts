import { and, asc, eq, inArray } from "drizzle-orm";
import { users } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, auditChanges } from "@smw/feature-kit";
import { RESERVED_NEW_SLUGS, RESERVED_SLUGS, siteSettingsOf, siteSettingsSchema, type SiteSettings } from "@smw/site-templates";
import { WebsiteService } from "./base";
import { redirectInput } from "./inputs";
import { schoolSites, siteRedirects } from "./schema";

/** Addresses the website answers on its own: a redirect from one of them would never be reached. */
const GENERATED = ["news", "events", "privacy", "home", "sitemap.xml", "robots.txt", "favicon.ico", "manifest.webmanifest"];
export type RedirectRow = typeof siteRedirects.$inferSelect;
export interface SiteTeacher { id: string; name: string; hidden: boolean }

/** Things about the whole site that apply at once, not with a publish: notice bar, buttons, social links, search engines, who is named, redirects. */
export class SiteSettingsService extends WebsiteService {
  async get(): Promise<SiteSettings> {
    return this.read(this.sees(), async (tx) => siteSettingsOf((await this.siteRow(tx, { create: false })).settings));
  }

  /**
   * Change some settings. Keys that are present replace the old value; `notice: null` removes the notice bar. Everything is checked
   * by the settings schema, and a teacher id that is not an active teacher of this school is dropped (a foreign id is never stored).
   */
  async update(patch: Record<string, unknown>): Promise<SiteSettings> {
    return this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const before = siteSettingsOf(row.settings);
      const merged: Record<string, unknown> = { ...before };
      for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete merged[k]; else merged[k] = v; }
      const r = siteSettingsSchema.safeParse(merged);
      if (!r.success) throw new ValidationError(Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message])));
      const next = r.data;
      if (patch.hiddenStaff !== undefined) {
        const ids = next.hiddenStaff.length ? (await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "teacher"), inArray(users.id, next.hiddenStaff)))).map((u) => u.id) : [];
        next.hiddenStaff = ids;
        next.teachersChecked = true;
      }
      await tx.update(schoolSites).set({ settings: next }).where(eq(schoolSites.id, row.id));
      return { before, next };
    }, ({ before, next }) => ({ action: "update", entity: "Website settings", summary: "Changed the website settings", meta: { changes: auditChanges(before, next) } })).then((r) => r.next);
  }

  /** Active teachers, with whether the site hides them. */
  async teachers(): Promise<SiteTeacher[]> {
    return this.read(this.sees(), async (tx) => {
      const hidden = new Set(siteSettingsOf((await this.siteRow(tx, { create: false })).settings).hiddenStaff);
      return (await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), eq(users.status, "active"))).orderBy(asc(users.name))).map((u) => ({ ...u, hidden: hidden.has(u.id) }));
    });
  }

  /** Who may publish: admins and custom roles that were given the right. */
  async publishers(): Promise<string[]> {
    return this.read(this.sees(), async (tx) => (await this.holdersOf(tx, "publish")).map((u) => u.name));
  }

  // ---------- redirects ----------

  async redirects(): Promise<RedirectRow[]> {
    return this.read(this.sees(), (tx) => tx.select().from(siteRedirects).orderBy(asc(siteRedirects.fromPath)));
  }

  /** One address that leads somewhere else. A live page's address, the app's own paths, a loop or a chain are refused or tidied. */
  async addRedirect(input: unknown): Promise<RedirectRow> {
    const parsed = this.parse(redirectInput, input);
    // One spelling per address: no trailing slash, and the old address in lower case (the site does not tell capitals apart).
    const tidy = (p: string) => (p.length > 1 && p.startsWith("/") ? p.replace(/\/+$/, "") : p);
    const r = { from: tidy(parsed.from).toLowerCase(), to: tidy(parsed.to) };
    const first = r.from.slice(1).split("/")[0]!;
    if ((RESERVED_SLUGS as readonly string[]).includes(first) || (RESERVED_NEW_SLUGS as readonly string[]).includes(first)) throw new ValidationError({ from: `/${first} belongs to the system (sign in, the panel and its forms). Pick another old address.` });
    if (GENERATED.includes(first)) throw new ValidationError({ from: `/${first} is made by the website itself (notices, events, the home page and the files search engines read). Pick another old address.` });
    if (r.to === r.from) throw new ValidationError({ to: "An address cannot lead to itself" });
    return this.write("manage", async (tx) => {
      const site = await this.siteRow(tx, { create: true, lock: true });
      const draftOrLive = [...site.draft.pages, ...(site.published?.pages ?? [])];
      if (draftOrLive.some((p) => `/${p.slug}` === r.from)) throw new ConflictError("A page of your site uses this address. Rename or remove the page first.");
      const rows = await tx.select().from(siteRedirects);
      // Follow the target through the table: arriving back at `from` is a loop.
      let at = r.to;
      for (let i = 0; i < 10 && at.startsWith("/"); i++) {
        if (at === r.from) throw new ValidationError({ to: "That would send visitors round in a circle" });
        const hop = rows.find((x) => x.fromPath === at);
        if (!hop) break;
        at = hop.toPath;
      }
      const [saved] = await tx.insert(siteRedirects).values({ schoolId: this.ctx.schoolId, fromPath: r.from, toPath: at, automatic: false })
        .onConflictDoUpdate({ target: [siteRedirects.schoolId, siteRedirects.fromPath], set: { toPath: at, automatic: false } }).returning();
      // Anything that led to `from` now leads straight on.
      for (const x of rows.filter((y) => y.toPath === r.from)) await tx.update(siteRedirects).set({ toPath: at }).where(eq(siteRedirects.id, x.id));
      return saved!;
    }, (x) => ({ action: "create", entity: "Redirect", entityId: x.id, summary: `Added a redirect from ${x.fromPath} to ${x.toPath}` }));
  }

  async removeRedirect(id: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [x] = await tx.delete(siteRedirects).where(eq(siteRedirects.id, id)).returning();
      if (!x) throw new NotFoundError("Redirect");
      return x;
    }, (x) => ({ action: "delete", entity: "Redirect", entityId: x.id, summary: `Removed the redirect from ${x.fromPath}` }));
  }
}
