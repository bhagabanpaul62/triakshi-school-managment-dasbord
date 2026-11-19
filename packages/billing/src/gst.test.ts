import { describe, expect, it } from "vitest";
import { GstCalculator } from "./gst";

const gst = new GstCalculator("Karnataka");

describe("GstCalculator", () => {
  it("same state: CGST 9% + SGST 9%", () => {
    expect(gst.compute(1_000_000, "Karnataka")).toEqual({ taxablePaise: 1_000_000, cgstPaise: 90_000, sgstPaise: 90_000, igstPaise: 0, totalPaise: 1_180_000, intra: true });
  });
  it("matches the state ignoring case and spaces", () => {
    expect(gst.compute(100_00, "  karnataka ").igstPaise).toBe(0);
  });
  it("other state: IGST 18%", () => {
    expect(gst.compute(1_000_000, "Maharashtra")).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 180_000, totalPaise: 1_180_000, intra: false });
  });
  it("unknown state is treated as interstate", () => {
    expect(gst.compute(1_000_000, null).igstPaise).toBe(180_000);
  });
  it("odd paise: CGST and SGST still add up exactly", () => {
    // 18% of 1,001 paise = 180.18 -> 180; halves 90 + 90
    // 18% of 1,003 paise = 180.54 -> 181; halves 90 + 91
    const a = gst.compute(1_003, "Karnataka");
    expect(a.cgstPaise + a.sgstPaise).toBe(181);
    expect(a).toMatchObject({ cgstPaise: 90, sgstPaise: 91, totalPaise: 1_184 });
    for (const taxable of [1, 3, 7, 99, 12_345, 999_999]) {
      const g = gst.compute(taxable, "Karnataka");
      expect(g.cgstPaise + g.sgstPaise).toBe(gst.compute(taxable, "Goa").igstPaise);
      expect(g.totalPaise).toBe(taxable + g.cgstPaise + g.sgstPaise);
    }
  });
  it("rejects fractional paise", () => {
    expect(() => gst.compute(10.5, "Karnataka")).toThrow(RangeError);
  });
});
