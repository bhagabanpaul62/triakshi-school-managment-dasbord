import type { FeatureSeed } from "@smw/feature-kit";
import { financialYear } from "@smw/db";
import { FeeCalculator } from "./calculator";
import { ConcessionService, DuesService, FeeHeadService, FeeStructureService, PaymentService, todayIST } from "./service";

interface SeedClass { id: string; name: string; grade: number }
interface SeedStudent { id: string; name: string; classId: string }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const METHODS = [
  { method: "cash" }, { method: "upi", reference: "UPI" }, { method: "cheque", reference: "CHQ" }, { method: "bank_transfer", reference: "NEFT" },
] as const;

/**
 * Demo fees for one school: four heads, a structure per class (₹18,000 to ₹48,000 by grade, three installments on
 * Apr 10, Aug 10 and Dec 10, late fee ₹50 a day after 5 days up to ₹500), sibling concessions, and payments:
 * most families paid Term 1, some Term 2, a few paid late, a few part-paid, several are overdue.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const classes = (state.classes ?? []) as SeedClass[];
  const studentRows = (state.students ?? []) as SeedStudent[];
  if (!classes.length) return;

  const heads = new FeeHeadService(ctx);
  const [tuition, admission, exam, annual] = [
    await heads.create({ name: "Tuition", kind: "tuition" }),
    await heads.create({ name: "Admission", kind: "admission", isRecurring: "" }),
    await heads.create({ name: "Exam", kind: "exam" }),
    await heads.create({ name: "Annual Charges", kind: "other" }),
  ];

  // A structure per class, priced by grade.
  const grades = classes.map((c) => c.grade);
  const [lo, hi] = [Math.min(...grades), Math.max(...grades)];
  const fy = Number(financialYear().slice(0, 4));
  const due = [`${fy}-04-10`, `${fy}-08-10`, `${fy}-12-10`];
  const structures = new FeeStructureService(ctx);
  const created: { id: string; classId: string }[] = [];
  for (const c of classes) {
    const rupees = 18_000 + (hi === lo ? 0 : Math.round(((c.grade - lo) / (hi - lo)) * 30) * 1000);
    const total = rupees * 100;
    const [t, e, a] = [Math.round(total * 0.7), Math.round(total * 0.1), Math.round(total * 0.12)];
    const parts = FeeCalculator.apportion(total, [1, 1, 1]);
    const s = await structures.save({
      classId: c.id, name: `${c.name} fees ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`,
      items: [
        { headId: tuition.id, amountPaise: t }, { headId: exam.id, amountPaise: e },
        { headId: annual.id, amountPaise: a }, { headId: admission.id, amountPaise: total - t - e - a },
      ],
      installments: due.map((dueDate, k) => ({ name: `Term ${k + 1}`, dueDate, amountPaise: parts[k]! })),
      lateRules: [{ kind: "per_day", amountPaise: 5_000, graceDays: 5, maxPaise: 50_000 }],
    });
    created.push({ id: s.id, classId: c.id });
  }
  state.feeStructures = created;
  if (!studentRows.length) return;

  // A 10% concession for a few students.
  const concessions = new ConcessionService(ctx);
  for (const s of studentRows.filter((_, i) => i % 17 === 5).slice(0, 8)) {
    await concessions.create({ studentId: s.id, kind: "percent", percent: "10", reason: "Sibling discount" });
  }

  // Payments, in date order so receipt numbers run in date order.
  const today = todayIST();
  const plan: { studentId: string; term: number; paidOn: string; fraction: number; n: number }[] = [];
  studentRows.forEach((s, i) => {
    const slot = i % 10; // 0-3 paid Terms 1 and 2, 4 paid Term 1 late, 5-6 paid Term 1, 7 part-paid Term 1, 8-9 paid nothing
    const early = (k: number) => addDays(due[k]!, -(2 + (i % 5)));
    if (slot <= 6) plan.push({ studentId: s.id, term: 0, paidOn: slot === 4 ? addDays(due[0]!, 12) : early(0), fraction: 1, n: i });
    if (slot <= 3) plan.push({ studentId: s.id, term: 1, paidOn: early(1), fraction: 1, n: i });
    if (slot === 7) plan.push({ studentId: s.id, term: 0, paidOn: addDays(due[0]!, 3), fraction: 0.5, n: i });
  });
  const dues = new DuesService(ctx), payments = new PaymentService(ctx);
  for (const p of plan.sort((x, y) => x.paidOn.localeCompare(y.paidOn))) {
    if (p.paidOn > today) continue; // not yet billed
    const line = (await dues.studentLedger(p.studentId, p.paidOn)).statement.lines[p.term];
    const amount = line ? (p.fraction < 1 ? Math.round((line.principalDue * p.fraction) / 100) * 100 : line.due) : 0;
    if (amount <= 0) continue;
    const m = METHODS[p.n % METHODS.length]!;
    await payments.record({ studentId: p.studentId, amountPaise: amount, method: m.method, reference: "reference" in m ? `${m.reference}${100000 + p.n * 7919}` : undefined, paidOn: p.paidOn });
  }
};
export default seed;
