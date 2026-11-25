// Raw, guarded reads of other modules' tables: the table may not exist when that module was never switched on, and students must not import their code.
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";

export async function hasTable(tx: Tx, name: string): Promise<boolean> {
  const [r] = await tx.execute<{ t: string | null }>(sql`select to_regclass(${`public.${name}`})::text as t`);
  return !!r?.t;
}

export const feesHref = (studentId: string) => `/app/fees/students/${studentId}`;

/** Bills of the child in one academic year that are not cancelled. */
export async function billsOfYear(tx: Tx, schoolId: string, studentId: string, yearId: string): Promise<number> {
  if (!(await hasTable(tx, "fee_invoices"))) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from fee_invoices where school_id = ${schoolId} and student_id = ${studentId} and year_id = ${yearId} and status <> 'cancelled'`);
  return Number(r?.n ?? 0);
}

export interface Bus { route: string; stop: string; capacity: number | null; riders: number }

/** The child's bus stop, and how many other active children ride the same vehicle. Null when there is no stop or transport was never on. */
export async function busOf(tx: Tx, schoolId: string, studentId: string): Promise<Bus | null> {
  if (!(await hasTable(tx, "student_transport"))) return null;
  const [r] = await tx.execute<{ route: string; stop: string; capacity: number | null; riders: number }>(sql`
    select r.name as route, st.name as stop, v.capacity,
      (select count(*)::int from student_transport t2 join routes r2 on r2.id = t2.route_id join students s2 on s2.id = t2.student_id
        where r.vehicle_id is not null and r2.vehicle_id = r.vehicle_id and s2.status = 'active' and s2.id <> t.student_id) as riders
    from student_transport t join routes r on r.id = t.route_id join route_stops st on st.id = t.stop_id left join vehicles v on v.id = r.vehicle_id
    where t.school_id = ${schoolId} and t.student_id = ${studentId} limit 1`);
  return r ? { route: r.route, stop: r.stop, capacity: r.capacity == null ? null : Number(r.capacity), riders: Number(r.riders) } : null;
}

export interface Money { bills: number; unpaidBills: number; unpaidPaise: number; receipts: number; depositPaise: number }

/** Bills, receipts and deposits of the child, for the leaving and withdrawing dialogs. */
export async function moneyOf(tx: Tx, schoolId: string, studentId: string): Promise<Money> {
  const out: Money = { bills: 0, unpaidBills: 0, unpaidPaise: 0, receipts: 0, depositPaise: 0 };
  if (await hasTable(tx, "fee_invoices")) {
    const [r] = await tx.execute<{ bills: number; open: number; owed: string | null }>(sql`
      select count(*) filter (where status <> 'cancelled')::int as bills,
        count(*) filter (where status = 'issued' and gross_paise - concession_paise - credited_paise + late_paise - paid_paise > 0)::int as open,
        sum(gross_paise - concession_paise - credited_paise + late_paise - paid_paise) filter (where status = 'issued' and gross_paise - concession_paise - credited_paise + late_paise - paid_paise > 0) as owed
      from fee_invoices where school_id = ${schoolId} and student_id = ${studentId}`);
    out.bills = Number(r?.bills ?? 0); out.unpaidBills = Number(r?.open ?? 0); out.unpaidPaise = Number(r?.owed ?? 0);
  }
  if (await hasTable(tx, "fee_receipts")) {
    const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from fee_receipts where school_id = ${schoolId} and student_id = ${studentId}`);
    out.receipts = Number(r?.n ?? 0);
  }
  if (await hasTable(tx, "fee_advances")) {
    const [r] = await tx.execute<{ d: string | null }>(sql`select sum(amount_paise) as d from fee_advances where school_id = ${schoolId} and student_id = ${studentId} and kind = 'deposit'`);
    out.depositPaise = Number(r?.d ?? 0);
  }
  return out;
}

/** Books the child still has out. */
export async function booksOut(tx: Tx, schoolId: string, studentId: string): Promise<number> {
  if (!(await hasTable(tx, "loans"))) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from loans where school_id = ${schoolId} and student_id = ${studentId} and returned_on is null`);
  return Number(r?.n ?? 0);
}
