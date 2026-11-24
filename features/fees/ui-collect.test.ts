import { describe, expect, it } from "vitest";
import { allocatePlan } from "./calc";
import { asCalc, changeDue, csvCell, denominationTotal, outcomeOf, pickedTotal, previewAllocation, selectIds, shareText, splitProblem, type DeskBill } from "./ui/collect/logic";

const line = (id: string, amountPaise: number, sort: number, paidPaise = 0) => ({ id, label: id.toUpperCase(), kind: "fee", amountPaise, concessionPaise: 0, creditedPaise: 0, paidPaise, sort });
const bill = (id: string, dueDate: string, lines: ReturnType<typeof line>[], over: Partial<DeskBill> = {}): DeskBill => ({
  id, studentId: "s1", studentName: "Riya", number: id, label: `Bill ${id}`, dueDate, state: "due", openPaise: lines.reduce((s, l) => s + l.amountPaise - l.paidPaise, 0), accruedLatePaise: 0, parts: [], lines, ...over,
});
const bills = [
  bill("b2", "2026-06-10", [line("t2", 300_00, 0), line("e2", 100_00, 1)]),
  bill("b1", "2026-04-10", [line("t1", 500_00, 0)], { state: "overdue", accruedLatePaise: 50_00 }),
];

describe("allocation preview", () => {
  it("equals the server's allocatePlan on the same bills, oldest due first, late fee first", () => {
    const picks = bills.map((b) => ({ id: b.id }));
    const p = previewAllocation(bills, picks, 700_00, true);
    const server = allocatePlan(bills.map((b) => asCalc(b)), 700_00, { lateFirst: true });
    expect(p.rows.map((r) => [r.billId, r.amountPaise])).toEqual(server.parts.map((x) => [x.invoiceId, x.amountPaise]));
    expect(p.rows.map((r) => r.line)).toEqual(["Late fee", "T1", "T2"]);
    expect(p.leftoverPaise).toBe(server.leftover);
    expect(p.appliedPaise + p.leftoverPaise).toBe(700_00);
  });
  it("late fee last, a part payment limit, and leftover becoming advance", () => {
    expect(previewAllocation(bills, [{ id: "b1" }], 100_00, false).rows.map((r) => r.line)).toEqual(["T1"]);
    const limited = previewAllocation(bills, [{ id: "b2", limitPaise: 150_00 }], 900_00, true);
    expect(limited.perBill).toEqual({ b2: 150_00 });
    expect(limited.leftoverPaise).toBe(750_00);
  });
  it("totals what the chosen bills need today, late fee included, capped by the limit", () => {
    expect(pickedTotal(bills, [{ id: "b1" }, { id: "b2" }])).toBe(550_00 + 400_00);
    expect(pickedTotal(bills, [{ id: "b1", limitPaise: 100_00 }])).toBe(100_00);
  });
  it("quick selections", () => {
    expect(selectIds(bills, "all")).toEqual(["b1", "b2"]);
    expect(selectIds(bills, "overdue")).toEqual(["b1"]);
    expect(selectIds(bills, "oldest")).toEqual(["b1"]);
    expect(selectIds(bills, "none")).toEqual([]);
  });
});

describe("cash and counts", () => {
  it("change to return and shortfall", () => {
    expect(changeDue(1_350_00, 2_000_00)).toEqual({ changePaise: 650_00, shortPaise: 0 });
    expect(changeDue(1_350_00, 1_000_00)).toEqual({ changePaise: 0, shortPaise: 350_00 });
    expect(changeDue(1_350_00, null)).toEqual({ changePaise: 0, shortPaise: 0 });
  });
  it("denomination totals in paise", () => {
    expect(denominationTotal({ "200000": 1, "50000": 3, "100": 7 })).toBe(200_000 + 150_000 + 700);
    expect(denominationTotal({ "50000": -2, "100": 1.9 })).toBe(100);
  });
});

describe("csv", () => {
  it("does not let a cell run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("Sharma, Riya")).toBe('"Sharma, Riya"');
    expect(csvCell(null)).toBe("");
    expect(csvCell("12.50")).toBe("12.50");
  });
});

describe("collect checks and the outcome box", () => {
  it("says what is wrong with a split", () => {
    expect(splitProblem([], 0, 0, 0)).toMatch(/Choose a bill/);
    expect(splitProblem([{ method: "cash", amountPaise: 500_00 }], 600_00, 0, 0)).toMatch(/not assigned/);
    expect(splitProblem([{ method: "cheque", amountPaise: 300_00 }, { method: "cash", amountPaise: 300_00 }], 600_00, 0, 0)).toMatch(/own receipt/);
    expect(splitProblem([{ method: "advance", amountPaise: 600_00 }], 600_00, 100_00, 0)).toMatch(/only/);
    expect(splitProblem([{ method: "cash", amountPaise: 600_00 }], 600_00, 0, 0)).toBeNull();
  });
  it("what will happen, in words", () => {
    const o = outcomeOf({ totalPaise: 1_000_00, leftoverPaise: 50_00, picked: bills, appliedPaise: 950_00, parts: [{ method: "cash", amountPaise: 1_000_00 }], payer: "Riya" });
    expect(o).toMatchObject({ receiptPaise: 1_000_00, leftDuePaise: 0, newAdvancePaise: 50_00, latePaise: 50_00 });
    expect(o.lines.join(" ")).toMatch(/cash box goes up by ₹1,000/i);
    expect(o.lines.join(" ")).toMatch(/kept as advance/);
  });
  it("share text", () => {
    expect(shareText({ number: "R-000042", amountPaise: 1_250_00, student: "Riya Sharma", school: "Triakshi School", link: "https://x/y" })).toBe("Fee receipt R-000042 for ₹1,250 received for Riya Sharma. Thank you. Triakshi School\nhttps://x/y");
  });
});
