import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { actionCtx, getSchool } from "@smw/runtime";
import { siteCss } from "@smw/themes";
import { HOME_SLUG, TEMPLATE_KEYS, type SiteContent, type TemplateKey } from "@smw/site-templates";
import { EMPTY_DATA, SiteView, type SiteData } from "@smw/site-templates/render";
import { PublicSiteService, SiteService } from "../service";
import { LivePreview } from "./live-preview";
import { submitEnquiry } from "./public-actions";

type Params = { slug?: string[] };
type Search = Record<string, string | string[] | undefined>;

/** What to show: the published site, or the draft for a signed-in admin who asked for ?preview=1. */
async function load(school: Awaited<ReturnType<typeof getSchool>>, preview: boolean) {
  if (preview) {
    const ctx = await actionCtx().catch(() => null);
    if (ctx?.role === "admin" && ctx.schoolId === school.id) {
      const row = await new SiteService(ctx).get().catch(() => null);
      if (row) return { content: row.draft as SiteContent, templateKey: row.templateKey as TemplateKey, preview: true };
    }
  }
  const live = await PublicSiteService.forSchool(school.id, school.features).published();
  return live ? { content: live.content, templateKey: live.templateKey, preview: false } : null;
}

const slugOf = (p: Params) => {
  const parts = p.slug ?? [];
  if (parts.length > 1) notFound();
  return parts[0]?.toLowerCase() || HOME_SLUG;
};

export async function generateSiteMetadata(params: Params): Promise<Metadata> {
  const school = await getSchool();
  const site = await load(school, false);
  const page = site?.content.pages.find((p) => p.slug === slugOf(params));
  if (!site || !page) return { title: school.name };
  const title = page.seo.title || (page.slug === HOME_SLUG ? school.name : `${page.title} | ${school.name}`);
  const hero = page.sections.find((s) => s.type === "hero");
  const image = (hero?.type === "hero" ? hero.data.imageUrl : undefined) ?? school.logoUrl ?? undefined;
  return {
    title, description: page.seo.description,
    openGraph: { title, description: page.seo.description, siteName: school.name, type: "website", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description: page.seo.description },
    icons: school.theme.faviconUrl ? { icon: school.theme.faviconUrl } : undefined,
  };
}

/** The page a visitor sees. Rendered by `/` and `/[...slug]`. */
export async function renderSite(params: Params, searchParams: Search) {
  const school = await getSchool();
  const slug = slugOf(params);
  const preview = (Array.isArray(searchParams.preview) ? searchParams.preview[0] : searchParams.preview) === "1";
  const site = await load(school, preview);
  // An admin previewing the draft can see any design without saving it.
  const t = Array.isArray(searchParams.template) ? searchParams.template[0] : searchParams.template;
  if (site?.preview && TEMPLATE_KEYS.includes(t as TemplateKey)) site.templateKey = t as TemplateKey;

  if (!site) {
    if (slug !== HOME_SLUG) notFound();
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", background: "var(--site-background)", color: "var(--site-text)", fontFamily: "system-ui, sans-serif" }}>
        <style dangerouslySetInnerHTML={{ __html: siteCss(school.theme) }} />
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>{school.name}</h1>
          <p style={{ color: "var(--site-muted-text)", margin: "8px 0 24px" }}>Our website is on its way.</p>
          <a href="/login" style={{ display: "inline-block", background: "var(--site-primary)", color: "#fff", padding: "12px 24px", borderRadius: 999, textDecoration: "none", fontWeight: 600 }}>Staff sign in</a>
        </div>
      </main>
    );
  }

  const page = site.content.pages.find((p) => p.slug === slug);
  if (!page) notFound();

  const pub = PublicSiteService.forSchool(school.id, school.features);
  // The editor's preview frame: the draft is redrawn in the browser as the admin types, so it needs every list up front.
  if (site.preview && searchParams.live === "1") {
    const [news, events, staff] = await Promise.all([pub.news(12), pub.events(12), pub.staff(24)]);
    return <LivePreview school={{ name: school.name, logoUrl: school.logoUrl }} theme={school.theme} data={{ news, events, staff }} initial={{ content: site.content, slug, template: site.templateKey }} />;
  }

  const types = new Set(page.sections.map((s) => s.type));
  const [news, events, staff] = await Promise.all([
    types.has("news") ? pub.news(12) : [], types.has("events") ? pub.events(12) : [], types.has("staff") ? pub.staff(24) : [],
  ]);
  const data: SiteData = { ...EMPTY_DATA, news, events, staff };

  return <SiteView school={{ name: school.name, logoUrl: school.logoUrl }} template={site.templateKey} theme={school.theme} content={site.content} slug={slug} data={data} enquiry={submitEnquiry} preview={site.preview} />;
}

/** Sitemap entries and robots rules need the same "what is live" answer. */
export async function livePaths(): Promise<string[]> {
  const school = await getSchool();
  if (school.status === "suspended" || school.status === "cancelled") return [];
  const live = await PublicSiteService.forSchool(school.id, school.features).published();
  return live ? live.content.pages.map((p) => (p.slug === HOME_SLUG ? "/" : `/${p.slug}`)) : ["/"];
}

export async function siteOrigin() {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|.*\.localhost)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function SitePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  return renderSite(await params, await searchParams);
}
export async function generateMetadata({ params }: { params: Promise<Params> }) {
  return generateSiteMetadata(await params);
}
