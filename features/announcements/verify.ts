// The public "this circular is genuine" check. Follows features/fees/verify.ts: the app merges every module's lookups.
import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "@smw/config";
import type { Tx } from "@smw/db";
import { publicAudience } from "./content";
import { announcements } from "./schema";

/** Same shape as the finance check page expects (no import: features stay independent). */
interface VerifyFound { status: string; ok: boolean; number: string; date: string; studentName: string | null; title: string; text: string | null }
type VerifyLookup = (tx: Tx, token: string) => Promise<VerifyFound | null>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Derived, not stored: a reprint of the PDF carries the same QR. Only its hash is kept in the database. */
export const verifyToken = (schoolId: string, noticeId: string) =>
  createHmac("sha256", env().DATA_KEY ?? "local-only-data-key").update(`circular:${schoolId}:${noticeId}`).digest("hex").slice(0, 32);
export const verifyHash = (token: string) => sha(token);

const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const STATUS: Record<string, { status: string; ok: boolean }> = {
  published: { status: "Genuine", ok: true }, expired: { status: "Genuine, no longer current", ok: true }, withdrawn: { status: "Withdrawn by the school", ok: false },
};

/** What the public page may know about a circular: number, date, title and standing. Its text only while it is on the website; never its audience. */
const circularLookup: VerifyLookup = async (tx, token): Promise<VerifyFound | null> => {
  const [n] = await tx.select().from(announcements).where(eq(announcements.verifyHash, verifyHash(token)));
  const s = n && STATUS[n.state];
  const open = !!n && n.state === "published" && n.website && publicAudience(n.audience) && (!n.expiresAt || n.expiresAt > new Date());
  return n?.number && n.publishedAt && s ? { ...s, number: n.number, date: istDay(n.publishedAt), studentName: null, title: n.title, text: open ? n.body : null } : null;
};

export const announcementsVerifyLookups: Record<string, VerifyLookup> = { circular: circularLookup };
