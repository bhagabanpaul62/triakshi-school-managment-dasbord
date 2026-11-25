import type { MetadataRoute } from "next";
import { HOME_SLUG } from "@smw/site-templates";
import { liveSite } from "./site-page";

/** Pages, notices and events on the main address only, each with the day it last changed. */
export async function sitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const { origin, live, listed, pub } = await liveSite();
  if (!listed || !live) return [];
  const at = live.publishedAt ?? undefined;
  const pages = live.content.pages.filter((p) => !p.hidden && !p.noindex).map((p) => ({
    url: `${origin}${p.slug === HOME_SLUG ? "" : `/${p.slug}`}`, lastModified: p.at ? new Date(p.at) : at, changeFrequency: "weekly" as const, priority: p.slug === HOME_SLUG ? 1 : 0.7,
  }));
  const [news, events] = await Promise.all([pub.news(50), pub.events(50)]);
  return [
    ...pages,
    ...news.map((n) => ({ url: `${origin}/news/${n.id}`, lastModified: n.publishedAt, changeFrequency: "monthly" as const, priority: 0.4 })),
    ...events.filter((e) => !e.id.startsWith("holiday-")).map((e) => ({ url: `${origin}/events/${e.id}`, lastModified: new Date(`${e.startsOn}T00:00:00+05:30`), changeFrequency: "monthly" as const, priority: 0.4 })),
  ];
}

const PRIVATE = ["/app", "/login", "/api", "/support-login", "/reset-password", "/verify-email", "/forgot-password", "/confirm-email", "/unsubscribe"];

/** Open on the main address; closed on every other address, when the school turned search off, and while offline. */
export async function robotsRules(): Promise<MetadataRoute.Robots> {
  const { origin, listed } = await liveSite();
  return listed
    ? { rules: { userAgent: "*", allow: "/", disallow: PRIVATE }, sitemap: `${origin}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } };
}
