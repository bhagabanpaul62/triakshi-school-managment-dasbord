import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "@smw/config";
import { withConsole, type Tx } from "@smw/db";
import { emailSuppressions } from "./schema";

export type Suppression = (typeof emailSuppressions.$inferSelect)["reason"];

/** Words for the office: why mail to this address stopped. */
export const SUPPRESSION_TEXT: Record<Suppression, string> = {
  bounced: "The mailbox refused our mail. Check the address.",
  spam: "The person marked our mail as spam.",
  invalid: "This is not a working address.",
};

/** SMTP answers that mean the address itself is bad. 535 (our login) or 552 (full mailbox) are not. */
const ADDRESS_REFUSED = new Set([550, 551, 553, 554]);
export const isAddressRefusal = (err: unknown) => ADDRESS_REFUSED.has(Number((err as { responseCode?: number })?.responseCode));

export const suppress = (tx: Tx, schoolId: string, address: string, reason: Suppression) =>
  tx.insert(emailSuppressions).values({ schoolId, address: address.trim(), reason }).onConflictDoNothing();

/** Which of these addresses mail must not go to (lower-case). Pass a tx scoped to the school, or a console tx. */
export async function suppressedAmong(tx: Tx, schoolId: string, addresses: string[]): Promise<Set<string>> {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!list.length) return new Set();
  const rows = [...(await tx.execute(sql`select lower(address) as a from email_suppressions where school_id = ${schoolId} and lower(address) in (${sql.join(list.map((a) => sql`${a}`), sql`, `)})`))] as { a: string }[];
  return new Set(rows.map((r) => r.a));
}

/** Is mail to this address stopped? For the record pages ("Email not working"); `tx` is a school tx, so only this school's list is seen. */
export async function isSuppressed(tx: Tx, address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  const [r] = [...(await tx.execute(sql`select 1 as x from email_suppressions where lower(address) = ${address.trim().toLowerCase()} limit 1`))];
  return !!r;
}

/**
 * A provider told us an address bounced, was reported as spam or is invalid. The provider knows no school, so every
 * school that holds this address (a login or a primary guardian) stops mailing it. Returns how many schools.
 */
export async function suppressEverywhere(address: string, reason: Suppression): Promise<number> {
  const a = address.trim().toLowerCase();
  if (!a || !a.includes("@")) return 0;
  return withConsole(async (tx) => {
    const guardians = [...(await tx.execute(sql`select to_regclass('guardians') is not null as ok`))] as { ok: boolean }[];
    const rows = [...(await tx.execute(guardians[0]?.ok
      ? sql`select school_id from users where lower(email) = ${a} union select school_id from guardians where lower(email) = ${a}`
      : sql`select school_id from users where lower(email) = ${a}`))] as { school_id: string }[];
    for (const r of rows) await suppress(tx, r.school_id, a, reason);
    return rows.length;
  });
}

/** The office fixed the address: mail may go again. */
export const unsuppress = (tx: Tx, schoolId: string, address: string) =>
  tx.execute(sql`delete from email_suppressions where school_id = ${schoolId} and lower(address) = ${address.trim().toLowerCase()}`);

// ---------- the provider's webhook (Brevo) ----------

/** Brevo event names that mean "stop mailing this address". A soft bounce is temporary and is ignored. */
const EVENTS: Record<string, Suppression> = { hard_bounce: "bounced", blocked: "bounced", spam: "spam", complaint: "spam", invalid_email: "invalid", invalid: "invalid" };

/** Compare secrets without leaking where they differ: hash both, then compare the fixed-size digests. */
export const sameSecret = (given: string, expected: string) =>
  timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());

/** POST from the mail provider. The secret comes in the x-webhook-secret header or as a Bearer token, never in the URL (URLs are logged). Repeats are harmless. */
export async function mailWebhook(req: Request): Promise<Response> {
  const expected = env().MAIL_WEBHOOK_SECRET;
  const given = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !sameSecret(given, expected)) return Response.json({ error: "Not allowed" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Not JSON" }, { status: 400 }); }
  let handled = 0;
  for (const e of (Array.isArray(body) ? body : [body]) as { event?: string; email?: string }[]) {
    const reason = EVENTS[String(e?.event ?? "").toLowerCase()];
    if (reason && typeof e.email === "string") handled += await suppressEverywhere(e.email, reason) > 0 ? 1 : 0;
  }
  return Response.json({ ok: true, handled });
}
