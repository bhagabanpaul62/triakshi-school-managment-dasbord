import { z } from "zod";
import { f } from "@smw/feature-kit";
import { COPY_STATUSES } from "./schema";

export const bookInput = z.object({
  title: f.text(2, 200, "Enter the title"),
  author: f.text(2, 120, "Enter the author"),
  isbn: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).replace(/[\s-]/g, "")), z.string().regex(/^(\d{9}[\dXx]|\d{13})$/, "ISBN has 10 or 13 digits").optional()),
  publisher: f.optText(120),
  category: f.text(2, 60, "Pick a category"),
  language: f.optText(40),
});

/** Copies added together with a new book (or later). */
export const copiesInput = z.object({
  copies: z.preprocess((v) => (v == null || v === "" ? 1 : v), z.coerce.number().int().min(1, "Add at least 1 copy").max(50, "Add up to 50 copies at a time")),
  shelf: f.optText(40),
});

export const copyStatusInput = z.object({ status: z.enum(COPY_STATUSES.filter((s) => s !== "issued") as ["available", "lost", "damaged"]) });

export const issueInput = z.object({
  copyId: f.id("Choose the copy"),
  studentId: f.optId(),
  /** Admission number typed at the desk. */
  admissionNo: f.optText(40),
  /** A staff member. */
  userId: f.optId(),
  issuedOn: f.optDate(),
}).refine((v) => [v.studentId, v.admissionNo, v.userId].filter(Boolean).length === 1, { message: "Enter an admission number or pick a staff member", path: ["admissionNo"] });

export const settingsInput = z.object({
  loanDays: z.coerce.number().int().min(1, "At least 1 day").max(90, "At most 90 days"),
  studentLimit: z.coerce.number().int().min(1, "At least 1 book").max(20, "At most 20 books"),
  staffLimit: z.coerce.number().int().min(1, "At least 1 book").max(50, "At most 50 books"),
  /** In rupees on the form; stored as paise. */
  finePerDay: z.coerce.number().min(0, "Cannot be negative").max(1000, "At most 1000 rupees a day"),
  renewalsAllowed: z.coerce.number().int().min(0, "Cannot be negative").max(5, "At most 5 renewals"),
});
