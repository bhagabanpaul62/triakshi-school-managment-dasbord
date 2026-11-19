import type { MetadataRoute } from "next";
import { env } from "@smw/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = env().MARKETING_URL.replace(/\/$/, "");
  return ["", "/pricing", "/signup", "/privacy", "/terms"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p === "" ? 1 : 0.6 }));
}
