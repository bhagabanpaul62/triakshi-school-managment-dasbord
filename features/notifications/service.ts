import { and, count, desc, eq, isNull } from "drizzle-orm";
import { listQuerySchema, SchoolService, toPage, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import notificationsFeature from "./feature";
import { notificationPayload } from "./inputs";
import { notificationPrefs, notifications, type Notification } from "./schema";
import { NotificationWriter } from "./writer";

type Perm = keyof typeof notificationsFeature.permissions;

export { NotificationWriter };
export type { Notification };

/** The signed-in user's own notifications. Every query is pinned to ctx.userId on top of the school's RLS scope. */
export class NotificationService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private mine = () => eq(notifications.userId, this.ctx.userId);

  /** Newest first, with the unread total (for the bell). */
  async forUser(limit = 10): Promise<{ items: Notification[]; unread: number }> {
    return this.read("read", async (tx) => {
      const [items, [u]] = await Promise.all([
        tx.select().from(notifications).where(this.mine()).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(Math.min(Math.max(limit, 1), 50)),
        tx.select({ n: count() }).from(notifications).where(and(this.mine(), isNull(notifications.readAt))),
      ]);
      return { items, unread: Number(u?.n ?? 0) };
    });
  }

  /** Paginated list for the full page. `filters.unread = "1"` shows unread only. */
  async list(query: ListQuery = {}): Promise<Page<Notification>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = and(this.mine(), q.filters.unread === "1" ? isNull(notifications.readAt) : undefined);
      const [rows, [total]] = await Promise.all([
        tx.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(notifications).where(where),
      ]);
      return toPage(rows, Number(total?.n ?? 0), q);
    });
  }

  /**
   * Mark one notification, or "all", as read. Uses a read-mode scope on purpose: it only touches the caller's own
   * rows, so it keeps working in a read-only school.
   */
  async markRead(target: string | "all"): Promise<{ updated: number }> {
    return this.read("read", async (tx) => {
      const where = and(this.mine(), isNull(notifications.readAt), target === "all" ? undefined : eq(notifications.id, target));
      if (target !== "all" && !/^[0-9a-f-]{36}$/i.test(target)) return { updated: 0 };
      const rows = await tx.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
      return { updated: rows.length };
    });
  }

  /** Notify other users from this service (inside `tx` when the caller has one). */
  async notify(userIds: string[], payload: unknown, tx?: Tx): Promise<number> {
    this.authorize("send", "write");
    const p = this.parse(notificationPayload, payload);
    const rows = [...new Set(userIds)].map((userId) => ({ userId, ...p }));
    return tx ? NotificationWriter.insert(tx, this.ctx.schoolId, rows) : this.write("send", (t) => NotificationWriter.insert(t, this.ctx.schoolId, rows));
  }

  async emailDigestEnabled(): Promise<boolean> {
    return this.read("read", async (tx) => {
      const [p] = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, this.ctx.userId)).limit(1);
      return p?.emailDigest ?? true;
    });
  }

  async setEmailDigest(enabled: boolean): Promise<{ emailDigest: boolean }> {
    return this.read("read", async (tx) => {
      await tx.insert(notificationPrefs).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, emailDigest: enabled })
        .onConflictDoUpdate({ target: [notificationPrefs.schoolId, notificationPrefs.userId], set: { emailDigest: enabled } });
      return { emailDigest: enabled };
    });
  }
}
