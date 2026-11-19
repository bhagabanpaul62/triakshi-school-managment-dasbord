import type { MetadataRoute } from "next";
import { livePaths, siteOrigin } from "./site-page";

export async function sitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const [origin, paths] = await Promise.all([siteOrigin(), livePaths()]);
  return paths.map((p) => ({ url: `${origin}${p === "/" ? "" : p}`, changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.7 }));
}

export async function robotsRules(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app", "/login", "/api", "/support-login", "/reset-password", "/verify-email"] }, sitemap: `${origin}/sitemap.xml` };
}
