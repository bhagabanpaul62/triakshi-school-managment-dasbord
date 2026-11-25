import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { listQuerySchema, SchoolService, toPage, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import notificationsFeature from "./feature";
import { listFilters } from "./inputs";
import { notifications, type Notification } from "./schema";
import { TOPICS, type TopicGroup, type TopicKey } from "./topics";
import { NotificationWriter } from "./writer";

type Perm = keyof typeof notificationsFeature.permissions;

export { NotificationWriter };
export type { Notification };

const UUID = /^[0-9a-f-]{36}$/i;
const topicsOf = (g: TopicGroup) => (Object.keys(TOPICS) as TopicKey[]).filter((k) => TOPICS[k].group === g);

/** The signed-in user's own notifications. Every query is pinned to ctx.userId on top of the school's RLS scope. Reading and read marks work in a read-only school. */
export class NotificationService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private mine = () => eq(notifications.userId, this.ctx.userId);
  private needsAction = () => and(eq(notifications.action, true), isNull(notifications.doneAt));

  /** The bell and the Needs action count in one cheap query. */
  async pulse(): Promise<{ bell: number; needsAction: number }> {
    return this.read("read", async (tx) => {
      const [r] = await tx.select({
        bell: sql<number>`count(*) filter (where ${notifications.readAt} is null)`.mapWith(Number),
        needsAction: sql<number>`count(*) filter (where ${notifications.action} and ${notifications.doneAt} is null)`.mapWith(Number),
      }).from(notifications).where(and(this.mine(), sql`(${notifications.readAt} is null or (${notifications.action} and ${notifications.doneAt} is null))`));
      return { bell: r?.bell ?? 0, needsAction: r?.needsAction ?? 0 };
    });
  }

  /** Newest first, with the unread total (for the bell). */
  async forUser(limit = 10): Promise<{ items: Notification[]; unread: number }> {
    const [items, p] = await Promise.all([
      this.read("read", (tx) => tx.select().from(notifications).where(this.mine()).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(Math.min(Math.max(limit, 1), 50))),
      this.pulse(),
    ]);
    return { items, unread: p.bell };
  }

  /** Paginated list. Filters: `tab` = action (still to do) or all, `unread` = "1", `group` = a topic group. */
  async list(query: ListQuery = {}): Promise<Page<Notification>> {
    const q = listQuerySchema.parse(query);
    const f = listFilters.safeParse(q.filters);
    const { tab, unread, group } = f.success ? f.data : { tab: "all" as const, unread: undefined, group: undefined };
    return this.read("read", async (tx) => {
      const where = and(this.mine(), tab === "action" ? this.needsAction() : undefined, unread ? isNull(notifications.readAt) : undefined,
        group ? inArray(notifications.topic, topicsOf(group)) : undefined);
      const [rows, [total]] = await Promise.all([
        tx.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(notifications).where(where),
      ]);
      return toPage(rows, Number(total?.n ?? 0), q);
    });
  }

  /** Mark one, or "all", as read. Action rows are read but stay in Needs action until their module closes them. Pending pushes and emails for them are dropped. */
  async markRead(target: string | "all"): Promise<{ updated: number }> {
    if (target !== "all" && !UUID.test(target)) return { updated: 0 };
    return this.read("read", async (tx) => {
      const rows = await tx.update(notifications).set({ readAt: sql`now()` })
        .where(and(this.mine(), isNull(notifications.readAt), target === "all" ? undefined : eq(notifications.id, target))).returning({ id: notifications.id });
      if (rows.length) await NotificationWriter.skipReadFor(tx, this.ctx.userId);
      return { updated: rows.length };
    });
  }
}
