import { z } from "zod";
import { listQueryFrom, ValidationError } from "@smw/feature-kit";

/** `?page=2&pageSize=20&q=...` from the request URL, validated like the panel's list pages. */
export const listQueryOf = (req: Request) => listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));

/** Validate `?a=b` query params with a zod schema (422 with field errors on failure). */
export function queryOf<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const r = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
  throw new ValidationError(fieldErrors);
}

/** Today in India as "YYYY-MM-DD", shifted by `days`. */
export function istDate(days = 0, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
