import { z } from "zod";
import { SlugPolicy } from "./slug";

export const BOARDS = ["CBSE", "ICSE", "State board", "IB", "Other"] as const;

/** Indian mobile: optional +91 or 0, then 10 digits starting 6-9. Stored as the 10 digits. */
export const phoneSchema = z.string().trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number.");

/** One printable line: no line breaks, so a name cannot inject email headers. */
const oneLine = (m: string) => z.string().trim().refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), m);

export const signupSchema = z.object({
  name: oneLine("Use plain text only.").min(3, "Enter the school's full name.").max(120),
  adminName: oneLine("Use plain text only.").min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  phone: phoneSchema,
  state: z.string().trim().min(2, "Pick your state."),
  city: z.string().trim().min(2, "Enter your city or town.").max(80),
  board: z.enum(BOARDS, "Pick a board."),
  approxStudents: z.coerce.number().int("Enter a whole number.").min(1, "Enter how many students you have.").max(100_000),
  slug: z.string().trim().toLowerCase().superRefine((v, ctx) => {
    const reason = SlugPolicy.check(v);
    if (reason) ctx.addIssue({ code: "custom", message: reason });
  }),
});
export type SignupInput = z.input<typeof signupSchema>;
export type SignupData = z.output<typeof signupSchema>;
