import { z } from "zod";
import { f } from "@smw/feature-kit";
import { PAGE_TEMPLATE_KEYS } from "@smw/site-templates";

export const pageInput = z.object({
  template: z.enum(PAGE_TEMPLATE_KEYS).default("blank"),
  slug: z.string().trim().toLowerCase().optional(),
  title: z.string().trim().optional(),
});
export const pageUpdateInput = z.object({
  title: z.string().trim(), intro: f.optText(200), seoTitle: f.optText(70), seoDescription: f.optText(200),
  seoImageUrl: z.string().trim().regex(/^(https?:\/\/[^\s]+|\/api\/files\/[^\s\\]+)$/i, "Upload a photo, or use a full link starting with https://").max(500).optional(),
});
export const addressInput = z.object({ slug: z.string().trim().toLowerCase().optional(), title: z.string().trim().optional() });
export const redirectInput = z.object({
  from: z.string().trim().toLowerCase().regex(/^\/[a-z0-9][a-z0-9/_.-]*$/, "Start with / and use letters, numbers and dashes, like /old-page").max(120),
  to: z.string().trim().regex(/^(\/(?![/\\])[^\s\\]*|https:\/\/[^\s]+)$/i, "Use a page like /admissions or a full https:// link").max(300),
});
