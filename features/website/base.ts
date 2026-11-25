import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { plans, schoolRoles, schools, users, type Tx } from "@smw/db";
import { NotFoundError, SchoolService } from "@smw/feature-kit";
import { siteSettingsOf, starterSite } from "@smw/site-templates";
import websiteFeature from "./feature";
import { schoolSites, type enquiries } from "./schema";

export type Perm = keyof typeof websiteFeature.permissions;
/** Public path of a stored file; the key after it is `<schoolId>/<area>/...`. */
export const PHOTO_URL = "/api/files/";
export type SiteRow = typeof schoolSites.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;

/** Where this school's website files live in storage. */
export const siteFolder = (schoolId: string) => `${schoolId}/public/site/`;
/** The storage key behind a file address (any `?v=` is dropped), or null when it is not a stored file. */
export const keyOfUrl = (url: string) => (url.startsWith(PHOTO_URL) ? url.slice(PHOTO_URL.length).split(/[?#]/)[0]! : null);
/** Today in India as "YYYY-MM-DD". */
export const istToday = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Shared by every website service: the feature, plan limits and the school's own row. */
export abstract class WebsiteService extends SchoolService<Perm> {
  protected feature = websiteFeature;

  /** Whether the person may see the Website rooms at all: reading, editing and publishing each imply it. One rule for every screen and preview. */
  canSee(): boolean { return this.can("read") || this.can("manage") || this.can("publish"); }
  /** The permission a read goes through: the first of read, edit, publish that the person holds. */
  protected sees(): Perm { return (["read", "manage", "publish"] as const).find((p) => this.can(p)) ?? "read"; }

  protected async schoolRow(tx: Tx) {
    const [row] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    if (!row) throw new NotFoundError("School");
    return row;
  }

  /** The plan's `limits` json ({} when the school has no plan). */
  protected async planLimits(tx: Tx, planId: string | null): Promise<Record<string, number | boolean>> {
    if (!planId) return {};
    const [p] = await tx.select({ limits: plans.limits }).from(plans).where(eq(plans.id, planId)).limit(1);
    return p?.limits ?? {};
  }

  /**
   * The site row. `lock` takes the row `for update`, so two people saving at once go one after the other and the
   * second reads what the first wrote. A school that never opened the editor gets the default site, saved when `create`.
   */
  protected async siteRow(tx: Tx, o: { create: boolean; lock?: boolean }): Promise<SiteRow> {
    const find = () => {
      const q = tx.select().from(schoolSites).where(eq(schoolSites.schoolId, this.ctx.schoolId)).limit(1);
      return o.lock ? q.for("update") : q;
    };
    const [row] = await find();
    if (row) return row;
    const draft = starterSite("classic", await this.schoolRow(tx));
    if (!o.create) return {
      id: "", schoolId: this.ctx.schoolId, templateKey: "classic", draft, draftAt: null, draftBy: null, published: null, publishedTemplateKey: null, publishedAt: null, publishedBy: null,
      scheduled: null, scheduledTemplateKey: null, scheduledFor: null, scheduledBy: null, askedAt: null, askedBy: null, askedNote: null, offlineAt: null,
      settings: siteSettingsOf({}), createdAt: new Date(), updatedAt: new Date(),
    };
    // Two first openings at once: one insert wins, the other reads it.
    await tx.insert(schoolSites).values({ schoolId: this.ctx.schoolId, templateKey: "classic", draft }).onConflictDoNothing();
    const [made] = await find();
    return made!;
  }

  /** Active people who hold a website permission: the default roles for it, and custom roles that were given it. */
  protected async holdersOf(tx: Tx, perm: Perm): Promise<{ id: string; name: string }[]> {
    const defaults = [...(this.feature.permissions[perm] ?? [])];
    return tx.select({ id: users.id, name: users.name }).from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
      .where(and(eq(users.status, "active"), or(and(isNull(users.roleId), defaults.length ? inArray(users.role, defaults) : sql`false`), sql`${`website:${perm}`} = any(${schoolRoles.grants})`)));
  }

  protected async nameOf(tx: Tx, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? null;
  }
}
