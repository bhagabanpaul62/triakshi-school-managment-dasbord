import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { listQuerySchema, type ListQuery } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { FeesBase, asId, calcOf } from "./base";
import { dueState, invoiceLateFee, openOf } from "./calc";
import { METHOD_LABEL, type PayMethod } from "./constants";
import { feeAdvances, feeConcessions, feePromises, feeRefunds, feeReminders, feeSettlements, feeUpiSlips, feeNotes, feeReceipts, feeInvoices } from "./schema";

export interface DueRow {
  id: string; name: string; admissionNo: string; classLabel: string; classId: string | null;
  gross: number; concession: number; late: number; paid: number; due: number; overdue: number;
  status: "overdue" | "due" | "paid"; nextDueDate: string | null;
}
export interface TrendPoint { key: string; label: string; paise: number }
export interface Ageing { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90p: number }

const NIL = "00000000-0000-0000-0000-000000000000";
/** What is open on a bill row aliased `i`. */
const OPEN = sql`(i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise)`;
/**
 * What is open on issued bills, by the day it falls due: one slice per bill, or one per settlement part (money paid
 * clears the earliest parts first, as in calc.slicesOf). Every dashboard and report reads this, in SQL, never in memory.
 */
const SLICES = sql`slices as (
  select i.id invoice_id, i.student_id, i.due_date due_on, ${OPEN} open_paise from fee_invoices i
    where i.status = 'issued' and ${OPEN} > 0 and not exists (select 1 from fee_due_parts p where p.invoice_id = i.id)
  union all
  select p.invoice_id, i.student_id, p.due_on, greatest(0, least(p.amount_paise, p.cum - greatest(0, p.tot - ${OPEN})))
    from (select invoice_id, due_on, amount_paise, sum(amount_paise) over (partition by invoice_id order by due_on) cum, sum(amount_paise) over (partition by invoice_id) tot from fee_due_parts) p
    join fee_invoices i on i.id = p.invoice_id where i.status = 'issued'
  union all
  select i.id, i.student_id, i.due_date, ${OPEN} - t.tot from fee_invoices i
    join (select invoice_id, sum(amount_paise) tot from fee_due_parts group by invoice_id) t on t.invoice_id = i.id where i.status = 'issued' and ${OPEN} > t.tot
)`;
/** Same shape, but for the open part of lines of one head (the head filter of the dues report). */
const headSlices = (headId: string) => sql`slices as (
  select i.id invoice_id, i.student_id, i.due_date due_on, l.amount_paise - l.concession_paise - l.credited_paise - l.paid_paise open_paise
    from fee_invoice_lines l join fee_invoices i on i.id = l.invoice_id where i.status = 'issued' and l.head_id = ${headId}
)`;
const LIVE = sql`('valid', 'clearing')`;
/**
 * Live receipts of a date range with the new money in each (an advance spent is not new money): `rcp` and `mon`.
 * Written as two steps on purpose: each row of one joined to the other by index is slow when one school holds the whole table.
 */
const receiptMoney = (from: string, to: string) => sql`rcp as materialized (select id, date, amount_paise, collected_by from fee_receipts where status in ${LIVE} and date between ${from}::date and ${to}::date),
  mon as materialized (select receipt_id, method, sum(amount_paise) paise from fee_receipt_methods where receipt_id in (select id from rcp) group by receipt_id, method)`;

const asRows = <T,>(r: Iterable<T>) => [...r];
const num = (v: unknown) => Number(v ?? 0);

export class DuesService extends FeesBase {
  // ---------- one student ----------

  /** Everything about one student's money, all years: balance, bills, receipts, notes, concessions, advances, deposits, promises and one timeline. */
  async studentAccount(studentId: string) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, asId(studentId, "Student"));
      const today = todayIST();
      const student = await this.oneStudent(tx, studentId);
      const invoices = await this.loadInvoices(tx, eq(feeInvoices.studentId, studentId));
      const [receipts, notes, concessions, settlements, advances, refunds, slips, promises, reminders] = await Promise.all([
        tx.select().from(feeReceipts).where(eq(feeReceipts.studentId, studentId)).orderBy(desc(feeReceipts.date), desc(feeReceipts.number)),
        tx.select().from(feeNotes).where(eq(feeNotes.studentId, studentId)).orderBy(desc(feeNotes.createdAt)),
        tx.select().from(feeConcessions).where(eq(feeConcessions.studentId, studentId)).orderBy(desc(feeConcessions.createdAt)),
        tx.select().from(feeSettlements).where(eq(feeSettlements.studentId, studentId)).orderBy(desc(feeSettlements.createdAt)),
        tx.select().from(feeAdvances).where(eq(feeAdvances.studentId, studentId)).orderBy(desc(feeAdvances.date), desc(feeAdvances.createdAt)),
        tx.select().from(feeRefunds).where(eq(feeRefunds.studentId, studentId)).orderBy(desc(feeRefunds.createdAt)),
        tx.select().from(feeUpiSlips).where(eq(feeUpiSlips.studentId, studentId)).orderBy(desc(feeUpiSlips.createdAt)),
        tx.select().from(feePromises).where(eq(feePromises.studentId, studentId)).orderBy(desc(feePromises.promisedOn)),
        tx.select().from(feeReminders).where(eq(feeReminders.studentId, studentId)).orderBy(desc(feeReminders.sentOn)),
      ]);
      const rows = invoices.map((i) => ({ ...i, openPaise: i.status === "issued" ? openOf(i) : 0, state: dueState(i, today), accruedLatePaise: i.status === "issued" ? invoiceLateFee(i.lateRule, calcOf(i), today) : 0 }));
      const openPaise = rows.reduce((s, r) => s + r.openPaise, 0), accruedPaise = rows.reduce((s, r) => s + r.accruedLatePaise, 0);
      const [advancePaise, depositPaise] = [await this.advanceOf(tx, studentId), await this.depositHeld(tx, studentId)];
      const timeline = [
        ...rows.filter((r) => r.issueDate).map((r) => ({ at: r.issueDate!, kind: "invoice", title: `Bill ${r.number}: ${r.label}`, amountPaise: r.grossPaise - r.concessionPaise, href: `/app/fees/invoices/${r.id}` })),
        ...receipts.map((r) => ({ at: r.date, kind: "receipt", title: `Receipt ${r.number}${r.status === "valid" ? "" : ` (${r.status})`}`, amountPaise: r.amountPaise, href: `/app/fees/receipts/${r.id}` })),
        ...notes.filter((n) => n.issuedOn).map((n) => ({ at: n.issuedOn!, kind: "note", title: `${n.kind === "credit" ? "Credit" : "Debit"} note ${n.number}: ${n.reason}`, amountPaise: n.amountPaise, href: `/app/fees/invoices/${n.invoiceId}` })),
        ...refunds.filter((r) => r.paidOn).map((r) => ({ at: r.paidOn!, kind: "refund", title: `Refund ${r.number}`, amountPaise: r.amountPaise, href: `/app/fees/students/${studentId}` })),
        ...slips.map((s) => ({ at: s.paidOn, kind: "slip", title: `UPI slip ${s.utr} (${s.status})`, amountPaise: s.amountPaise, href: `/app/fees/students/${studentId}` })),
        ...promises.map((p) => ({ at: p.promisedOn, kind: "promise", title: `Promised to pay${p.note ? `: ${p.note}` : ""}`, amountPaise: p.amountPaise ?? 0, href: `/app/fees/students/${studentId}` })),
        ...reminders.map((r) => ({ at: r.sentOn, kind: "reminder", title: "Reminder sent", amountPaise: 0, href: `/app/fees/invoices/${r.invoiceId}` })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return { student, balance: { openPaise, accruedPaise, advancePaise, depositPaise, netPaise: openPaise + accruedPaise - advancePaise }, invoices: rows, receipts, notes, concessions, settlements, advances, deposits: { heldPaise: depositPaise }, refunds, slips, promises, timeline };
    });
  }

  /** The family at the counter: this student and the brothers and sisters, with every open bill and the advance each holds. */
  async family(studentId: string) {
    return this.read(this.can("collect") ? "collect" : "read", async (tx) => {
      const today = todayIST();
      const ids = await this.familyOf(tx, studentId);
      const kids = await this.studentLines(tx, inArray(sql`students.id`, ids));
      const open = await this.loadInvoices(tx, and(inArray(feeInvoices.studentId, ids), eq(feeInvoices.status, "issued")));
      const members = await Promise.all(kids.map(async (k) => {
        const bills = open.filter((i) => i.studentId === k.id && openOf(i) > 0).map((i) => ({ id: i.id, number: i.number, label: i.label, dueDate: i.dueDate, openPaise: openOf(i), accruedLatePaise: invoiceLateFee(i.lateRule, calcOf(i), today), state: dueState(i, today) }));
        return { student: k, bills, advancePaise: await this.advanceOf(tx, k.id), openPaise: bills.reduce((s, b) => s + b.openPaise + b.accruedLatePaise, 0) };
      }));
      return { members: members.sort((a, b) => (a.student.id === studentId ? -1 : b.student.id === studentId ? 1 : a.student.name.localeCompare(b.student.name))), totalPaise: members.reduce((s, m) => s + m.openPaise, 0) };
    });
  }

  // ---------- the dues report ----------

  /**
   * Students with something open, worst first. Ageing is by days past due. Students who left stay in. `totals` cover
   * every student that matches, not only this page. Late fee that has built up is shown beside, not inside, `due`.
   */
  async report(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const f = q.filters;
      const out = await this.rows(tx, { q: q.q, classId: f.classId, headId: f.headId, routeId: f.routeId, overdueOnly: f.overdue === "1", status: f.status, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
      return { rows: out.rows, total: out.total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(out.total / q.pageSize)), totals: out.totals };
    });
  }

  private async rows(tx: Tx, o: { ids?: string[]; q?: string; classId?: string; headId?: string; routeId?: string; overdueOnly?: boolean; status?: string; includeZero?: boolean; limit: number; offset: number }) {
    const today = todayIST();
    const [t] = asRows(await tx.execute<{ r: string | null; t: string | null }>(sql`select to_regclass('student_transport') r, to_regclass('routes') t`));
    const where = [
      o.ids ? sql`s.id in (${sql.join((o.ids.length ? o.ids : [NIL]).map((x) => sql`${x}::uuid`), sql`, `)})` : sql`true`,
      o.q ? sql`(s.name ilike ${`%${o.q}%`} or s.admission_no ilike ${`%${o.q}%`})` : sql`true`,
      o.classId ? sql`s.class_id = ${o.classId}::uuid` : sql`true`,
      o.status ? sql`s.status = ${o.status}` : sql`true`,
      o.routeId && t?.r ? sql`exists (select 1 from student_transport st where st.student_id = s.id and st.route_id = ${o.routeId}::uuid)` : sql`true`,
      o.overdueOnly ? sql`coalesce(a.overdue, 0) > 0` : sql`true`,
      o.includeZero ? sql`true` : sql`coalesce(a.open, 0) > 0`,
    ];
    const age = (lo: number, hi: number) => sql`coalesce(sum(open_paise) filter (where due_on < ${today}::date and ${today}::date - due_on between ${lo} and ${hi}), 0)`;
    const res = asRows(await tx.execute<Record<string, string | number | null>>(sql`
      with ${o.headId ? headSlices(o.headId) : SLICES},
      a as (select student_id, sum(open_paise) open, coalesce(sum(open_paise) filter (where due_on < ${today}::date), 0) overdue, min(due_on) filter (where open_paise > 0) next_due,
                   coalesce(sum(open_paise) filter (where due_on >= ${today}::date), 0) not_due, ${age(1, 30)} d1, ${age(31, 60)} d2, ${age(61, 90)} d3, ${age(91, 100000)} d4
            from slices where open_paise > 0 group by student_id),
      inv as (select student_id, sum(gross_paise) gross, sum(concession_paise + credited_paise) conc, sum(late_paise) late, sum(paid_paise) paid from fee_invoices where status = 'issued' group by student_id)
      select s.id, s.name, s.admission_no, s.class_id, s.status, s.left_on, coalesce(c.name || coalesce('-' || sec.name, ''), '-') class_label,
             coalesce(a.open, 0) open, coalesce(a.overdue, 0) overdue, a.next_due, coalesce(a.not_due, 0) not_due, coalesce(a.d1, 0) d1, coalesce(a.d2, 0) d2, coalesce(a.d3, 0) d3, coalesce(a.d4, 0) d4,
             coalesce(inv.gross, 0) gross, coalesce(inv.conc, 0) conc, coalesce(inv.late, 0) late, coalesce(inv.paid, 0) paid,
             count(*) over () total, sum(coalesce(a.open, 0)) over () t_open, sum(coalesce(a.overdue, 0)) over () t_overdue, sum(coalesce(a.not_due, 0)) over () t_not_due,
             sum(coalesce(a.d1, 0)) over () t1, sum(coalesce(a.d2, 0)) over () t2, sum(coalesce(a.d3, 0)) over () t3, sum(coalesce(a.d4, 0)) over () t4
      from students s left join a on a.student_id = s.id left join inv on inv.student_id = s.id left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
      where ${sql.join(where, sql` and `)}
      order by coalesce(a.overdue, 0) desc, coalesce(a.open, 0) desc, s.name, s.id limit ${o.limit} offset ${o.offset}`));
    const ids = res.map((r) => r.id as string);
    const bills = ids.length ? await this.loadInvoices(tx, and(inArray(feeInvoices.studentId, ids), eq(feeInvoices.status, "issued"))) : [];
    const rows = res.map((r) => {
      const accrued = bills.filter((b) => b.studentId === r.id).reduce((s, b) => s + invoiceLateFee(b.lateRule, calcOf(b), today), 0);
      const [open, overdue] = [num(r.open), num(r.overdue)];
      return {
        id: r.id as string, name: r.name as string, admissionNo: r.admission_no as string, classId: (r.class_id as string | null), classLabel: r.class_label as string,
        gross: num(r.gross), concession: num(r.conc), late: num(r.late), paid: num(r.paid), due: open, overdue, accrued,
        status: overdue > 0 ? "overdue" as const : open > 0 ? "due" as const : "paid" as const, nextDueDate: (r.next_due as string | null) ?? null,
        studentStatus: r.status as string, leftOn: (r.left_on as string | null) ?? null,
        ageing: { notDue: num(r.not_due), d1_30: num(r.d1), d31_60: num(r.d2), d61_90: num(r.d3), d90p: num(r.d4) } satisfies Ageing,
      };
    });
    const first = res[0];
    return {
      rows, total: num(first?.total),
      totals: { due: num(first?.t_open), overdue: num(first?.t_overdue), ageing: { notDue: num(first?.t_not_due), d1_30: num(first?.t1), d31_60: num(first?.t2), d61_90: num(first?.t3), d90p: num(first?.t4) } satisfies Ageing },
    };
  }

  /** For a student login: their own dues (only students who have been billed), with the late fee that has built up included. */
  async mine(): Promise<DueRow[]> {
    return this.viewer(async (tx, own) => {
      if (!own?.length) return [];
      const out = await this.rows(tx, { ids: own, includeZero: true, limit: 50, offset: 0 });
      return out.rows.filter((r) => r.gross > 0 || r.due > 0).map(({ accrued, ageing: _a, studentStatus: _s, leftOn: _l, ...r }) => ({ ...r, due: r.due + accrued, overdue: r.overdue + (r.status === "overdue" ? accrued : 0), late: r.late + accrued }));
    });
  }

  async classOptions() { return this.read("read", (tx) => tx.execute<{ id: string; name: string }>(sql`select id, name from classes order by grade`).then(asRows)); }

  // ---------- the dashboard ----------

  /** The headline numbers, by SQL aggregate. */
  async summary() {
    return this.read("read", (tx) => this.summaryIn(tx));
  }

  private async summaryIn(tx: Tx) {
    const today = todayIST(), month = `${today.slice(0, 7)}-01`;
    const [[a], now, mon, year] = await Promise.all([
      tx.execute<{ open: string; overdue: string; students: string; overdue_students: string }>(sql`with ${SLICES} select coalesce(sum(open_paise), 0) open, coalesce(sum(open_paise) filter (where due_on < ${today}::date), 0) overdue, count(distinct student_id) students, count(distinct student_id) filter (where due_on < ${today}::date) overdue_students from slices where open_paise > 0`).then(asRows),
      this.collectedIn(tx, today, today), this.collectedIn(tx, month, today), this.collectedIn(tx, `${(await this.currentYear(tx)).startsOn}`, today),
    ]);
    const [billed] = asRows(await tx.execute<{ v: string }>(sql`select coalesce(sum(gross_paise - concession_paise - credited_paise + late_paise), 0) v from fee_invoices where status = 'issued'`));
    return {
      collectedToday: now.paise, receiptsToday: now.n, collectedThisMonth: mon.paise, receiptsThisMonth: mon.n,
      outstanding: num(a?.open), overdueAmount: num(a?.overdue), overdueCount: num(a?.overdue_students), studentsWithDues: num(a?.students),
      collectedThisYear: year.paise, billedThisYear: num(billed?.v),
    };
  }

  /** Money received between two days (the advance used is not new money, so it is left out). */
  private async collectedIn(tx: Tx, from: string, to: string) {
    const [r] = asRows(await tx.execute<{ paise: string; n: string }>(sql`with ${receiptMoney(from, to)}
      select coalesce(sum(paise) filter (where method <> 'advance'), 0) paise, count(distinct receipt_id) n from mon`));
    return { paise: num(r?.paise), n: num(r?.n) };
  }

  /** Money received on one day (for the home page). */
  async collected(date: string) { return this.read("read", (tx) => this.collectedIn(tx, date, date)); }

  /** Newest receipts, for the home page. */
  async recentReceipts(limit: number) {
    return this.read("read", async (tx) => asRows(await tx.execute<{ id: string; student: string; amount: string; method: string | null; number: string; date: string }>(sql`
      select r.id, r.snapshot->>'studentName' student, r.amount_paise amount, (select m.method from fee_receipt_methods m where m.receipt_id = r.id order by m.amount_paise desc limit 1) method, r.number, r.date
      from fee_receipts r where r.status in ${LIVE} order by r.date desc, r.created_at desc limit ${limit}`)).map((r) => ({ id: r.id, student: r.student, amountPaise: num(r.amount), method: r.method ?? "cash", receiptNo: r.number, paidOn: r.date })));
  }

  /** The staff dashboard: numbers, ageing, dues by class, who to chase, today's receipts. All aggregates in SQL. */
  async overview() {
    return this.read("read", async (tx) => {
      const today = todayIST();
      const [summary, top, byClass, today_, byMethod] = await Promise.all([
        this.summaryIn(tx),
        this.rows(tx, { overdueOnly: true, limit: 8, offset: 0 }),
        tx.execute<{ id: string; name: string; students: string; due: string; overdue: string; overdue_students: string }>(sql`
          with ${SLICES}, per as (select student_id, sum(open_paise) open, coalesce(sum(open_paise) filter (where due_on < ${today}::date), 0) overdue from slices group by student_id)
          select c.id, c.name, count(*) students, sum(per.open) due, sum(per.overdue) overdue, count(*) filter (where per.overdue > 0) overdue_students
          from per join students s on s.id = per.student_id join classes c on c.id = s.class_id group by c.id, c.name, c.grade order by c.grade`).then(asRows),
        tx.execute<{ id: string; student_id: string; student: string; amount: string; method: string | null; number: string }>(sql`
          select r.id, r.student_id, r.snapshot->>'studentName' student, r.amount_paise amount, (select m.method from fee_receipt_methods m where m.receipt_id = r.id order by m.amount_paise desc limit 1) method, r.number
          from fee_receipts r where r.status in ${LIVE} and r.date = ${today}::date order by r.created_at desc limit 8`).then(asRows),
        tx.execute<{ method: PayMethod; paise: string }>(sql`with ${receiptMoney(today, today)} select method, sum(paise) paise from mon where method <> 'advance' group by method`).then(asRows),
      ]);
      return {
        summary, ageing: top.totals.ageing,
        byClass: byClass.map((c) => ({ classId: c.id, name: c.name, students: num(c.students), due: num(c.due), overdue: num(c.overdue), overdueStudents: num(c.overdue_students) })).filter((c) => c.due > 0),
        chase: top.rows,
        today: { receipts: today_.map((r) => ({ id: r.id, receiptNo: r.number, amountPaise: num(r.amount), method: r.method ?? "cash", studentId: r.student_id, student: r.student })), byMethod: byMethod.map((m) => ({ method: m.method as PayMethod, paise: num(m.paise), label: METHOD_LABEL[m.method] })).sort((a, b) => b.paise - a.paise) },
      };
    });
  }

  /** Money collected per day (last `span` days) or per month (last `span` months), zero-filled. */
  async trend(unit: "day" | "month" = "day", span = unit === "day" ? 30 : 12): Promise<TrendPoint[]> {
    return this.read("read", async (tx) => {
      const today = todayIST();
      const [y, m, d] = today.split("-").map(Number) as [number, number, number];
      const buckets: TrendPoint[] = [];
      for (let k = span - 1; k >= 0; k--) {
        const at = unit === "day" ? new Date(Date.UTC(y, m - 1, d - k)) : new Date(Date.UTC(y, m - 1 - k, 1));
        buckets.push({ key: at.toISOString().slice(0, unit === "day" ? 10 : 7), label: at.toLocaleDateString("en-IN", unit === "day" ? { day: "numeric", month: "short", timeZone: "UTC" } : { month: "short", year: "2-digit", timeZone: "UTC" }), paise: 0 });
      }
      const from = unit === "day" ? buckets[0]!.key : `${buckets[0]!.key}-01`;
      const rows = await tx.execute<{ day: string; paise: string }>(sql`with ${receiptMoney(from, today)}
        select to_char(rcp.date, ${unit === "day" ? "YYYY-MM-DD" : "YYYY-MM"}) as day, sum(mon.paise) paise from rcp join mon on mon.receipt_id = rcp.id where mon.method <> 'advance' group by 1`);
      for (const r of rows) { const b = buckets.find((x) => x.key === r.day); if (b) b.paise += num(r.paise); }
      return buckets;
    });
  }

  // ---------- collection reports ----------

  /** Money received between two days, grouped by head, class, method, cashier or day. Billed against collected is on `overview`. */
  async collection(o: { from: string; to: string; by: "head" | "class" | "method" | "cashier" | "day" }) {
    return this.read("read", async (tx) => {
      const [from, to] = [o.from, o.to];
      const run = async (q: ReturnType<typeof sql>) => asRows(await tx.execute<{ key: string | null; label: string | null; paise: string; n: string }>(q));
      const rows = o.by === "head" ? await run(sql`select coalesce(h.id::text, l.kind) key, coalesce(h.name, case l.kind when 'late' then 'Late fee' when 'bounce' then 'Bounce charge' when 'opening' then 'Opening balance' else 'Other' end) label, sum(a.amount_paise) paise, count(distinct a.receipt_id) n
          from fee_allocations a join fee_receipts r on r.id = a.receipt_id join fee_invoice_lines l on l.id = a.invoice_line_id left join fee_heads h on h.id = l.head_id
          where a.undone_at is null and r.status in ${LIVE} and r.date between ${from}::date and ${to}::date group by 1, 2 order by 3 desc`)
        : o.by === "class" ? await run(sql`select coalesce(c.id::text, 'none') key, coalesce(c.name, 'No class') label, sum(a.amount_paise) paise, count(distinct a.receipt_id) n
          from fee_allocations a join fee_receipts r on r.id = a.receipt_id join fee_invoice_lines l on l.id = a.invoice_line_id join fee_invoices i on i.id = l.invoice_id left join classes c on c.id = i.class_id
          where a.undone_at is null and r.status in ${LIVE} and r.date between ${from}::date and ${to}::date group by 1, 2 order by 3 desc`)
        : o.by === "method" ? await run(sql`select m.method key, m.method label, sum(m.amount_paise) paise, count(distinct r.id) n from fee_receipts r join fee_receipt_methods m on m.receipt_id = r.id
          where r.status in ${LIVE} and m.method <> 'advance' and r.date between ${from}::date and ${to}::date group by 1, 2 order by 3 desc`)
        : o.by === "cashier" ? await run(sql`select coalesce(u.id::text, 'none') key, coalesce(u.name, 'Unknown') label, sum(r.amount_paise) paise, count(*) n from fee_receipts r left join users u on u.id = r.collected_by
          where r.status in ${LIVE} and r.date between ${from}::date and ${to}::date group by 1, 2 order by 3 desc`)
        : await run(sql`select r.date::text key, r.date::text label, sum(r.amount_paise) paise, count(*) n from fee_receipts r where r.status in ${LIVE} and r.date between ${from}::date and ${to}::date group by 1, 2 order by 1`);
      const out = rows.map((r) => ({ key: r.key ?? "", label: o.by === "method" ? METHOD_LABEL[r.label as PayMethod] ?? String(r.label) : r.label ?? "", paise: num(r.paise), receipts: num(r.n) }));
      return { rows: out, totalPaise: out.reduce((s, r) => s + r.paise, 0) };
    });
  }
}

