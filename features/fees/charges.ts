// The API other features use to put a due on a student's fee ledger (transport, library fines). Same signatures as before,
// now on invoices. It runs inside the caller's transaction and checks no permission: the calling service already did.
// Fees never imports those features; they import this.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { academicYears } from "@smw/feature-academics/schema";
import { InvoiceService } from "./invoices";
import { feeInvoices } from "./schema";

type Kind = "transport" | "library_fine";
export interface ChargeRow { studentId: string; kind: Kind; label: string; dueDate: string; amountPaise: number; sourceKey: string }

/** The year the ledger shows now, or null when the school has none yet (then nothing can be billed). */
export async function ledgerYear(tx: Tx) {
  const [y] = await tx.select({ id: academicYears.id, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn }).from(academicYears).orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)).limit(1);
  return y ?? null;
}

const bills = (schoolId: string) => new InvoiceService(systemCtx(schoolId, ["fees"]));
const schoolOf = async (tx: Tx) => (await tx.execute<{ s: string }>(sql`select current_setting('app.school_id', true) s`))[0]!.s;

/** A live (not cancelled) bill for a source key. */
const liveBy = (key: string) => and(eq(feeInvoices.sourceKey, key), sql`${feeInvoices.status} <> 'cancelled'`);

/**
 * Add charges as issued bills. One that already exists and is live stays as it is (so a paid month never changes);
 * one that was cancelled comes back as a new bill. Returns how many bills this call made.
 */
export async function postCharges(tx: Tx, schoolId: string, yearId: string, rows: ChargeRow[]): Promise<number> {
  const svc = bills(schoolId);
  const made: string[] = [];
  for (const r of rows) {
    const [have] = await tx.select({ id: feeInvoices.id }).from(feeInvoices).where(liveBy(r.sourceKey));
    if (have) continue;
    made.push(await svc.createDraft(tx, { studentId: r.studentId, yearId, kind: r.kind, label: r.label, dueDate: r.dueDate, sourceKey: r.sourceKey, lines: [{ kind: "fee", label: r.label, amountPaise: r.amountPaise }] }));
  }
  await svc.issueIn(tx, made);
  return made.length;
}

/** Cancel a student's unpaid charges of one kind due on or after `from`. Paid ones stay. Returns how many were cancelled. */
export async function cancelUnpaidCharges(tx: Tx, studentId: string, kind: Kind, from: string): Promise<number> {
  const svc = bills(await schoolOf(tx));
  await tx.execute(sql`select id from students where id = ${studentId}::uuid for update`);
  const open = await tx.select({ id: feeInvoices.id }).from(feeInvoices).where(and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.kind, kind), eq(feeInvoices.status, "issued"), gte(feeInvoices.dueDate, from), eq(feeInvoices.paidPaise, 0)));
  for (const o of open) await svc.cancelIn(tx, o.id, "Charge no longer applies");
  return open.length;
}

/** Cancel one charge by its source key. Returns false when it has money against it (nothing changes). */
export async function cancelCharge(tx: Tx, sourceKey: string): Promise<boolean> {
  const [row] = await tx.select({ id: feeInvoices.id, studentId: feeInvoices.studentId }).from(feeInvoices).where(liveBy(sourceKey));
  if (!row) return true;
  const svc = bills(await schoolOf(tx));
  // Wait for a payment that holds the student, then look at the money.
  await tx.execute(sql`select id from students where id = ${row.studentId}::uuid for update`);
  const [now] = await tx.select({ paid: feeInvoices.paidPaise, status: feeInvoices.status }).from(feeInvoices).where(eq(feeInvoices.id, row.id));
  if (now!.status === "cancelled") return true;
  if (now!.paid > 0) return false;
  await svc.cancelIn(tx, row.id, "Charge cancelled");
  return true;
}

