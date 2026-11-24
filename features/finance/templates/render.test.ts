import { describe, expect, it } from "vitest";
import { pdfPageCount, qrSvg } from "@smw/integrations";
import { KINDS, LAYOUTS, defaultConfig, sampleData, type DocumentData, type DocumentKind, type DocumentLayout } from "./config";
import { renderDocument } from "./render";

const pages = async (bytes: Uint8Array) => {
  expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
  return pdfPageCount(bytes);
};
const cfg = (kind: DocumentKind, layout: DocumentLayout) => ({ ...defaultConfig(kind, ["श्री विद्यालय", "12 Main Road, Kolkata"]), layout, watermark: "Draft" });
const rowsFor = (kind: DocumentKind, n: number): DocumentData["rows"] => Array.from({ length: n }, (_, i) => {
  const base = sampleData(kind).rows[0]!;
  return { ...base, item: `प्रिया शर्मा, instalment ${i + 1} with a rather long description that has to wrap inside its column` };
});

describe("renderDocument", () => {
  for (const kind of KINDS) for (const layout of LAYOUTS) {
    it(`${kind} on ${layout}: Hindi name, no rows, forty rows`, async () => {
      for (const rows of [0, 1, 40]) {
        const data = { ...sampleData(kind), rows: rowsFor(kind, rows), qrSvg: qrSvg("https://x.example/verify/receipt/abcdefghijklmnop"), marks: ["DUPLICATE"] };
        data.facts = [["Student", "प्रिया शर्मा क्षत्रिय"], ...data.facts.slice(1)];
        expect(await pages(await renderDocument(cfg(kind, layout), data))).toBeGreaterThan(0);
      }
    });
  }

  it("long tables run onto more pages on A4, but a roll stays one page", async () => {
    const data = { ...sampleData("statement"), rows: rowsFor("statement", 200) };
    expect(await pages(await renderDocument(cfg("statement", "a4"), data))).toBeGreaterThan(2);
    expect(await pages(await renderDocument(cfg("statement", "thermal80"), { ...data, rows: data.rows.slice(0, 40) }))).toBe(1);
  });
  it("two copies share a sheet, and a long document falls back to a full set of pages per copy", async () => {
    expect(await pages(await renderDocument(cfg("receipt", "two_up"), sampleData("receipt")))).toBe(1);
    expect(await pages(await renderDocument(cfg("receipt", "two_up"), { ...sampleData("receipt"), rows: rowsFor("receipt", 40) }))).toBeGreaterThanOrEqual(2);
  });
  it("hidden details do not reach the PDF", async () => {
    const withIt = await renderDocument(cfg("receipt", "a4"), sampleData("receipt"));
    const without = await renderDocument({ ...cfg("receipt", "a4"), hiddenFacts: ["Guardian", "Class", "Payment reference"], hiddenTotals: ["Balance after payment"] }, sampleData("receipt"));
    expect(without.length).toBeLessThan(withIt.length);
  });
  it("a one page receipt stays under 120 KB", async () => {
    expect((await renderDocument(cfg("receipt", "a5"), { ...sampleData("receipt"), qrSvg: qrSvg("https://x.example/verify/receipt/abcdefghijklmnop") })).length).toBeLessThan(120_000);
  });
});
