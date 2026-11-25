import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { CrudService, ForbiddenError, ValidationError, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import announcementsFeature from "./feature";
import { announcementInput } from "./inputs";
import { announcements } from "./schema";

type Perm = keyof typeof announcementsFeature.permissions;
export type Announcement = typeof announcements.$inferSelect;

/** Announcements. Staff see everything; students (the family login) see what is addressed to them. */
export class AnnouncementService extends CrudService<typeof announcements, Perm> {
  protected feature = announcementsFeature;
  protected table = announcements;
  protected entityName = "Announcement";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = announcementInput;
  protected updateSchema = announcementInput;
  protected defaultSort = "publishedAt";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [announcements.title, announcements.body]; }
  protected sortColumns() { return { publishedAt: announcements.publishedAt, title: announcements.title }; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.audience ? eq(announcements.audience, f.audience as Announcement["audience"]) : undefined];
  }
  protected describe(r: Announcement) { return r.title; }

  protected async scopeClause(_tx: Tx): Promise<SQL | undefined> {
    if (this.ctx.role !== "student") return undefined;
    // "parents" means families, who sign in as the student. A class announcement reaches only that class's students.
    // Raw SQL on purpose: this feature does not require students, so it never imports its tables.
    const myClasses = sql`select class_id from students where user_id = ${this.ctx.userId} and status = 'active'`;
    return or(inArray(announcements.audience, ["all", "students", "parents"]), and(eq(announcements.audience, "class"), sql`${announcements.classId} in (${myClasses})`));
  }

  /** Everyone an announcement is addressed to (never the author), by role or, for a class, its students. */
  private async recipients(tx: Tx, a: Announcement): Promise<string[]> {
    if (a.audience === "class") {
      if (!a.classId) return [];
      const rows = await tx.execute<{ uid: string }>(sql`
        select user_id as uid from students where class_id = ${a.classId} and status = 'active' and user_id is not null`);
      return [...rows].map((r) => r.uid);
    }
    const roles = { staff: ["admin", "accountant", "teacher", "staff"], students: ["student"], parents: ["student"] } as const;
    const byRole = a.audience === "all" ? undefined : inArray(users.role, [...roles[a.audience]]);
    return (await tx.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), byRole))).map((u) => u.id);
  }

  protected async afterCreate(tx: Tx, row: Announcement) {
    const ids = (await this.recipients(tx, row)).filter((id) => id !== this.ctx.userId);
    await NotificationWriter.insert(tx, this.ctx.schoolId, ids.map((userId) => ({
      userId, kind: "announcement" as const, title: row.title, body: row.body.slice(0, 200), href: "/app/announcements",
    })));
  }

  /** Only a notice for everyone may go on the public website, and only an admin may put it there. */
  private shape(data: Record<string, unknown>, wasPublic = false) {
    if (data.isPublic && data.audience !== "all") throw new ValidationError({ isPublic: "Only a notice for everyone can go on the website" });
    if (data.isPublic && !wasPublic && this.ctx.role !== "admin") throw new ValidationError({ isPublic: "Only an admin can put a notice on the website" });
    return { ...data, classId: data.audience === "class" ? data.classId : null };
  }
  /** Admins look after every notice; anyone else only their own. */
  private own(row: Announcement) {
    if (this.ctx.role !== "admin" && row.createdBy !== this.ctx.userId) throw new ForbiddenError("Only the person who posted this notice, or an admin, can change it.");
  }
  protected async beforeCreate(_tx: Tx, data: Record<string, unknown>) { return { ...this.shape(data), createdBy: this.ctx.userId }; }
  protected async beforeUpdate(_tx: Tx, existing: Announcement, data: Record<string, unknown>) { this.own(existing); return this.shape(data, existing.isPublic); }
  protected async beforeRemove(_tx: Tx, existing: Announcement) { this.own(existing); }

  /** Classes to pick from when an audience is "one class". Raw SQL: this feature does not require academics. */
  async classOptions() {
    return this.read("read", async (tx) => [...await tx.execute<{ value: string; label: string }>(sql`select id as value, name as label from classes order by display_order, name`)]);
  }

  /** Latest announcements for dashboards (pinned first). */
  async latest(limit = 5) {
    return this.read("read", async (tx) => {
      const scope = await this.scopeClause(tx);
      return tx.select().from(announcements).where(scope).orderBy(desc(announcements.pinned), desc(announcements.publishedAt)).limit(limit);
    });
  }

  /** Public announcements for the school website (no login). Call with a system context. */
  async publicNews(limit = 6) {
    return this.read("read", (tx) => tx.select().from(announcements).where(and(eq(announcements.isPublic, true), eq(announcements.audience, "all"))).orderBy(desc(announcements.publishedAt)).limit(limit));
  }
}
