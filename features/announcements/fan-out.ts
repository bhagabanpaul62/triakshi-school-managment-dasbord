// From "published" to people: recipients (set based, safe to rerun) and one notification each. Also corrections and late joiners.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withSchool, type Tx } from "@smw/db";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { personKey, type Reached } from "@smw/feature-notifications/audience-rules";
import { commDeliveries, notifications } from "@smw/feature-notifications/schema";
import { NotificationWriter, type NotificationRow } from "@smw/feature-notifications/writer";
import { plain, type Notice } from "./content";
import { giveNumber } from "./lifecycle";
import { announcementRecipients, announcements } from "./schema";

const CHUNK = 1000;
const chunks = <T>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
export const subjectOf = (id: string) => ({ type: "notice", id });
export const noticeHref = (id: string) => `/app/announcements/${id}`;

export type Kind = "new" | "changed" | "remind" | "late" | "removed";
export const NO_LONGER = "This notice is no longer for you";
/** An answer is wanted now: something is asked and the last date has not passed. */
export const asksNow = (n: Notice, now: Date) => n.response.kind !== "none" && !(n.dueAt && n.dueAt <= now);

/** The one notification a person gets for a notice. All kinds share a group key, so an unread one grows a count instead of piling up. */
export function noticeRow(n: Notice, userId: string, kind: Kind, now = new Date()): NotificationRow {
  const asks = asksNow(n, now);
  const base = { userId, subject: subjectOf(n.id), href: noticeHref(n.id), groupKey: `notice:${n.id}`, body: plain(n) };
  switch (kind) {
    case "new": return n.type === "urgent"
      ? { ...base, topic: "urgent.alert", title: `Urgent: ${n.title}`, urgent: true, action: asks }
      : { ...base, topic: asks ? "notice.answer" : "notice.published", title: n.title, action: asks };
    case "late": return { ...base, topic: "notice.published", title: `Last date has passed: ${n.title}`, action: false };
    case "changed": return { ...base, topic: "notice.changed", title: `Updated: ${n.title}` };
    case "remind": return { ...base, topic: "notice.answer", title: `Reminder: ${n.title}`, action: true, urgent: n.type === "urgent" };
    case "removed": return { userId, topic: "notice.changed", title: NO_LONGER, href: "/app/announcements" };
  }
}

/** Notify people, once each. `silent` writes the row in the app but drops the push and email (a late joiner is not woken up). */
export async function tell(tx: Tx, schoolId: string, n: Notice, userIds: string[], kind: Kind, o: { silent?: boolean; now?: Date } = {}): Promise<number> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return 0;
  const written = await NotificationWriter.insert(tx, schoolId, ids.map((id) => noticeRow(n, id, kind, o.now)));
  if (o.silent) {
    for (const part of chunks(ids)) {
      await tx.update(commDeliveries).set({ state: "skipped", reason: "Joined after it was sent" }).where(and(eq(commDeliveries.state, "pending"), inArray(commDeliveries.notificationId,
        tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.subjectType, "notice"), eq(notifications.subjectId, n.id), inArray(notifications.userId, part))))));
    }
  }
  return written;
}

/** Freeze people into recipients. Returns only the ones this call added; the unique key makes a rerun add nobody. */
export async function addRecipients(tx: Tx, schoolId: string, n: Notice, reached: Reached[], o: { joinedLate?: boolean; now?: Date } = {}): Promise<Reached[]> {
  const added: Reached[] = [];
  const now = o.now ?? new Date();
  for (const part of chunks(reached)) {
    const rows = part.map((r) => ({
      schoolId, announcementId: n.id, personKey: personKey(r), userId: r.userId, studentId: r.studentId, name: r.name, label: r.label, sectionId: r.sectionId,
      joinedLate: !!o.joinedLate, seenAt: r.userId && r.userId === n.createdBy ? now : null,
    }));
    const done = new Set((await tx.insert(announcementRecipients).values(rows).onConflictDoNothing().returning({ k: announcementRecipients.personKey })).map((d) => d.k));
    added.push(...part.filter((r) => done.has(personKey(r))));
  }
  return added;
}

const usersOf = (people: Reached[], n: Notice) => people.flatMap((p) => (p.userId && p.userId !== n.createdBy ? [p.userId] : []));

/**
 * Make the recipients and the notifications of a notice that is going out. Runs in one transaction under a row lock, so a rerun
 * (a retry, two workers) finds the people already there and adds nobody. Returns what this run added.
 */
export async function fanOut(schoolId: string, noticeId: string, now = new Date()): Promise<{ recipients: number; notified: number }> {
  return withSchool(schoolId, async (tx) => {
    const [n] = await tx.select().from(announcements).where(eq(announcements.id, noticeId)).for("update");
    if (!n || (n.state !== "sending" && n.state !== "published")) return { recipients: 0, notified: 0 };
    if (n.state === "sending" && n.sendAt && n.sendAt > now) return { recipients: 0, notified: 0 };
    const fresh = await addRecipients(tx, schoolId, n, await resolveAudience(tx, n.audience), { now });
    const notified = await tell(tx, schoolId, n, usersOf(fresh, n), "new", { now });
    if (n.state === "sending") {
      await giveNumber(tx, schoolId, n);
      await tx.update(announcements).set({ state: "published", fannedOutAt: now, updatedAt: now }).where(eq(announcements.id, n.id));
    }
    return { recipients: fresh.length, notified };
  });
}

/** A correction changed who the notice is for: tell the added, close it for the removed, and (if asked) tell everyone else again. */
export async function reconcile(tx: Tx, schoolId: string, n: Notice, o: { notifyAgain: boolean; now?: Date }): Promise<{ added: number; removed: number }> {
  const now = o.now ?? new Date();
  const reached = await resolveAudience(tx, n.audience);
  const keys = new Set(reached.map(personKey));
  const current = await tx.select({ key: announcementRecipients.personKey, userId: announcementRecipients.userId, removedAt: announcementRecipients.removedAt }).from(announcementRecipients).where(eq(announcementRecipients.announcementId, n.id));
  const gone = current.filter((c) => !c.removedAt && !keys.has(c.key));
  const back = current.filter((c) => c.removedAt && keys.has(c.key)).map((c) => c.key);
  const old = new Set(current.filter((c) => !c.removedAt).map((c) => c.key));

  await NotificationWriter.rewrite(tx, schoolId, subjectOf(n.id), { title: n.title, body: plain(n) });
  const goneUsers = [...new Set(gone.flatMap((g) => (g.userId ? [g.userId] : [])))];
  // The rewrite above reaches every row of the notice; the people who lose it must not see the new words.
  for (const part of chunks(goneUsers)) await tx.update(notifications).set({ title: NO_LONGER, body: null })
    .where(and(eq(notifications.schoolId, schoolId), eq(notifications.subjectType, "notice"), eq(notifications.subjectId, n.id), inArray(notifications.userId, part)));
  for (const part of chunks(back)) await tx.update(announcementRecipients).set({ removedAt: null }).where(and(eq(announcementRecipients.announcementId, n.id), inArray(announcementRecipients.personKey, part)));
  const fresh = await addRecipients(tx, schoolId, n, reached, { now });
  const newKeys = new Set([...back, ...fresh.map(personKey)]);
  const added = reached.filter((r) => newKeys.has(personKey(r)));
  for (const part of chunks(gone.map((g) => g.key))) await tx.update(announcementRecipients).set({ removedAt: now }).where(and(eq(announcementRecipients.announcementId, n.id), inArray(announcementRecipients.personKey, part), isNull(announcementRecipients.removedAt)));

  for (const uid of goneUsers) { await NotificationWriter.seen(tx, schoolId, subjectOf(n.id), uid); await NotificationWriter.done(tx, schoolId, subjectOf(n.id), uid); }
  await tell(tx, schoolId, n, goneUsers, "removed");
  await tell(tx, schoolId, n, usersOf(added, n), "new", { now });
  if (o.notifyAgain) await tell(tx, schoolId, n, usersOf(reached.filter((r) => old.has(personKey(r))), n), "changed");
  return { added: added.length, removed: gone.length };
}

/** People who now match a live notice's audience and were never on it (new joiners): added quietly, no push. */
export async function addLateJoiners(tx: Tx, schoolId: string, n: Notice, now = new Date()): Promise<number> {
  const fresh = await addRecipients(tx, schoolId, n, await resolveAudience(tx, n.audience), { joinedLate: true, now });
  await tell(tx, schoolId, n, usersOf(fresh, n), "new", { silent: true, now });
  return fresh.length;
}

/** Close the action rows and bells of everyone, e.g. when a notice expires. */
export const closeForAll = (tx: Tx, schoolId: string, noticeId: string) => NotificationWriter.done(tx, schoolId, subjectOf(noticeId));
