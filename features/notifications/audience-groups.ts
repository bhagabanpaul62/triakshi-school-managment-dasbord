// Saved audiences: "Class 8 science students", "Bus 3 families". Private to their maker, or shared with every teacher.
import { z } from "zod";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, CrudService, ForbiddenError, type Ctx } from "@smw/feature-kit";
import { audienceField } from "./audience-rules";
import notificationsFeature from "./feature";
import { commGroups } from "./schema";

type Perm = keyof typeof notificationsFeature.permissions;
type Group = typeof commGroups.$inferSelect;

const flag = z.preprocess((v) => (v === "1" || v === "on" || v === "true" ? true : v === "0" || v === "false" || v === "" ? false : v), z.boolean());
const name = z.string().trim().min(1, "Give the group a name").max(80);

export class CommGroupService extends CrudService<typeof commGroups, Perm, Group> {
  protected feature = notificationsFeature;
  protected table = commGroups;
  protected entityName = "Group";
  protected createSchema = z.object({ name, audience: audienceField, shared: flag.default(false) });
  protected updateSchema = z.object({ name, audience: audienceField, shared: flag }).partial();
  protected readPermission: Perm = "read";
  protected writePermission: Perm = "read";
  protected override defaultSort = "name";
  constructor(ctx: Ctx) { super(ctx); }

  protected override sortColumns() { return { name: commGroups.name, createdAt: commGroups.createdAt }; }
  protected override searchColumns() { return [commGroups.name]; }
  /** Mine, plus what others shared. */
  protected override async scopeClause(): Promise<SQL | undefined> { this.staffOnly(); return or(eq(commGroups.createdBy, this.ctx.userId), eq(commGroups.shared, true)); }

  /** Sharing and changing someone else's group take notice rights: admin or `announcements:manage`. */
  private canManage = () => this.ctx.role === "admin" || !!this.ctx.grants?.has("announcements:manage");
  private staffOnly() { if (this.ctx.role === "student" || this.ctx.role === "parent") throw new ForbiddenError(); }

  private async free(tx: Tx, n: string, exceptId?: string) {
    const [dup] = await tx.select({ id: commGroups.id }).from(commGroups).where(and(sql`lower(${commGroups.name}) = lower(${n})`, exceptId ? sql`${commGroups.id} <> ${exceptId}::uuid` : undefined)).limit(1);
    if (dup) throw new ConflictError("A group with this name already exists.");
  }

  protected override async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    this.staffOnly();
    if (data.shared && !this.canManage()) throw new ForbiddenError("Only an admin can share a group with everyone.");
    await this.free(tx, String(data.name));
    return { ...data, createdBy: this.ctx.userId };
  }
  protected override async beforeUpdate(tx: Tx, existing: Group, data: Record<string, unknown>) {
    this.staffOnly();
    if (existing.createdBy !== this.ctx.userId && !this.canManage()) throw new ForbiddenError("This group belongs to someone else.");
    if (data.shared && !existing.shared && !this.canManage()) throw new ForbiddenError("Only an admin can share a group with everyone.");
    if (typeof data.name === "string") await this.free(tx, data.name, existing.id);
    return data;
  }
  protected override async beforeRemove(_tx: Tx, existing: Group) {
    this.staffOnly();
    if (existing.createdBy !== this.ctx.userId && !this.canManage()) throw new ForbiddenError("This group belongs to someone else.");
  }
}
