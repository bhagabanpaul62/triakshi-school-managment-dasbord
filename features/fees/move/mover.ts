// Moves one school's old fee tables into the finance engine inside the caller's transaction. See docs/FINANCE-PRD.md section 9.
// Nothing old is edited or deleted. Anything the old calculator and the new tables disagree on, and the move cannot explain, throws.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { auditLogs, uuidv7, type Tx } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { apportion, todayIST } from "@smw/feature-kit/money";
import { cashAccount, type PostLine } from "@smw/feature-finance/posting";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { studentEnrollments, students } from "@smw/feature-students/schema";
import { FeesBase, calcOf, newToken, type InvoiceFull } from "../base";
import { invoiceLateFee, openOf } from "../calc";
import { ChecksService } from "../checks";
import { InvoiceService } from "../invoices";
import { feeAdvances, feeCharges, feeCheques, feeConcessionUses, feeConcessions, feeHeads, feeInvoiceLines, feeInvoices, feePaymentAllocations, feePayments, feePlanClasses, feePlanDues, feePlanLines, feePlans, feeReceiptMethods, feeReceipts, feeStructureItems, feeStructures, installments, lateFeeRules, studentConcessions } from "../schema";
import { FeeCalculator } from "./legacy-calculator";
import { differences, expectedNumbers, legacyInput, lateRuleFor, planStudentYear, sortedInstalments, type Numbers, type OldCharge, type OldConcession, type OldPayment, type OldStructure, type PlannedBill, type YearPlan } from "./plan";

export const MOVE_ACTION = "move-fees";
const zero = (): Numbers => ({ gross: 0, concession: 0, late: 0, paid: 0, due: 0 });
const add = (a: Numbers, b: Numbers): Numbers => ({ gross: a.gross + b.gross, concession: a.concession + b.concession, late: a.late + b.late, paid: a.paid + b.paid, due: a.due + b.due });

export interface MoveReport {
  schoolId: string;
  status: "moved" | "already moved" | "nothing to move";
  today: string;
  counts: Record<string, number>;
  /** Old calculator numbers (all students and years), the new tables, and what separates them on purpose. */
  totals: { old: Numbers; new: Numbers; notBilled: Numbers; creditToAdvance: number };
  receipts: { oldValidPaise: number; newValidPaise: number; reversed: number; advancePaise: number };
  /** D1: money on instalments that are not on the student's bills for that year. It is held as an advance. */
  orphans: { student: string; receiptNo: string; paidOn: string; paise: number; oldAppDuePaise: number | null; newDuePaise: number; advancePaise: number }[];
  /** A concession added after money was paid: the extra is held as an advance. */
  credits: { student: string; receiptNo: string; paise: number }[];
  /** D4: students who left, with instalments after they left that were not billed. */
  notBilled: { student: string; instalments: number; oldDuePaise: number; newDuePaise: number }[];
  /** D3: dues of years other than the current one (the old dues screen showed only the current year). */
  pastYearDues: { year: string; students: number; duePaise: number }[];
}

interface YearCase { studentId: string; yearId: string; plan: YearPlan; structure: OldStructure | null; concessions: OldConcession[]; charges: OldCharge[]; classId: string | null; sectionId: string | null; classLabel: string }

const lines = (xs: string[]) => xs.map((x) => `  - ${x}`).join("\n");

/** Moves the fee data of the school the context belongs to. */
export class FeeMover extends FeesBase {
  static for(schoolId: string) { return new FeeMover(systemCtx(schoolId, ["fees", "finance"])); }

  async run(tx: Tx, o: { today?: string } = {}): Promise<MoveReport> {
    const today = o.today ?? todayIST();
    const schoolId = this.ctx.schoolId;
    const report: MoveReport = {
      schoolId, status: "moved", today, counts: {}, totals: { old: zero(), new: zero(), notBilled: zero(), creditToAdvance: 0 },
      receipts: { oldValidPaise: 0, newValidPaise: 0, reversed: 0, advancePaise: 0 }, orphans: [], credits: [], notBilled: [], pastYearDues: [],
    };

    const [already] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.module, "fees"), eq(auditLogs.action, MOVE_ACTION))).limit(1);
    const [movedReceipt] = await tx.execute<{ n: string }>(sql`select count(*) n from fee_receipts r join fee_payments p on p.receipt_no = r.number and p.school_id = r.school_id`);
    if (already || Number(movedReceipt!.n) > 0) return { ...report, status: "already moved" };

    // ---- read the old tables ----
    const [years, classRows, sectionRows, studentRows, enrols, heads, structRows, itemRows, instRows, ruleRows, concRows, chargeRows, payRows, allocRows] = await Promise.all([
      tx.select().from(academicYears).orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn)),
      tx.select({ id: classes.id, name: classes.name }).from(classes), tx.select({ id: sections.id, name: sections.name }).from(sections),
      tx.select().from(students).orderBy(asc(students.admissionNo), asc(students.id)), tx.select().from(studentEnrollments), tx.select().from(feeHeads),
      tx.select().from(feeStructures), tx.select().from(feeStructureItems), tx.select().from(installments), tx.select().from(lateFeeRules),
      tx.select().from(studentConcessions).orderBy(asc(studentConcessions.createdAt), asc(studentConcessions.id)), tx.select().from(feeCharges),
      tx.select().from(feePayments).orderBy(asc(feePayments.paidOn), asc(feePayments.receiptNo)), tx.select().from(feePaymentAllocations),
    ]);
    if (!payRows.length && !structRows.length && !chargeRows.length && !concRows.length) return { ...report, status: "nothing to move" };

    const classNames = new Map(classRows.map((c) => [c.id, c.name])), sectionNames = new Map(sectionRows.map((s) => [s.id, s.name]));
    const label = (classId: string | null, sectionId: string | null) => (classId ? `${classNames.get(classId) ?? "-"}${sectionId && sectionNames.has(sectionId) ? `-${sectionNames.get(sectionId)}` : ""}` : "-");
    const headBy = new Map(heads.map((h) => [h.id, h]));
    const current = years[0];
    const started = years.filter((y) => y.startsOn <= today);

    const structures = structRows.map((s): OldStructure => ({
      id: s.id, yearId: s.yearId, classId: s.classId, name: s.name,
      items: itemRows.filter((i) => i.structureId === s.id).sort((a, b) => headBy.get(a.headId)!.name.localeCompare(headBy.get(b.headId)!.name) || a.headId.localeCompare(b.headId))
        .map((i) => ({ headId: i.headId, headName: headBy.get(i.headId)!.name, headType: headBy.get(i.headId)!.type, amountPaise: i.amountPaise })),
      installments: instRows.filter((i) => i.structureId === s.id).map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise })),
      lateRules: ruleRows.filter((r) => r.structureId === s.id).map((r) => ({ installmentId: r.installmentId, kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise })),
    }));
    for (const s of structures) if (s.installments.length && !s.items.length) throw new Error(`Fee structure "${s.name}" has instalments but no fees: fix it in the old screens, then move again.`);
    const structureByClassYear = new Map(structures.map((s) => [`${s.yearId}:${s.classId}`, s]));
    const structureOfInstalment = new Map(structures.flatMap((s) => s.installments.map((i) => [i.id, s] as const)));

    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const allocsOf = new Map<string, typeof allocRows>();
    for (const a of allocRows) allocsOf.set(a.paymentId, [...(allocsOf.get(a.paymentId) ?? []), a]);
    const toOld = (p: (typeof payRows)[number]): OldPayment => ({ id: p.id, paidOn: p.paidOn, amountPaise: p.amountPaise, allocations: (allocsOf.get(p.id) ?? []).map((a) => ({ installmentId: a.installmentId, chargeId: a.chargeId, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise })) });
    const validOf = new Map<string, OldPayment[]>();
    for (const p of payRows.filter((x) => x.status === "valid")) validOf.set(p.studentId, [...(validOf.get(p.studentId) ?? []), toOld(p)]);
    for (const p of payRows) {
      const sum = (allocsOf.get(p.id) ?? []).reduce((a, x) => a + x.amountPaise + x.lateFeePaise, 0);
      if (p.status === "valid" && sum !== p.amountPaise) throw new Error(`Receipt ${p.receiptNo}: the payment is ${p.amountPaise} paise but its allocations add up to ${sum}. Nothing was moved.`);
    }
    const unknownAlloc = allocRows.find((a) => !a.installmentId && !a.chargeId);
    if (unknownAlloc) throw new Error(`A payment allocation (${unknownAlloc.id}) points at neither an instalment nor a charge. Nothing was moved.`);

    // ---- which class a student was in, each year ----
    const enrolOf = new Map(enrols.map((e) => [`${e.studentId}:${e.yearId}`, e]));
    const classOfYear = (s: (typeof studentRows)[number], yearId: string): { classId: string | null; sectionId: string | null } => {
      const e = enrolOf.get(`${s.id}:${yearId}`);
      if (e?.classId) return { classId: e.classId, sectionId: e.sectionId };
      if (current && yearId === current.id) return { classId: s.classId, sectionId: s.sectionId };
      // A past year with no enrolment row: the structure their payments were made on.
      const paid = new Map<string, number>();
      for (const p of validOf.get(s.id) ?? []) for (const a of p.allocations) { const st = a.installmentId ? structureOfInstalment.get(a.installmentId) : undefined; if (st?.yearId === yearId) paid.set(st.classId, (paid.get(st.classId) ?? 0) + a.amountPaise); }
      const best = [...paid].sort((a, b) => b[1] - a[1])[0];
      return { classId: best?.[0] ?? null, sectionId: null };
    };

    // ---- plan every student and year ----
    const cases: YearCase[] = [];
    const chargesBy = new Map<string, typeof chargeRows>(), concsBy = new Map<string, typeof concRows>();
    for (const c of chargeRows.filter((x) => x.status === "active")) chargesBy.set(`${c.studentId}:${c.yearId}`, [...(chargesBy.get(`${c.studentId}:${c.yearId}`) ?? []), c]);
    for (const c of concRows) concsBy.set(`${c.studentId}:${c.yearId}`, [...(concsBy.get(`${c.studentId}:${c.yearId}`) ?? []), c]);
    for (const s of studentRows) {
      for (const y of started) {
        const where = classOfYear(s, y.id);
        const structure = where.classId ? structureByClassYear.get(`${y.id}:${where.classId}`) ?? null : null;
        const charges = (chargesBy.get(`${s.id}:${y.id}`) ?? []).map((c): OldCharge => ({ id: c.id, kind: c.kind, label: c.label, dueDate: c.dueDate, amountPaise: c.amountPaise, sourceKey: c.sourceKey }));
        if (!structure && !charges.length) continue;
        const concessions = (concsBy.get(`${s.id}:${y.id}`) ?? []).map((c): OldConcession => ({ id: c.id, headId: c.headId, kind: c.kind, value: c.value }));
        const plan = planStudentYear({ structure, concessions, charges, payments: validOf.get(s.id) ?? [], active: s.status === "active", leftOn: s.leftOn, today });
        cases.push({ studentId: s.id, yearId: y.id, plan, structure, concessions, charges, classId: where.classId, sectionId: where.sectionId, classLabel: label(where.classId, where.sectionId) });
      }
    }
    // A bill must carry money: a structure with nothing to bill is a data problem to fix first.
    for (const c of cases) for (const b of c.plan.bills) if (!b.lines.length) throw new Error(`"${b.label}" of ${studentById.get(c.studentId)!.name} has no amount. Nothing was moved.`);

    // ---- plans ----
    const rootOf = new Map<string, string>(), planLines = new Map<string, Map<string, string>>();
    const yearBy = new Map(years.map((y) => [y.id, y]));
    for (const s of structures) {
      const rootId = uuidv7();
      const general = lateRuleFor(s, null);
      const [plan] = await tx.insert(feePlans).values({ schoolId, yearId: s.yearId, rootId, version: 1, name: s.name, status: "published", admissionType: "all", lateRule: general, joinRule: "full", note: "Moved from the old fee structure.", publishedAt: new Date() }).returning({ id: feePlans.id });
      await tx.insert(feePlanClasses).values({ schoolId, planId: plan!.id, classId: s.classId });
      rootOf.set(s.id, rootId);
      const lineIds = new Map<string, string>();
      const sorted = sortedInstalments(s), per = sorted.map((i) => apportion(i.amountPaise, s.items.map((x) => x.amountPaise)));
      for (const [k, it] of s.items.entries()) {
        const [pl] = await tx.insert(feePlanLines).values({ schoolId, planId: plan!.id, headId: it.headId, optional: false }).returning({ id: feePlanLines.id });
        lineIds.set(it.headId, pl!.id);
        const dues = sorted.flatMap((i, n) => (per[n]![k]! > 0 ? [{ schoolId, lineId: pl!.id, dueKey: `inst-${i.id.replace(/-/g, "").slice(-12)}`, label: i.name, billOn: i.dueDate < yearBy.get(s.yearId)!.startsOn ? i.dueDate : yearBy.get(s.yearId)!.startsOn, dueOn: i.dueDate, amountPaise: per[n]![k]! }] : []));
        if (dues.length) await tx.insert(feePlanDues).values(dues);
      }
      planLines.set(s.id, lineIds);
    }

    // ---- concessions ----
    const concessionId = new Map<string, string>();
    for (const c of concRows) {
      const [row] = await tx.insert(feeConcessions).values({ schoolId, studentId: c.studentId, yearId: c.yearId, typeId: null, headId: c.headId, mode: c.kind, value: c.value, reason: c.reason, status: "approved", createdBy: c.approvedBy, per: "year", createdAt: c.createdAt }).returning({ id: feeConcessions.id });
      concessionId.set(c.id, row!.id);
    }

    // ---- bills, in due-date order so the numbers read like the school's own year ----
    const bills = cases.flatMap((c) => c.plan.bills.map((b) => ({ c, b }))).sort((x, y) => x.b.dueDate.localeCompare(y.b.dueDate) || studentById.get(x.c.studentId)!.admissionNo.localeCompare(studentById.get(y.c.studentId)!.admissionNo) || x.b.ref.localeCompare(y.b.ref));
    const invoices = new InvoiceService(this.ctx);
    const settings = await this.settings(tx);
    const guardians = new Map<string, string | null>();
    const billed = new Map<string, { invoiceId: string; lineIds: string[]; number: string; nextSort: number }>();
    const movedIds: string[] = [];
    for (const { c, b } of bills) {
      const s = studentById.get(c.studentId)!;
      if (!guardians.has(s.id)) guardians.set(s.id, (await this.snapshot(tx, { id: s.id, name: s.name, admissionNo: s.admissionNo, classId: s.classId, sectionId: s.sectionId, status: s.status, leftOn: s.leftOn, classLabel: "" })).guardian);
      const sourceKey = b.kind === "plan" ? `plan:${rootOf.get(c.structure!.id)}:${s.id}:${b.dueKey}` : b.sourceKey!;
      const [dup] = await tx.select({ id: feeInvoices.id }).from(feeInvoices).where(and(eq(feeInvoices.sourceKey, sourceKey), sql`${feeInvoices.status} <> 'cancelled'`));
      if (dup) throw new Error(`A bill with source ${sourceKey} already exists, so ${s.name}'s "${b.label}" cannot be moved. Nothing was moved.`);
      const id = await invoices.createDraft(tx, {
        studentId: s.id, yearId: c.yearId, kind: b.kind, label: b.label, dueDate: b.dueDate, sourceKey, classId: c.classId, lateRule: b.lateRule,
        snapshot: { studentName: s.name, admissionNo: s.admissionNo, classLabel: c.classLabel, guardian: guardians.get(s.id) ?? null },
        lines: b.lines.map((l) => ({ headId: l.headId, kind: l.kind, label: l.label, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise })),
      });
      await invoices.issueIn(tx, [id], b.issueDate);
      const [row] = await tx.select({ number: feeInvoices.number }).from(feeInvoices).where(eq(feeInvoices.id, id));
      const lineRows = await tx.select({ id: feeInvoiceLines.id }).from(feeInvoiceLines).where(eq(feeInvoiceLines.invoiceId, id)).orderBy(asc(feeInvoiceLines.sort));
      billed.set(`${c.studentId}:${c.yearId}:${b.ref}`, { invoiceId: id, lineIds: lineRows.map((l) => l.id), number: row!.number!, nextSort: lineRows.length });
      movedIds.push(id);
      for (const u of b.uses) await tx.insert(feeConcessionUses).values({ schoolId, concessionId: concessionId.get(u.concessionId)!, invoiceId: id, amountPaise: u.amountPaise });
    }
    report.counts = { students: new Set(cases.map((c) => c.studentId)).size, plans: structures.length, invoices: bills.length, concessions: concRows.length };
    for (const k of ["plan", "transport", "library_fine", "custom"] as const) report.counts[`invoices_${k}`] = bills.filter((x) => x.b.kind === k).length;

    // ---- receipts ----
    const placed = new Map<string, number>(), credit = new Map<string, number>();
    for (const c of cases) {
      for (const [id, n] of c.plan.placed) placed.set(id, (placed.get(id) ?? 0) + n);
      for (const x of c.plan.credits) credit.set(x.paymentId, (credit.get(x.paymentId) ?? 0) + x.amountPaise);
    }
    type Place = { c: YearCase; b: PlannedBill };
    const placesOf = new Map<string, Place[]>();
    for (const c of cases) for (const b of c.plan.bills) {
      const ids = new Set([...b.principal.map((x) => x.paymentId), ...b.late.flatMap((l) => l.paid.map((p) => p.paymentId))]);
      for (const id of ids) placesOf.set(id, [...(placesOf.get(id) ?? []), { c, b }]);
    }
    const templateVersion = await this.templateVersionIn(tx, "receipt");
    const bank = await cashAccount(tx, schoolId, { kind: "bank" }), cash = await cashAccount(tx, schoolId, { kind: "cash" });
    const studentLine = (s: (typeof studentRows)[number]) => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, classId: s.classId, sectionId: s.sectionId, status: s.status, leftOn: s.leftOn, classLabel: label(s.classId, s.sectionId) });
    const orphanRows: { payment: (typeof payRows)[number]; rest: number }[] = [];

    const snapshots = new Map<string, Awaited<ReturnType<FeeMover["snapshot"]>>>();
    for (const p of payRows) {
      const s = studentById.get(p.studentId)!;
      if (!snapshots.has(s.id)) snapshots.set(s.id, await this.snapshot(tx, studentLine(s)));
      const snapshot = snapshots.get(s.id)!;
      const valid = p.status === "valid";
      const rest = valid ? p.amountPaise - (placed.get(p.id) ?? 0) : 0;
      const advance = valid ? rest + (credit.get(p.id) ?? 0) : 0;
      const [receipt] = await tx.insert(feeReceipts).values({
        schoolId, number: p.receiptNo, studentId: s.id, date: p.paidOn, amountPaise: p.amountPaise, advancePaise: advance, status: valid ? "valid" : "reversed", counterId: null, payerName: null, note: null,
        snapshot, templateVersion, verifyToken: newToken(), collectedBy: p.collectedBy, reverseReason: valid ? null : p.cancelReason, reversedAt: valid ? null : p.cancelledAt ?? p.updatedAt, createdAt: p.createdAt,
      }).returning({ id: feeReceipts.id });
      const method = p.method === "cash" ? cash : bank;
      await tx.insert(feeReceiptMethods).values({ schoolId, receiptId: receipt!.id, method: p.method, amountPaise: p.amountPaise, cashAccountId: p.method === "cheque" ? null : method.id, reference: p.reference });
      if (!valid) { report.receipts.reversed++; continue; }

      let chequeId: string | null = null;
      if (p.method === "cheque") {
        const [ch] = await tx.insert(feeCheques).values({ schoolId, receiptId: receipt!.id, chequeNo: p.reference ?? "-", bank: "Not recorded", chequeDate: p.paidOn, amountPaise: p.amountPaise, status: "cleared", depositedTo: bank.id, depositedOn: p.paidOn, clearedOn: p.paidOn }).returning({ id: feeCheques.id });
        chequeId = ch!.id;
      }
      const parts: { lineId: string; amountPaise: number }[] = [];
      for (const { c, b } of placesOf.get(p.id) ?? []) {
        const at = billed.get(`${c.studentId}:${c.yearId}:${b.ref}`)!;
        for (const x of b.principal) if (x.paymentId === p.id) parts.push({ lineId: at.lineIds[x.lineIndex]!, amountPaise: x.amountPaise });
        for (const l of b.late) {
          const mine = l.paid.find((x) => x.paymentId === p.id);
          if (mine) parts.push({ lineId: await this.lateLine(tx, at, c.studentId, l.date, l.amountPaise, settings.basis), amountPaise: mine.amountPaise });
        }
      }
      const slices = await this.applyParts(tx, parts, { receiptId: receipt!.id, date: p.paidOn });
      const credits = await this.creditLines(tx, slices);
      if (advance > 0) {
        await tx.insert(feeAdvances).values({ schoolId, studentId: s.id, kind: "receipt", amountPaise: advance, refId: receipt!.id, date: p.paidOn, note: `Receipt ${p.receiptNo}: ${rest > 0 ? "paid on a fee that is not on this student's bills" : "paid above a reduced bill"}` });
        credits.push({ account: "student_advances", credit: advance, party: { type: "student", id: s.id }, memo: "Advance" });
      }
      const debit: PostLine = p.method === "cheque" ? { account: "cheques", debit: p.amountPaise, memo: "Cheque" } : { account: { id: method.accountId }, debit: p.amountPaise };
      await this.post(tx, { date: p.paidOn, sourceKey: `fees:receipt:${receipt!.id}`, sourceType: "fee_receipt", sourceId: receipt!.id, memo: `Receipt ${p.receiptNo}`, lines: [debit, ...credits] });
      if (chequeId) await this.post(tx, { date: p.paidOn, sourceKey: `fees:cheque-clear:${chequeId}`, sourceType: "fee_receipt", sourceId: receipt!.id, memo: `Cheque ${p.reference ?? ""} cleared`, lines: [{ account: { id: bank.accountId }, debit: p.amountPaise }, { account: "cheques", credit: p.amountPaise }] });
      report.receipts.newValidPaise += p.amountPaise; report.receipts.advancePaise += advance;
      if (rest > 0) orphanRows.push({ payment: p, rest });
    }
    // Late fees the old calculator still showed as owed on a cleared bill: a line nobody has paid yet.
    for (const c of cases) for (const b of c.plan.bills) for (const l of b.late.filter((x) => x.paid.length === 0)) {
      await this.lateLine(tx, billed.get(`${c.studentId}:${c.yearId}:${b.ref}`)!, c.studentId, l.date, l.amountPaise, settings.basis);
    }
    report.counts.receipts = payRows.length;
    report.counts.late_lines = Number((await tx.execute<{ n: string }>(sql`select count(*) n from fee_invoice_lines where kind = 'late'`))[0]!.n);

    // The old receipt numbers keep running: make the next one come after the highest moved.
    const highest = new Map<string, number>();
    for (const p of payRows) { const m = /^[^/]+\/(\d{4}-\d{2})\/(\d+)$/.exec(p.receiptNo); if (m) highest.set(m[1]!, Math.max(highest.get(m[1]!) ?? 0, Number(m[2]))); }
    for (const [fy, n] of highest) {
      await tx.execute(sql`insert into sequences (id, school_id, key, value) values (${uuidv7()}, ${schoolId}, ${`receipt:${fy}`}, ${n})
        on conflict (school_id, key) do update set value = greatest(sequences.value, excluded.value), updated_at = now()`);
    }

    await this.verify(tx, { today, cases, movedIds, payRows, validOf, studentById, structureByClassYear, current: current?.id ?? null, years, report, orphanRows, credit });

    const issues = await new ChecksService(this.ctx).runIn(tx);
    if (issues.length) throw new Error(`The control checks fail after the move, so nothing was moved:\n${lines(issues.slice(0, 20).map((m) => m.message))}`);

    await tx.insert(auditLogs).values({ schoolId, module: "fees", action: MOVE_ACTION, entity: "School", entityId: schoolId, summary: `Moved ${report.counts.invoices} bills and ${report.counts.receipts} receipts from the old fee tables`, meta: { counts: report.counts, totals: report.totals, receipts: report.receipts, orphans: report.orphans.length } });
    return report;
  }

  /** One late fee as a bill line (and its posting). `nextSort` keeps the lines in order. */
  private async lateLine(tx: Tx, at: { invoiceId: string; number: string; nextSort: number }, studentId: string, date: string, amountPaise: number, basis: "accrual" | "cash"): Promise<string> {
    const [line] = await tx.insert(feeInvoiceLines).values({ schoolId: this.ctx.schoolId, invoiceId: at.invoiceId, kind: "late", label: "Late fee", amountPaise, sort: at.nextSort++ }).returning({ id: feeInvoiceLines.id });
    await this.refreshInvoiceTotals(tx, [at.invoiceId]);
    if (basis === "accrual") {
      await this.post(tx, { date, sourceKey: `fees:late:${line!.id}`, sourceType: "fee_invoice", sourceId: at.invoiceId, memo: `Late fee on ${at.number}`, lines: [{ account: "student_dues", debit: amountPaise, party: { type: "student", id: studentId } }, { account: "late_fee", credit: amountPaise }] });
    }
    return line!.id;
  }

  /**
   * Student by student and year by year: the old calculator against the new tables. Whatever differs and is not one of
   * the known, named reasons (a student who left, money held as an advance) stops the move.
   */
  private async verify(tx: Tx, v: {
    today: string; cases: YearCase[]; movedIds: string[]; payRows: (typeof feePayments.$inferSelect)[]; validOf: Map<string, OldPayment[]>; studentById: Map<string, typeof students.$inferSelect>;
    structureByClassYear: Map<string, OldStructure>; current: string | null; years: (typeof academicYears.$inferSelect)[]; report: MoveReport;
    orphanRows: { payment: typeof feePayments.$inferSelect; rest: number }[]; credit: Map<string, number>;
  }) {
    const ids = new Set(v.movedIds);
    const [invRows, lineRows] = await Promise.all([tx.select().from(feeInvoices), tx.select().from(feeInvoiceLines)]);
    const linesBy = new Map<string, (typeof lineRows)>();
    for (const l of lineRows) linesBy.set(l.invoiceId, [...(linesBy.get(l.invoiceId) ?? []), l]);
    const fresh = invRows.filter((i) => ids.has(i.id)).map((i): InvoiceFull => ({ ...i, lines: (linesBy.get(i.id) ?? []).sort((a, b) => a.sort - b.sort), parts: [] }));
    const byKey = new Map<string, InvoiceFull[]>();
    for (const i of fresh) byKey.set(`${i.studentId}:${i.yearId}`, [...(byKey.get(`${i.studentId}:${i.yearId}`) ?? []), i]);

    const problems: string[] = [];
    const name = (id: string) => { const s = v.studentById.get(id)!; return `${s.name} (${s.admissionNo})`; };
    const yearName = (id: string) => v.years.find((y) => y.id === id)!.name;
    const pastDue = new Map<string, { students: Set<string>; due: number }>();
    const advanceExpected = new Map<string, number>(), dueBy = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

    for (const c of v.cases) {
      const old = new FeeCalculator(legacyInput(c.structure, c.charges, c.concessions, v.validOf.get(c.studentId) ?? [], v.today)).statement();
      const want = expectedNumbers(old, new Set(c.plan.skipped));
      const mine = byKey.get(`${c.studentId}:${c.yearId}`) ?? [];
      const got = zero();
      for (const inv of mine) {
        const accrued = invoiceLateFee(inv.lateRule, calcOf(inv), v.today);
        for (const l of inv.lines) {
          if (l.kind === "late") got.late += l.amountPaise; else got.gross += l.amountPaise;
          got.concession += l.concessionPaise; got.paid += l.paidPaise; got.due += openOf(l);
        }
        got.late += accrued; got.due += accrued;
      }
      const wrong = differences(want.numbers, got);
      if (wrong.length) problems.push(`${name(c.studentId)}, ${yearName(c.yearId)}: ${wrong.map((k) => `${k} old ${want.numbers[k]} new ${got[k]}`).join("; ")}`);

      v.report.totals.old = add(v.report.totals.old, { gross: old.totals.gross, concession: old.totals.concession, late: old.totals.late, paid: old.totals.paid, due: old.totals.due });
      v.report.totals.new = add(v.report.totals.new, got);
      bump(dueBy, c.studentId, got.due);
      const skipped = want.skippedLines.reduce((a, l) => add(a, { gross: l.gross, concession: l.concession, late: l.lateFee, paid: l.paid, due: l.due }), zero());
      v.report.totals.notBilled = add(v.report.totals.notBilled, skipped);
      v.report.totals.creditToAdvance += want.credit;
      bump(advanceExpected, c.studentId, want.credit);
      if (skipped.gross > 0) {
        const row = v.report.notBilled.find((r) => r.student === name(c.studentId)) ?? (v.report.notBilled[v.report.notBilled.push({ student: name(c.studentId), instalments: 0, oldDuePaise: 0, newDuePaise: 0 }) - 1]!);
        row.instalments += want.skippedLines.length; row.oldDuePaise += old.totals.due; row.newDuePaise += got.due;
      }
      if (v.current && c.yearId !== v.current && got.due > 0) {
        const e = pastDue.get(c.yearId) ?? { students: new Set<string>(), due: 0 };
        e.students.add(c.studentId); e.due += got.due; pastDue.set(c.yearId, e);
      }
    }
    v.report.pastYearDues = [...pastDue].map(([y, e]) => ({ year: yearName(y), students: e.students.size, duePaise: e.due }));

    // Money in must equal money placed on bills plus advances, student by student, from the raw old rows.
    const [allocated, held] = await Promise.all([
      tx.execute<{ s: string; v: string }>(sql`select student_id s, sum(amount_paise) v from fee_allocations where undone_at is null and receipt_id is not null group by 1`),
      tx.execute<{ s: string; v: string }>(sql`select student_id s, sum(amount_paise) v from fee_advances where kind = 'receipt' group by 1`),
    ]);
    const allocBy = new Map([...allocated].map((r) => [r.s, Number(r.v)])), heldBy = new Map([...held].map((r) => [r.s, Number(r.v)]));
    const paidBy = new Map<string, number>();
    for (const p of v.payRows.filter((x) => x.status === "valid")) bump(paidBy, p.studentId, p.amountPaise);
    for (const [sid, paid] of paidBy) {
      if ((allocBy.get(sid) ?? 0) + (heldBy.get(sid) ?? 0) !== paid) problems.push(`${name(sid)}: paid ${paid} but ${allocBy.get(sid) ?? 0} sits on bills and ${heldBy.get(sid) ?? 0} is held as advance`);
    }
    for (const [sid, held] of heldBy) {
      // What is held is what the old calculator could not place: money on other classes' fees plus overpaid principal.
      const orphan = v.orphanRows.filter((o) => o.payment.studentId === sid).reduce((a, o) => a + o.rest, 0);
      if (held !== orphan + (advanceExpected.get(sid) ?? 0)) problems.push(`${name(sid)}: advance ${held}, expected ${orphan} on other fees plus ${advanceExpected.get(sid) ?? 0} overpaid`);
    }
    if (problems.length) throw new Error(`The new tables differ from the old calculator for ${problems.length} student-year(s), so nothing was moved:\n${lines(problems.slice(0, 40))}${problems.length > 40 ? `\n  ... and ${problems.length - 40} more` : ""}`);

    // Known differences, named for the school to confirm.
    for (const { payment, rest } of v.orphanRows) {
      const s = v.studentById.get(payment.studentId)!;
      const cur = v.current, mine = (k: YearCase) => k.studentId === s.id && k.yearId === cur;
      // The old screens used the class they are in now, and ignored money on any other class's instalments.
      const st = cur && s.classId ? v.structureByClassYear.get(`${cur}:${s.classId}`) ?? null : null;
      const year = v.cases.find(mine);
      const paidThisYear = (v.validOf.get(s.id) ?? []).filter((p) => v.payRows.find((r) => r.id === p.id)!.yearId === cur);
      const oldApp = cur ? new FeeCalculator(legacyInput(st, year?.charges ?? [], year?.concessions ?? [], paidThisYear, v.today)).statement().totals.due : null;
      const newDue = dueBy.get(s.id) ?? 0;
      v.report.orphans.push({ student: name(s.id), receiptNo: payment.receiptNo, paidOn: payment.paidOn, paise: rest, oldAppDuePaise: oldApp, newDuePaise: newDue, advancePaise: rest });
    }
    for (const p of v.payRows.filter((x) => x.status === "valid" && (v.credit.get(x.id) ?? 0) > 0)) v.report.credits.push({ student: name(p.studentId), receiptNo: p.receiptNo, paise: v.credit.get(p.id)! });
    v.report.receipts.oldValidPaise = v.payRows.filter((p) => p.status === "valid").reduce((a, p) => a + p.amountPaise, 0);
    if (v.report.receipts.oldValidPaise !== v.report.receipts.newValidPaise) throw new Error(`Receipts differ: old ${v.report.receipts.oldValidPaise}, new ${v.report.receipts.newValidPaise}. Nothing was moved.`);
  }
}
