import { and, eq, ne, sql } from "drizzle-orm";
import { ConflictError } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
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
 * Links guardians (contact records) to students. Guardians have no login: the student account is the family login.
 * One guardian record per phone number in the school, so siblings share it.
 * Callers pass their own transaction: this class owns the rules, not the permission checks.
 */
export class ParentAccounts {
  constructor(private readonly schoolId: string) {}

  /** Link a guardian to a student. The first guardian of a student becomes the primary one. */
  async link(tx: Tx, studentId: string, d: GuardianDetails, primary?: boolean) {
    const phone = normalizePhone(d.phone);
    let [guardian] = await tx.select().from(guardians).where(eq(guardians.phone, phone)).limit(1);
    guardian ??= (await tx.insert(guardians).values({
      schoolId: this.schoolId, name: d.name, relation: d.relation, phone, email: d.email, occupation: d.occupation,
    }).returning())[0]!;

    const links = await tx.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    if (links.some((l) => l.guardianId === guardian.id)) throw new ConflictError(`${guardian.name} is already linked to this student.`);
    const isPrimary = primary ?? links.length === 0;
    if (isPrimary) await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
    await tx.insert(studentGuardians).values({ schoolId: this.schoolId, studentId, guardianId: guardian.id, isPrimary });
    return { guardian };
  }

  async makePrimary(tx: Tx, studentId: string, guardianId: string) {
    await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
    const done = await tx.update(studentGuardians).set({ isPrimary: true })
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).returning({ id: studentGuardians.id });
    return done.length > 0;
  }

  /** Remove the link; a guardian left with no children loses the record. */
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
    await tx.delete(guardians).where(eq(guardians.id, guardianId));
  }
}
