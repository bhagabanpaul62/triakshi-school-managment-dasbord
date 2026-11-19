import { and, eq, inArray } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { notifications } from "./schema";
import type { NotificationPayload } from "./inputs";

/**
 * Framework-free helper for other features: add notifications inside the caller's own transaction,
 * so they appear if and only if the change that caused them commits.
 *   await NotificationWriter.insert(tx, ctx.schoolId, parentIds.map((userId) => ({ userId, kind: "fee_due", title: "Fee due", href: "/app/fees" })));
 */
export class NotificationWriter {
  static async insert(tx: Tx, schoolId: string, rows: ({ userId: string } & NotificationPayload)[]): Promise<number> {
    if (!rows.length) return 0;
    // Only people of this school: a user id from another school must never get a row (the console-side digest would email it).
    const ids = [...new Set(rows.map((r) => r.userId))];
    const ok = new Set((await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, schoolId), inArray(users.id, ids)))).map((u) => u.id));
    const mine = rows.filter((r) => ok.has(r.userId));
    if (!mine.length) return 0;
    await tx.insert(notifications).values(mine.map((r) => ({
      schoolId, userId: r.userId, kind: r.kind ?? "system", title: r.title.slice(0, 160), body: r.body?.slice(0, 1000) ?? null,
      // Links stay inside the app; anything else is dropped rather than rendered as a link.
      href: r.href && /^\/app(\/|$)/.test(r.href) && !r.href.includes("//") ? r.href.slice(0, 300) : null,
    })));
    return mine.length;
  }
}
