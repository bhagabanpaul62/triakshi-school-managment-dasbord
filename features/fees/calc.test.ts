import { describe, expect, it } from "vitest";
import { allocatePlan, concessionsOn, dueState, invoiceLateFee, lateFee, openOf, previewInvoice, slicesOf, type CalcLine } from "./calc";

const line = (id: string, amountPaise: number, over: Partial<CalcLine> = {}): CalcLine => ({ id, kind: "fee", amountPaise, concessionPaise: 0, creditedPaise: 0, paidPaise: 0, sort: 0, ...over });
const rule = (r: object) => ({ graceDays: 0, ...r }) as never;

describe("late fee", () => {
  const base = { dueOn: "2026-04-10", openPaise: 100_000, fixedPaise: 0 };
  it("flat, per day, percent and slabs, after the grace days", () => {
    expect(lateFee(rule({ kind: "flat", amountPaise: 5_000, graceDays: 5 }), { ...base, until: "2026-04-15" })).toBe(0);
    expect(lateFee(rule({ kind: "flat", amountPaise: 5_000, graceDays: 5 }), { ...base, until: "2026-04-16" })).toBe(5_000);
    expect(lateFee(rule({ kind: "per_day", amountPaise: 1_000, graceDays: 5, maxPaise: 8_000 }), { ...base, until: "2026-04-20" })).toBe(5_000);
    expect(lateFee(rule({ kind: "per_day", amountPaise: 1_000, graceDays: 5, maxPaise: 8_000 }), { ...base, until: "2026-05-30" })).toBe(8_000);
    expect(lateFee(rule({ kind: "percent", basisPoints: 200 }), { ...base, until: "2026-04-11" })).toBe(2_000);
    const slabs = rule({ kind: "slabs", slabs: [{ afterDays: 1, amountPaise: 1_000 }, { afterDays: 10, amountPaise: 3_000 }] });
    expect([5, 12].map((d) => lateFee(slabs, { ...base, until: `2026-04-${10 + d}` }))).toEqual([1_000, 3_000]);
  });
  it("counts what is already fixed against the cap, and stops when nothing is open", () => {
    const r = rule({ kind: "per_day", amountPaise: 1_000, maxPaise: 8_000 });
    expect(lateFee(r, { ...base, until: "2026-05-30", fixedPaise: 5_000 })).toBe(3_000);
    expect(lateFee(r, { ...base, until: "2026-05-30", openPaise: 0 })).toBe(0);
  });
  it("an invoice's fee follows its settlement parts and ignores late lines", () => {
    const inv = { id: "i", dueDate: "2026-04-10", lines: [line("a", 100_000), line("l", 3_000, { kind: "late" })], parts: [{ dueOn: "2026-06-01", amountPaise: 103_000 }] };
    expect(invoiceLateFee(rule({ kind: "per_day", amountPaise: 1_000 }), inv, "2026-06-04")).toBe(0); // 3 days = 3,000, and 3,000 is already a late line
    expect(invoiceLateFee(rule({ kind: "per_day", amountPaise: 1_000 }), inv, "2026-06-06")).toBe(2_000);
    expect(invoiceLateFee(rule({ kind: "per_day", amountPaise: 1_000 }), inv, "2026-05-30")).toBe(0);
  });
});

describe("parts and states", () => {
  it("money paid clears the earliest parts first; extra falls on the bill's own date", () => {
    const inv = { dueDate: "2026-04-10", parts: [{ dueOn: "2026-06-01", amountPaise: 400 }, { dueOn: "2026-05-01", amountPaise: 600 }] };
    expect(slicesOf(inv, 1_000)).toEqual([{ dueOn: "2026-05-01", openPaise: 600 }, { dueOn: "2026-06-01", openPaise: 400 }]);
    expect(slicesOf(inv, 700)).toEqual([{ dueOn: "2026-05-01", openPaise: 300 }, { dueOn: "2026-06-01", openPaise: 400 }]);
    expect(slicesOf(inv, 300)).toEqual([{ dueOn: "2026-06-01", openPaise: 300 }]);
    expect(slicesOf(inv, 1_200)).toContainEqual({ dueOn: "2026-04-10", openPaise: 200 });
    expect(slicesOf(inv, 0)).toEqual([]);
  });
  it("derives the state and never stores it", () => {
    const t = { grossPaise: 1_000, concessionPaise: 0, creditedPaise: 0, latePaise: 0, paidPaise: 0, status: "issued", dueDate: "2026-05-10" };
    expect(dueState(t, "2026-05-11")).toBe("overdue");
    expect(dueState(t, "2026-05-05")).toBe("due");
    expect(dueState(t, "2026-04-01")).toBe("upcoming");
    expect(dueState({ ...t, paidPaise: 400 }, "2026-04-01")).toBe("part_paid");
    expect(dueState({ ...t, paidPaise: 400 }, "2026-06-01")).toBe("overdue");
    expect(dueState({ ...t, paidPaise: 1_000 }, "2026-06-01")).toBe("paid");
    expect(dueState({ ...t, status: "cancelled" }, "2026-06-01")).toBe("cancelled");
    expect(dueState({ ...t, parts: [{ dueOn: "2026-07-01", amountPaise: 1_000 }] }, "2026-06-01")).toBe("upcoming");
  });
});

describe("allocation", () => {
  const inv = (id: string, dueDate: string, lines: CalcLine[]) => ({ id, dueDate, lines });
  it("oldest bill first, late line first or last by setting, then the line order", () => {
    const a = inv("a", "2026-05-10", [line("a1", 500, { sort: 1 }), line("a2", 500, { sort: 2 }), line("al", 100, { kind: "late", sort: 3 })]);
    const b = inv("b", "2026-04-10", [line("b1", 300)]);
    const first = allocatePlan([a, b], 1_000, { lateFirst: true });
    expect(first.parts.map((p) => [p.lineId, p.amountPaise])).toEqual([["b1", 300], ["al", 100], ["a1", 500], ["a2", 100]]);
    const last = allocatePlan([a, b], 1_000, { lateFirst: false });
    expect(last.parts.map((p) => [p.lineId, p.amountPaise])).toEqual([["b1", 300], ["a1", 500], ["a2", 200]]);
    expect(allocatePlan([a, b], 2_000, { lateFirst: true }).leftover).toBe(2_000 - 1_400);
  });
  it("a limit caps what one payment may put on a bill", () => {
    const a = { ...inv("a", "2026-05-10", [line("a1", 500), line("a2", 500)]), limit: 600 };
    expect(allocatePlan([a], 1_000, { lateFirst: true })).toMatchObject({ leftover: 400 });
  });
});

describe("concessions", () => {
  it("head-specific first, then whole-bill, capped, spread to the paisa; deposits take none", () => {
    const lines = [{ headId: "t", amountPaise: 10_001 }, { headId: "e", amountPaise: 5_000 }, { headId: "d", kind: "deposit", amountPaise: 20_000 }];
    const c = concessionsOn(lines, [{ headId: "t", mode: "percent", value: 5000 }, { headId: null, mode: "amount", value: 1_000 }]);
    expect(c[0]).toBe(5_001 + Math.floor(1_000 * 5_000 / 10_000) + (0)); // half of 10,001 (rounded), then a share of 1,000
    expect(c[2]).toBe(0);
    expect(c.reduce((s, x) => s + x, 0)).toBe(Math.round(10_001 * 0.5) + 1_000);
  });
  it("preview adds up", () => {
    const p = previewInvoice({ lines: [{ amountPaise: 3_333 }, { amountPaise: 3_333 }, { amountPaise: 3_334 }], concessions: [{ headId: null, mode: "percent", value: 1000 }] });
    expect(p.concessionPaise).toBe(1_000);
    expect(p.duePaise).toBe(9_000);
    expect(p.lines.reduce((s, l) => s + openOf(line("x", l.amountPaise, { concessionPaise: l.concessionPaise })), 0)).toBe(9_000);
  });
});
