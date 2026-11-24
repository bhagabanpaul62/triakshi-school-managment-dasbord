import { describe, expect, it } from "vitest";
import { FeeCalculator } from "./legacy-calculator";
import { cappedApportion, differences, dueKeyOf, expectedNumbers, headAmounts, lateRuleFor, legacyInput, planStudentYear, splitConcessions, type OldConcession, type OldPayment, type OldStructure } from "./plan";

const T = "head-tuition", E = "head-exam";
const I1 = "00000000-0000-7000-8000-0000000000a1", I2 = "00000000-0000-7000-8000-0000000000a2", I3 = "00000000-0000-7000-8000-0000000000a3";

/** Tuition 10,000 + Exam 5,000 paise in three instalments of 5,000. Per instalment: tuition 3333, exam 1667 (hand-worked). */
const structure = (over: Partial<OldStructure> = {}): OldStructure => ({
  id: "s1", yearId: "y1", classId: "c1", name: "Class 5",
  items: [{ headId: T, headName: "Tuition", headType: "income", amountPaise: 10_000 }, { headId: E, headName: "Exam", headType: "income", amountPaise: 5_000 }],
  installments: [
    { id: I1, name: "Term 1", dueDate: "2026-04-10", amountPaise: 5_000 },
    { id: I2, name: "Term 2", dueDate: "2026-08-10", amountPaise: 5_000 },
    { id: I3, name: "Term 3", dueDate: "2026-12-10", amountPaise: 5_000 },
  ],
  lateRules: [{ installmentId: null, kind: "per_day", amountPaise: 100, graceDays: 5, maxPaise: 1_000 }],
  ...over,
});
const conc = (c: Partial<OldConcession> & Pick<OldConcession, "id" | "kind" | "value">): OldConcession => ({ headId: null, ...c });
const pay = (id: string, paidOn: string, allocs: [string, number, number?][]): OldPayment => ({
  id, paidOn, amountPaise: allocs.reduce((s, a) => s + a[1] + (a[2] ?? 0), 0),
  allocations: allocs.map(([ref, amountPaise, lateFeePaise]) => ({ installmentId: ref.startsWith("00000000") ? ref : null, chargeId: ref.startsWith("00000000") ? null : ref, amountPaise, lateFeePaise: lateFeePaise ?? 0 })),
});
const year = (o: Partial<Parameters<typeof planStudentYear>[0]> = {}) => planStudentYear({ structure: structure(), concessions: [], charges: [], payments: [], active: true, leftOn: null, today: "2026-11-24", ...o });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("splitting an instalment over heads", () => {
  it("apportions each instalment over the items and the exam line takes the larger remainder", () => {
    expect(headAmounts(structure())).toEqual([[3_333, 1_667], [3_333, 1_667], [3_333, 1_667]]);
  });
  it("keeps the dues of every instalment exact when sizes differ", () => {
    // 1001 over [10000, 5000]: 667.33 and 333.67 -> 667 + 333, the remainder goes to the exam line (0.67 > 0.33).
    const s = structure({ installments: [{ id: I1, name: "A", dueDate: "2026-04-10", amountPaise: 1_001 }, { id: I2, name: "B", dueDate: "2026-05-10", amountPaise: 13_999 }] });
    const rows = headAmounts(s);
    expect(rows[0]).toEqual([667, 334]);
    expect(rows.map(sum)).toEqual([1_001, 13_999]);
  });
});

describe("concessions", () => {
  it("whole-fee 10 percent: 1,500 in all, 500 on each instalment, spread over both heads", () => {
    const r = splitConcessions(structure(), [conc({ id: "c", kind: "percent", value: 1_000 })]);
    expect(r.total).toBe(1_500);
    expect(r.perInstalment).toEqual([500, 500, 500]);
    expect(r.perLine[0]).toEqual([333, 167]);
    expect(r.uses.map((u) => u[0])).toEqual([500, 500, 500]);
  });
  it("a head concession stays on its head: exam free in full", () => {
    const r = splitConcessions(structure(), [conc({ id: "c", kind: "percent", value: 10_000, headId: E })]);
    expect(r.total).toBe(5_000);
    expect(r.perInstalment).toEqual([1_667, 1_667, 1_666]);
    expect(r.perLine.map((l) => l[0])).toEqual([0, 0, 0]);
    expect(r.perLine.map((l) => l[1])).toEqual([1_667, 1_667, 1_666]);
  });
  it("head ones first, whole ones capped at what is left, and the parts of each concession add up on the bills", () => {
    const cs = [conc({ id: "whole", kind: "amount", value: 9_000 }), conc({ id: "exam", kind: "percent", value: 5_000, headId: E }), conc({ id: "pct", kind: "percent", value: 2_500 })];
    const r = splitConcessions(structure(), cs);
    // exam 50% = 2,500; whole amount 9,000 is capped at 15,000 - 2,500 = 12,500 -> 9,000; 25% of gross = 3,750 capped at 3,500.
    expect(r.applied).toEqual([9_000, 2_500, 3_500]);
    expect(r.total).toBe(15_000);
    expect(r.uses.map((u) => sum(u))).toEqual(r.perInstalment);
    cs.forEach((_, c) => expect(sum(r.uses.map((u) => u[c]!))).toBe(r.applied[c]));
    r.perLine.forEach((l, n) => { expect(sum(l)).toBe(r.perInstalment[n]); l.forEach((v, k) => expect(v).toBeLessThanOrEqual(headAmounts(structure())[n]![k]!)); });
  });
  it("agrees with the old calculator to the paisa on awkward numbers", () => {
    const s = structure({ items: [{ headId: T, headName: "T", headType: "income", amountPaise: 33_333 }, { headId: E, headName: "E", headType: "income", amountPaise: 7_777 }], installments: [{ id: I1, name: "A", dueDate: "2026-04-10", amountPaise: 13_703 }, { id: I2, name: "B", dueDate: "2026-08-10", amountPaise: 13_703 }, { id: I3, name: "C", dueDate: "2026-12-10", amountPaise: 13_704 }] });
    for (const cs of [[conc({ id: "a", kind: "percent", value: 1_234 })], [conc({ id: "a", kind: "amount", value: 9_999, headId: T }), conc({ id: "b", kind: "percent", value: 333 })], [conc({ id: "a", kind: "percent", value: 10_000 })]]) {
      const old = new FeeCalculator({ ...legacyInput(s, [], cs, [], "2026-01-01") });
      const r = splitConcessions(s, cs);
      expect(r.total).toBe(old.concessionTotal());
      expect(r.perInstalment).toEqual(old.statement().lines.map((l) => l.concession));
    }
  });
  it("capped apportion never exceeds a cap and gives the rest to the others", () => {
    expect(cappedApportion(10, [1, 1], [3, 100])).toEqual([3, 7]);
    expect(cappedApportion(5, [0, 0], [2, 9])).toEqual([1, 4]);
  });
});

describe("a year of bills", () => {
  it("bills every instalment, in due order, with issue date no later than due or today", () => {
    const p = year();
    expect(p.bills.map((b) => [b.label, b.dueKey, b.issueDate])).toEqual([["Term 1", dueKeyOf(I1), "2026-04-10"], ["Term 2", dueKeyOf(I2), "2026-08-10"], ["Term 3", dueKeyOf(I3), "2026-11-24"]]);
    expect(p.bills.map((b) => sum(b.lines.map((l) => l.amountPaise)))).toEqual([5_000, 5_000, 5_000]);
  });
  it("keeps the dueKey unique and stable", () => {
    expect(dueKeyOf(I1)).toBe("inst-0000000000a1");
    expect(new Set([I1, I2, I3].map(dueKeyOf)).size).toBe(3);
  });
  it("part payment is spread over the open lines by apportion", () => {
    const p = year({ payments: [pay("p1", "2026-04-08", [[I1, 2_000]])] });
    expect(p.bills[0]!.principal).toEqual([{ paymentId: "p1", lineIndex: 0, amountPaise: 1_333 }, { paymentId: "p1", lineIndex: 1, amountPaise: 667 }]);
    expect(p.bills[0]!.issueDate).toBe("2026-04-08");
    expect(p.placed.get("p1")).toBe(2_000);
  });
  it("a second payment spreads over what is still open", () => {
    const p = year({ payments: [pay("p1", "2026-04-08", [[I1, 2_000]]), pay("p2", "2026-04-09", [[I1, 3_000]])] });
    const paid = [0, 0];
    p.bills[0]!.principal.forEach((x) => { paid[x.lineIndex]! += x.amountPaise; });
    expect(paid).toEqual([3_333, 1_667]);
  });
  it("late fee paid becomes a late line for that payment", () => {
    const p = year({ payments: [pay("p1", "2026-04-20", [[I1, 5_000, 1_000]])] });
    expect(p.bills[0]!.late).toEqual([{ amountPaise: 1_000, date: "2026-04-20", paid: [{ paymentId: "p1", amountPaise: 1_000 }] }]);
    expect(p.placed.get("p1")).toBe(6_000);
  });
  it("a concession added after payment leaves a credit that becomes an advance", () => {
    const p = year({ concessions: [conc({ id: "c", kind: "percent", value: 1_000 })], payments: [pay("p1", "2026-04-08", [[I1, 5_000]])] });
    expect(p.credits).toEqual([{ paymentId: "p1", amountPaise: 500 }]);
    expect(sum(p.bills[0]!.principal.map((x) => x.amountPaise))).toBe(4_500);
  });
  it("principal cleared late with the late fee still owed keeps an unpaid late line", () => {
    // 15% whole concession after a part payment: 5,000 due, 10% conc = 500 -> net 4,500, paid 4,500 on 2026-04-30 (20 days late, 15 after grace: 1,000 cap).
    const p = year({ concessions: [conc({ id: "c", kind: "percent", value: 1_000 })], payments: [pay("p1", "2026-04-30", [[I1, 4_500]])] });
    expect(p.bills[0]!.late).toEqual([{ amountPaise: 1_000, date: "2026-04-30", paid: [] }]);
  });
  it("payments on instalments of another class stay unplaced (they become an advance)", () => {
    const p = year({ payments: [pay("p1", "2026-04-08", [["other-instalment", 4_000]])] });
    expect(p.placed.size).toBe(0);
    expect(p.bills[0]!.principal).toEqual([]);
  });
  it("charges become one-line bills with their own source key, paid whole", () => {
    const p = year({ structure: null, charges: [{ id: "ch1", kind: "transport", label: "Transport Jul", dueDate: "2026-07-01", amountPaise: 1_234, sourceKey: "transport:s1:2026-07" }], payments: [pay("p1", "2026-07-02", [["ch1", 1_234]])] });
    expect(p.bills).toHaveLength(1);
    expect(p.bills[0]).toMatchObject({ kind: "transport", sourceKey: "transport:s1:2026-07", issueDate: "2026-07-01", dueKey: null });
    expect(p.bills[0]!.principal).toEqual([{ paymentId: "p1", lineIndex: 0, amountPaise: 1_234 }]);
  });
  it("a student who left is billed only for instalments with money or due by the day they left", () => {
    const p = year({ active: false, leftOn: "2026-08-31", payments: [pay("p1", "2026-12-01", [[I3, 1_000]])] });
    expect(p.bills.map((b) => b.label)).toEqual(["Term 1", "Term 2", "Term 3"]);
    const q = year({ active: false, leftOn: "2026-06-30" });
    expect(q.bills.map((b) => b.label)).toEqual(["Term 1"]);
    expect(q.skipped).toEqual([I2, I3]);
    expect(year({ active: false, leftOn: null }).bills).toEqual([]);
  });
  it("a deposit head makes a deposit line", () => {
    const s = structure({ items: [{ headId: T, headName: "Tuition", headType: "income", amountPaise: 10_000 }, { headId: E, headName: "Caution deposit", headType: "deposit", amountPaise: 5_000 }] });
    expect(year({ structure: s }).bills[0]!.lines.map((l) => l.kind)).toEqual(["fee", "deposit"]);
  });
});

describe("late rules", () => {
  it("an instalment's own rule beats the rule for all", () => {
    const s = structure({ lateRules: [{ installmentId: null, kind: "flat", amountPaise: 500, graceDays: 0, maxPaise: null }, { installmentId: I2, kind: "per_day", amountPaise: 100, graceDays: 3, maxPaise: 900 }] });
    expect(lateRuleFor(s, I1)).toEqual({ kind: "flat", amountPaise: 500, graceDays: 0, maxPaise: null });
    expect(lateRuleFor(s, I2)).toEqual({ kind: "per_day", amountPaise: 100, graceDays: 3, maxPaise: 900 });
    expect(lateRuleFor(structure({ lateRules: [] }), I1)).toBeNull();
  });
});

describe("what the new tables must show", () => {
  it("takes out lines that were not billed and counts overpaid principal as an advance, not as paid", () => {
    const cs = [conc({ id: "c", kind: "percent", value: 1_000 })];
    const input = legacyInput(structure(), [], cs, [pay("p1", "2026-04-08", [[I1, 5_000]])], "2026-11-24");
    const st = new FeeCalculator(input).statement();
    const full = expectedNumbers(st, new Set());
    expect(full.credit).toBe(500);
    expect(full.numbers).toMatchObject({ gross: 15_000, concession: 1_500, paid: 4_500 });
    const left = expectedNumbers(st, new Set([I3]));
    expect(left.numbers.gross).toBe(10_000);
    expect(left.skippedLines.map((l) => l.installmentId)).toEqual([I3]);
  });
  it("names the keys that differ", () => {
    const a = { gross: 1, concession: 2, late: 3, paid: 4, due: 5 };
    expect(differences(a, { ...a, paid: 9, due: 0 })).toEqual(["paid", "due"]);
    expect(differences(a, a)).toEqual([]);
  });
});
