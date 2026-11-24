// Run: node --experimental-strip-types packages/ui/src/components/finance/logic.check.ts
import assert from "node:assert/strict";
// @ts-expect-error node needs the extension; tsc does not allow it without a flag
import * as L from "./logic.ts";

const clean = (s: string) => L.cleanAmount(s);
assert.equal(clean("1,200"), "1200");
assert.equal(clean("₹1,200"), "1200");
assert.equal(clean("1200.5"), "1200.5");
assert.equal(clean("1200.50"), "1200.50");
assert.equal(clean("1200.505"), null, "three decimals blocked");
assert.equal(clean("12a"), null);
assert.equal(clean("1.2.3"), null);
assert.equal(clean(""), "");
assert.equal(L.toPaise("1200"), 120000);
assert.equal(L.toPaise("1200.5"), 120050);
assert.equal(L.toPaise("0.07"), 7);
assert.equal(L.toPaise("19.99"), 1999, "no float drift");
assert.equal(L.toPaise("."), null);
assert.equal(L.toPaise(""), null);
assert.equal(L.fromPaise(120000), "1200");
assert.equal(L.fromPaise(120050), "1200.50");
assert.equal(L.fromPaise(7), "0.07");
assert.equal(L.groupIndian("1234567.5"), "12,34,567.5");
assert.equal(L.groupIndian("999"), "999");
assert.equal(L.groupIndian("1000"), "1,000");
assert.equal(L.formatPaise(12345600), "₹1,23,456");
assert.equal(L.formatPaise(12345650), "₹1,23,456.50");
assert.equal(L.formatPaise(500, { fixed: true }), "₹5.00");
assert.equal(L.formatPaise(-80000), "-₹800");
assert.equal(L.formatPaise(80000, { sign: "always" }), "+₹800");
assert.equal(L.formatPaise(-80000, { sign: "abs" }), "₹800");

assert.deepEqual(L.splitState(1000, [400, 300]), { assigned: 700, left: 300, over: 0, done: false });
assert.deepEqual(L.splitState(1000, [600, 600]), { assigned: 1200, left: 0, over: 200, done: false });
assert.equal(L.splitState(1000, [1000]).done, true);

assert.deepEqual(L.moveItem([1, 2, 3], 1, -1), [2, 1, 3]);
assert.deepEqual(L.moveItem([1, 2, 3], 0, -1), [1, 2, 3]);
assert.deepEqual(L.moveItem([1, 2, 3], 2, 1), [1, 2, 3]);
assert.deepEqual(L.duplicateAt([{ a: 1 }, { a: 2 }], 0, (x: { a: number }) => ({ a: x.a + 10 })), [{ a: 1 }, { a: 11 }, { a: 2 }]);
assert.equal(L.sumPaise([{ amountPaise: 5 }, { amountPaise: 7 }]), 12);

assert.deepEqual(L.shares([1, 1, 1]), [34, 33, 33]);
assert.equal(L.shares([1, 1, 1]).reduce((a: number, b: number) => a + b, 0), 100);
assert.deepEqual(L.shares([0, 0]), [0, 0]);
assert.deepEqual(L.variance(900, 1000), { pct: 90, diff: -100, over: false, scaleMax: 1000 });
assert.equal(L.variance(5, 0).pct, null);
assert.equal(L.sparkPath([1], 10, 10).d, "");
assert.match(L.sparkPath([1, 2, 3], 100, 20).d, /^M2 18 L50 10 L98 2$/);
assert.deepEqual(L.sumKeys([{ a: 1, b: "x" }, { a: 2 }], ["a", "b"]), { a: 3, b: 0 });
assert.equal(L.csvCell('a,"b"'), '"a,""b"""');

// periods: Indian financial year
assert.equal(L.fyStartOf("2026-03-31"), 2025);
assert.equal(L.fyStartOf("2026-04-01"), 2026);
assert.deepEqual(L.monthPeriod(2028, 2), { kind: "month", from: "2028-02-01", to: "2028-02-29" });
assert.deepEqual(L.fyPeriod(2026), { kind: "fy", from: "2026-04-01", to: "2027-03-31" });
assert.deepEqual(L.quarterPeriod(2026, 1), { kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
assert.deepEqual(L.quarterPeriod(2026, 3), { kind: "quarter", from: "2026-10-01", to: "2026-12-31" });
assert.deepEqual(L.quarterPeriod(2026, 4), { kind: "quarter", from: "2027-01-01", to: "2027-03-31" });
assert.deepEqual(L.presetPeriod("last_month", "2026-01-15"), L.monthPeriod(2025, 12));
assert.deepEqual(L.presetPeriod("this_quarter", "2026-11-24"), L.quarterPeriod(2026, 3));
assert.deepEqual(L.presetPeriod("last_quarter", "2026-05-02"), L.quarterPeriod(2025, 4));
assert.deepEqual(L.presetPeriod("last_fy", "2026-02-10"), L.fyPeriod(2024));
for (const p of [L.monthPeriod(2026, 11), L.fyPeriod(2026), L.quarterPeriod(2026, 4), { kind: "custom" as const, from: "2026-11-03", to: "2026-11-20" }]) {
  const q = L.periodParams(p);
  assert.deepEqual(L.parsePeriod(q, "2026-11-24"), p, `round trip ${q.period}`);
}
assert.deepEqual(L.parsePeriod({ period: "junk" }, "2026-11-24"), L.monthPeriod(2026, 11));
assert.deepEqual(L.parsePeriod({ period: "custom", from: "2026-12-01", to: "2026-11-01" }, "2026-11-24"), L.monthPeriod(2026, 11));
assert.equal(L.periodLabel(L.monthPeriod(2026, 11)), "Nov 2026");
assert.equal(L.periodLabel(L.fyPeriod(2026)), "FY 2026-27");
assert.equal(L.periodLabel(L.quarterPeriod(2026, 4)), "Q4 FY 2026-27");
assert.equal(L.periodLabel({ kind: "custom", from: "2026-11-03", to: "2026-11-20" }), "3 Nov 2026 to 20 Nov 2026");

assert.equal(L.dayKey("2026-11-03"), "2026-11-03");
assert.equal(L.dayKey("2026-11-03T20:00:00Z"), "2026-11-04", "IST is ahead of UTC");
const g = L.groupByDay([{ at: "2026-11-03", n: 1 }, { at: "2026-11-05", n: 2 }, { at: "2026-11-03T05:00:00Z", n: 3 }]);
assert.deepEqual(g.map((x: { day: string }) => x.day), ["2026-11-05", "2026-11-03"]);
assert.deepEqual(g[1]!.items.map((x: { n: number }) => x.n), [1, 3]);

// every state named in features/fees/constants.ts and PRD 5.1 has an entry
for (const s of "draft upcoming due overdue part_paid paid cancelled valid clearing bounced reversed received deposited cleared pending approved rejected withdrawn submitted verified reviewed locked paid_out failed open soft closed spent published archived ended".split(" ")) {
  assert.ok(L.STATE_MAP[s], `state ${s}`);
}
assert.deepEqual(L.stateInfo("overdue"), { label: "Overdue", tone: "danger" });
assert.deepEqual(L.stateInfo("weird_one"), { label: "weird one", tone: "default" });
console.log("logic.check: all passed");
