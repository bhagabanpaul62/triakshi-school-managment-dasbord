import { and, eq, ne, or, sql } from "drizzle-orm";
import { Passwords } from "@smw/auth";
import { users, type Tx } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { guardians, studentGuardians, type GUARDIAN_RELATIONS } from "./schema";
import { normalizePhone } from "./util";

export interface GuardianDetails {
  name: string;
  relation: (typeof GUARDIAN_RELATIONS)[number];
  phone: string;
  email?: string;
  occupation?: string;
}

/**
 * Creates and links parent logins. One parent login (login ID = phone number) covers all their children in
 * the school, so linking by a phone that already exists reuses that parent instead of making a second one.
 * Callers pass their own transaction: this class owns the rules, not the permission checks.
 */
export class ParentAccounts {
  constructor(private readonly schoolId: string) {}

  /**
   * shortcut: the first password is the last 6 digits of the phone number so parents can sign in on day one;
   * replace it with an SMS or WhatsApp invite link once DLT is approved.
   */
  private firstPassword(phone: string) { return phone.slice(-6); }

  /** Find or create the parent user for a phone number. */
  private async loginFor(tx: Tx, d: GuardianDetails, phone: string) {
    const [found] = await tx.select().from(users).where(or(eq(users.loginId, phone), eq(users.phone, phone))).limit(1);
    if (found) {
      if (found.role !== "parent") throw new ConflictError(`${phone} is already used by another login in this school.`);
      if (found.status === "disabled") await tx.update(users).set({ status: "active" }).where(eq(users.id, found.id));
      return found;
    }
    const [created] = await tx.insert(users).values({
      schoolId: this.schoolId, role: "parent", loginId: phone, phone, name: d.name,
      passwordHash: await Passwords.hash(this.firstPassword(phone)), status: "active",
    }).returning();
    return created!;
  }

  /** Link a guardian to a student. The first guardian of a student becomes the primary one. */
  async link(tx: Tx, studentId: string, d: GuardianDetails, primary?: boolean) {
    const phone = normalizePhone(d.phone);
    const user = await this.loginFor(tx, d, phone);
    let [guardian] = await tx.select().from(guardians).where(eq(guardians.userId, user.id)).limit(1);
    guardian ??= (await tx.insert(guardians).values({
      schoolId: this.schoolId, name: d.name, relation: d.relation, phone, email: d.email, occupation: d.occupation, userId: user.id,
    }).returning())[0]!;

    const links = await tx.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    if (links.some((l) => l.guardianId === guardian.id)) throw new ConflictError(`${guardian.name} is already linked to this student.`);
    const isPrimary = primary ?? links.length === 0;
    if (isPrimary) await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
    await tx.insert(studentGuardians).values({ schoolId: this.schoolId, studentId, guardianId: guardian.id, isPrimary });
    return { guardian, userId: user.id };
  }

  async makePrimary(tx: Tx, studentId: string, guardianId: string) {
    await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
    const done = await tx.update(studentGuardians).set({ isPrimary: true })
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).returning({ id: studentGuardians.id });
    return done.length > 0;
  }

  /** Remove the link; a parent left with no children loses the record and the login is disabled. */
  async unlink(tx: Tx, studentId: string, guardianId: string) {
    const [link] = await tx.delete(studentGuardians)
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).returning();
    if (!link) return false;
    const rest = await tx.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId)).orderBy(studentGuardians.createdAt);
    if (link.isPrimary && rest[0]) await tx.update(studentGuardians).set({ isPrimary: true }).where(eq(studentGuardians.id, rest[0].id));
    await this.dropIfOrphan(tx, guardianId);
    return true;
  }

  /** Before a student is deleted: clean up guardians who have no other child here. */
  async releaseAll(tx: Tx, studentId: string) {
    const mine = await tx.select({ guardianId: studentGuardians.guardianId }).from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    for (const { guardianId } of mine) {
      const others = await tx.select({ id: studentGuardians.id }).from(studentGuardians)
        .where(and(eq(studentGuardians.guardianId, guardianId), ne(studentGuardians.studentId, studentId))).limit(1);
      if (others.length === 0) await this.dropIfOrphan(tx, guardianId, studentId);
    }
  }

  private async dropIfOrphan(tx: Tx, guardianId: string, ignoreStudent?: string) {
    const [left] = await tx.select({ n: sql<number>`count(*)` }).from(studentGuardians)
      .where(and(eq(studentGuardians.guardianId, guardianId), ignoreStudent ? ne(studentGuardians.studentId, ignoreStudent) : undefined));
    if (Number(left?.n ?? 0) > 0) return;
    const [g] = await tx.delete(guardians).where(eq(guardians.id, guardianId)).returning();
    if (g?.userId) await tx.update(users).set({ status: "disabled" }).where(eq(users.id, g.userId));
  }
}
