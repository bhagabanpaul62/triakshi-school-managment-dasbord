import { describe, expect, it } from "vitest";
import { clock12, minutes, monthlyFeeFor, occupancyPct, occupancyTone, stopTimeProblem } from "./rules";

describe("transport rules", () => {
  it("minutes and 12-hour clock", () => {
    expect(minutes("07:10")).toBe(430);
    expect(clock12("07:10")).toBe("7:10 am");
    expect(clock12("14:30")).toBe("2:30 pm");
    expect(clock12("00:05")).toBe("12:05 am");
    expect(clock12("12:00")).toBe("12:00 pm");
  });

  it("occupancy is a capped percentage and 0 without a vehicle", () => {
    expect(occupancyPct(10, 40)).toBe(25);
    expect(occupancyPct(14, 14)).toBe(100);
    expect(occupancyPct(20, 14)).toBe(100);
    expect(occupancyPct(5, null)).toBe(0);
    expect(occupancyPct(5, 0)).toBe(0);
    expect(occupancyTone(100)).toBe("danger");
    expect(occupancyTone(90)).toBe("warning");
    expect(occupancyTone(40)).toBe("info");
  });

  it("stop times must increase both in the morning and in the evening", () => {
    const ok = [{ name: "A", morningTime: "07:00", eveningTime: "15:00" }, { name: "B", morningTime: "07:10", eveningTime: "15:10" }];
    expect(stopTimeProblem(ok)).toBeNull();
    expect(stopTimeProblem([])).toBeNull();
    expect(stopTimeProblem([ok[0]!])).toBeNull();
    expect(stopTimeProblem([ok[0]!, { ...ok[1]!, morningTime: "07:00" }])).toMatchObject({ field: "morningTime" });
    expect(stopTimeProblem([ok[0]!, { ...ok[1]!, eveningTime: "14:00" }])).toMatchObject({ field: "eveningTime" });
    expect(stopTimeProblem([ok[0]!, { ...ok[1]!, morningTime: "06:00" }])?.message).toContain("B must come after A");
  });

  it("monthly fee: full both ways, half one way, nothing for neither", () => {
    expect(monthlyFeeFor(120000, true, true)).toBe(120000);
    expect(monthlyFeeFor(120000, true, false)).toBe(60000);
    expect(monthlyFeeFor(120001, false, true)).toBe(60001);
    expect(monthlyFeeFor(120000, false, false)).toBe(0);
  });
});
