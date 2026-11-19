import { sql, type Tx } from "@smw/db";

const DAY = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Calendar-aware: Jan 31 + 1 month = Feb 28/29, one year keeps the date. */
export function addInterval(d: Date, interval: "annual" | "monthly"): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + (interval === "annual" ? 12 : 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** "12 Apr 2026" in IST, for invoice text. */
export const dmy = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-";

/** Active students of a school. Students is another feature's table, so it may not exist (tests): ask the catalog first. */
export async function countStudents(tx: Tx, schoolId: string): Promise<number> {
  const has = await tx.execute<{ ok: boolean }>(sql`select to_regclass('public.students') is not null as ok`);
  if (!has[0]?.ok) return 0;
  const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from students where school_id = ${schoolId} and status = 'active'`);
  return Number(r[0]?.n ?? 0);
}
