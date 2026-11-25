import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { after } from "next/server";
import { cache, type ReactNode } from "react";
import { SESSION_COOKIE, actionCtx, getSchool, primaryRedirect } from "@smw/runtime";
import { requestHost } from "@smw/runtime/host";
import { siteCss } from "@smw/themes";
import {
  HOME_SLUG, TEMPLATE_KEYS, breadcrumbLd, firstMarkdownImage, istDay, mk, privacyText, schoolLd, shareImage, siteSettingsOf,
  type Page, type SiteContent, type SiteSettings, type TemplateKey,
} from "@smw/site-templates";
import { env } from "@smw/config";
import { EMPTY_DATA, SiteMarkdown, SiteView, Wrap, type SiteData, type SiteViewProps } from "@smw/site-templates/render";
import { markdownToText } from "@smw/ui/markdown";
import { PublicEnquiryService, PublicSiteService, SiteService, countable, originOf, type PublicEventDetail, type PublicNotice } from "../service";
import { LivePreview } from "./live-preview";
import { PreviewLinks } from "./preview-links";
import { homeAlias, pageOf, pickView } from "./site-routes";
import { submitEnquiry } from "./public-actions";

type Params = { slug?: string[] };
type Search = Record<string, string | string[] | undefined>;
type School = Awaited<ReturnType<typeof getSchool>>;

interface Site { content: SiteContent; templateKey: TemplateKey; settings: SiteSettings; preview: boolean; offline: boolean }

/** What to show: the draft for anyone who may read the website and asked for ?preview=1 (W4), else the published site. */
const loadSite = cache(async (preview: boolean | number): Promise<Site | null> => {
  const school = await getSchool();
  if (preview) {
    const ctx = await actionCtx().catch(() => null);
    // SiteService.get() itself refuses a person without website:read, so no role is named here.
    const row = ctx && ctx.schoolId === school.id ? await new SiteService(ctx).get().catch(() => null) : null;
    // `?preview=1&version=N`: a saved version (Website, Versions) instead of the draft.
    const v = row && typeof preview === "number" ? await new SiteService(ctx!).previewContent({ version: preview }).catch(() => null) : null;
    if (row && v) return { content: v.content, templateKey: v.templateKey, settings: siteSettingsOf(row.settings), preview: true, offline: false };
    if (row) return { content: row.draft as SiteContent, templateKey: row.templateKey as TemplateKey, settings: siteSettingsOf(row.settings), preview: true, offline: false };
  }
  const live = await PublicSiteService.forSchool(school.id, school.features).published();
  return live ? { content: live.content, templateKey: live.templateKey, settings: live.settings, preview: false, offline: !!live.offlineAt } : null;
});

type View =
  | { k: "page"; page: Page }
  | { k: "news"; items: SiteData["news"] }
  | { k: "newsItem"; item: PublicNotice & { withdrawn: boolean } }
  | { k: "events"; items: SiteData["events"] }
  | { k: "eventItem"; item: PublicEventDetail & { cancelled: boolean } }
  | { k: "privacy" };

type Resolved =
  | { t: "redirect"; to: string; permanent: boolean }
  | { t: "soon"; school: School }
  | { t: "missing"; school: School }
  | { t: "offline"; school: School; site: Site }
  | { t: "ok"; school: School; site: Site; view: View; path: string; host: string };

const flag = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isPreview = (s: Search): boolean | number => (flag(s.preview) === "1" ? Number(flag(s.version)) || true : false);
const pathOf = (parts: string[]) => `/${parts.join("/")}`;

/** Which page is it, and is there anything to show? Cached per request so the metadata and the page agree. */
const resolve = cache(async (key: string, preview: boolean | number): Promise<Resolved> => {
  const parts = key ? key.split("/") : [];
  const school = await getSchool();
  const site = await loadSite(preview);
  const host = requestHost(await headers());
  const path = pathOf(parts);
  // "/home" is the home page under a second address: one address only, for search engines and shared links.
  if (homeAlias(parts, !!site?.preview)) return { t: "redirect", to: "/", permanent: true };
  if (!site) return parts.length === 0 ? { t: "soon", school } : { t: "missing", school };
  if (site.offline && !site.preview) return { t: "offline", school, site };
  const pub = PublicSiteService.forSchool(school.id, school.features);
  const picked = pickView(parts, site.content.pages, site.preview);
  let view: View | null = null;
  if (picked?.k === "page") view = { k: "page", page: site.content.pages.find((p) => p.slug === picked.slug)! };
  else if (picked?.k === "news") view = { k: "news", items: (await pub.news(50)) as SiteData["news"] };
  else if (picked?.k === "events") view = { k: "events", items: await pub.events(50) };
  else if (picked?.k === "privacy") view = { k: "privacy" };
  else if (picked?.k === "newsItem") { const item = await pub.newsItem(picked.id); view = item ? { k: "newsItem", item } : null; }
  else if (picked?.k === "eventItem") { const item = await pub.eventItem(picked.id); view = item ? { k: "eventItem", item } : null; }
  if (!view) {
    // An old address leaves a permanent redirect before any "not found".
    const to = await pub.redirectFor(path);
    return to ? { t: "redirect", to: to.to, permanent: to.permanent } : { t: "missing", school };
  }
  return { t: "ok", school, site, view, path, host };
});

const partsOf = (p: Params) => (p.slug ?? []).map((s) => s.toLowerCase());
const mainHost = (school: School, host: string) => school.primaryHost ?? host;
const originFor = (school: School, host: string) => {
  const h = mainHost(school, host);
  return `${/^(localhost|127\.|.*\.localhost)(:|$)/.test(h) ? "http" : "https"}://${h}`;
};
const secondary = (school: School, host: string) => !!school.primaryHost && host.split(":")[0]!.toLowerCase() !== school.primaryHost.toLowerCase();

const day = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
function eventWhen(e: PublicEventDetail): string {
  const s = e.startsAt, en = e.endsAt;
  if (e.allDay) return en && istDay(en) !== istDay(s) ? `${day(s)} to ${day(en)}` : day(s);
  if (!en) return `${day(s)}, ${time(s)}`;
  return istDay(en) === istDay(s) ? `${day(s)}, ${time(s)} to ${time(en)}` : `${day(s)}, ${time(s)} to ${day(en)}, ${time(en)}`;
}
const short = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : undefined);

/** Title, description, page object and the extra content of a generated page (news, events, privacy). */
function generated(school: School, v: Exclude<View, { k: "page" }>) {
  const row = school.row;
  const base = { seo: {}, sections: [] as Page["sections"] };
  switch (v.k) {
    case "news": return { page: { ...base, slug: "news", title: "News and notices", intro: "What is happening at the school.", sections: v.items.length ? [mk("news", { heading: "Latest first", limit: 50 })] : [] } as Page, description: `News and notices from ${school.name}.`, empty: v.items.length ? null : "No notices have been published yet. Please check back soon." };
    case "events": return { page: { ...base, slug: "events", title: "Events and holidays", intro: "What is coming up.", sections: v.items.length ? [mk("events", { heading: "Coming up", limit: 50 })] : [] } as Page, description: `Events and holidays at ${school.name}.`, empty: v.items.length ? null : "No events are listed right now. Please check back soon." };
    case "newsItem": return v.item.withdrawn
      ? { page: { ...base, slug: "news", title: "Notice withdrawn", intro: "This notice was withdrawn.", noindex: true } as Page, description: "This notice was withdrawn.", empty: null }
      : { page: { ...base, slug: "news", title: v.item.title, intro: short(v.item.publishedAt) } as Page, description: markdownToText(v.item.body, 160), empty: null };
    case "eventItem": return { page: { ...base, slug: "events", title: v.item.title, intro: v.item.cancelled ? "This event was cancelled." : eventWhen(v.item) } as Page, description: v.item.description ? markdownToText(v.item.description, 160) : `${v.item.title} at ${school.name}, ${eventWhen(v.item)}.`, empty: null };
    case "privacy": return { page: { ...base, slug: "privacy", title: "Privacy notice", intro: `How ${school.name} looks after the details you send through this website.` } as Page, description: `Privacy notice of ${school.name}.`, empty: null, text: privacyText({ name: school.name, email: row.email, phone: row.phone, address: row.address }) };
  }
}

const trailOf = (v: View) => (v.k === "newsItem" ? { label: "News and notices", href: "/news" } : v.k === "eventItem" ? { label: "Events and holidays", href: "/events" } : undefined);

export async function generateSiteMetadata(params: Params, searchParams: Search = {}): Promise<Metadata> {
  const r = await resolve(partsOf(params).join("/"), isPreview(searchParams));
  if (r.t === "redirect") return {};
  if (r.t !== "ok") return { title: r.school.name, robots: { index: false, follow: false } };
  const { school, site, view, path, host } = r;
  const g = view.k === "page" ? null : generated(school, view);
  const page = view.k === "page" ? view.page : g!.page;
  const title = view.k === "page" ? (page.seo.title || (page.slug === HOME_SLUG ? school.name : `${page.title} | ${school.name}`)) : `${page.title} | ${school.name}`;
  const description = (view.k === "page" ? page.seo.description || page.intro : g!.description) || undefined;
  // A notice or event with a picture in its text shares that picture; otherwise the page's own, then the home hero, then the logo.
  const heroOf = (c: SiteContent["pages"][number] | undefined) => { const h = c?.sections.find((x) => x.type === "hero" && !x.hidden); return h?.type === "hero" ? h.data.imageUrl : undefined; };
  const image = shareImage({
    item: view.k === "newsItem" && !view.item.withdrawn ? firstMarkdownImage(view.item.body) : view.k === "eventItem" ? firstMarkdownImage(view.item.description) : undefined,
    page: page.seo.imageUrl, hero: heroOf(page) ?? heroOf(site.content.pages.find((p) => p.slug === HOME_SLUG)), logo: school.logoUrl,
  });
  const origin = originFor(school, host);
  const canonical = `${origin}${path === "/" ? "" : path}`;
  const hide = secondary(school, host) || !site.settings.indexed || !!page.noindex || site.preview || (view.k === "newsItem" && view.item.withdrawn);
  return {
    metadataBase: new URL(origin), title, description,
    alternates: { canonical },
    robots: hide ? { index: false, follow: false } : undefined,
    openGraph: { title, description, siteName: school.name, type: view.k === "page" ? "website" : "article", url: canonical, locale: "en_IN", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
    icons: school.theme.faviconUrl ? { icon: school.theme.faviconUrl } : undefined,
  };
}

/** A plain, school-coloured page for "on its way" and "being updated": no menu, one clear sentence. */
function Plain({ school, title, body, phone, children }: { school: School; title: string; body: string; phone?: string | null; children?: ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", background: "var(--site-background)", color: "var(--site-text)", fontFamily: "system-ui, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: siteCss(school.theme) }} />
      <div style={{ maxWidth: 480 }}>
        <p style={{ margin: 0, fontWeight: 600, color: "var(--site-muted-text)" }}>{school.name}</p>
        <h1 style={{ fontSize: 32, margin: "8px 0 0" }}>{title}</h1>
        <p style={{ color: "var(--site-muted-text)", margin: "10px 0 24px", fontSize: 17 }}>{body}</p>
        {phone ? <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, background: "var(--site-fill)", color: "var(--site-on-primary)", padding: "0 24px", borderRadius: 999, textDecoration: "none", fontWeight: 600, marginRight: 8 }}>Call the school office</a> : null}
        {children}
      </div>
    </main>
  );
}

const profileOf = (school: School) => {
  const r = school.row;
  return {
    name: r.name, affiliationNo: r.affiliationNo, schoolCode: r.schoolCode, email: r.email, phone: r.phone,
    address: [r.address, r.city, r.state, r.pincode].filter(Boolean).join(", ") || null,
    head: [r.headName, r.headQualification].filter(Boolean).join(", ") || null,
  };
};

/** The page a visitor sees. Rendered by `/` and `/[...slug]`. */
export async function renderSite(params: Params, searchParams: Search) {
  const parts = partsOf(params);
  const preview = isPreview(searchParams);
  const school = await getSchool();
  const h = await headers();
  const host = requestHost(h);
  const search = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string])))).toString();
  // The school's main address is the only one search engines and families should use (D1).
  const toMain = preview ? null : primaryRedirect({
    host, freeHost: `${school.slug}.${env().ROOT_DOMAIN}`, primaryHost: school.primaryHost, redirect: school.row.redirectToPrimary, path: `${pathOf(parts)}${search ? `?${search}` : ""}`,
  });
  if (toMain) permanentRedirect(toMain.location);

  const r = await resolve(parts.join("/"), preview);
  // An address change made it (308); one typed by hand can be pointed elsewhere later (307).
  if (r.t === "redirect") return r.permanent ? permanentRedirect(r.to) : redirect(r.to);
  if (r.t === "missing") notFound();
  if (r.t === "soon") return <Plain school={r.school} title="Our website is on its way" body="We are getting everything ready." phone={r.school.row.phone}><a href="/login" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 24px", borderRadius: 999, textDecoration: "none", fontWeight: 600, boxShadow: "inset 0 0 0 2px var(--site-primary)", color: "var(--site-primary-text)" }}>Staff sign in</a></Plain>;
  if (r.t === "offline") return <Plain school={r.school} title="Our website is being updated" body={r.site.settings.offlineMessage || "We are making some changes. Please check back soon."} phone={r.school.row.phone} />;

  const { site, view, path } = r;
  // An admin previewing the draft can see any design without saving it.
  const t = flag(searchParams.template);
  const templateKey = site.preview && TEMPLATE_KEYS.includes(t as TemplateKey) ? (t as TemplateKey) : site.templateKey;
  const pub = PublicSiteService.forSchool(school.id, school.features);
  const schoolProps = { name: school.name, logoUrl: school.logoUrl };

  if (view.k === "page" && site.preview && flag(searchParams.live) === "1") {
    const [news, events, staff] = await Promise.all([pub.news(12), pub.events(12), pub.staff(24)]);
    return <LivePreview school={schoolProps} theme={school.theme} settings={site.settings} data={{ news, events, staff }} initial={{ content: site.content, slug: view.page.slug, template: templateKey }} />;
  }

  // One more view, after the response is sent: not for bots, previews or people signed in, and never able to fail the page.
  const signedIn = (await cookies()).has(SESSION_COOKIE);
  if (countable({ userAgent: h.get("user-agent"), preview: site.preview, signedIn })) {
    const origin = originOf(h.get("referer"), [host, school.primaryHost]);
    after(() => PublicSiteService.forSchool(school.id, school.features).countView(path, origin));
  }

  // In a preview every link to another page keeps the preview (and the version) in the address.
  const keep = site.preview ? <PreviewLinks query={typeof preview === "number" ? `preview=1&version=${preview}` : "preview=1"} /> : null;
  const origin = originFor(school, host);
  const url = (p: string) => `${origin}${p === "/" ? "" : p}`;
  const common: Omit<SiteViewProps, "slug"> = {
    school: schoolProps, template: templateKey, theme: school.theme, content: site.content, enquiry: submitEnquiry, settings: site.settings, profile: profileOf(school), preview: site.preview,
  };
  const sameAs = Object.values(site.settings.social).filter((x): x is string => !!x);
  const row = school.row;
  const home = schoolLd({ name: school.name, url: url("/"), logo: school.logoUrl, phone: row.phone, email: row.email, sameAs, address: { street: row.address, city: row.city, state: row.state, pin: row.pincode } });

  if (view.k === "page") {
    const page = view.page;
    const types = new Set(page.sections.filter((s) => !s.hidden).map((s) => s.type));
    const [news, events, staff] = await Promise.all([
      types.has("news") ? pub.news(12) : [], types.has("events") ? pub.events(12) : [], types.has("staff") ? pub.staff(24) : [],
    ]);
    const shown = page.sections.filter((x) => !x.hidden);
    const enq = PublicEnquiryService.forSchool(school.id, school.features);
    const forms = Object.fromEntries(await Promise.all(shown.flatMap((x) => (x.type === "admission_form" ? [enq.options(x.data.classes).then((o) => [x.id, o] as const)] : []))));
    const alt = await pub.altFor(page, [school.logoUrl]);
    const data: SiteData = { ...EMPTY_DATA, news, events, staff, forms, alt };
    const ld = page.slug === HOME_SLUG ? [home] : [home, breadcrumbLd([{ name: "Home", url: url("/") }, { name: page.title, url: url(path) }])];
    return <>{keep}<SiteView {...common} slug={page.slug} data={data} jsonLd={ld} /></>;
  }

  const g = generated(school, view);
  const trail = trailOf(view);
  const ld = [breadcrumbLd([{ name: "Home", url: url("/") }, ...(trail ? [{ name: trail.label, url: url(trail.href) }] : []), { name: g.page.title, url: url(path) }])];
  // The lists open twelve at a time: ?page=2 for the next twelve.
  const listed = view.k === "news" ? view.items.length : view.k === "events" ? view.items.length : 0;
  const { page: pageNo, pages, from, to } = pageOf(listed, flag(searchParams.page));
  const slice = <T,>(items: T[]) => items.slice(from, to);
  const data: SiteData = { ...EMPTY_DATA, news: view.k === "news" ? slice(view.items) : [], events: view.k === "events" ? slice(view.items) : [], alt: {} };
  const pager = pages > 1 ? (
    <nav aria-label="Pages of the list" className="st-actions" style={{ marginTop: 24 }}>
      {pageNo > 1 ? <a className="st-btn st-ghost" href={`${path}${pageNo > 2 ? `?page=${pageNo - 1}` : ""}`}>Newer</a> : null}
      <span style={{ alignSelf: "center" }}>Page {pageNo} of {pages}</span>
      {pageNo < pages ? <a className="st-btn st-ghost" href={`${path}?page=${pageNo + 1}`}>Older</a> : null}
    </nav>
  ) : null;
  return (
    <>{keep}<SiteView {...common} slug={g.page.slug} page={g.page} data={data} trail={trail} jsonLd={ld}>
      {g.empty ? <Wrap id="empty" type="empty"><p className="st-empty">{g.empty}</p></Wrap> : null}
      {pager ? <Wrap id="pager" type="pager">{pager}</Wrap> : null}
      {view.k === "newsItem" ? <Wrap id="notice" type="notice">{view.item.withdrawn ? <p className="st-empty">This notice was withdrawn by the school. <a href="/news">See all notices</a></p> : <SiteMarkdown source={view.item.body} />}</Wrap> : null}
      {view.k === "eventItem" ? (
        <Wrap id="event" type="event">
          <dl className="st-facts">
            <div><dt>When</dt><dd>{eventWhen(view.item)}</dd></div>
            {view.item.location ? <div><dt>Where</dt><dd>{view.item.location}</dd></div> : null}
            {view.item.mapUrl && /^https:\/\//i.test(view.item.mapUrl) ? <div><dt>Map</dt><dd><a href={view.item.mapUrl} target="_blank" rel="noopener noreferrer">Open the map<span className="st-sr"> (opens in a new tab)</span></a></dd></div> : null}
          </dl>
          {view.item.cancelled ? <p className="st-empty">This event was cancelled. <a href="/events">See upcoming events</a></p> : null}
          {view.item.description ? <SiteMarkdown source={view.item.description} /> : null}
        </Wrap>
      ) : null}
      {"text" in g && g.text ? <Wrap id="privacy" type="privacy"><SiteMarkdown source={g.text} /></Wrap> : null}
    </SiteView></>
  );
}

/** The school's own 404: its menu and its enquiry button, so a wrong link is never a dead end. */
export async function SiteNotFound() {
  const school = await getSchool();
  const site = await loadSite(false);
  if (!site || site.offline) {
    return <Plain school={school} title="Page not found" body="This page does not exist or was moved." phone={school.row.phone}><a href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 24px", borderRadius: 999, textDecoration: "none", fontWeight: 600, boxShadow: "inset 0 0 0 2px var(--site-primary)", color: "var(--site-primary-text)" }}>Go to the home page</a></Plain>;
  }
  const page: Page = { slug: "not-found", title: "Page not found", intro: "This page does not exist or was moved.", seo: {}, noindex: true, sections: [] };
  const apply = site.content.pages.some((p) => p.slug === "admissions" && !p.hidden);
  return (
    <SiteView school={{ name: school.name, logoUrl: school.logoUrl }} template={site.templateKey} theme={school.theme} content={site.content} slug="not-found" page={page}
      enquiry={submitEnquiry} settings={site.settings} profile={profileOf(school)}>
      <Wrap id="lost" type="lost">
        <p className="st-empty">Try the menu above, or start from the home page.</p>
        <div className="st-actions"><a className="st-btn" href="/">Go to the home page</a>{apply ? <a className="st-btn st-ghost" href="/admissions">Apply for admission</a> : null}</div>
      </Wrap>
    </SiteView>
  );
}

/** Sitemap and robots need the same "what is live, and on which address" answer. */
export async function liveSite() {
  const school = await getSchool();
  const host = requestHost(await headers());
  const origin = originFor(school, host);
  const paused = school.status === "suspended" || school.status === "cancelled";
  const pub = PublicSiteService.forSchool(school.id, school.features);
  const live = paused ? null : await pub.published();
  // Only the main address is listed; a secondary address, a site switched off, or one taken offline lists nothing.
  const listed = !!live && !secondary(school, host) && live.settings.indexed && !live.offlineAt;
  return { origin, live, listed, pub, school };
}

export default async function SitePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  return renderSite(await params, await searchParams);
}
export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  return generateSiteMetadata(await params, await searchParams);
}
