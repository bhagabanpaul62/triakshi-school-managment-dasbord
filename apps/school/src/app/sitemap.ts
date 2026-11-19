import type { MetadataRoute } from "next";
import { sitemapEntries } from "@smw/feature-website/ui/sitemap";

export const dynamic = "force-dynamic";
export default function sitemap(): Promise<MetadataRoute.Sitemap> { return sitemapEntries(); }
