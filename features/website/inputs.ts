import { z } from "zod";
import { f } from "@smw/feature-kit";
import { PAGE_TEMPLATE_KEYS } from "@smw/site-templates";
import { ENQUIRY_STATUSES } from "./schema";

/** A public admission enquiry. `website` is the honeypot: real visitors never see or fill it. */
export const enquiryInput = z.object({
  studentName: f.text(2, 100, "Enter the child's name"),
  dob: f.optDate(),
  classApplying: f.optText(40),
  parentName: f.text(2, 100, "Enter the parent's name"),
  phone: f.phone(),
  email: f.optEmail(),
  message: f.optText(1000),
  website: f.optText(200),
});

/** Staff adding an enquiry by hand (a phone call, a walk-in). */
export const manualEnquiryInput = enquiryInput.omit({ website: true }).extend({ source: z.enum(["phone", "walk-in", "referral", "website"]).default("walk-in") });

export const enquiryUpdateInput = z.object({
  status: z.enum(ENQUIRY_STATUSES),
  notes: f.optText(2000),
});

export const pageInput = z.object({
  template: z.enum(PAGE_TEMPLATE_KEYS).default("blank"),
  slug: z.string().trim().toLowerCase().optional(),
  title: z.string().trim().optional(),
});
export const pageUpdateInput = z.object({ title: z.string().trim(), intro: f.optText(200), seoTitle: f.optText(70), seoDescription: f.optText(200) });
