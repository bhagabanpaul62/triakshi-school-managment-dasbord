import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FeatureSeed } from "@smw/feature-kit";
import { withSchool } from "@smw/db";
import { addDays, addMonths, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { finCashAccounts, finSettings } from "@smw/feature-finance/schema";
import { academicYears } from "@smw/feature-academics/schema";
import { ChequeService } from "./cheques";
import { HeadService, PlanService } from "./plans";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { feeConcessions, feeInvoices, feePromises, feeUpiSlips } from "./schema";


interface SeedClass { id: string; name: string; grade: number }
interface SeedStudent { id: string; name: string; classId: string }

/**
 * Demo fees for one school: a published plan per class (monthly tuition from April, annual charges, two exam fees),
 * bills issued up to today, about 70% of families paid in three visits with mixed methods, some part-paid or overdue,
 * one cheque still clearing, one advance, one concession and one UPI slip waiting. Plans are published directly here;
 * the real flow sends them for approval.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const classes = (state.classes ?? []) as SeedClass[];
  const kids = (state.students ?? []) as SeedStudent[];
  if (!classes.length) return;
  const today = todayIST();
  const year = await withSchool(ctx.schoolId, async (tx) => (await tx.select().from(academicYears).orderBy(sql`is_current desc`, sql`starts_on desc`).limit(1))[0]);
  if (!year) return;

  const heads = new HeadService(ctx);
  const [tuition, exam, annual] = [
    await heads.create({ name: "Tuition", kind: "tuition", isTuition: "true" }),
    await heads.create({ name: "Exam fee", kind: "exam" }),
    await heads.create({ name: "Annual charges", kind: "other" }),
  ];

  // Plans: prices rise with the grade. Monthly tuition on the 10th (billed on the 1st), annual charges in April, exam fees in September and February.
  const grades = classes.map((c) => c.grade);
  const [lo, hi] = [Math.min(...grades), Math.max(...grades)];
  const plans = new PlanService(ctx);
  const start = year.startsOn;
  const created: { id: string; classId: string }[] = [];
  for (const c of classes) {
    const monthly = (1_000 + (hi === lo ? 0 : Math.round(((c.grade - lo) / (hi - lo)) * 20) * 100)) * 100;
    const month = (k: number) => addMonths(start, k);
    const plan = await plans.saveDraft({
      yearId: year.id, name: `${c.name} fees ${year.name}`, classIds: [c.id], joinRule: "due_after_joining",
      lateRule: { kind: "per_day", amountPaise: 1_000, graceDays: 5, maxPaise: 50_000 },
      lines: [
        { headId: tuition.id, dues: Array.from({ length: 12 }, (_, k) => ({ dueKey: month(k).slice(0, 7), label: new Date(`${month(k)}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }), billOn: month(k), dueOn: addDays(month(k), 9), amountPaise: monthly })) },
        { headId: annual.id, dues: [{ dueKey: "ANNUAL", label: "Annual charges", billOn: start, dueOn: addDays(start, 14), amountPaise: monthly * 2 }] },
        { headId: exam.id, dues: [{ dueKey: "EXAM1", label: "Exam fee, term 1", billOn: addMonths(start, 5), dueOn: addDays(addMonths(start, 5), 14), amountPaise: monthly / 2 }, { dueKey: "EXAM2", label: "Exam fee, term 2", billOn: addMonths(start, 10), dueOn: addDays(addMonths(start, 10), 14), amountPaise: monthly / 2 }] },
      ],
    });
    await withSchool(ctx.schoolId, (tx) => plans.publishIn(tx, plan.plan.id));
    created.push({ id: plan.plan.id, classId: c.id });
  }
  state.feePlans = created;
  if (!kids.length) return;

  // Settings the demo needs: UPI on, a UPI id on the bank account, and room to date receipts in the past.
  await withSchool(ctx.schoolId, async (tx) => {
    const bank = await cashAccount(tx, ctx.schoolId, { kind: "bank" });
    await tx.update(finCashAccounts).set({ upiId: "school@upi", upiName: "School fees" }).where(eq(finCashAccounts.id, bank.id));
    await tx.insert(finSettings).values({ schoolId: ctx.schoolId, config: { backdateDays: 365, upiOn: true } }).onConflictDoUpdate({ target: finSettings.schoolId, set: { config: { backdateDays: 365, upiOn: true } } });
    // One concession, approved before billing so it is on every bill.
    await tx.insert(feeConcessions).values({ schoolId: ctx.schoolId, studentId: kids[5 % kids.length]!.id, yearId: year.id, mode: "percent", value: 1000, reason: "Brother or sister at the school", status: "approved" });
  });

  const bills = new InvoiceService(ctx);
  await bills.issueBulk({}, today);

  const receipts = new ReceiptService(ctx);
  const open = await withSchool(ctx.schoolId, (tx) => tx.select().from(feeInvoices).where(and(eq(feeInvoices.status, "issued"), inArray(feeInvoices.studentId, kids.map((k) => k.id)))).orderBy(asc(feeInvoices.dueDate)));
  const byStudent = new Map<string, typeof open>();
  for (const b of open) byStudent.set(b.studentId, [...(byStudent.get(b.studentId) ?? []), b]);
  const METHODS = ["cash", "upi", "cheque", "bank_transfer", "card"] as const;
  const visits = [addMonths(start, 2), addMonths(start, 5), addMonths(start, 7)].map((d) => addDays(d, 12)).filter((d) => d <= today);

  const plan: { studentId: string; date: string; ids: string[]; method: (typeof METHODS)[number]; extra: number }[] = [];
  kids.forEach((k, i) => {
    const slot = i % 10; // 0-6 pay in full at every visit, 7 pays only the first visit, 8-9 pay nothing
    const mine = byStudent.get(k.id) ?? [];
    visits.forEach((date, v) => {
      if (slot >= 8 || (slot === 7 && v > 0)) return;
      const due = mine.filter((b) => b.dueDate <= date && !plan.some((p) => p.studentId === k.id && p.ids.includes(b.id)));
      if (due.length) plan.push({ studentId: k.id, date, ids: due.map((b) => b.id), method: METHODS[(i + v) % METHODS.length]!, extra: i === 3 && v === 0 ? 150_000 : 0 });
    });
  });
  let chequeLeft = 0;
  for (const p of plan.sort((a, b) => a.date.localeCompare(b.date))) {
    const total = await withSchool(ctx.schoolId, async (tx) => (await tx.select({ v: sql<string>`coalesce(sum(gross_paise - concession_paise - credited_paise + late_paise - paid_paise), 0)` }).from(feeInvoices).where(inArray(feeInvoices.id, p.ids)))[0]!.v);
    const amount = Number(total) + p.extra;
    if (amount <= 0) continue;
    const cheque = p.method === "cheque";
    const rc = await receipts.collect({
      studentId: p.studentId, date: p.date, invoiceIds: p.ids,
      methods: [{ method: p.method, amountPaise: amount, reference: p.method === "cash" ? undefined : `REF${100000 + plan.indexOf(p) * 7919}`, ...(cheque ? { cheque: { chequeNo: String(310000 + plan.indexOf(p)), bank: "State Bank", chequeDate: p.date } } : {}) }],
    });
    if (cheque) {
      chequeLeft++;
      // Most cheques clear; the last one is left clearing to show the register.
      const row = await withSchool(ctx.schoolId, async (tx) => (await tx.execute<{ id: string }>(sql`select id from fee_cheques where receipt_id = ${rc.id}::uuid`))[0]!);
      if (p !== plan.at(-1) && chequeLeft % 3 !== 0) {
        const svc = new ChequeService(ctx);
        await svc.deposit({ id: row.id, date: p.date });
        await svc.clear({ id: row.id, date: p.date });
      }
    }
  }

  // One slip waiting for the office, and one family that promised to pay.
  const owing = open.find((b) => !plan.some((p) => p.ids.includes(b.id)));
  if (owing) {
    await withSchool(ctx.schoolId, async (tx) => {
      await tx.insert(feeUpiSlips).values({ schoolId: ctx.schoolId, studentId: owing.studentId, amountPaise: owing.grossPaise - owing.concessionPaise, utr: "SEED4821907365", paidOn: today, invoiceIds: [owing.id] });
      await tx.insert(feePromises).values({ schoolId: ctx.schoolId, studentId: owing.studentId, promisedOn: addDays(today, 5), note: "Will pay after salary" });
    });
  }
  // Back to the school's own limits.
  await withSchool(ctx.schoolId, (tx) => tx.update(finSettings).set({ config: { upiOn: true } }).where(eq(finSettings.schoolId, ctx.schoolId)));
};
export default seed;
