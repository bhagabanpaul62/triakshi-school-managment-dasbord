import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, max, sql, type SQL } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { channelsFor, priorityOf, type GroupPrefs } from "./channels";
import { LEGACY_KIND_TOPIC, type NotificationRow } from "./inputs";
import { commDeliveries, commSettings, notificationPrefs, notifications } from "./schema";

export type { NotificationRow };
const CHUNK = 1000;
/** A grouped row that keeps growing pushes again only after this long, unless it is urgent. */
const PUSH_GAP_MS = 5 * 60_000;
const READ_IN_APP = "Already read in the app";

const chunks = <T>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
// Links stay inside the app; anything else is dropped rather than rendered as a link.
const safeHref = (h?: string) => (h && /^\/app(\/|$)/.test(h) && !h.includes("//") ? h.slice(0, 300) : null);

/**
 * How other features tell people something, inside their own transaction, so it appears if and only if the change commits.
 *   await NotificationWriter.insert(tx, ctx.schoolId, ids.map((userId) => ({ userId, topic: "fees.due", title: "Fee due", href: "/app/fees" })));
 */
export class NotificationWriter {
  /** The school's default channels per group (comm_settings). */
  static async schoolDefaults(tx: Tx): Promise<GroupPrefs> {
    const [s] = await tx.select({ settings: commSettings.settings }).from(commSettings).limit(1);
    return (s?.settings?.channelDefaults ?? {}) as GroupPrefs;
  }

  /** Returns how many rows went to active people of this school. */
  static async insert(tx: Tx, schoolId: string, rows: NotificationRow[]): Promise<number> {
    if (!rows.length) return 0;
    const defaults = await this.schoolDefaults(tx);
    let written = 0;
    for (const part of chunks(rows)) written += await this.insertChunk(tx, schoolId, part, defaults);
    return written;
  }

  private static async insertChunk(tx: Tx, schoolId: string, part: NotificationRow[], defaults: GroupPrefs): Promise<number> {
    const ids = [...new Set(part.map((r) => r.userId))];
    // Only active people of this school: a user id from another school must never get a row.
    const ok = new Set((await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.status, "active"), inArray(users.id, ids)))).map((u) => u.id));
    const mine = part.filter((r) => ok.has(r.userId));
    if (!mine.length) return 0;

    // Rows with one group key and person become one row with a count (a single statement cannot upsert the same row twice).
    const merged = new Map<string, { row: NotificationRow; n: number }>();
    for (const [i, row] of mine.entries()) {
      const k = row.groupKey ? `${row.userId}\u0000${row.groupKey}` : `#${i}`;
      merged.set(k, { row, n: (merged.get(k)?.n ?? 0) + 1 });
    }
    const items = [...merged.values()].map(({ row, n }) => ({ row, n, id: randomUUID() as string, topic: row.topic ?? LEGACY_KIND_TOPIC[row.kind] }));

    const saved = await tx.insert(notifications).values(items.map(({ row, n, id, topic }) => ({
      id, schoolId, userId: row.userId, topic, title: row.title.slice(0, 160), body: row.body?.slice(0, 1000) ?? null, href: safeHref(row.href),
      subjectType: row.subject?.type ?? null, subjectId: row.subject?.id ?? null, groupKey: row.groupKey ?? null, count: n,
      action: row.action ?? false, urgent: row.urgent ?? false, privateBody: row.privateBody ?? false,
    }))).onConflictDoUpdate({
      target: [notifications.schoolId, notifications.userId, notifications.groupKey],
      targetWhere: sql`${notifications.groupKey} is not null and ${notifications.readAt} is null and ${notifications.doneAt} is null`,
      set: {
        count: sql`${notifications.count} + excluded.count`, title: sql`excluded.title`, body: sql`excluded.body`, href: sql`excluded.href`,
        urgent: sql`${notifications.urgent} or excluded.urgent`, createdAt: sql`now()`, updatedAt: sql`now()`,
      },
    }).returning({ id: notifications.id, userId: notifications.userId, groupKey: notifications.groupKey, count: notifications.count });

    const prefs = new Map((await tx.select({ userId: notificationPrefs.userId, groups: notificationPrefs.groups }).from(notificationPrefs).where(inArray(notificationPrefs.userId, [...ok]))).map((p) => [p.userId, p.groups]));
    const fresh = new Map(items.map((x) => [x.id, x]));
    const grown = saved.filter((s) => !fresh.has(s.id));
    const lastPush = new Map(grown.length
      ? (await tx.select({ id: commDeliveries.notificationId, at: max(commDeliveries.createdAt) }).from(commDeliveries)
        .where(and(inArray(commDeliveries.notificationId, grown.map((g) => g.id)), eq(commDeliveries.channel, "push"))).groupBy(commDeliveries.notificationId)).map((l) => [l.id, l.at] as const)
      : []);

    const now = new Date();
    const due: (typeof commDeliveries.$inferInsert)[] = [];
    for (const s of saved) {
      const item = fresh.get(s.id) ?? items.find((x) => x.row.userId === s.userId && x.row.groupKey === s.groupKey)!;
      const ch = channelsFor(item.topic, prefs.get(s.userId), defaults);
      const base = { schoolId, userId: s.userId, notificationId: s.id, priority: priorityOf(item.topic, item.row.urgent), nextAt: item.row.deliverAfter ?? now };
      if (fresh.has(s.id)) {
        if (ch.push) due.push({ ...base, sourceKey: `notification:${s.id}`, channel: "push", mode: "instant" });
        if (ch.email !== "off") due.push({ ...base, sourceKey: `notification:${s.id}`, channel: "email", mode: ch.email });
      } else {
        // A row that grew keeps its email (the digest reads the newest text); only the phone gets another tap, and not too often.
        const last = lastPush.get(s.id);
        if (ch.push && (item.row.urgent || !last || now.getTime() - last.getTime() > PUSH_GAP_MS)) due.push({ ...base, sourceKey: `notification:${s.id}:${s.count}`, channel: "push", mode: "instant" });
      }
    }
    for (const d of chunks(due)) await tx.insert(commDeliveries).values(d).onConflictDoNothing();
    return mine.length;
  }

  /** Drop the pending push and email of every read notification in `scope`: nobody is told about what they already saw. */
  private static async skipRead(tx: Tx, scope: SQL | undefined) {
    await tx.update(commDeliveries).set({ state: "skipped", reason: READ_IN_APP })
      .where(and(eq(commDeliveries.state, "pending"), inArray(commDeliveries.notificationId, tx.select({ id: notifications.id }).from(notifications).where(and(isNotNull(notifications.readAt), scope)))));
  }

  private static aboutSubject(schoolId: string, subject: { type: string; id: string }, userId?: string) {
    return and(eq(notifications.schoolId, schoolId), eq(notifications.subjectType, subject.type), eq(notifications.subjectId, subject.id), userId ? eq(notifications.userId, userId) : undefined);
  }

  /** The thing was opened: mark its notifications read (one person, or everyone when `userId` is left out) and drop their pending sends. */
  static async seen(tx: Tx, schoolId: string, subject: { type: string; id: string }, userId?: string): Promise<number> {
    const where = this.aboutSubject(schoolId, subject, userId);
    const rows = await tx.update(notifications).set({ readAt: sql`now()` }).where(and(where, isNull(notifications.readAt))).returning({ id: notifications.id });
    await this.skipRead(tx, where);
    return rows.length;
  }

  /** The work is finished (by whoever did it): close action rows, and read them too. */
  static async done(tx: Tx, schoolId: string, subject: { type: string; id: string }, userId?: string): Promise<number> {
    const where = this.aboutSubject(schoolId, subject, userId);
    const rows = await tx.update(notifications).set({ doneAt: sql`now()`, readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(where, eq(notifications.action, true), isNull(notifications.doneAt))).returning({ id: notifications.id });
    await this.skipRead(tx, where);
    return rows.length;
  }

  /** The thing changed (a corrected notice): show the new words everywhere, in the app, in pushes and in emails not yet sent. */
  static async rewrite(tx: Tx, schoolId: string, subject: { type: string; id: string }, text: { title: string; body?: string | null }): Promise<number> {
    const rows = await tx.update(notifications).set({ title: text.title.slice(0, 160), body: text.body?.slice(0, 1000) ?? null, updatedAt: sql`now()` })
      .where(this.aboutSubject(schoolId, subject)).returning({ id: notifications.id });
    return rows.length;
  }

  /** Same skip for a person's own read marks in the bell (service.markRead). */
  static skipReadFor(tx: Tx, userId: string) { return this.skipRead(tx, eq(notifications.userId, userId)); }
}
