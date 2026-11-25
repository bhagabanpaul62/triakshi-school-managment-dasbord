import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { users } from "@smw/db";
import { systemCtx, type Ctx } from "@smw/feature-kit";
import { AnnouncementService } from "@smw/feature-announcements/service";
import { EventService } from "@smw/feature-events/service";
import { announcements } from "@smw/feature-announcements/schema";
import { events } from "@smw/feature-events/schema";
import { fileRefs, istDay, siteContentSchema, siteSettingsOf, stripMeta, type Page, type SiteContent, type SiteSettings, type TemplateKey } from "@smw/site-templates";
import { PHOTO_URL, WebsiteService, keyOfUrl } from "./base";
import { schoolSites, sitePageDays, siteMedia, siteRedirects } from "./schema";

// ---------- public ----------

/** What a visitor can see of a teacher. */
export interface PublicStaff { id: string; name: string; subject: string | null }
export interface PublicEvent { id: string; title: string; startsOn: string; location: string | null; description: string | null }

export type ViewOrigin = "direct" | "search" | "social" | "other";
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|startpage)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|linkedin|youtube|youtu|whatsapp|wa|t|telegram|pinterest|reddit|lnkd)\.(com|me|co|be|in|ly)$/i;

/** Where a visit came from, from the referrer's host only. The referrer itself is never kept. Own hosts count as direct. */
export function originOf(referrer: string | null | undefined, ownHosts: (string | null | undefined)[] = []): ViewOrigin {
  let host: string;
  try { host = new URL(referrer ?? "").hostname.toLowerCase(); } catch { return "direct"; }
  if (!host || ownHosts.some((h) => h && h.split(":")[0]!.toLowerCase() === host)) return "direct";
  if (SEARCH.test(host)) return "search";
  return SOCIAL.test(host) ? "social" : "other";
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|scrapy|httpclient/i;
/** A visit is counted only for a person with a browser: not a bot, not a draft preview, not someone signed in (staff or family). */
export const countable = (i: { userAgent?: string | null; preview?: boolean; signedIn?: boolean }) => !!i.userAgent && !BOT.test(i.userAgent) && !i.preview && !i.signedIn;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
/** Same rule as the notice list: only a notice for everyone, or for the website alone, may ever be public. */
const publicNotice = sql`(${announcements.website} and (${announcements.audience}->'include' = '[]'::jsonb or (${announcements.audience}->'exclude' = '[]'::jsonb and ${announcements.audience}->'include' @> '[{"type":"everyone"}]'::jsonb)))`;
const forEveryone = sql`(${events.audience} @> '{"include":[{"type":"everyone"}]}'::jsonb and jsonb_array_length(${events.audience} -> 'exclude') = 0)`;

export interface PublicNotice { id: string; title: string; body: string; publishedAt: Date | null }
export interface PublicEventDetail { id: string; title: string; description: string | null; startsAt: Date; endsAt: Date | null; allDay: boolean; location: string | null; mapUrl: string | null }

/**
 * The website as a visitor sees it. Nobody is signed in, so the public routes build a system context with
 * `systemCtx(schoolId, school.features)` (role admin) and use the feature permission "public", which is granted to
 * admin for exactly this reason. It can only read the published site, public news and events, and count a view. Enquiries go through PublicEnquiryService.
 */
export class PublicSiteService extends WebsiteService {
  /** The description of each uploaded photo a page shows (Website, Media), by address. One query per page, for photos without a caption of their own. */
  async altFor(page: Page, extra: (string | null | undefined)[] = []): Promise<Record<string, string>> {
    if (!this.can("public")) return {};
    const urls = [...fileRefs({ pages: [page], nav: [], footer: { links: [] } }).map((r) => r.url), ...extra.filter((u): u is string => !!u)];
    const keys = [...new Set(urls.map(keyOfUrl).filter((k): k is string => !!k))];
    if (!keys.length) return {};
    return this.read("public", async (tx) => Object.fromEntries((await tx.select({ key: siteMedia.fileKey, alt: siteMedia.alt }).from(siteMedia).where(and(inArray(siteMedia.fileKey, keys), sql`${siteMedia.alt} is not null`))).map((r) => [PHOTO_URL + r.key, r.alt!])));
  }

  static forSchool(schoolId: string, features: Iterable<string>, readOnly = false) {
    return new PublicSiteService({ ...systemCtx(schoolId, features), readOnly });
  }

  /** The published site, its template and settings, or null when nothing is published (or the module is off). `offlineAt` set = the school took the site offline. */
  async published(): Promise<{ templateKey: TemplateKey; content: SiteContent; publishedAt: Date | null; settings: SiteSettings; offlineAt: Date | null } | null> {
    if (!this.can("public")) return null;
    return this.read("public", async (tx) => {
      const [row] = await tx.select().from(schoolSites).where(eq(schoolSites.schoolId, this.ctx.schoolId)).limit(1);
      if (!row?.published) return null;
      const ok = siteContentSchema.safeParse(row.published);
      return ok.success ? { templateKey: row.publishedTemplateKey ?? row.templateKey, content: stripMeta(ok.data, { keepPageDate: true }), publishedAt: row.publishedAt, settings: siteSettingsOf(row.settings), offlineAt: row.offlineAt } : null;
    });
  }

  async news(limit = 6) {
    if (!this.ctx.features.has("announcements")) return [];
    // A published notice always has its time; the filter only tells the types so.
    return (await new AnnouncementService(this.ctx).publicNews(limit)).flatMap((a) => (a.publishedAt ? [{ ...a, publishedAt: a.publishedAt }] : []));
  }

  /** Public events, through the events feature's own service when it offers them. */
  async events(limit = 6): Promise<PublicEvent[]> {
    return loadPublicEvents(this.ctx, limit);
  }

  /** Teachers by name, with a subject when the academics tables are there. Optional by design: [] on any problem. */
  async staff(limit = 8): Promise<PublicStaff[]> {
    if (!this.can("public")) return [];
    return this.read("public", async (tx) => {
      // Teachers the school chose not to name stay off the page (PRD W6).
      const [site] = await tx.select({ settings: schoolSites.settings }).from(schoolSites).where(eq(schoolSites.schoolId, this.ctx.schoolId)).limit(1);
      const settings = siteSettingsOf(site?.settings);
      // Nobody is named until the school has looked at the list (Settings, Teachers shown). The panel and the publish check say so.
      if (!settings.teachersChecked) return [];
      const hidden = settings.hiddenStaff;
      const teachers = await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(eq(users.role, "teacher"), eq(users.status, "active"), hidden.length ? notInArray(users.id, hidden) : undefined)).orderBy(users.name).limit(limit);
      const subjects = new Map<string, string[]>();
      try {
        // A savepoint, so a school without academics tables does not poison the transaction.
        await tx.transaction(async (sp) => {
          const rows = await sp.execute<{ teacher_id: string; name: string }>(sql`select distinct st.teacher_id, s.name from section_teachers st join subjects s on s.id = st.subject_id`);
          for (const r of rows) subjects.set(r.teacher_id, [...(subjects.get(r.teacher_id) ?? []), r.name]);
        });
      } catch { /* no academics: names only */ }
      return teachers.map((t) => ({ id: t.id, name: t.name, subject: subjects.get(t.id)?.slice(0, 3).join(", ") ?? null }));
    });
  }

  /** One public notice. A withdrawn one comes back with no text: the page says it was withdrawn. null = no such public notice. */
  async newsItem(id: string): Promise<(PublicNotice & { withdrawn: boolean }) | null> {
    if (!this.can("public") || !this.ctx.features.has("announcements") || !isUuid(id)) return null;
    return this.read("public", async (tx) => {
      const [n] = await tx.select().from(announcements)
        .where(and(eq(announcements.id, id), eq(announcements.schoolId, this.ctx.schoolId), publicNotice, inArray(announcements.state, ["published", "expired", "withdrawn"]))).limit(1);
      if (!n) return null;
      return n.state === "withdrawn" ? { id: n.id, title: "", body: "", publishedAt: null, withdrawn: true } : { id: n.id, title: n.title, body: n.body, publishedAt: n.publishedAt, withdrawn: false };
    });
  }

  /** One public event for everyone. A cancelled one still opens, so a shared link says what happened. */
  async eventItem(id: string): Promise<(PublicEventDetail & { cancelled: boolean }) | null> {
    if (!this.can("public") || !this.ctx.features.has("events") || !isUuid(id)) return null;
    return this.read("public", async (tx) => {
      const [e] = await tx.select().from(events)
        .where(and(eq(events.id, id), eq(events.schoolId, this.ctx.schoolId), eq(events.isPublic, true), forEveryone, inArray(events.state, ["live", "cancelled"]))).limit(1);
      return e ? { id: e.id, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, location: e.location, mapUrl: e.mapUrl, cancelled: e.state === "cancelled" } : null;
    });
  }

  /**
   * Where an old address now goes (a path of this site or a full https link), or null. `permanent` is true only for the redirect an address
   * change made (308); one the school typed by hand is 307, so it can be pointed somewhere else later.
   */
  async redirectFor(path: string): Promise<{ to: string; permanent: boolean } | null> {
    if (!this.can("public")) return null;
    const from = (path.length > 1 ? path.replace(/\/+$/, "") : path).toLowerCase();
    return this.read("public", async (tx) => {
      const [r] = await tx.select({ to: siteRedirects.toPath, automatic: siteRedirects.automatic }).from(siteRedirects)
        .where(and(eq(siteRedirects.schoolId, this.ctx.schoolId), sql`lower(${siteRedirects.fromPath}) = ${from}`)).limit(1);
      return r && /^(\/(?![/\\])\S*|https:\/\/\S+)$/i.test(r.to) && r.to.toLowerCase() !== from ? { to: r.to, permanent: r.automatic } : null;
    });
  }

  /**
   * One more view of a page today (India), by kind of origin. No person, no cookie. Never throws: a counter must not break a page.
   * Views are added up in memory and written every ten seconds, so a busy page is one write, not one per visitor.
   */
  async countView(path: string, origin: ViewOrigin): Promise<void> {
    if (!this.can("public")) return;
    const key = `${this.ctx.schoolId}|${istDay()}|${path.slice(0, 200)}|${origin}`;
    const cur = VIEWS.get(key);
    if (cur) cur.n++;
    else VIEWS.set(key, { svc: this, day: istDay(), path: path.slice(0, 200), origin, n: 1 });
    if (!viewTimer) { viewTimer = setTimeout(() => { void PublicSiteService.flushViews(); }, VIEW_FLUSH_MS); viewTimer.unref?.(); }
  }

  /** Write the views counted so far. The worker and the tests call it; a timer does it every ten seconds. */
  static async flushViews(): Promise<void> {
    if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; }
    const rows = [...VIEWS.values()];
    VIEWS.clear();
    for (const r of rows) {
      try {
        await r.svc.write("public", (tx) => tx.insert(sitePageDays).values({ schoolId: r.svc.ctx.schoolId, day: r.day, path: r.path, origin: r.origin, views: r.n })
          .onConflictDoUpdate({ target: [sitePageDays.schoolId, sitePageDays.day, sitePageDays.path, sitePageDays.origin], set: { views: sql`${sitePageDays.views} + ${r.n}` } }));
      } catch { /* a counter must not break anything */ }
    }
  }
}

const VIEW_FLUSH_MS = 10_000;
const VIEWS = new Map<string, { svc: PublicSiteService; day: string; path: string; origin: ViewOrigin; n: number }>();
let viewTimer: ReturnType<typeof setTimeout> | null = null;
process.once("beforeExit", () => { void PublicSiteService.flushViews(); });

/** Public events through the events feature's own service. [] when the module is off for this school. */
async function loadPublicEvents(ctx: Ctx, limit: number): Promise<PublicEvent[]> {
  if (!ctx.features.has("events")) return [];
  const svc = new EventService(ctx);
  const [rows, holidays] = await Promise.all([svc.publicEvents(limit), svc.publicHolidays(limit)]);
  const shown = rows.map((r) => ({
    id: r.id, title: r.title, location: r.location, description: r.description,
    startsOn: new Date(r.startsAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  }));
  const days = holidays.map((h) => ({ id: `holiday-${h.startsOn}`, title: h.title, location: null, description: null, startsOn: h.startsOn }));
  return [...shown, ...days].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).slice(0, limit);
}
