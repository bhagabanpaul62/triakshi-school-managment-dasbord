import type { MetadataRoute } from "next";
import { robotsRules } from "@smw/feature-website/ui/sitemap";

export const dynamic = "force-dynamic";
export default function robots(): Promise<MetadataRoute.Robots> { return robotsRules(); }
