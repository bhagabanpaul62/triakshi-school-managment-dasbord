import { sql } from "drizzle-orm";
import type { Tx } from "./client";
import { uuidv7 } from "./uuid";

/** Next value of a gap-free per-school counter (receipts, invoices). Row-locks, so it is safe under concurrency. */
export async function nextSequence(tx: Tx, schoolId: string, key: string): Promise<number> {
  const rows = await tx.execute<{ value: number }>(sql`
    insert into sequences (id, school_id, key, value) values (${uuidv7()}, ${schoolId}, ${key}, 1)
    on conflict (school_id, key) do update set value = sequences.value + 1, updated_at = now()
    returning value`);
  return Number(rows[0]!.value);
}

/** Indian financial year label for a date: Apr 2026 - Mar 2027 -> "2026-27". */
export function financialYear(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
