import { describe, expect, it } from "vitest";
import { code128, code128Modules, labelsPdf } from "./labels";

describe("Code 128 labels", () => {
  it("encodes ACC-00012 exactly like a reference encoder (Apple CoreImage CICode128BarcodeGenerator)", () => {
    expect(code128("ACC-00012").join("")).toBe(REFERENCE);
  });

  it("is 11 modules per symbol plus the 13-module stop, and rejects non-ASCII", () => {
    expect(code128Modules("ACC-00012")).toBe(134);
    expect(() => code128("")).toThrow();
    expect(() => code128("Ā")).toThrow();
  });

  it("writes a valid multi-page PDF", () => {
    const bytes = labelsPdf(Array.from({ length: 30 }, (_, i) => ({ title: `Book ${i}`, code: `ACC-${String(i + 1).padStart(5, "0")}` })));
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

// The widths CoreImage draws for "ACC-00012", run by run, bar first.
const REFERENCE = [2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 3, 2, 1, 1, 3, 1, 3, 2, 1, 1, 2, 2, 1, 3, 2, 1, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 1, 2, 3, 2, 2, 1, 2, 2, 3, 2, 1, 1, 3, 1, 2, 1, 3, 1, 2, 3, 3, 1, 1, 1, 2].join("");
