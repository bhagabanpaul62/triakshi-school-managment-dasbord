import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { FeesBase } from "./base";

export interface Mismatch { check: "totals" | "paid" | "dues" | "advances" | "deposits" | "journals" | "counters"; studentId?: string; invoiceId?: string; expectedPaise: number; actualPaise: number; message: string }

/** Controls that must always hold. They run nightly and in tests; a mismatch is shown to the admin, never fixed silently. */
export class ChecksService extends FeesBase {
  async run(): Promise<{ ok: boolean; mismatches: Mismatch[] }> {
    return this.read("read", async (tx) => {
      const mismatches = await this.runIn(tx);
      return { ok: mismatches.length === 0, mismatches };
    });
  }

  async runIn(tx: Tx): Promise<Mismatch[]> {
    const q = async <T,>(query: ReturnType<typeof sql>) => [...(await tx.execute<T & Record<string, unknown>>(query))] as (T & Record<string, unknown>)[];
    const n = (v: unknown) => Number(v ?? 0);
    const out: Mismatch[] = [];
    const lines = sql`select invoice_id, coalesce(sum(amount_paise) filter (where kind <> 'late'), 0) gross, coalesce(sum(amount_paise) filter (where kind = 'late'), 0) late, coalesce(sum(concession_paise), 0) conc, coalesce(sum(credited_paise), 0) cred, coalesce(sum(paid_paise), 0) paid from fee_invoice_lines group by invoice_id`;
    for (const r of await q<{ id: string; number: string | null }>(sql`select i.id, i.number, i.gross_paise + i.late_paise - i.concession_paise - i.credited_paise - i.paid_paise cached, s.gross + s.late - s.conc - s.cred - s.paid actual
      from fee_invoices i join (${lines}) s on s.invoice_id = i.id where i.gross_paise <> s.gross or i.late_paise <> s.late or i.concession_paise <> s.conc or i.credited_paise <> s.cred or i.paid_paise <> s.paid limit 50`)) {
      out.push({ check: "totals", invoiceId: r.id, expectedPaise: n(r.actual), actualPaise: n(r.cached), message: `The saved totals of bill ${r.number ?? r.id} do not match its lines.` });
    }
    for (const r of await q<{ id: string }>(sql`select l.id, l.invoice_id, l.paid_paise, coalesce(a.s, 0) alloc from fee_invoice_lines l
      left join (select invoice_line_id, sum(amount_paise) s from fee_allocations where undone_at is null group by 1) a on a.invoice_line_id = l.id where l.paid_paise <> coalesce(a.s, 0) limit 50`)) {
      out.push({ check: "paid", invoiceId: r.invoice_id as string, expectedPaise: n(r.alloc), actualPaise: n(r.paid_paise), message: "A bill line shows a different paid amount than the money allocated to it." });
    }
    const ledger = (key: string) => sql`select jl.party_id sid, sum(jl.debit_paise - jl.credit_paise) bal from fin_journal_lines jl join fin_accounts a on a.id = jl.account_id where a.system_key = ${key} and jl.party_type = 'student' group by 1`;
    const booked = sql`exists (select 1 from fin_journals j where j.source_key = case when l.kind = 'late' then 'fees:late:' || l.id::text else 'fees:invoice:' || i.id::text end)`;
    const compare = async (check: Mismatch["check"], key: string, list: ReturnType<typeof sql>, label: string, sign = 1) => {
      for (const r of await q<{ sid: string }>(sql`with led as (${ledger(key)}), lst as (${list})
        select coalesce(led.sid, lst.sid) sid, coalesce(led.bal, 0) * ${sign} ledger, coalesce(lst.bal, 0) listed from led full join lst on lst.sid = led.sid where coalesce(led.bal, 0) * ${sign} <> coalesce(lst.bal, 0) limit 50`)) {
        out.push({ check, studentId: r.sid, expectedPaise: n(r.listed), actualPaise: n(r.ledger), message: `${label} in the ledger (${n(r.ledger)}) does not match the student's own list (${n(r.listed)}).` });
      }
    };
    await compare("dues", "student_dues", sql`select i.student_id sid, sum(l.amount_paise - l.concession_paise - l.credited_paise - l.paid_paise) bal from fee_invoice_lines l join fee_invoices i on i.id = l.invoice_id where i.status = 'issued' and ${booked} group by 1`, "Student dues");
    await compare("advances", "student_advances", sql`select student_id sid, sum(amount_paise) bal from fee_advances where kind <> 'deposit' group by 1`, "The advance", -1);
    await compare("deposits", "deposits_payable", sql`select sid, sum(bal) bal from (
      select i.student_id sid, case when ${booked} then l.amount_paise - l.credited_paise else l.paid_paise end bal from fee_invoice_lines l join fee_invoices i on i.id = l.invoice_id where i.status = 'issued' and l.kind = 'deposit'
      union all select student_id, amount_paise from fee_advances where kind = 'deposit') x group by 1`, "The deposit", -1);
    for (const r of await q<{ journal_id: string }>(sql`select journal_id, sum(debit_paise) d, sum(credit_paise) c from fin_journal_lines group by 1 having sum(debit_paise) <> sum(credit_paise) limit 20`)) {
      out.push({ check: "journals", expectedPaise: n(r.d), actualPaise: n(r.c), message: `Journal entry ${r.journal_id} does not balance.` });
    }
    // A counter difference is in the books only when it was decided (or small enough to need no decision); while it waits the cash account stays at what the box should hold.
    for (const r of await q<{ id: string; day: string; diff: string; state: string | null; booked: boolean }>(sql`select c.id, c.day, abs(c.counted_paise - c.expected_paise) diff, c.difference_state state,
      exists (select 1 from fin_journals j where j.source_key = 'fees:counter-diff:' || c.id::text) booked from fee_counters c where c.closed_at is not null and c.counted_paise <> c.expected_paise`)) {
      const waiting = r.state === "pending" || r.state === "recount";
      if (waiting === r.booked) out.push({ check: "counters", expectedPaise: waiting ? 0 : n(r.diff), actualPaise: r.booked ? n(r.diff) : 0, message: waiting ? `The counter of ${r.day} still waits for a decision but its difference is already in the books.` : `The counter of ${r.day} has a decided difference that is not in the books.` });
    }
    return out;
  }
}
