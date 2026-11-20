import { describe, expect, it } from "vitest";
import { limitWarning } from "./limits";

describe("limitWarning", () => {
  const limits = { t1: { maxPerDay: 2, maxPerWeek: 5, week: 4, day: { 1: 2, 2: 1 } }, t2: { maxPerDay: null, maxPerWeek: 3, week: 3, day: {} } };
  it("warns when one more period passes the day limit", () => expect(limitWarning(limits, "t1", 1, false)).toMatch(/3 periods that day, over their limit of 2/));
  it("warns on the week limit when the day is fine", () => {
    expect(limitWarning(limits, "t1", 2, false)).toBeNull(); // 2 a day, 5 a week: exactly at both
    expect(limitWarning(limits, "t2", 3, false)).toMatch(/4 periods that week/);
  });
  it("keeping the teacher already in the cell adds nothing", () => expect(limitWarning(limits, "t1", 1, true)).toBeNull());
  it("teachers without limits never warn", () => expect(limitWarning(limits, "t9", 1, false)).toBeNull());
});
