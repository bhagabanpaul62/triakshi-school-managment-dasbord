import { and, eq, schools, users } from "@smw/db";
import { SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { ForbiddenError, NotFoundError, PlatformService } from "@smw/feature-kit";
import { assertId, supportLoginInput } from "./inputs";

export const SUPPORT_TOKEN_MINUTES = 5;

/** Staff open a school's panel as one of its users: a 5-minute single-use token that the school app turns into a 30-minute session. Read-only unless the owner allows writes. */
export class SupportLoginService extends PlatformService {
  async create(input: unknown): Promise<{ url: string; expiresAt: Date; userName: string }> {
    this.require("owner", "support");
    const d = this.parse(supportLoginInput, input);
    if (d.userId) assertId(d.userId, "User");
    if (d.allowWrites && this.ctx.role !== "owner") throw new ForbiddenError("Only an owner can allow changes in a support session.");
    return this.tx(async (tx) => {
      const [school] = await tx.select({ id: schools.id, slug: schools.slug, name: schools.name }).from(schools).where(eq(schools.id, d.schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      const [user] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(
        eq(users.schoolId, school.id), eq(users.status, "active"), d.userId ? eq(users.id, d.userId) : eq(users.role, "admin"),
      )).orderBy(users.createdAt).limit(1);
      if (!user) throw new NotFoundError("An active user for this school");
      const token = await new SchoolAuth(school.id).issueToken(tx, "support_login", {
        userId: user.id, minutes: SUPPORT_TOKEN_MINUTES,
        meta: { staffId: this.ctx.staffId, staffName: this.ctx.name, reason: d.reason, allowWrites: d.allowWrites },
      });
      await this.audit(tx, "support.login", `Support login to ${school.name} as ${user.name}${d.allowWrites ? " (writes allowed)" : " (read-only)"}: ${d.reason}`, school.id, { userId: user.id, allowWrites: d.allowWrites, reason: d.reason });
      return { url: schoolUrl(school.slug, `/support-login?token=${encodeURIComponent(token)}`), expiresAt: new Date(Date.now() + SUPPORT_TOKEN_MINUTES * 60_000), userName: user.name };
    });
  }
}
