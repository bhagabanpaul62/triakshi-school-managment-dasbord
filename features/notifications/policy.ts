// Who may send to whom. One place for notices, events and message families.
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { allows, ForbiddenError, type Ctx, type FeatureDef } from "@smw/feature-kit";
import { canTargetFeeOverdue, teacherSections } from "./audience";
import type { Audience, AudienceRule } from "./audience-rules";
import { loadCommSettings } from "./settings";

export type Reach = "free" | "approval";

export class AudiencePolicy {
  /** "free": send now. "approval": goes to a reviewer first. Throws ForbiddenError when never allowed. */
  static async reach<P extends string>(tx: Tx, ctx: Ctx, audience: Audience, o: { feature: FeatureDef<P>; permission: P }): Promise<Reach> {
    // Families never target a list: they message through the messages module itself.
    if (ctx.role === "student" || ctx.role === "parent" || !allows(ctx, o.feature, o.permission)) throw new ForbiddenError();
    const all = audience.include.concat(audience.exclude);
    if (all.some((r) => r.type === "fee_overdue") && !canTargetFeeOverdue(ctx)) throw new ForbiddenError("Only the fees team can pick families with dues.");
    if (ctx.role === "admin" || allows(ctx, o.feature, "manage")) return "free";

    const settings = o.feature.key === "announcements" ? await loadCommSettings(tx) : null;
    if (settings) {
      const wholeSchool = audience.include.some((r) => r.type === "everyone"), families = audience.include.some((r) => r.type === "families");
      if ((wholeSchool && settings.approvalFor.wholeSchool) || (families && settings.approvalFor.families)) return "approval";
      if (ctx.role === "teacher" && settings.teacherPublish === "approval") return "approval";
    }
    if (ctx.role !== "teacher") return "free";
    return (await AudiencePolicy.isOwn(tx, ctx.userId, audience, 0)) ? "free" : "approval";
  }

  /** True when every include rule stays inside the teacher's own sections (or is a saved group made only of those). */
  private static async isOwn(tx: Tx, userId: string, audience: Audience, depth: number): Promise<boolean> {
    const mine = new Set(await teacherSections(tx, userId));
    const own = async (r: AudienceRule): Promise<boolean> => {
      switch (r.type) {
        case "section": return mine.has(r.id);
        case "subject": return !!r.sectionId && mine.has(r.sectionId);
        case "teachers_of": return !!r.sectionId && mine.has(r.sectionId);
        case "student": return (await rowsOf(tx, sql`select section_id::text as s from students where id = ${r.id}::uuid and status = 'active'`)).some((x) => mine.has(x.s));
        case "class": {
          const secs = await rowsOf(tx, sql`select id::text as s from sections where class_id = ${r.id}::uuid and year_id in (select id from academic_years where is_current)`);
          return secs.length > 0 && secs.every((x) => mine.has(x.s));
        }
        case "group": {
          if (depth > 0) return false;
          const [g] = await rowsOf<{ a: Audience }>(tx, sql`select audience as a from comm_groups where id = ${r.id}::uuid`);
          return !!g && (await AudiencePolicy.isOwn(tx, userId, g.a, 1));
        }
        default: return false;
      }
    };
    for (const r of audience.include) if (!(await own(r))) return false;
    return audience.include.length > 0;
  }
}

const rowsOf = async <T = { s: string }>(tx: Tx, q: ReturnType<typeof sql>) => [...(await tx.execute(q))] as T[];
