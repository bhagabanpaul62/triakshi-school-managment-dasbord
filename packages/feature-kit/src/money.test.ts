import { describe, expect, it } from "vitest";
import { addMonths, apportion, daysBetween, fyOf, fyRange, inWords, monthEnd, percentOf, rupees } from "./money";

describe("money", () => {
  it("apportions exactly", () => {
    for (const [total, w] of [[100, [1, 1, 1]], [1, [3, 7]], [999_999, [5, 0, 11, 2]], [0, [1, 2]], [7, [0, 0]]] as [number, number[]][]) {
      expect(apportion(total, w).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("formats and spells", () => {
    expect(rupees(1_800_050)).toBe("₹18,000.50");
    expect(rupees(-500)).toBe("-₹5");
    expect(percentOf(1001, 1000)).toBe(100);
    expect(inWords(12_345_050)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty and Fifty Paise Only");
    expect(inWords(0)).toBe("Rupees Zero Only");
    expect(inWords(1_000_000_000_00)).toBe("Rupees One Hundred Crore Only");
  });
  it("financial years and months", () => {
    expect([fyOf("2026-03-31"), fyOf("2026-04-01"), fyOf("2099-12-01")]).toEqual(["2025-26", "2026-27", "2099-00"]);
    expect(fyRange("2026-27")).toEqual(["2026-04-01", "2027-03-31"]);
    expect([monthEnd("2028-02-05"), addMonths("2026-11-24", 2), daysBetween("2026-02-28", "2026-03-01")]).toEqual(["2028-02-29", "2027-01-01", 1]);
  });
});
