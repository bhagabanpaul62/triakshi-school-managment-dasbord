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

/** Indian financial year label for a date: Apr 2026 - Mar 2027 -> "2026-27". Read in IST, so a UTC server agrees with India on 1 April. */
export function financialYear(d = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
