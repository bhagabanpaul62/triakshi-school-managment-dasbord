import { accountCredits, eq, invoices, schools, sql, type Tx } from "@smw/db";
import { dueOf } from "./amounts";

type CreditKind = typeof accountCredits.$inferInsert["kind"];

/**
 * The credit Triakshi holds for a school: a list of + and - rows whose sum is the balance. Each row has a unique
 * source key, so a replayed webhook or a double click cannot add or spend the same credit twice.
 */
export class AccountCredits {
  /** True when the row was added, false when this source had already been recorded. */
  static async add(tx: Tx, p: { schoolId: string; amountPaise: number; kind: CreditKind; sourceKey: string; invoiceId?: string | null; paymentId?: string | null; creditNoteId?: string | null; note?: string }) {
    if (p.amountPaise === 0) return false;
    const rows = await tx.insert(accountCredits).values({ ...p, invoiceId: p.invoiceId ?? null, paymentId: p.paymentId ?? null, creditNoteId: p.creditNoteId ?? null, note: p.note ?? null })
      .onConflictDoNothing().returning({ id: accountCredits.id });
    return rows.length > 0;
  }

  static async balance(tx: Tx, schoolId: string): Promise<number> {
    const [r] = await tx.select({ n: sql<number>`coalesce(sum(${accountCredits.amountPaise}), 0)::bigint` }).from(accountCredits).where(eq(accountCredits.schoolId, schoolId));
    return Number(r?.n ?? 0);
  }

  /**
   * Spend credit on a just-issued invoice, as much as covers it. The school row is locked first so two invoices issued
   * at the same moment cannot both spend the same credit. Returns what was used.
   */
  static async useOn(tx: Tx, inv: typeof invoices.$inferSelect): Promise<number> {
    await tx.select({ id: schools.id }).from(schools).where(eq(schools.id, inv.schoolId)).for("update");
    const use = Math.min(await this.balance(tx, inv.schoolId), dueOf(inv));
    if (use <= 0) return 0;
    await this.add(tx, { schoolId: inv.schoolId, amountPaise: -use, kind: "used", sourceKey: `use:${inv.id}`, invoiceId: inv.id });
    await tx.update(invoices).set({ creditAppliedPaise: inv.creditAppliedPaise + use }).where(eq(invoices.id, inv.id));
    return use;
  }
}
