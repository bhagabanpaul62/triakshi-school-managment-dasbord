// What Triakshi tells schools: planned work, a problem, solved. The console writes (packages/platform/src/notices.ts); a school reads its own audience.
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { platformNotices, plans, schools, withSchool } from "@smw/db";

export interface ShownNotice { id: string; title: string; body: string; tone: "info" | "warning" | "danger" | "success"; startsAt: Date; endsAt: Date | null }

/** Notices running now for this school: to everyone, to its plan, or to the school itself. Newest first. Anyone signed in may read them. */
export async function activeNotices(schoolId: string, limit = 5, now = new Date()): Promise<ShownNotice[]> {
  return withSchool(schoolId, async (tx) => {
    const [me] = await tx.select({ planKey: plans.key }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(eq(schools.id, schoolId)).limit(1);
    const rows = await tx.select().from(platformNotices).where(and(
      lte(platformNotices.startsAt, now),
      or(isNull(platformNotices.endsAt), gt(platformNotices.endsAt, now)),
      or(
        eq(platformNotices.audience, "all"),
        and(eq(platformNotices.audience, "school"), eq(platformNotices.schoolId, schoolId)),
        me?.planKey ? and(eq(platformNotices.audience, "plan"), eq(platformNotices.planKey, me.planKey)) : undefined,
      ),
    )).orderBy(desc(platformNotices.startsAt)).limit(limit);
    return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, tone: n.tone, startsAt: n.startsAt, endsAt: n.endsAt }));
  });
}
