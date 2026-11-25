// A person's secret calendar link. The link carries a random 128-bit token; only its hash is stored.
import { randomBytes } from "node:crypto";
import { sha256 } from "@smw/feature-kit/secret";
import { and, eq, schoolRoles, sql, users, withSchool } from "@smw/db";
import { SchoolService, type Ctx } from "@smw/feature-kit";
import { noSupport } from "./access";
import eventsFeature from "./feature";
import { calendarFeeds } from "./schema";

type Perm = keyof typeof eventsFeature.permissions;
const SHAPE = /^[A-Za-z0-9_-]{22}$/;
export const feedPath = (token: string) => `/api/calendar/${token}.ics`;

export class CalendarFeedService extends SchoolService<Perm> {
  protected feature = eventsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Whether the person has a link, and when a phone last used it. The link itself cannot be shown again. */
  async mine(): Promise<{ active: boolean; lastUsedAt: Date | null }> {
    return this.read("read", async (tx) => {
      const [f] = await tx.select({ at: calendarFeeds.lastUsedAt }).from(calendarFeeds).where(eq(calendarFeeds.userId, this.ctx.userId));
      return { active: !!f, lastUsedAt: f?.at ?? null };
    });
  }

  /** A new link. The old one stops working at once. The token is returned here and nowhere else. */
  async reset(): Promise<{ token: string }> {
    noSupport(this.ctx);
    const token = randomBytes(16).toString("base64url");
    await this.write("read", (tx) => tx.insert(calendarFeeds).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, tokenHash: sha256(token) })
      .onConflictDoUpdate({ target: [calendarFeeds.schoolId, calendarFeeds.userId], set: { tokenHash: sha256(token), lastUsedAt: null, updatedAt: new Date() } }),
      () => ({ action: "calendar-link", entity: "Calendar link", summary: "Made a new phone calendar link" }));
    return { token };
  }

  async revoke(): Promise<void> {
    noSupport(this.ctx);
    await this.write("read", (tx) => tx.delete(calendarFeeds).where(eq(calendarFeeds.userId, this.ctx.userId)));
  }
}

export interface FeedOwner { userId: string; role: Ctx["role"]; name: string; grants?: ReadonlySet<string> }

/** Who a link belongs to, or null (no such link, or the person is no longer active). Never says which. */
export async function feedOwner(schoolId: string, token: string): Promise<FeedOwner | null> {
  if (!SHAPE.test(token)) return null;
  return withSchool(schoolId, async (tx) => {
    const [r] = await tx.select({ u: users, g: schoolRoles.grants, at: calendarFeeds.lastUsedAt, id: calendarFeeds.id }).from(calendarFeeds)
      .innerJoin(users, eq(users.id, calendarFeeds.userId)).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
      .where(and(eq(calendarFeeds.tokenHash, sha256(token)), eq(users.status, "active")));
    if (!r || r.u.role === "parent") return null;
    if (!r.at || Date.now() - r.at.getTime() > 3_600_000) await tx.update(calendarFeeds).set({ lastUsedAt: sql`now()` }).where(eq(calendarFeeds.id, r.id));
    return { userId: r.u.id, role: r.u.role, name: r.u.name, grants: r.g && r.u.role !== "admin" ? new Set(r.g) : undefined };
  });
}
