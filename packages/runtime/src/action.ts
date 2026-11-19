// One wrapper for every server action and API handler: AppErrors become clean results, anything else is logged and hidden.
import { AppError } from "@smw/feature-kit";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (err) {
    // Next.js redirect()/notFound() throw on purpose; let them through.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    if (err instanceof AppError) return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors };
    console.error(JSON.stringify({ level: "error", msg: "action failed", err: String(err), stack: (err as Error)?.stack }));
    return { ok: false, error: "Something went wrong. Please try again.", code: "internal" };
  }
}

/** FormData → plain object; empty strings become undefined, repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? (v === "" ? undefined : v) : v;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], val);
    else out[k] = val;
  }
  return out;
}
