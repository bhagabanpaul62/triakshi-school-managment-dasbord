import { and, desc, eq, gt, isNull, lte, or, platformNotices, plans, schools } from "@smw/db";
import { NotFoundError, PlatformService, ValidationError } from "@smw/feature-kit";
import { assertId, noticeInput } from "./inputs";

export type NoticeState = "upcoming" | "running" | "ended";

/** When a notice is shown: `upcoming` before it starts, `running` now, `ended` after its end. */
export function noticeState(n: { startsAt: Date; endsAt: Date | null }, now = new Date()): NoticeState {
  return n.startsAt > now ? "upcoming" : n.endsAt && n.endsAt <= now ? "ended" : "running";
}

/** Messages from Triakshi to schools: planned work, a problem, solved. A school sees those for everyone, for its plan, or for itself, as a strip across its panel. */
export class NoticeService extends PlatformService {
  /** Newest first, with where each one stands and who it is for. Filter `state`. */
  async list(state?: NoticeState) {
    this.require("owner", "support", "sales");
    const now = new Date();
    return this.tx(async (tx) => {
      const rows = await tx.select({ n: platformNotices, school: schools.name }).from(platformNotices).leftJoin(schools, eq(schools.id, platformNotices.schoolId)).orderBy(desc(platformNotices.startsAt)).limit(200);
      return rows.map(({ n, school }) => ({ ...n, school, state: noticeState(n, now) })).filter((n) => !state || n.state === state);
    });
  }

  /** Write one. `startsAt` defaults to now; with no end it runs until ended by hand. */
  async create(input: unknown) {
    this.require("owner", "support");
    const d = this.parse(noticeInput, input);
    const startsAt = d.startsAt ?? new Date();
    if (d.endsAt && d.endsAt <= startsAt) throw new ValidationError({ endsAt: "The end must be after the start" });
    return this.tx(async (tx) => {
      if (d.audience === "plan") {
        if (!d.planKey) throw new ValidationError({ planKey: "Choose a plan" });
        const [p] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.key, d.planKey)).limit(1);
        if (!p) throw new ValidationError({ planKey: "That plan does not exist" });
      }
      if (d.audience === "school") {
        if (!d.schoolId) throw new ValidationError({ schoolId: "Choose a school" });
        const [s] = await tx.select({ id: schools.id }).from(schools).where(eq(schools.id, d.schoolId)).limit(1);
        if (!s) throw new NotFoundError("School");
      }
      const [n] = await tx.insert(platformNotices).values({
        title: d.title, body: d.body, tone: d.tone, audience: d.audience, planKey: d.audience === "plan" ? d.planKey! : null, schoolId: d.audience === "school" ? d.schoolId! : null,
        startsAt, endsAt: d.endsAt ?? null, createdBy: this.ctx.staffId,
      }).returning();
      await this.audit(tx, "notice.create", `Posted notice "${n!.title}" to ${d.audience === "all" ? "every school" : d.audience === "plan" ? `plan ${d.planKey}` : "one school"}`, n!.schoolId, { noticeId: n!.id });
      return n!;
    });
  }

  /** End it now: schools stop seeing it at once. */
  async end(id: string) {
    this.require("owner", "support");
    assertId(id, "Notice");
    return this.tx(async (tx) => {
      const now = new Date();
      const [n] = await tx.update(platformNotices).set({ endsAt: now }).where(and(eq(platformNotices.id, id), or(isNull(platformNotices.endsAt), gt(platformNotices.endsAt, now)), lte(platformNotices.startsAt, now))).returning();
      if (n) { await this.audit(tx, "notice.end", `Ended notice "${n.title}"`, n.schoolId, { noticeId: id }); return n; }
      // Not started yet, or already over: a notice that has not started is removed; one that ended is left as the record.
      const [d] = await tx.delete(platformNotices).where(and(eq(platformNotices.id, id), gt(platformNotices.startsAt, now))).returning();
      if (!d) throw new NotFoundError("A running notice");
      await this.audit(tx, "notice.delete", `Removed notice "${d.title}" before it started`, d.schoolId, { noticeId: id });
      return d;
    });
  }
}
