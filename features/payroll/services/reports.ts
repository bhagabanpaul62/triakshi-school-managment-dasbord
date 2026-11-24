import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { NotFoundError, ValidationError } from "@smw/feature-kit";
import { addMonths, fyOf, fyRange, monthStart, todayIST } from "@smw/feature-kit/money";
import { unseal } from "@smw/feature-kit/secret";
import { staffProfiles } from "@smw/feature-staff/schema";
import { monthLabel, rupeeText, toCsv } from "../csv";
import { PayrollService } from "../base";
import { payAssignments, payItems, payLines, payLoans, payProfiles, payRuns } from "../schema";
import { repaid } from "../compute";

export interface ReportColumn { key: string; label: string; type?: "text" | "money" | "number" }
export interface Report { name: string; title: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; groupKey?: string; note?: string }
export const REPORT_NAMES = { register: "Salary register", components: "Cost by month or department", bank: "Bank advice", pt: "Professional tax register", tds: "Income tax register", esi: "ESI sheet", statement: "Yearly salary statement", leave: "Leave liability", loans: "Loan ledger" } as const;
export type ReportName = keyof typeof REPORT_NAMES;
const params = z.object({ month: z.string().regex(/^\d{4}-\d{2}(-01)?$/).optional(), from: z.string().optional(), to: z.string().optional(), by: z.enum(["month", "department"]).default("month"), runId: z.uuid().optional(), userId: z.uuid().optional(), fy: z.string().regex(/^\d{4}-\d{2}$/).optional() });

export const reportCsv = (r: Report) => toCsv([r.columns.map((c) => c.label), ...r.rows.map((row) => r.columns.map((c) => (c.type === "money" ? rupeeText(Number(row[c.key] ?? 0)) : (row[c.key] as string | number | null | undefined))))]);

export class ReportService extends PayrollService {
  /** The live items of approved and paid runs in a month, with the person and the lines. */
  private async month(tx: Tx, month: string) {
    const items = await tx.select({ i: payItems, r: payRuns }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
      .where(and(eq(payRuns.month, month), inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`));
    const ids = items.map((x) => x.i.id);
    const [lines, people, profiles] = await Promise.all([ids.length ? tx.select().from(payLines).where(inArray(payLines.itemId, ids)) : [], this.people(tx, items.map((x) => x.i.userId)), items.length ? tx.select().from(payProfiles).where(inArray(payProfiles.userId, items.map((x) => x.i.userId))) : []]);
    const rows = items.map(({ i, r }) => {
      const mine = lines.filter((l) => l.itemId === i.id);
      const sum = (f: (c: string) => boolean) => mine.filter((l) => l.code && f(l.code)).reduce((a, l) => a + Number(l.amountPaise), 0);
      return { item: i, run: r, person: people.get(i.userId)!, profile: profiles.find((p) => p.userId === i.userId) ?? null, lines: mine, sum };
    }).sort((a, b) => a.person.name.localeCompare(b.person.name));
    return rows;
  }

  async build(name: ReportName, raw: unknown = {}): Promise<Report> {
    const p = this.parse(params, raw);
    const month = p.month ? `${p.month.slice(0, 7)}-01` : monthStart(todayIST());
    const title = REPORT_NAMES[name];
    if (!title) throw new NotFoundError("Report");
    if (name === "statement") return this.statement(p.userId ?? this.ctx.userId, p.fy ?? fyOf(todayIST()));
    this.authorize("read", "read");
    return this.read("read", async (tx) => {
      switch (name) {
        case "register": {
          const rows = (await this.month(tx, month)).map((r) => ({ employeeId: r.person.employeeId, name: r.person.name, group: r.person.department ?? "No department", days: (r.item.paidHalfDays / 2), gross: Number(r.item.grossPaise), pf: r.sum((c) => c === "pf_employee"), esi: r.sum((c) => c === "esi_employee"), pt: r.sum((c) => c === "pt"), tds: r.sum((c) => c === "tds"), other: Number(r.item.deductionsPaise) - r.sum((c) => ["pf_employee", "esi_employee", "pt", "tds"].includes(c)), net: Number(r.item.netPaise) }));
          return { name, title: `${title}, ${monthLabel(month)}`, groupKey: "group", rows, columns: [{ key: "name", label: "Person" }, { key: "employeeId", label: "ID" }, { key: "days", label: "Days", type: "number" }, { key: "gross", label: "Gross", type: "money" }, { key: "pf", label: "PF", type: "money" }, { key: "esi", label: "ESI", type: "money" }, { key: "pt", label: "Prof. tax", type: "money" }, { key: "tds", label: "TDS", type: "money" }, { key: "other", label: "Other", type: "money" }, { key: "net", label: "Net pay", type: "money" }] };
        }
        case "components": {
          const from = p.from ?? addMonths(month, -11), to = p.to ?? month;
          const rows = await tx.select({ m: payRuns.month, dept: staffProfiles.department, people: sql<number>`count(*)::int`, gross: sql<string>`sum(${payItems.grossPaise})`, ded: sql<string>`sum(${payItems.deductionsPaise})`, emp: sql<string>`sum(${payItems.employerPaise})`, net: sql<string>`sum(${payItems.netPaise})` })
            .from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId)).leftJoin(staffProfiles, eq(staffProfiles.userId, payItems.userId))
            .where(and(inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`, sql`${payRuns.month} >= ${from} and ${payRuns.month} <= ${to}`)).groupBy(payRuns.month, staffProfiles.department).orderBy(payRuns.month);
          const by = new Map<string, { label: string; people: number; gross: number; ded: number; emp: number; net: number }>();
          for (const r of rows) {
            const k = p.by === "month" ? r.m : r.dept ?? "No department";
            const g = by.get(k) ?? { label: p.by === "month" ? monthLabel(r.m) : k, people: 0, gross: 0, ded: 0, emp: 0, net: 0 };
            g.people = Math.max(g.people, r.people); g.gross += Number(r.gross); g.ded += Number(r.ded); g.emp += Number(r.emp); g.net += Number(r.net); by.set(k, g);
          }
          return { name, title: `${title}, ${p.by === "month" ? "by month" : "by department"}`, note: "Cost centres are not set per person, so there is no cost centre cut.", columns: [{ key: "label", label: p.by === "month" ? "Month" : "Department" }, { key: "people", label: "People", type: "number" }, { key: "gross", label: "Gross", type: "money" }, { key: "ded", label: "Deductions", type: "money" }, { key: "emp", label: "Employer cost", type: "money" }, { key: "net", label: "Net pay", type: "money" }], rows: [...by.values()] };
        }
        case "bank": {
          if (!p.runId) throw new ValidationError({ runId: "Pick a run." });
          const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, p.runId));
          if (!run) throw new NotFoundError("Pay run");
          const items = await tx.select().from(payItems).where(and(eq(payItems.runId, run.id), sql`${payItems.skippedReason} is null`));
          const [people, profiles] = await Promise.all([this.people(tx, items.map((i) => i.userId)), items.length ? tx.select().from(payProfiles).where(inArray(payProfiles.userId, items.map((i) => i.userId))) : []]);
          return { name, title: `${title}, ${run.label}`, columns: [{ key: "name", label: "Person" }, { key: "by", label: "Paid by" }, { key: "bank", label: "Bank" }, { key: "account", label: "Account" }, { key: "ifsc", label: "IFSC" }, { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status" }],
            rows: items.map((i) => { const pr = profiles.find((x) => x.userId === i.userId); return { name: people.get(i.userId)?.name, by: pr?.payBy ?? "bank", bank: pr?.bankName, account: pr?.bankLast4 ? `XXXX${pr.bankLast4}` : null, ifsc: pr?.ifsc, amount: Number(i.netPaise), status: i.payout }; }) };
        }
        case "pt": return { name, title: `${title}, ${monthLabel(month)}`, columns: [{ key: "name", label: "Person" }, { key: "state", label: "State" }, { key: "gross", label: "Gross", type: "money" }, { key: "pt", label: "Professional tax", type: "money" }], rows: (await this.month(tx, month)).filter((r) => r.sum((c) => c === "pt") > 0).map((r) => ({ name: r.person.name, state: r.profile?.state ?? "School's state", gross: Number(r.item.grossPaise), pt: r.sum((c) => c === "pt") })) };
        case "tds": {
          const rows = (await this.month(tx, month)).filter((r) => r.sum((c) => c === "tds") > 0);
          await this.audit(tx, { action: "export", entity: "Report", summary: "Opened the income tax register with PAN numbers", meta: { count: rows.length } });
          return { name, title: `${title}, ${monthLabel(month)}`, columns: [{ key: "name", label: "Person" }, { key: "pan", label: "PAN" }, { key: "gross", label: "Gross", type: "money" }, { key: "tds", label: "Tax deducted", type: "money" }], rows: rows.map((r) => ({ name: r.person.name, pan: r.profile?.panSealed ? unseal(r.profile.panSealed, this.ctx.schoolId) : null, gross: Number(r.item.grossPaise), tds: r.sum((c) => c === "tds") })) };
        }
        case "esi": {
          const rows = (await this.month(tx, month)).filter((r) => r.sum((c) => c === "esi_employee") > 0);
          await this.audit(tx, { action: "export", entity: "Report", summary: "Opened the ESI sheet with ESI numbers", meta: { count: rows.length } });
          return { name, title: `${title}, ${monthLabel(month)}`, columns: [{ key: "esi", label: "IP number" }, { key: "name", label: "Person" }, { key: "days", label: "Days", type: "number" }, { key: "gross", label: "Wages", type: "money" }, { key: "employee", label: "Employee share", type: "money" }, { key: "employer", label: "Employer share", type: "money" }], rows: rows.map((r) => ({ esi: r.profile?.esiSealed ? unseal(r.profile.esiSealed, this.ctx.schoolId) : null, name: r.person.name, days: r.item.paidHalfDays / 2, gross: Number(r.item.grossPaise), employee: r.sum((c) => c === "esi_employee"), employer: r.sum((c) => c === "esi_employer") })) };
        }
        case "leave": {
          const day = todayIST(), people = [...(await this.people(tx)).values()].filter((x) => !x.left);
          const config = await this.config(tx);
          const rows = [];
          for (const x of people) {
            const [a] = await tx.select({ g: payAssignments.grossPaise }).from(payAssignments).where(and(eq(payAssignments.userId, x.id), lte(payAssignments.fromDate, day))).orderBy(desc(payAssignments.fromDate)).limit(1);
            const half = (await this.sources.days.encashable(tx, x.id, day)).reduce((s, e) => s + e.halfDays, 0);
            if (a && half) rows.push({ name: x.name, days: half / 2, amount: Math.round((Number(a.g) * (half / 2)) / config.dayDivisor) });
          }
          return { name, title: `${title}, ${day}`, note: "Paid leave that can be cashed out, at gross divided by the day divisor in settings.", columns: [{ key: "name", label: "Person" }, { key: "days", label: "Days", type: "number" }, { key: "amount", label: "Liability", type: "money" }], rows };
        }
        case "loans": {
          const loans = await tx.select().from(payLoans).orderBy(payLoans.createdAt);
          const [paid, people] = await Promise.all([repaid(tx, loans.map((l) => l.id)), this.people(tx, [...new Set(loans.map((l) => l.userId))])]);
          return { name, title, columns: [{ key: "name", label: "Person" }, { key: "status", label: "Status" }, { key: "given", label: "Loan", type: "money" }, { key: "recovered", label: "Recovered", type: "money" }, { key: "balance", label: "Balance", type: "money" }], rows: loans.map((l) => ({ name: people.get(l.userId)?.name, status: l.status, given: Number(l.amountPaise), recovered: paid.get(l.id) ?? 0, balance: l.givenOn ? Number(l.amountPaise) - (paid.get(l.id) ?? 0) : 0 })) };
        }
        default: throw new NotFoundError("Report");
      }
    });
  }

  /** One person's year of pay. Anyone may open their own; payroll staff any. */
  private async statement(userId: string, fy: string): Promise<Report> {
    this.assertCanSee(userId);
    const [from, to] = fyRange(fy);
    return this.read("self", async (tx) => {
      const rows = await tx.select({ m: payRuns.month, i: payItems }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId)).where(and(eq(payItems.userId, userId), inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`, sql`${payRuns.month} >= ${from} and ${payRuns.month} <= ${to}`)).orderBy(payRuns.month);
      const tds = rows.length ? await tx.select({ id: payLines.itemId, v: payLines.amountPaise }).from(payLines).where(and(eq(payLines.code, "tds"), inArray(payLines.itemId, rows.map((r) => r.i.id)))) : [];
      const who = (await this.people(tx, [userId])).get(userId);
      return { name: "statement", title: `Salary statement ${fy}${who ? `, ${who.name}` : ""}`, columns: [{ key: "label", label: "Month" }, { key: "gross", label: "Gross", type: "money" }, { key: "ded", label: "Deductions", type: "money" }, { key: "tds", label: "Tax", type: "money" }, { key: "net", label: "Net pay", type: "money" }],
        rows: rows.map((r) => ({ label: monthLabel(r.m), gross: Number(r.i.grossPaise), ded: Number(r.i.deductionsPaise), tds: tds.filter((t) => t.id === r.i.id).reduce((a, t) => a + Number(t.v), 0), net: Number(r.i.netPaise) })) };
    });
  }

  /** The EPFO return file for a month: one line per person, fields joined by "#~#". Wages are worked back from the amounts and rates the run used. */
  async ecr(rawMonth: string): Promise<{ filename: string; text: string; count: number }> {
    this.authorize("read", "read");
    const month = monthStart(`${rawMonth.slice(0, 7)}-01`);
    return this.write("read", async (tx) => {
      const rows = (await this.month(tx, month)).filter((r) => r.sum((c) => c === "pf_employee") > 0);
      const lines = rows.map((r) => {
        const rate = (key: string, fallback: number) => Number(((r.item.snapshot as { rates?: { key: string; value: unknown }[] }).rates ?? []).find((x) => x.key === key)?.value ?? fallback);
        const wages = (code: string, bp: number) => Math.round(r.sum((c) => c === code) * 10_000 / bp / 100);
        const epf = r.sum((c) => c === "pf_employee"), eps = r.sum((c) => c === "eps_employer"), employer = r.sum((c) => c === "pf_employer") + eps;
        if (!r.profile?.uanSealed) throw new ValidationError({ uan: `${r.person.name} has no UAN. Add it before making the return file.` });
        return [unseal(r.profile.uanSealed, this.ctx.schoolId), r.person.name.toUpperCase(), Math.round(Number(r.item.grossPaise) / 100), wages("pf_employee", rate("pf_employee_bp", 1200)), wages("eps_employer", rate("eps_bp", 833)), wages("edli", rate("edli_bp", 50)), Math.round(epf / 100), Math.round(eps / 100), Math.round((employer - eps) / 100), r.item.unpaidHalfDays / 2, 0].join("#~#");
      });
      if (!lines.length) throw new ValidationError({ month: "Nobody paid provident fund in this month." });
      await this.audit(tx, { action: "export", entity: "Report", summary: "Made the PF return file with UAN numbers", meta: { count: lines.length, month } });
      return { filename: `ecr-${month.slice(0, 7)}.txt`, text: `${lines.join("\n")}\n`, count: lines.length };
    });
  }
}
