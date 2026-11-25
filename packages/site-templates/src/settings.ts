/** Things about the whole site that apply at once, not with a publish. Pure. */
import { z } from "zod";

const link = z.string().trim().regex(/^(\/(?![/\\])[^\s\\]*|https?:\/\/[^\s]+)$/i, "Use a page like /admissions or a full https:// link").max(500);
const https = z.string().trim().regex(/^https:\/\/[^\s]+$/i, "Use a full link starting with https://").max(300).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const SOCIALS = ["facebook", "instagram", "youtube", "x", "linkedin"] as const;

export const siteSettingsSchema = z.object({
  notice: z.object({ text: z.string().trim().max(160), href: link.optional(), tone: z.enum(["info", "important"]).default("info"), from: day, until: day }).optional(),
  social: z.partialRecord(z.enum(SOCIALS), https).default({}),
  /** Round buttons on a phone. */
  callNumber: z.string().trim().max(20).optional(),
  whatsapp: z.string().trim().max(20).optional(),
  showDirections: z.boolean().default(false),
  /** Search engines may list the site. */
  indexed: z.boolean().default(true),
  /** User ids of teachers the site must not name. */
  hiddenStaff: z.array(z.string()).max(500).default([]),
  /** The school has looked at who is named on the site (set when the teachers list is saved). */
  teachersChecked: z.boolean().default(false),
  offlineMessage: z.string().trim().max(300).optional(),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

/** A damaged or empty row reads as the defaults. */
export const siteSettingsOf = (raw: unknown): SiteSettings => {
  const r = siteSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : siteSettingsSchema.parse({});
};
