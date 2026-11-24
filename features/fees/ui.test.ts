import { describe, expect, it } from "vitest";
import { addMonthsKeepDay, ageingBuckets, diffPlans, generateDues, invoicePaperData, lateExample, lateRuleSentence, planProblems, planTotals, reviseDifference, splitIntoParts } from "./ui/logic";

const year = { startsOn: "2026-04-01", endsOn: "2027-03-31" };
const sum = (xs: { amountPaise: number }[]) => xs.reduce((s, x) => s + x.amountPaise, 0);

describe("plan schedules over an academic year", () => {
  it("monthly makes twelve dues, April to March, on the due day", () => {
    const d = generateDues("monthly", year, 100_000, { dueDay: 10 });
    expect(d).toHaveLength(12);
    expect(d[0]).toMatchObject({ dueKey: "2026-04", label: "Apr 2026", dueOn: "2026-04-10", billOn: "2026-04-03" });
    expect(d[11]).toMatchObject({ dueKey: "2027-03", dueOn: "2027-03-10" });
    expect(sum(d)).toBe(1_200_000);
  });
  it("holds a due day of 31 to the end of a short month", () => {
    const d = generateDues("monthly", year, 1, { dueDay: 31 });
    expect(d.find((x) => x.dueKey === "2026-06")!.dueOn).toBe("2026-06-30");
    expect(d.find((x) => x.dueKey === "2027-02")!.dueOn).toBe("2027-02-28");
  });
  it("quarterly makes four, term follows the term count, yearly and once make one", () => {
    expect(generateDues("quarterly", year, 5, {}).map((x) => x.dueOn)).toEqual(["2026-04-10", "2026-07-10", "2026-10-10", "2027-01-10"]);
    expect(generateDues("term", year, 5, { terms: 3 }).map((x) => x.dueKey)).toEqual(["T1", "T2", "T3"]);
    expect(generateDues("term", year, 5, { terms: 2 }).map((x) => x.dueOn)).toEqual(["2026-04-10", "2026-10-10"]);
    expect(generateDues("yearly", year, 9, {})).toHaveLength(1);
    expect(generateDues("once", year, 9, {})[0]!.dueKey).toBe("ONCE");
  });
  it("custom takes the given dates, sorted, once each, and ignores junk", () => {
    const d = generateDues("custom", year, 7, { dates: ["2026-09-01", "2026-06-15", "2026-09-01", "soon"] });
    expect(d.map((x) => x.dueOn)).toEqual(["2026-06-15", "2026-09-01"]);
    expect(d[0]!.label).toBe("15 Jun 2026");
  });
  it("a total is split over the dues with nothing lost", () => {
    const d = generateDues("quarterly", year, 100_001, { basis: "total" });
    expect(sum(d)).toBe(100_001);
    expect(d.map((x) => x.amountPaise)).toEqual([25_001, 25_000, 25_000, 25_000]);
  });
  it("a first due before the year starts is held to the first day", () => {
    expect(generateDues("yearly", { startsOn: "2026-04-15", endsOn: "2027-03-31" }, 1, { dueDay: 5 })[0]!.dueOn).toBe("2026-04-15");
  });
});

describe("plan totals", () => {
  const monthly = generateDues("monthly", year, 100_000, {});
  const once = generateDues("once", year, 500_000, {});
  const lines = [{ headId: "tuition", optional: false, dues: monthly }, { headId: "admission", optional: false, dues: once }, { headId: "bus", optional: true, dues: generateDues("monthly", year, 20_000, {}) }];
  it("totals by head, by bill and keeps optional fees apart", () => {
    const t = planTotals(lines);
    expect(t.yearPaise).toBe(1_700_000);
    expect(t.optionalPaise).toBe(240_000);
    expect(t.byHead.map((h) => h.totalPaise)).toEqual([1_200_000, 500_000, 240_000]);
    expect(t.byDue).toHaveLength(13);
    expect(t.byDue[0]).toMatchObject({ dueKey: "2026-04", requiredPaise: 100_000, optionalPaise: 20_000 });
    expect(t.byDue.find((x) => x.dueKey === "ONCE")!.requiredPaise).toBe(500_000);
  });
  it("names what is missing", () => {
    expect(planProblems({ name: "", classIds: [], lines: [] })).toHaveLength(3);
    expect(planProblems({ name: "Class 1", classIds: ["c"], lines, })).toEqual([]);
    expect(planProblems({ name: "Class 1", classIds: ["c"], lines: [{ headId: "a", optional: false, dues: [{ ...monthly[0]!, dueOn: "2026-01-01" }] }] })[0]).toMatch(/before its bill date/);
  });
});

describe("plan version diff", () => {
  const head = (headId: string, headName: string, amounts: number[], optional = false) => ({ headId, headName, optional, dues: amounts.map((amountPaise, i) => ({ dueKey: `T${i + 1}`, dueOn: `2026-0${i + 4}-10`, amountPaise })) });
  it("lists added, removed, changed and moved fees and the year's change", () => {
    const from = { lines: [head("t", "Tuition", [100_000, 100_000]), head("l", "Library", [10_000])] };
    const to = { lines: [head("t", "Tuition", [110_000, 110_000]), head("x", "Exam", [5_000]), { ...head("l2", "Lab", [1]) }] };
    const d = diffPlans(from, { lines: [to.lines[0]!, to.lines[1]!] });
    expect(d.changes.map((c) => c.kind).sort()).toEqual(["added", "amount", "removed"]);
    expect(d.fromPaise).toBe(210_000);
    expect(d.toPaise).toBe(225_000);
    expect(d.deltaPaise).toBe(15_000);
    expect(d.percent).toBe(7.1);
  });
  it("sees a moved date and a fee that became optional", () => {
    const a = head("t", "Tuition", [100_000]);
    const moved = { ...a, dues: [{ ...a.dues[0]!, dueOn: "2026-05-20" }], optional: true };
    const d = diffPlans({ lines: [a] }, { lines: [moved] });
    expect(d.changes.map((c) => c.kind).sort()).toEqual(["dates", "optional"]);
    expect(diffPlans({ lines: [a] }, { lines: [a] }).changes).toEqual([]);
  });
});

describe("revising a bill", () => {
  it("lowering what is open needs approval; raising or keeping does not", () => {
    const old = [{ amountPaise: 100_000, concessionPaise: 10_000 }, { amountPaise: 50_000 }];
    expect(reviseDifference(old, [{ amountPaise: 100_000 }])).toMatchObject({ oldOpenPaise: 140_000, newPaise: 100_000, differencePaise: -40_000, needsApproval: true });
    expect(reviseDifference(old, [{ amountPaise: 140_000 }])).toMatchObject({ differencePaise: 0, needsApproval: false });
    expect(reviseDifference(old, [{ amountPaise: 150_000 }])).toMatchObject({ differencePaise: 10_000, needsApproval: false });
  });
  it("counts only what is still open on a part-paid bill", () => {
    const r = reviseDifference([{ amountPaise: 100_000, paidPaise: 60_000 }], [{ amountPaise: 30_000 }]);
    expect(r.oldOpenPaise).toBe(40_000);
    expect(r.needsApproval).toBe(true);
    expect(r.why).toMatch(/lowers/);
  });
});

describe("late fee in words", () => {
  it("says the rule and works an example through the same arithmetic as billing", () => {
    const rule = { kind: "flat", amountPaise: 10_000, graceDays: 5, maxPaise: null } as const;
    expect(lateRuleSentence(rule)).toBe("₹100 is added once, after 5 days of grace.");
    expect(lateExample(rule).feePaise).toBe(10_000);
    expect(lateExample({ kind: "per_day", amountPaise: 1_000, graceDays: 0, maxPaise: 5_000 }, 1_000_000, 20).feePaise).toBe(5_000);
    expect(lateExample(null).sentence).toBe("");
    expect(lateRuleSentence(null)).toBe("No late fee.");
  });
});

describe("invoice on paper and settlement parts", () => {
  it("shows concession, late fee and the payable total, in words", () => {
    const d = invoicePaperData({ number: null, issueDate: null, dueDate: "2026-12-10", label: "Term 2", student: { name: "Priya", admissionNo: "A1", classLabel: "7-B", guardian: null }, lines: [{ label: "Tuition", amountPaise: 1_200_000, concessionPaise: 120_000 }, { label: "Late fee", amountPaise: 0, concessionPaise: 0, latePaise: 5_000 }] });
    expect(d.facts[0]).toEqual(["Number", "Draft"]);
    expect(d.rows[0]).toMatchObject({ item: "Tuition", concession: "₹1,200.00", amount: "₹10,800.00" });
    expect(d.totals.at(-1)).toEqual(["Payable", "₹10,850.00", true]);
    expect(d.amountWords).toMatch(/only$/i);
  });
  it("splits a total into monthly parts that add up", () => {
    const p = splitIntoParts(100_001, 3, "2026-11-30");
    expect(p.map((x) => x.dueOn)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    expect(sum(p)).toBe(100_001);
    expect(addMonthsKeepDay("2027-01-31", 1)).toBe("2027-02-28");
    expect(splitIntoParts(0, 3, "2026-11-30")).toEqual([]);
  });
  it("only the late age bands open the overdue list", () => {
    const b = ageingBuckets({ notDue: 1, d1_30: 2, d31_60: 3, d61_90: 4, d90p: 5 });
    expect(b[0]!.href).toBeUndefined();
    expect(b.slice(1).every((x) => x.href === "/app/fees/dues?overdue=1")).toBe(true);
  });
});
