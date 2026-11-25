import { z } from "zod";
import { LINK_SECONDS } from "@smw/feature-messages/constants";
import { readJson } from "@smw/runtime/bearer";
import { listQueryFrom, NotFoundError, ValidationError } from "@smw/feature-kit";

/** `?page=2&pageSize=20&q=...` from the request URL, validated like the panel's list pages. */
export const listQueryOf = (req: Request) => listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));

/** Validate `?a=b` query params with a zod schema (422 with field errors on failure). */
export function queryOf<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return parsed(schema, Object.fromEntries(new URL(req.url).searchParams));
}

function parsed<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
  throw new ValidationError(fieldErrors);
}

/** A file as the services take it. */
export interface Upload { name: string; type: string; size: number; bytes: Uint8Array }

/**
 * The body of a write that may carry files. JSON works as before. `multipart/form-data` carries the same JSON in a text part
 * named `json` and the files as parts: `files` (repeat it) or, for a notice answer, `file:<questionId>`. Limits are the services' own.
 */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<{ data: z.infer<S>; files: Upload[]; byName: Record<string, Upload> }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return { data: await readJson(req, schema), files: [], byName: {} };
  }
  let form: FormData;
  try { form = await req.formData(); } catch { throw new ValidationError({ _: "Send a valid multipart body." }); }
  const text = form.get("json");
  let raw: unknown;
  try { raw = JSON.parse(typeof text === "string" ? text : "{}"); } catch { throw new ValidationError({ json: "The json part must be JSON." }); }
  const files: Upload[] = [], byName: Record<string, Upload> = {};
  for (const [key, v] of form.entries()) {
    if (typeof v === "string" || v.size === 0) continue;
    const up = { name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) };
    if (key === "files") files.push(up);
    else if (key.startsWith("file:")) byName[key.slice(5)] = up;
  }
  return { data: parsed(schema, raw), files, byName };
}

/** What a download answers: a link that works for a minute. The app opens it at once and never stores it. */
export const linkOf = (url: string, name?: string) => ({ url, ...(name ? { name } : {}), expiresIn: LINK_SECONDS });

/** Today in India as "YYYY-MM-DD", shifted by `days`. */
export function istDate(days = 0, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Next.js passes dynamic segments as a promise. */
export type IdParams = { params: Promise<{ id: string }> };
export type FileParams = { params: Promise<{ id: string; fileId: string }> };

/** The `[id]` segment. Anything that is not a UUID is a plain 404, never a 500 or a hint about other ids. */
export async function idOf({ params }: { params: Promise<Record<string, string>> }, key = "id"): Promise<string> {
  const id = (await params)[key];
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Record");
  return id;
}
