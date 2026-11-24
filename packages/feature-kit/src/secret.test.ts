import { describe, expect, it } from "vitest";
import { mask, seal, unseal } from "./secret";

describe("secret", () => {
  it("round-trips, never repeats, and refuses a changed value or another school", () => {
    const a = seal("ABCDE1234F", "school-a");
    expect(unseal(a, "school-a")).toBe("ABCDE1234F");
    expect(seal("ABCDE1234F", "school-a")).not.toBe(a);
    expect(a).not.toContain("ABCDE");
    expect(() => unseal(a, "school-b")).toThrow();
    expect(() => unseal(a.slice(0, -2) + (a.endsWith("AA") ? "BB" : "AA"), "school-a")).toThrow();
    expect(() => unseal("junk", "school-a")).toThrow();
  });
  it("masks", () => expect([mask("123456789012"), mask(null), mask("12")]).toEqual(["XXXXXXXX9012", null, "12"]));
});
