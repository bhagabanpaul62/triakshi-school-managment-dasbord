// The API other features use to put a due on a student's fee ledger (transport, library fines).
// It runs inside the caller's transaction and checks no permission: the calling service already did.
// Fees never imports those features; they import this.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { feeCharges, feePaymentAllocations, feePayments, type CHARGE_KINDS } from "./schema";

type Kind = (typeof CHARGE_KINDS)[number];

export interface ChargeRow { studentId: string; kind: Kind; label: string; dueDate: string; amountPaise: number; sourceKey: string }

/** The year the ledger shows now, or null when the school has none yet (then nothing can be billed). */
export async function ledgerYear(tx: Tx) {
  const [y] = await tx.select({ id: academicYears.id, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn }).from(academicYears)
    .orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)).limit(1);
  return y ?? null;
}

/** Paise received (valid payments only) against each charge. */
async function paidOn(tx: Tx, chargeIds: string[]): Promise<Map<string, number>> {
  if (!chargeIds.length) return new Map();
  const rows = await tx.select({ id: feePaymentAllocations.chargeId, paid: sql<number>`coalesce(sum(${feePaymentAllocations.amountPaise}), 0)::bigint` })
    .from(feePaymentAllocations).innerJoin(feePayments, eq(feePayments.id, feePaymentAllocations.paymentId))
    .where(and(inArray(feePaymentAllocations.chargeId, chargeIds), eq(feePayments.status, "valid"))).groupBy(feePaymentAllocations.chargeId);
  return new Map(rows.map((r) => [r.id!, Number(r.paid)]));
}

/**
 * Add charges. One that already exists and is active stays as it is (so a paid month never changes);
 * one that was cancelled comes back with the new amount. Returns how many are active because of this call.
 */
export async function postCharges(tx: Tx, schoolId: string, yearId: string, rows: ChargeRow[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const got = await tx.insert(feeCharges).values({ schoolId, yearId, ...r }).onConflictDoUpdate({
      target: [feeCharges.schoolId, feeCharges.sourceKey],
      set: { status: "active", cancelledAt: null, label: r.label, dueDate: r.dueDate, amountPaise: r.amountPaise, yearId },
      setWhere: eq(feeCharges.status, "cancelled"),
    }).returning({ id: feeCharges.id });
    n += got.length;
  }
  return n;
}

/** Same lock PaymentService.record takes: a payment and a cancel on one student cannot interleave. */
async function lockStudent(tx: Tx, studentId: string) {
  await tx.select({ id: students.id }).from(students).where(eq(students.id, studentId)).for("update");
}

/** Cancel a student's unpaid charges of one kind due on or after `from`. Paid ones stay. Returns how many were cancelled. */
export async function cancelUnpaidCharges(tx: Tx, studentId: string, kind: Kind, from: string): Promise<number> {
  await lockStudent(tx, studentId);
  const open = await tx.select({ id: feeCharges.id }).from(feeCharges)
    .where(and(eq(feeCharges.studentId, studentId), eq(feeCharges.kind, kind), eq(feeCharges.status, "active"), gte(feeCharges.dueDate, from)));
  const paid = await paidOn(tx, open.map((c) => c.id));
  const ids = open.filter((c) => !paid.get(c.id)).map((c) => c.id);
  if (ids.length) await tx.update(feeCharges).set({ status: "cancelled", cancelledAt: new Date() }).where(inArray(feeCharges.id, ids));
  return ids.length;
}

/** What is on the ledger for one source key: null when nothing was posted. */
export async function chargeFor(tx: Tx, sourceKey: string): Promise<{ id: string; status: "active" | "cancelled"; paidPaise: number } | null> {
  const [c] = await tx.select({ id: feeCharges.id, status: feeCharges.status }).from(feeCharges).where(eq(feeCharges.sourceKey, sourceKey)).limit(1);
  if (!c) return null;
  return { ...c, paidPaise: (await paidOn(tx, [c.id])).get(c.id) ?? 0 };
}

/** Cancel one charge by its source key. Returns false when it has money against it (nothing changes). */
export async function cancelCharge(tx: Tx, sourceKey: string): Promise<boolean> {
  const [row] = await tx.select({ studentId: feeCharges.studentId }).from(feeCharges).where(eq(feeCharges.sourceKey, sourceKey)).limit(1);
  if (!row) return true;
  await lockStudent(tx, row.studentId);
  const c = await chargeFor(tx, sourceKey);
  if (!c || c.status === "cancelled") return true;
  if (c.paidPaise > 0) return false;
  await tx.update(feeCharges).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(feeCharges.id, c.id));
  return true;
}
