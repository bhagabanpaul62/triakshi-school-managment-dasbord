import { eq, sql } from "drizzle-orm";
import { financialYear, nextSequence, type Tx } from "@smw/db";
import { describeAudience } from "@smw/feature-notifications/audience";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { UNDO_SECONDS } from "./constants";
import { isWebsiteOnly, type Notice } from "./content";
import { announcements } from "./schema";
import { verifyHash, verifyToken } from "./verify";

/** The name of the current academic year ("2026-27"), or the financial year when none is set. */
export async function sessionName(tx: Tx): Promise<string> {
  const [y] = [...(await tx.execute(sql`select name from academic_years where is_current limit 1`))] as { name: string }[];
  return y?.name ?? financialYear();
}

/** "Class 5 A and 2 more", or the website-only words. Re-made whenever the audience is saved. */
export async function labelOf(tx: Tx, c: Pick<Notice, "audience" | "website">): Promise<string> {
  if (!c.audience.include.length) return isWebsiteOnly(c) ? "Website only" : "";
  return describeAudience(tx, c.audience);
}

/**
 * Move a notice into "sending". A circular gets its number here, in the same transaction as the state, so a number is never lost
 * or given twice. A notice that was undone keeps the number it already has. `immediate` skips the undo wait (urgent, send now).
 */
export async function startSending(tx: Tx, schoolId: string, n: Notice, o: { immediate: boolean; now?: Date }): Promise<Notice> {
  const now = o.now ?? new Date();
  let number = n.number;
  if (n.type === "circular" && !number) {
    const settings = await loadCommSettings(tx);
    const seq = await nextSequence(tx, schoolId, `circular:${await sessionName(tx)}`);
    number = settings.circularFormat.replace("{session}", await sessionName(tx)).replace("{n}", String(seq).padStart(3, "0"));
  }
  const [row] = await tx.update(announcements).set({
    state: "sending", number, publishedAt: now, sendAt: o.immediate ? now : new Date(now.getTime() + UNDO_SECONDS * 1000),
    audienceLabel: await labelOf(tx, n), verifyHash: number ? verifyHash(verifyToken(schoolId, n.id)) : n.verifyHash, updatedAt: now,
  }).where(eq(announcements.id, n.id)).returning();
  return row!;
}
