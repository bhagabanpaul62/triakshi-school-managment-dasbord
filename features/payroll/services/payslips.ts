import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NotFoundError } from "@smw/feature-kit";
import { inWords, rupees } from "@smw/feature-kit/money";
import type { DocumentData } from "@smw/feature-finance/templates/config";
import { TemplateService } from "@smw/feature-finance/templates/service";
import { monthLabel } from "../csv";
import { PayrollService } from "../base";
import { payItems, payLines, payProfiles, payRuns } from "../schema";
import { NotificationWriter } from "@smw/feature-notifications/writer";

export interface PayslipRow { itemId: string; payslipNo: string; month: string; label: string; runLabel: string; netPaise: number; grossPaise: number; payout: string }

export class PayslipService extends PayrollService {
  /** Payslips of one person, newest first. Payroll staff may ask for anyone; everyone else only for themselves. */
  async list(userId?: string): Promise<PayslipRow[]> {
    const id = userId ?? this.ctx.userId;
    this.assertCanSee(id);
    return this.read("self", async (tx) => {
      const rows = await tx.select({ i: payItems, r: payRuns }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
        .where(and(eq(payItems.userId, id), inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`, sql`${payItems.payslipNo} is not null`)).orderBy(desc(payRuns.month), desc(payRuns.createdAt));
      if (id === this.ctx.userId && !this.ctx.readOnly && !this.ctx.supportStaffId) for (const { i } of rows) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "payslip", id: i.id }, { userId: id });
      return rows.map(({ i, r }) => ({ itemId: i.id, payslipNo: i.payslipNo!, month: r.month, label: monthLabel(r.month), runLabel: r.label, netPaise: Number(i.netPaise), grossPaise: Number(i.grossPaise), payout: i.payout }));
    });
  }

  /** The words and numbers of a payslip, ready for the shared document layout. */
  async data(itemId: string): Promise<{ data: DocumentData; filename: string; version: number | null; userId: string }> {
    return this.read("self", async (tx) => {
      const [row] = await tx.select({ i: payItems, r: payRuns }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId)).where(eq(payItems.id, itemId));
      // Someone else's payslip looks the same as one that does not exist, so nothing leaks.
      if (!row || !["approved", "paid"].includes(row.r.status) || row.i.skippedReason || !row.i.payslipNo) throw new NotFoundError("Payslip");
      this.assertCanSee(row.i.userId);
      const [who, lines, [prof]] = await Promise.all([this.people(tx, [row.i.userId]), tx.select().from(payLines).where(eq(payLines.itemId, itemId)).orderBy(payLines.sort), tx.select().from(payProfiles).where(eq(payProfiles.userId, row.i.userId))]);
      const p = who.get(row.i.userId)!;
      const earn = lines.filter((l) => l.kind === "earning"), cut = lines.filter((l) => l.kind === "deduction");
      const sum = (ls: typeof lines) => ls.reduce((a, l) => a + Number(l.amountPaise), 0);
      const days = (row.i.paidHalfDays / 2).toLocaleString("en-IN");
      const facts: [string, string][] = [["Employee", p.name], ["Employee ID", p.employeeId], ["Payslip no", row.i.payslipNo], ["Month", monthLabel(row.r.month)], ["Pay days", `${days} of ${row.i.calendarDays}`]];
      if (p.designation) facts.push(["Designation", p.designation]);
      if (p.department) facts.push(["Department", p.department]);
      if (prof?.panLast4) facts.push(["PAN", `XXXXXX${prof.panLast4}`]);
      if (prof?.bankLast4) facts.push(["Bank account", `XXXX${prof.bankLast4}`]);
      const named = (l: (typeof lines)[number]) => (l.note && !l.manual && l.code === null ? `${l.label} (${l.note})` : l.label);
      const rows = [...earn.map((l) => ({ item: named(l), earn: rupees(Number(l.amountPaise)), deduct: "" })), ...cut.map((l) => ({ item: l.label, earn: "", deduct: rupees(Number(l.amountPaise)) }))];
      const net = Number(row.i.netPaise);
      return {
        data: { facts, rows, totals: [["Total earnings", rupees(sum(earn))], ["Total deductions", rupees(sum(cut))], ["Net pay", rupees(net), true]], amountWords: inWords(net), notes: [], marks: [], qrSvg: null },
        filename: `payslip-${row.i.payslipNo.replace(/\//g, "-")}.pdf`, version: row.i.templateVersion, userId: row.i.userId,
      };
    });
  }

  /**
   * The PDF in the school's payslip layout, the version it was issued with. The layout service wants the finance grant,
   * which a teacher does not have, so it is asked with an admin context after this service has checked the right to this payslip.
   */
  async pdf(itemId: string): Promise<{ bytes: Uint8Array; filename: string }> {
    const { data, filename, version } = await this.data(itemId);
    const bytes = await new TemplateService({ ...this.ctx, role: "admin", grants: undefined }).render("payslip", data, version != null ? { version } : {});
    return { bytes, filename };
  }
}
