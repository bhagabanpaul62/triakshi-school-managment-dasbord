import type { MetadataRoute } from "next";
import { env } from "@smw/config";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${env().MARKETING_URL.replace(/\/$/, "")}/sitemap.xml` };
}
