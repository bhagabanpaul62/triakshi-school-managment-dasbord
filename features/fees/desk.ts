import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schools } from "@smw/db";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { FeesBase, type Perm } from "./base";
import { dueNow, type DeskBill } from "./calc";
import { DuesService } from "./dues";
import { feeCounters, feeInvoices } from "./schema";

/**
 * What the money-taking screens need that is not one document's own business: the school's rules and pay details, finding
 * a student at the counter, and a family's open bills with their real lines.
 */
export class DeskService extends FeesBase {
  /** Staff need collect or read; a student login only reads the school's own pay details. */
  private perm(): Perm { return this.can("collect") ? "collect" : this.can("read") ? "read" : "self"; }

  /** School rules and pay details the counter and the pay page need. */
  async config() {
    return this.read(this.perm(), async (tx) => {
      const [s, [anyCounter], accounts, [school]] = await Promise.all([
        this.settings(tx),
        tx.select({ id: feeCounters.id }).from(feeCounters).limit(1),
        tx.select({ id: finCashAccounts.id, name: finCashAccounts.name, kind: finCashAccounts.kind, upiId: finCashAccounts.upiId, upiName: finCashAccounts.upiName }).from(finCashAccounts).where(eq(finCashAccounts.isActive, true)).orderBy(desc(finCashAccounts.isDefault), asc(finCashAccounts.name)),
        tx.select({ name: schools.name, phone: schools.phone, address: schools.address, city: schools.city }).from(schools).limit(1),
      ]);
      const upi = accounts.find((a) => a.upiId);
      return {
        today: todayIST(), lateFeeFirst: s.lateFeeFirst, cashLimitPaise: s.cashLimitPaise, backdateDays: s.backdateDays, bounceChargePaise: s.bounceChargePaise, upiOn: s.upiOn,
        officeHours: s.officeHours || null,
        usesCounters: !!anyCounter, school: { name: school?.name ?? "School", phone: school?.phone ?? null, address: [school?.address, school?.city].filter(Boolean).join(", ") || null },
        upi: upi ? { upiId: upi.upiId!, name: upi.upiName ?? school?.name ?? "School" } : null,
        banks: accounts.filter((a) => a.kind === "bank").map((a) => ({ id: a.id, name: a.name })),
      };
    });
  }

  /** Students by name, admission number, a guardian's phone or a bill number; each with what is due. */
  async find(q: string) {
    const t = q.trim();
    if (t.length < 2) return [];
    return this.read(this.can("collect") ? "collect" : "read", async (tx) => {
      const like = `%${t.replace(/[%_]/g, "")}%`;
      const rows = [...(await tx.execute<{ id: string; name: string; admission_no: string; cls: string; due: string }>(sql`
        select s.id, s.name, s.admission_no, coalesce(c.name || coalesce('-' || sec.name, ''), '-') cls,
          (select coalesce(sum(i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise), 0) from fee_invoices i where i.student_id = s.id and i.status = 'issued') due
        from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
        where s.name ilike ${like} or s.admission_no ilike ${like}
          or exists (select 1 from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = s.id and g.phone ilike ${like})
          or exists (select 1 from fee_invoices i where i.student_id = s.id and i.number ilike ${like})
        order by s.name limit 8`))];
      return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.admission_no} · ${r.cls}${Number(r.due) > 0 ? ` · ${rupees(Number(r.due))} due` : ""}` }));
    });
  }

  /** The picked student's family: every open bill of every sibling with its real lines (the preview uses them) and each child's advance. */
  async family(studentId: string) {
    const fam = await new DuesService(this.ctx).family(studentId);
    const ids = fam.members.flatMap((m) => m.bills.map((b) => b.id));
    const loaded = ids.length ? await this.read(this.can("collect") ? "collect" : "read", (tx) => this.loadInvoices(tx, inArray(feeInvoices.id, ids))) : [];
    const bills: DeskBill[] = fam.members.flatMap((m) => m.bills.map((b) => {
      const full = loaded.find((l) => l.id === b.id);
      return { id: b.id, studentId: m.student.id, studentName: m.student.name, number: b.number, label: b.label, dueDate: b.dueDate, state: b.state, openPaise: b.openPaise, accruedLatePaise: b.accruedLatePaise,
        parts: full?.parts ?? [], lines: (full?.lines ?? []).map((l) => ({ id: l.id, label: l.label, kind: l.kind, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise, creditedPaise: l.creditedPaise, paidPaise: l.paidPaise, sort: l.sort })) };
    }));
    const members = fam.members.map((m) => ({
      id: m.student.id, name: m.student.name, admissionNo: m.student.admissionNo, classLabel: m.student.classLabel, advancePaise: m.advancePaise, waitingAdvancePaise: m.waitingAdvancePaise, duePaise: m.openPaise,
      overduePaise: bills.filter((b) => b.studentId === m.student.id && b.state === "overdue").reduce((s, b) => s + dueNow(b), 0),
    }));
    return { members, bills, totalPaise: fam.totalPaise };
  }
}
