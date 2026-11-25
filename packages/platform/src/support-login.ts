import { and, eq, schools, supportVisits, users } from "@smw/db";
import { SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { ForbiddenError, NotFoundError, PlatformService, ValidationError, supportMayEnter } from "@smw/feature-kit";
import { assertId, supportLoginInput } from "./inputs";

export const SUPPORT_TOKEN_MINUTES = 5;
const EMERGENCY_REASON_MIN = 20;

export { supportMayEnter };

/** What the console says to staff when the school said no. */
export function supportRefusal(s: { supportAccess: string; supportAccessUntil: Date | null }): string {
  return s.supportAccess === "until"
    ? "This school allowed Triakshi to sign in only for a limited time, and that time is over. Ask the school's administrator to allow it again in Settings. An owner can enter in an emergency, with a written reason."
    : "This school has asked that Triakshi does not sign in. Ask the school's administrator to allow it in Settings. An owner can enter in an emergency, with a written reason.";
}

/**
 * Staff open a school's panel as one of its users: a 5-minute single-use token that the school app turns into a 30-minute session.
 * Read-only unless an owner allows writes. The school's own setting decides whether staff may enter at all; an owner may enter against it in an
 * emergency with a written reason. Each entry is written to `support_visits`, which the school reads and is told about.
 */
export class SupportLoginService extends PlatformService {
  async create(input: unknown): Promise<{ url: string; expiresAt: Date; userName: string; visitId: string; emergency: boolean }> {
    this.require("owner", "support");
    const d = this.parse(supportLoginInput, input);
    if (d.userId) assertId(d.userId, "User");
    if (d.allowWrites && this.ctx.role !== "owner") throw new ForbiddenError("Only an owner can allow changes in a support session.");
    if (d.emergency && this.ctx.role !== "owner") throw new ForbiddenError("Only an owner can enter against the school's setting.");
    return this.tx(async (tx) => {
      const [school] = await tx.select({ id: schools.id, slug: schools.slug, name: schools.name, supportAccess: schools.supportAccess, supportAccessUntil: schools.supportAccessUntil }).from(schools).where(eq(schools.id, d.schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      const allowed = supportMayEnter(school);
      if (!allowed && !d.emergency) throw new ForbiddenError(supportRefusal(school));
      const emergency = !allowed;
      if (emergency && d.reason.length < EMERGENCY_REASON_MIN) throw new ValidationError({ reason: `An emergency entry needs a real reason (at least ${EMERGENCY_REASON_MIN} characters). The school will read it.` });
      const [user] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(
        eq(users.schoolId, school.id), eq(users.status, "active"), d.userId ? eq(users.id, d.userId) : eq(users.role, "admin"),
      )).orderBy(users.createdAt).limit(1);
      if (!user) throw new NotFoundError("An active user for this school");
      const [visit] = await tx.insert(supportVisits).values({
        schoolId: school.id, staffId: this.ctx.staffId, staffName: this.ctx.name, asUserId: user.id, asUserName: user.name, reason: d.reason, readOnly: !d.allowWrites, emergency,
      }).returning({ id: supportVisits.id });
      const token = await new SchoolAuth(school.id).issueToken(tx, "support_login", {
        userId: user.id, minutes: SUPPORT_TOKEN_MINUTES,
        meta: { staffId: this.ctx.staffId, staffName: this.ctx.name, reason: d.reason, allowWrites: d.allowWrites, visitId: visit!.id, emergency },
      });
      await this.audit(tx, emergency ? "support.emergency" : "support.login", `${emergency ? "Emergency support login" : "Support login"} to ${school.name} as ${user.name}${d.allowWrites ? " (writes allowed)" : " (read-only)"}: ${d.reason}`, school.id, { userId: user.id, allowWrites: d.allowWrites, reason: d.reason, visitId: visit!.id, emergency });
      return { url: schoolUrl(school.slug, `/support-login?token=${encodeURIComponent(token)}`), expiresAt: new Date(Date.now() + SUPPORT_TOKEN_MINUTES * 60_000), userName: user.name, visitId: visit!.id, emergency };
    });
  }
}
