import { describe, expect, it } from "vitest";
import { ProrationCalculator } from "./proration";
import { addInterval } from "./util";

const start = new Date("2026-04-01T00:00:00Z");
const end = new Date("2027-04-01T00:00:00Z"); // 365 days

describe("ProrationCalculator", () => {
  it("upgrade charges the price difference for the days left, rounded down", () => {
    const now = new Date("2026-10-01T00:00:00Z"); // 183 days left of 365
    const q = ProrationCalculator.quote({ oldPaise: 1_000_000, newPaise: 2_500_000, periodStart: start, periodEnd: end, now });
    expect(q).toEqual({ kind: "upgrade", remainingDays: 182, periodDays: 365, amountPaise: Math.floor((1_500_000 * 182) / 365) });
  });
  it("rounds down to the paisa", () => {
    const q = ProrationCalculator.quote({ oldPaise: 0, newPaise: 100, periodStart: start, periodEnd: end, now: new Date("2026-04-02T00:00:00Z") });
    expect(q).toMatchObject({ kind: "upgrade", amountPaise: Math.floor((100 * 364) / 365) });
  });
  it("upgrade on the last day costs almost nothing, never negative", () => {
    const q = ProrationCalculator.quote({ oldPaise: 100, newPaise: 200, periodStart: start, periodEnd: end, now: new Date("2027-05-01T00:00:00Z") });
    expect(q).toMatchObject({ kind: "upgrade", amountPaise: 0, remainingDays: 0 });
  });
  it("a period that has not started charges the whole difference", () => {
    const q = ProrationCalculator.quote({ oldPaise: 100_00, newPaise: 300_00, periodStart: start, periodEnd: end, now: new Date("2026-01-01T00:00:00Z") });
    expect(q).toMatchObject({ kind: "upgrade", amountPaise: 200_00, remainingDays: 365 });
  });
  it("downgrade waits for the period end", () => {
    expect(ProrationCalculator.quote({ oldPaise: 500, newPaise: 100, periodStart: start, periodEnd: end, now: start })).toEqual({ kind: "downgrade", scheduleAt: end });
  });
  it("same price is no change", () => {
    expect(ProrationCalculator.quote({ oldPaise: 100, newPaise: 100, periodStart: start, periodEnd: end, now: start })).toEqual({ kind: "same" });
  });
});

describe("addInterval", () => {
  it("clamps month ends and keeps the date for a year", () => {
    expect(addInterval(new Date("2026-01-31T00:00:00Z"), "monthly").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addInterval(new Date("2026-04-12T08:00:00Z"), "annual").toISOString()).toBe("2027-04-12T08:00:00.000Z");
  });
});
