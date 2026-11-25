import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { schoolDomains, type Tx } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { PdfBuilder, services } from "@smw/integrations";
import { HOME_SLUG, SECTION_META, disclosureTitle, siteSettingsOf, type SiteContent } from "@smw/site-templates";
import { withConsole } from "@smw/db";
import { WebsiteService, istToday, siteFolder } from "./base";
import { MediaService } from "./media-service";
import { enquiries, sitePageDays, siteVersions } from "./schema";
import { SiteService } from "./site-service";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface Insights {
  days: 30 | 90; since: string; views: number; before: number | null;
  byDay: { day: string; views: number }[];
  top: { path: string; title: string; views: number; enquiries: number }[];
  origins: Record<"direct" | "search" | "social" | "other", number>;
  enquiries: number; /** Enquiries by day, and by the page the form was sent from. */ enquiriesByDay: { day: string; n: number }[]; enquiriesByPage: Record<string, number>;
  /** Share of visits that became an enquiry, 0 to 1; null with no visits. */ rate: number | null;
}
export type SiteState = "not_published" | "live" | "live_changes" | "scheduled" | "offline";
export interface CheckItem { key: string; label: string; done: boolean; href: string; hint: string }
export interface Overview {
  state: SiteState; first: boolean; changes: string[]; scheduledFor: Date | null; /** Why a due schedule is waiting, or null. */ scheduleNote: string | null; offlineAt: Date | null;
  published: { at: Date; byName: string | null; version: number | null } | null;
  asked: { by: string | null; byId: string | null; note: string | null; at: Date } | null;
  checklist: CheckItem[]; views30: number; enquiries30: number; pages: number;
  canPublish: boolean; canManage: boolean; homeSlug: string;
}

/** Visits and enquiries without a cookie, and the one-page state of the site. */
export class InsightsService extends WebsiteService {
  private async counts(tx: Tx, from: string, to: string) {
    const rows = await tx.select({ day: sitePageDays.day, path: sitePageDays.path, origin: sitePageDays.origin, views: sql<number>`sum(${sitePageDays.views})::int` }).from(sitePageDays)
      .where(and(gte(sitePageDays.day, from), lt(sitePageDays.day, to))).groupBy(sitePageDays.day, sitePageDays.path, sitePageDays.origin);
    const [e] = await tx.select({ n: sql<number>`count(*)::int` }).from(enquiries)
      .where(and(gte(enquiries.createdAt, new Date(`${from}T00:00:00+05:30`)), lt(enquiries.createdAt, new Date(`${to}T00:00:00+05:30`)), eq(enquiries.source, "website"), sql`${enquiries.mergedInto} is null`));
    const per = await tx.select({ day: sql<string>`to_char(${enquiries.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`, page: enquiries.pagePath, n: sql<number>`count(*)::int` }).from(enquiries)
      .where(and(gte(enquiries.createdAt, new Date(`${from}T00:00:00+05:30`)), lt(enquiries.createdAt, new Date(`${to}T00:00:00+05:30`)), eq(enquiries.source, "website"), sql`${enquiries.mergedInto} is null`))
      .groupBy(sql`1`, enquiries.pagePath);
    return { rows, enquiries: e?.n ?? 0, per };
  }

  async insights(days: 30 | 90 = 30): Promise<Insights> {
    if (days !== 30 && days !== 90) throw new ValidationError({ days: "Pick 30 or 90 days" });
    return this.read(this.sees(), async (tx) => {
      const today = istToday();
      const to = addDays(today, 1), since = addDays(today, 1 - days);
      const [now, prev, site] = await Promise.all([this.counts(tx, since, to), this.counts(tx, addDays(since, -days), since), this.siteRow(tx, { create: false })]);
      const titles = new Map((site.published ?? site.draft).pages.map((p) => [p.slug === HOME_SLUG ? "/" : `/${p.slug}`, p.title]));
      const perDay = new Map<string, number>(), perPath = new Map<string, number>();
      const origins = { direct: 0, search: 0, social: 0, other: 0 };
      for (const r of now.rows) {
        perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.views);
        perPath.set(r.path, (perPath.get(r.path) ?? 0) + r.views);
        origins[r.origin] += r.views;
      }
      const byPage = now.per.reduce<Record<string, number>>((a, x) => (x.page ? { ...a, [x.page]: (a[x.page] ?? 0) + x.n } : a), {});
      const views = [...perDay.values()].reduce((a, b) => a + b, 0);
      const before = prev.rows.length ? prev.rows.reduce((a, r) => a + r.views, 0) : null;
      return {
        days, since, views, before,
        byDay: Array.from({ length: days }, (_, i) => { const day = addDays(since, i); return { day, views: perDay.get(day) ?? 0 }; }),
        top: [...perPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, v]) => ({ path, title: titles.get(path) ?? path, views: v, enquiries: byPage[path] ?? 0 })),
        origins, enquiries: now.enquiries,
        enquiriesByDay: Array.from({ length: days }, (_, k) => { const day = addDays(since, k); return { day, n: now.per.filter((x) => x.day === day).reduce((a, x) => a + x.n, 0) }; }),
        enquiriesByPage: byPage, rate: views ? Math.min(1, now.enquiries / views) : null,
      };
    });
  }

  /** Worker job (run with the daily document check): day counts older than this are of no use to anyone. */
  static async prunePageDays(days = 400, now = new Date()): Promise<number> {
    const before = addDays(istToday(now), -days);
    return (await withConsole((tx) => tx.delete(sitePageDays).where(lt(sitePageDays.day, before)).returning({ id: sitePageDays.id }))).length;
  }

  /** Everything the Overview screen shows, in one read. */
  async overview(): Promise<Overview> {
    const owns = this.can("manage") && !this.ctx.readOnly;
    const own = owns ? await new MediaService(this.ctx).list({ kind: "photo" }) : null;
    return this.read(this.sees(), async (tx) => {
      const site = await this.siteRow(tx, { create: false });
      const school = await this.schoolRow(tx);
      const today = istToday();
      const { rows, enquiries: enq } = await this.counts(tx, addDays(today, -29), addDays(today, 1));
      const [last] = await tx.select({ number: siteVersions.number, byName: siteVersions.byName }).from(siteVersions).where(ne(siteVersions.kind, "before_restore")).orderBy(desc(siteVersions.number)).limit(1);
      const [dom] = await tx.select({ id: schoolDomains.id }).from(schoolDomains).where(and(eq(schoolDomains.kind, "custom"), eq(schoolDomains.status, "verified"))).limit(1);
      const photos = own ? own.filter((m) => !m.url.includes("unsplash")).length : (await services().storage.list(siteFolder(this.ctx.schoolId))).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.key)).length;
      const changed = SiteService.hasUnpublishedChanges(site);
      const state: SiteState = site.offlineAt ? "offline" : !site.published ? "not_published" : site.scheduledFor ? "scheduled" : changed ? "live_changes" : "live";
      const c: SiteContent = site.draft;
      const sections = c.pages.flatMap((p) => p.sections.filter((s) => !s.hidden));
      const hero = c.pages.find((p) => p.slug === HOME_SLUG)?.sections.find((s) => s.type === "hero" && !s.hidden);
      const contact = sections.find((s) => s.type === "contact");
      const settings = siteSettingsOf(site.settings);
      const liveHasDisclosure = !!site.published?.pages.some((p) => p.sections.some((s) => s.type === "disclosure" && !s.hidden));
      const checklist: CheckItem[] = [
        { key: "logo", label: "School logo", done: !!school.logoUrl, href: "/app/theme", hint: "Upload it under Theme." },
        { key: "headline", label: "Your own headline on the home page", done: hero?.type === "hero" && !!hero.data.heading.trim() && hero.data.heading !== (SECTION_META.hero.initial as { heading: string }).heading, href: "/app/website/edit", hint: "Write one line about your school." },
        { key: "photos", label: "Three of your own photos", done: photos >= 3, href: "/app/website/media", hint: `${photos} uploaded so far.` },
        { key: "contact", label: "Address and phone", done: contact?.type === "contact" && contact.data.address !== (SECTION_META.contact.initial as { address: string }).address, href: "/app/website/edit?page=contact", hint: "Visitors need to find you." },
        { key: "form", label: "Admission enquiry form", done: sections.some((s) => s.type === "admission_form"), href: "/app/website/edit?page=admissions", hint: "Parents ask for a seat here." },
        { key: "teachers", label: "Teachers checked", done: settings.teachersChecked, href: "/app/website/settings", hint: "Choose whose names show." },
        { key: "search", label: "Search description on the home page", done: !!c.pages.find((p) => p.slug === HOME_SLUG)?.seo.description, href: "/app/website/pages", hint: "Two sentences for Google." },
        { key: "disclosure", label: `${disclosureTitle(school.board)} on the site`, done: liveHasDisclosure, href: "/app/website/disclosure", hint: "Parents and the board expect it." },
        { key: "domain", label: "Your own web address", done: !!dom, href: "/app/domains", hint: "Optional, but easier to remember." },
      ];
      return {
        state, first: !site.published, changes: SiteService.changes(site).lines, scheduledFor: site.scheduledFor,
        scheduleNote: site.scheduledFor && this.ctx.readOnly ? "Waiting: the school is read-only. It goes live after the plan is renewed." : site.scheduledFor && site.scheduledFor.getTime() <= Date.now() ? "Due now. It goes live within five minutes." : null, offlineAt: site.offlineAt,
        published: site.published && site.publishedAt ? { at: site.publishedAt, byName: last?.byName ?? (await this.nameOf(tx, site.publishedBy)), version: last?.number ?? null } : null,
        asked: site.askedAt ? { by: await this.nameOf(tx, site.askedBy), byId: site.askedBy, note: site.askedNote, at: site.askedAt } : null,
        checklist, views30: rows.reduce((a, r) => a + r.views, 0), enquiries30: enq, pages: c.pages.length,
        canPublish: this.can("publish"), canManage: this.can("manage"), homeSlug: HOME_SLUG,
      };
    });
  }

  /** A printable A4 poster: the school's name and a QR code of its address. */
  async poster(address: string): Promise<Uint8Array> {
    if (!/^https?:\/\/[^\s]+$/i.test(address)) throw new ValidationError({ address: "Not a web address" });
    const name = await this.read(this.sees(), async (tx) => (await this.schoolRow(tx)).name);
    const pdf = await PdfBuilder.create({ unicode: true });
    await pdf.need([name, "Scan to visit our website", address]);
    const W = pdf.width;
    const centre = (s: string, size: number, y: number, bold = false) => pdf.textAt(s, { x: (W - pdf.measure(s, size, bold)) / 2, y, size, bold });
    centre(name, 30, pdf.height - 150, true);
    centre("Scan to visit our website", 20, pdf.height - 195);
    pdf.qr(address, { x: (W - 340) / 2, top: pdf.height - 240, size: 340 });
    centre(address.replace(/^https?:\/\//, ""), 22, pdf.height - 620, true);
    centre("Admissions, fees, news and contact", 14, pdf.height - 660);
    return pdf.save();
  }
}
