import { eq, sql } from "drizzle-orm";
import { financialYear, nextSequence, type Tx } from "@smw/db";
import { describeAudience, expandGroups } from "@smw/feature-notifications/audience";
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
 * Move a notice into "sending". Saved groups are written out as their rules now, so a group edited later changes nothing.
 * The circular number is not given here: it is given when the undo window ends (see `giveNumber`), so an undone circular uses none.
 */
export async function startSending(tx: Tx, n: Notice, o: { immediate: boolean; now?: Date }): Promise<Notice> {
  const now = o.now ?? new Date();
  const [row] = await tx.update(announcements).set({
    state: "sending", publishedAt: now, sendAt: o.immediate ? now : new Date(now.getTime() + UNDO_SECONDS * 1000),
    audience: await expandGroups(tx, n.audience), audienceLabel: await labelOf(tx, n), updatedAt: now,
  }).where(eq(announcements.id, n.id)).returning();
  return row!;
}

/**
 * A circular's number, given in the same transaction that sends it out, so a number is never lost, skipped or given twice.
 * Returns the notice as it stands after.
 */
export async function giveNumber(tx: Tx, schoolId: string, n: Notice): Promise<Notice> {
  if (n.type !== "circular" || n.number) return n;
  const session = await sessionName(tx);
  const seq = await nextSequence(tx, schoolId, `circular:${session}`);
  const number = (await loadCommSettings(tx)).circularFormat.replace("{session}", session).replace("{n}", String(seq).padStart(3, "0"));
  const token = verifyToken(schoolId, n.id);
  const [row] = await tx.update(announcements).set({ number, verifyHash: token ? verifyHash(token) : null }).where(eq(announcements.id, n.id)).returning();
  return row!;
}
