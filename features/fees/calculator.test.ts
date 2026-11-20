import { describe, expect, it } from "vitest";
import { FeeCalculator, type CalcInput, type CalcPayment } from "./calculator";

const TUITION = "head-tuition", EXAM = "head-exam";
const I1 = "i1", I2 = "i2", I3 = "i3";

/** Two heads (₹30,000 + ₹6,000), three installments of ₹12,000; late fee ₹50/day after 5 days, capped at ₹500. */
function base(over: Partial<CalcInput> = {}): CalcInput {
  return {
    today: "2026-04-01",
    items: [{ headId: TUITION, amountPaise: 3_000_000 }, { headId: EXAM, amountPaise: 600_000 }],
    installments: [
      { id: I1, name: "Term 1", dueDate: "2026-04-10", amountPaise: 1_200_000 },
      { id: I2, name: "Term 2", dueDate: "2026-08-10", amountPaise: 1_200_000 },
      { id: I3, name: "Term 3", dueDate: "2026-12-10", amountPaise: 1_200_000 },
    ],
    concessions: [],
    lateRules: [{ installmentId: null, kind: "per_day", amountPaise: 5_000, graceDays: 5, maxPaise: 50_000 }],
    payments: [],
    ...over,
  };
}
const pay = (id: string, paidOn: string, ...a: [string, number, number?][]): CalcPayment => ({
  id, paidOn, status: "valid", allocations: a.map(([installmentId, amountPaise, lateFeePaise]) => ({ installmentId, amountPaise, lateFeePaise: lateFeePaise ?? 0 })),
});
const reconciles = (c: FeeCalculator) => {
  const t = c.statement().totals;
  expect(t.gross - t.concession + t.late - t.paid).toBe(t.due - t.credit);
};

describe("apportion", () => {
  it("adds up to the total, to the paisa", () => {
    for (const [total, w] of [[100, [1, 1, 1]], [1, [5, 5, 5]], [333, [1111, 1111, 1111]], [7, [3, 0, 9]], [0, [1, 2]]] as const) {
      const parts = FeeCalculator.apportion(total, [...w]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
  it("gives the leftover paise to the biggest remainders", () => {
    expect(FeeCalculator.apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe("concessions", () => {
  it("rounds a percent to whole paise and spreads it over installments", () => {
    const c = new FeeCalculator(base({
      items: [{ headId: TUITION, amountPaise: 3333 }],
      installments: [I1, I2, I3].map((id, k) => ({ id, name: `T${k}`, dueDate: `2026-0${4 + k}-10`, amountPaise: 1111 })),
      concessions: [{ headId: null, kind: "percent", value: 1000 }],
    }));
    expect(c.concessionTotal()).toBe(333); // 333.3 rounds down
    const { lines, totals } = c.statement();
    expect(lines.map((l) => l.concession)).toEqual([111, 111, 111]);
    expect(totals.concession).toBe(333);
    reconciles(c);
  });
  it("rounds half up", () => {
    expect(FeeCalculator.percentOf(1005, 1000)).toBe(101); // 100.5
  });
  it("a head concession cannot exceed that head, a whole-fee one cannot exceed what is left", () => {
    const c = new FeeCalculator(base({ concessions: [{ headId: EXAM, kind: "amount", value: 900_000 }, { headId: null, kind: "amount", value: 99_999_999 }] }));
    expect(c.concessionTotal()).toBe(3_600_000); // exam capped at 600,000, then the rest of the fee
    const t = c.statement().totals;
    expect(t.net).toBe(0);
    expect(t.due).toBe(0);
  });
  it("a percent on one head is taken of that head", () => {
    expect(new FeeCalculator(base({ concessions: [{ headId: EXAM, kind: "percent", value: 5000 }] })).concessionTotal()).toBe(300_000);
  });
  it("a fully conceded installment owes no late fee", () => {
    const c = new FeeCalculator(base({ today: "2026-12-30", concessions: [{ headId: null, kind: "percent", value: 10_000 }] }));
    expect(c.statement().totals.late).toBe(0);
  });
});

describe("late fee", () => {
  const lateOn = (today: string, rule = base().lateRules) => new FeeCalculator(base({ today, lateRules: rule })).statement().lines[0]!.lateFee;
  it("is free until the grace days are over", () => {
    expect(lateOn("2026-04-10")).toBe(0);
    expect(lateOn("2026-04-15")).toBe(0);
  });
  it("charges per day after the grace days", () => {
    expect(lateOn("2026-04-16")).toBe(5_000);
    expect(lateOn("2026-04-20")).toBe(25_000);
  });
  it("stops at the cap", () => {
    expect(lateOn("2026-07-01")).toBe(50_000);
  });
  it("a flat fee is charged once", () => {
    const flat = [{ installmentId: null, kind: "flat" as const, amountPaise: 20_000, graceDays: 0, maxPaise: null }];
    expect(lateOn("2026-04-10", flat)).toBe(0);
    expect(lateOn("2026-04-11", flat)).toBe(20_000);
    expect(lateOn("2026-09-01", flat)).toBe(20_000);
  });
  it("a rule for one installment overrides the general one", () => {
    const c = new FeeCalculator(base({
      today: "2026-04-20",
      lateRules: [...base().lateRules, { installmentId: I1, kind: "flat", amountPaise: 1_000, graceDays: 0, maxPaise: null }],
    }));
    expect(c.statement().lines[0]!.lateFee).toBe(1_000);
  });
  it("no rule, no late fee", () => {
    expect(new FeeCalculator(base({ today: "2027-01-01", lateRules: [] })).statement().totals.late).toBe(0);
  });
  it("stops growing the day the principal is cleared", () => {
    const c = new FeeCalculator(base({ today: "2026-07-01", payments: [pay("p1", "2026-04-20", [I1, 1_200_000, 25_000])] }));
    const l = c.statement().lines[0]!;
    expect(l.lateFee).toBe(25_000); // frozen at Apr 20, not 50,000 on Jul 1
    expect(l.principalDue).toBe(0);
    // principal still short by 200,000, so the fee keeps growing
    const open = new FeeCalculator(base({ today: "2026-07-01", payments: [pay("p1", "2026-04-20", [I1, 1_000_000, 25_000])] })).statement().lines[0]!;
    expect(open.lateFee).toBe(50_000);
  });
});

describe("statement and payments", () => {
  it("nothing paid: due = gross and only past-due installments are overdue", () => {
    const c = new FeeCalculator(base({ today: "2026-09-01" }));
    const { lines, totals } = c.statement();
    expect(lines.map((l) => l.status)).toEqual(["overdue", "overdue", "pending"]);
    expect(totals.overdue).toBe(1_200_000 * 2 + totals.late);
    reconciles(c);
  });
  it("a partial payment marks the installment partial and leaves the rest due", () => {
    const c = new FeeCalculator(base({ today: "2026-04-05", payments: [pay("p1", "2026-04-05", [I1, 500_000])] }));
    const l = c.statement().lines[0]!;
    expect(l.status).toBe("partial");
    expect(l.due).toBe(700_000);
    reconciles(c);
  });
  it("cancelled payments are ignored", () => {
    const cancelled: CalcPayment = { ...pay("p1", "2026-04-05", [I1, 1_200_000]), status: "cancelled" };
    const t = new FeeCalculator(base({ today: "2026-04-06", payments: [cancelled] })).statement().totals;
    expect(t.paid).toBe(0);
    expect(t.due).toBe(3_600_000);
  });
  it("reconciles with concession, late fee and payments together", () => {
    const c = new FeeCalculator(base({
      today: "2026-09-01",
      concessions: [{ headId: null, kind: "percent", value: 1250 }, { headId: EXAM, kind: "amount", value: 33_333 }],
      payments: [pay("p1", "2026-04-08", [I1, 1_200_000 - 150_000]), pay("p2", "2026-08-30", [I2, 400_001, 50_000])],
    }));
    reconciles(c);
  });
  it("shows a credit when a concession is added after the money was paid", () => {
    const c = new FeeCalculator(base({ today: "2026-04-09", concessions: [{ headId: null, kind: "percent", value: 10_000 }], payments: [pay("p1", "2026-04-08", [I1, 1_200_000])] }));
    expect(c.statement().totals.credit).toBe(1_200_000);
    reconciles(c);
  });
});

describe("allocate", () => {
  it("pays the oldest installment first", () => {
    const plan = new FeeCalculator(base()).allocate(1_500_000, "2026-04-05");
    expect(plan.allocations.map((a) => [a.installmentId, a.amountPaise])).toEqual([[I1, 1_200_000], [I2, 300_000]]);
    expect(plan.unallocated).toBe(0);
  });
  it("pays the late fee before the principal", () => {
    const plan = new FeeCalculator(base()).allocate(100_000, "2026-04-20"); // 25,000 late
    expect(plan.allocations).toEqual([{ installmentId: I1, charge: false, name: "Term 1", amountPaise: 75_000, lateFeePaise: 25_000 }]);
    expect(plan.lateFee).toBe(25_000);
  });
  it("clears an older installment's late fee and principal before moving on", () => {
    const plan = new FeeCalculator(base()).allocate(1_250_000, "2026-09-01"); // Term 1: 1,200,000 + 50,000 late
    expect(plan.allocations[0]).toMatchObject({ installmentId: I1, amountPaise: 1_200_000, lateFeePaise: 50_000 });
    expect(plan.allocations).toHaveLength(1);
  });
  it("reports what is more than owed", () => {
    const plan = new FeeCalculator(base()).allocate(4_000_000, "2026-04-05");
    expect(plan.allocated).toBe(3_600_000);
    expect(plan.unallocated).toBe(400_000);
  });
  it("after allocating, the statement clears exactly", () => {
    const plan = new FeeCalculator(base()).allocate(1_225_000, "2026-04-20");
    const next = new FeeCalculator(base({ today: "2026-04-21", payments: [pay("p1", "2026-04-20", ...plan.allocations.map((a) => [a.installmentId, a.amountPaise, a.lateFeePaise] as [string, number, number]))] }));
    expect(next.statement().lines[0]!.due).toBe(0);
    expect(next.statement().lines[0]!.lateFee).toBe(25_000);
    reconciles(next);
  });
});

describe("apportion regression", () => {
  it("splits ₹23,000 into three installments that sum exactly", () => {
    const parts = FeeCalculator.apportion(2_300_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(2_300_000);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
});
