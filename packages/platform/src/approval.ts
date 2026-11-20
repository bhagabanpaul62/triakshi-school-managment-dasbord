import { z } from "zod";
import { and, asc, desc, eq, inArray, plans, platformAuditLogs, schools, sql, users, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService } from "@smw/feature-kit";
import { services, type Mail } from "@smw/integrations";
import { OnboardingEmails, signInLink } from "@smw/onboarding";
import { assertId } from "./inputs";

const DAY = 86_400_000;
export const TRIAL_DAYS = 30;

const noteSchema = z.string().trim().max(500).optional();
const reasonSchema = z.string().trim().min(5, "Say why (at least 5 characters). The school reads this.").max(500);

export interface PendingSchool {
  id: string; name: string; slug: string; city: string | null; state: string | null; board: string | null;
  planName: string | null; studentCap: number; phone: string | null; email: string | null; createdAt: Date; status: "pending" | "rejected";
  adminName: string | null; adminEmail: string | null; emailVerified: boolean;
}
export interface ApprovalResult { schoolId: string; status: "trial" | "rejected" | "pending"; trialEndsAt: Date | null; emailSent: boolean }

/**
 * The review queue for self-serve signups: pending schools are approved (trial starts now) or rejected (with a reason).
 * Approve and reject are owner only; support and sales can read the queue. Emails go out after the change commits.
 */
export class ApprovalService extends PlatformService {
  private rows(tx: Tx, status: "pending" | "rejected") {
    return tx.select({
      id: schools.id, name: schools.name, slug: schools.slug, city: schools.city, state: schools.state, board: schools.board,
      planName: plans.name, studentCap: schools.studentCap, phone: schools.phone, email: schools.email, createdAt: schools.createdAt, status: schools.status,
    }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(eq(schools.status, status)).orderBy(asc(schools.createdAt), schools.id);
  }

  private async withAdmins(tx: Tx, list: Awaited<ReturnType<ApprovalService["rows"]>>): Promise<PendingSchool[]> {
    if (list.length === 0) return [];
    const admins = await tx.select({ schoolId: users.schoolId, name: users.name, email: users.email, status: users.status }).from(users)
      .where(and(eq(users.role, "admin"), inArray(users.schoolId, list.map((s) => s.id)))).orderBy(asc(users.createdAt));
    return list.map((s) => {
      const a = admins.find((x) => x.schoolId === s.id);
      return { ...s, status: s.status as "pending" | "rejected", adminName: a?.name ?? null, adminEmail: a?.email ?? null, emailVerified: a?.status === "active" };
    });
  }

  /** Oldest first: whoever has waited longest is on top. */
  async listPending(): Promise<PendingSchool[]> {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => this.withAdmins(tx, await this.rows(tx, "pending")));
  }

  async listRejected(): Promise<PendingSchool[]> {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => this.withAdmins(tx, (await this.rows(tx, "rejected")).reverse()));
  }

  /** Cheap number for the nav badge. */
  async pendingCount(): Promise<number> {
    this.require("owner", "support", "sales");
    return this.tx(async (tx) => (await tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "pending"))).length);
  }

  /** The review record: one pending or rejected school with its admin, or NotFound. */
  async review(id: string): Promise<PendingSchool & { rejectedReason: string | null }> {
    this.require("owner", "support", "sales");
    assertId(id, "School");
    return this.tx(async (tx) => {
      const [row] = await tx.select({
        id: schools.id, name: schools.name, slug: schools.slug, city: schools.city, state: schools.state, board: schools.board,
        planName: plans.name, studentCap: schools.studentCap, phone: schools.phone, email: schools.email, createdAt: schools.createdAt, status: schools.status,
      }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(eq(schools.id, id)).limit(1);
      if (!row || (row.status !== "pending" && row.status !== "rejected")) throw new NotFoundError("School");
      const [s] = await this.withAdmins(tx, [row]);
      const [last] = await tx.select({ meta: platformAuditLogs.meta }).from(platformAuditLogs)
        .where(and(eq(platformAuditLogs.schoolId, id), eq(platformAuditLogs.action, "school.reject"))).orderBy(desc(platformAuditLogs.createdAt)).limit(1);
      return { ...s!, rejectedReason: row.status === "rejected" ? String((last?.meta as { reason?: string } | undefined)?.reason ?? "") || null : null };
    });
  }

  /** Pending to trial. The 30-day clock starts now, not at signup. */
  async approve(id: string, note?: string): Promise<ApprovalResult> {
    this.require("owner");
    assertId(id, "School");
    const n = this.parse(noteSchema, note);
    const { school, admin } = await this.tx(async (tx) => {
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * DAY);
      // The status guard is in the UPDATE itself, so two owners clicking at once cannot both approve.
      const [school] = await tx.update(schools).set({ status: "trial", trialEndsAt, statusChangedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schools.id, id), eq(schools.status, "pending"))).returning();
      if (!school) throw await this.notPending(tx, id, "approved");
      const admin = await this.admin(tx, id);
      await this.audit(tx, "school.approve", `Approved ${school.name}`, id, { from: "pending", to: "trial", note: n ?? null, trialEndsAt: trialEndsAt.toISOString() });
      return { school, admin };
    });
    const emailSent = await this.sendSignIn(school, admin);
    return { schoolId: id, status: "trial", trialEndsAt: school.trialEndsAt, emailSent };
  }

  /**
   * Email the school's administrator their way in again: the "set your password" page if they never set one
   * (the usual case when the first link was lost), otherwise sign-in with their email filled in. Approved schools only.
   */
  async resendSignIn(id: string): Promise<{ emailSent: boolean; setPassword: boolean }> {
    this.require("owner", "support");
    assertId(id, "School");
    const { school, admin } = await this.tx(async (tx) => {
      const [school] = await tx.select().from(schools).where(eq(schools.id, id)).limit(1);
      if (!school) throw new NotFoundError("School");
      if (school.status === "pending" || school.status === "rejected") throw new ConflictError(`${school.name} is ${school.status}; approve it first.`);
      const admin = await this.admin(tx, id);
      if (!admin) throw new ConflictError(`${school.name} has no administrator with an email.`);
      await this.audit(tx, "school.resend_sign_in", `Resent the sign-in email for ${school.name}`, id, {});
      return { school, admin };
    });
    return { emailSent: await this.sendSignIn(school, admin), setPassword: !admin.hasPassword };
  }

  private async sendSignIn(school: { id: string; name: string; slug: string }, admin: Awaited<ReturnType<ApprovalService["admin"]>>): Promise<boolean> {
    if (!admin) return false;
    try {
      const { url, setPassword } = await signInLink(school.id, school.slug, { id: admin.id, email: admin.email!, hasPassword: admin.hasPassword });
      return await this.send(OnboardingEmails.approved({ to: admin.email!, adminName: admin.name, schoolName: school.name, trialDays: TRIAL_DAYS, link: url, setPassword }));
    } catch (err) { // the approval already committed; a link or mail failure is reported, never undone
      console.error(JSON.stringify({ level: "warn", msg: "sign-in email failed", schoolId: school.id, err: String(err) }));
      return false;
    }
  }

  /** Pending to rejected, with a reason the school reads in its email. */
  async reject(id: string, reason: string): Promise<ApprovalResult> {
    this.require("owner");
    assertId(id, "School");
    const why = this.parse(reasonSchema, reason);
    const { school, admin } = await this.tx(async (tx) => {
      const [school] = await tx.update(schools).set({ status: "rejected", statusChangedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schools.id, id), eq(schools.status, "pending"))).returning();
      if (!school) throw await this.notPending(tx, id, "rejected");
      const admin = await this.admin(tx, id);
      await this.audit(tx, "school.reject", `Rejected ${school.name}: ${why}`, id, { from: "pending", to: "rejected", reason: why });
      return { school, admin };
    });
    const emailSent = await this.send(admin && OnboardingEmails.rejected({ to: admin.email!, adminName: admin.name, schoolName: school.name, reason: why }));
    return { schoolId: id, status: "rejected", trialEndsAt: null, emailSent };
  }

  /** Rejected back to pending, for a second look. No email. */
  async reopen(id: string): Promise<ApprovalResult> {
    this.require("owner");
    assertId(id, "School");
    await this.tx(async (tx) => {
      const [school] = await tx.update(schools).set({ status: "pending", statusChangedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schools.id, id), eq(schools.status, "rejected"))).returning();
      if (!school) throw await this.notPending(tx, id, "reopened", "rejected");
      await this.audit(tx, "school.reopen", `Reopened ${school.name} for review`, id, { from: "rejected", to: "pending" });
    });
    return { schoolId: id, status: "pending", trialEndsAt: null, emailSent: false };
  }

  private async admin(tx: Tx, schoolId: string) {
    const [a] = await tx.select({ id: users.id, name: users.name, email: users.email, hasPassword: sql<boolean>`${users.passwordHash} is not null` }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.role, "admin"))).orderBy(asc(users.createdAt)).limit(1);
    return a?.email ? a : null;
  }

  private async notPending(tx: Tx, id: string, verb: string, need = "pending") {
    const [s] = await tx.select({ name: schools.name, status: schools.status }).from(schools).where(eq(schools.id, id)).limit(1);
    return s ? new ConflictError(`${s.name} is ${s.status.replace("_", "-")}, only ${need} schools can be ${verb}.`) : new NotFoundError("School");
  }

  /** Best effort: the status change already committed, so a mail failure must not undo or hide it. */
  private async send(mail: Mail | null | undefined): Promise<boolean> {
    if (!mail) return false;
    try { await services().email.send(mail); return true; } catch (err) {
      console.error(JSON.stringify({ level: "warn", msg: "approval email failed", err: String(err) }));
      return false;
    }
  }
}
