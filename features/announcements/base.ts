import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { AudiencePolicy, type Reach } from "@smw/feature-notifications/policy";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import type { Notice } from "./content";
import announcementsFeature from "./feature";
import { announcements } from "./schema";

/** Not past its end date, by the clock: a notice stops being live the moment its time ends, not when the nightly job gets to it. */
export const notExpired = sql`(${announcements.expiresAt} is null or ${announcements.expiresAt} > now())`;

export type Perm = keyof typeof announcementsFeature.permissions;

/** What every notice service shares: who may see which notice, and who may change it. */
export abstract class NoticeBase extends SchoolService<Perm> {
  protected feature = announcementsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  protected get isManager() { return this.can("manage"); }
  protected get inSupport() { return !!this.ctx.supportStaffId; }
  /** Families answer and read through FeedService; the staff services refuse them. */
  protected staffOnly() { if (this.ctx.role === "student" || this.ctx.role === "parent") throw new ForbiddenError(); }
  /** Answers, reports and private files are never shown to platform staff acting through a support login. */
  protected noSupport() { if (this.inSupport) throw new ForbiddenError("This is not available in a support session."); }

  /** Staff see their own notices, those sent to them, and (approvers) those waiting. Managers see all. */
  protected visible(): SQL | undefined {
    if (this.isManager) return undefined;
    const me = this.ctx.userId;
    return or(
      eq(announcements.createdBy, me),
      sql`exists (select 1 from announcement_recipients r where r.announcement_id = ${announcements.id} and r.user_id = ${me}::uuid and r.removed_at is null)`,
      this.can("approve") ? eq(announcements.state, "waiting") : undefined,
    );
  }

  protected async find(tx: Tx, id: string, lock = false): Promise<Notice> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Notice");
    const q = tx.select().from(announcements).where(and(eq(announcements.id, id), this.visible())).limit(1);
    const [n] = await (lock ? q.for("update") : q);
    if (!n) throw new NotFoundError("Notice");
    return n;
  }

  /** The writer, or an admin / manager. */
  protected own(n: Pick<Notice, "createdBy">) {
    if (!this.isManager && n.createdBy !== this.ctx.userId) throw new ForbiddenError("Only the person who wrote this notice, or an admin, can do this.");
  }

  protected async reach(tx: Tx, audience: Audience, permission: "draft" | "publish"): Promise<Reach> {
    return AudiencePolicy.reach(tx, this.ctx, audience, { feature: this.feature, permission });
  }

  /** People who may approve, by name. Built-in roles follow feature.ts; custom roles follow their grants. */
  protected async approvers(tx: Tx): Promise<{ id: string; name: string }[]> {
    const roles = sql.join(this.feature.permissions.approve.map((r) => sql`${r}`), sql`, `);
    return [...(await tx.execute(sql`select u.id::text as id, u.name from users u left join school_roles r on r.id = u.role_id
      where u.status = 'active' and u.role not in ('student', 'parent')
        and ((u.role_id is null and u.role in (${roles})) or 'announcements:approve' = any(r.grants)) order by u.name`))] as { id: string; name: string }[];
  }

  protected async settings(tx: Tx) { return loadCommSettings(tx); }

  protected fieldError(field: string, message: string): never { throw new ValidationError({ [field]: message }); }
}
