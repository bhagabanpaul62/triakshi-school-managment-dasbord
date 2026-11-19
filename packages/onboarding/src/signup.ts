import { SchoolAuth, RateLimiter } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { and, eq, schools, users, withSchool } from "@smw/db";
import { AppError, parse, ValidationError } from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { OnboardingEmails } from "./emails";
import { createSchool, slugTaken, type CreatedSchool } from "./create-school";
import { signupSchema, type SignupInput } from "./schema";
import { SlugPolicy } from "./slug";

export const VERIFY_TOKEN_MINUTES = 48 * 60;
/** shortcut: in-process counter, fine for one marketing container; move to Postgres when it runs as replicas. */
export const signupLimiter = new RateLimiter(5, 60 * 60_000);

/** shortcut: in-process; a slug check is a cheap read, so this only stops bulk enumeration. */
export const slugCheckLimiter = new RateLimiter(60, 60_000);

/** Resending the verify link: 3 per hour per school. shortcut: in-process, as above. */
export const resendLimiter = new RateLimiter(3, 60 * 60_000);

export interface SlugCheck { available: boolean; reason?: string; suggestion?: string }
export interface SignupResult extends CreatedSchool { email: string; emailSent: boolean; loginUrl: string }

export class SignupService {
  /** Is this subdomain free? Offers `slug-2` style alternatives when it is taken. */
  static async checkSlug(raw: string, opts: { ip?: string } = {}): Promise<SlugCheck> {
    if (opts.ip !== undefined && !slugCheckLimiter.take(`slug:${opts.ip}`)) return { available: false, reason: "Too many checks. Wait a minute and try again." };
    const slug = raw.trim().toLowerCase();
    const reason = SlugPolicy.check(slug);
    if (reason) return { available: false, reason, suggestion: (await SlugPolicy.suggest(slug, slugTaken)) ?? undefined };
    if (!(await slugTaken(slug))) return { available: true };
    return { available: false, reason: "That address is taken.", suggestion: (await SlugPolicy.suggest(slug, slugTaken)) ?? undefined };
  }

  /** Create the school as pending (no trial clock until staff approve it) and its admin, then email the verify link. */
  static async start(input: SignupInput, opts: { ip?: string } = {}): Promise<SignupResult> {
    if (!signupLimiter.take(`signup:${opts.ip ?? "?"}`)) throw new AppError("Too many signups from this network. Try again in an hour.", "rate_limited", 429);
    const d = parse(signupSchema, input);
    const check = await SignupService.checkSlug(d.slug);
    if (!check.available) throw new ValidationError({ slug: check.reason ?? "That address is taken." });

    const created = await createSchool({ ...d, status: "pending" });
    const token = await withSchool(created.schoolId, (tx) =>
      new SchoolAuth(created.schoolId).issueToken(tx, "verify_email", { userId: created.adminUserId, minutes: VERIFY_TOKEN_MINUTES }));
    const link = schoolUrl(created.slug, `/verify-email?token=${encodeURIComponent(token)}`);

    let emailSent = true;
    try {
      await services().email.send(OnboardingEmails.verify({ to: d.email, adminName: d.adminName, schoolName: d.name, link }));
    } catch {
      emailSent = false; // The school exists; the page tells the person to write to us.
    }
    return { ...created, email: d.email, emailSent, loginUrl: schoolUrl(created.slug, "/login") };
  }

  /**
   * A fresh verify link for an admin who has not set a password yet (the first link expired or was lost).
   * Returns nothing about whether the address matched, so it cannot be used to find out who is registered.
   */
  static async resendVerification(schoolId: string, rawEmail: string): Promise<{ limited: boolean }> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return { limited: false };
    if (!resendLimiter.take(`resend:${schoolId}`)) return { limited: true };
    const auth = new SchoolAuth(schoolId);
    const found = await withSchool(schoolId, async (tx) => {
      const [u] = await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(eq(users.schoolId, schoolId), eq(users.role, "admin"), eq(users.status, "invited"), eq(users.email, email))).limit(1);
      const [school] = await tx.select({ name: schools.name, slug: schools.slug }).from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (!u || !school) return null;
      return { user: u, school, token: await auth.issueToken(tx, "verify_email", { userId: u.id, minutes: VERIFY_TOKEN_MINUTES }) };
    });
    if (!found) return { limited: false };
    const link = schoolUrl(found.school.slug, `/verify-email?token=${encodeURIComponent(found.token)}`);
    await services().email.send(OnboardingEmails.verify({ to: email, adminName: found.user.name, schoolName: found.school.name, link })).catch(() => undefined);
    return { limited: false };
  }
}
