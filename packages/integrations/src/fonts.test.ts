import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { runsOf } from "./fonts";
import { PdfBuilder } from "./pdf";

const SAMPLES = ["₹1,23,456.00", "प्रिया शर्मा क्षत्रिय", "ಕನ್ನಡ ಶಾಲೆ", "তিথি বিদ্যালয়", "தமிழ் பள்ளி ஸ்ரீ", "తెలుగు శ్రీ ప్రియ"];

describe("font runs", () => {
  it("picks the font per script and keeps joiners with their letters", () => {
    expect(runsOf("Priya प्रिया ಕನ್ನಡ").map((r) => r.face)).toEqual(["latin", "devanagari", "latin", "kannada"]);
    expect(runsOf("₹5").map((r) => r.face)).toEqual(["latinExt", "latin"]);
    expect(runsOf("क्‍ष").map((r) => r.face)).toEqual(["devanagari"]);
  });
  it("prints ? for a letter in no font, never a missing-glyph box", () => {
    expect(runsOf("日").map((r) => r.text).join("")).toBe("?");
  });
});

describe("unicode PdfBuilder", () => {
  it("renders every script, including Telugu conjuncts that crash fontkit's mark positioning", async () => {
    const b = await PdfBuilder.create({ unicode: true });
    await b.need(SAMPLES);
    SAMPLES.forEach((s, i) => { b.textAt(s, { x: 40, y: 780 - i * 30, size: 16 }); b.textAt(s, { x: 300, y: 780 - i * 30, size: 16, bold: true }); });
    const bytes = await b.save();
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("throws a clear error when text was not announced with need()", async () => {
    const b = await PdfBuilder.create({ unicode: true });
    expect(() => b.textAt("प्रिया", { x: 0, y: 0 })).toThrow(/not prepared/);
  });
  it("a Latin one-page receipt stays small", async () => {
    const b = await PdfBuilder.create({ unicode: true });
    const rows = Array.from({ length: 12 }, (_, i) => [`Tuition fee term ${i + 1}`, PdfBuilder.money(1_250_000 + i)]);
    await b.need(rows.flat());
    b.header({ title: "Fee receipt", orgName: "Triakshi Public School", orgLines: ["12 Main Road, Kolkata"] })
      .table({ columns: [{ label: "Item", width: 300 }, { label: "Amount", width: 150, align: "right" }], rows });
    expect((await b.save()).length).toBeLessThan(120_000);
  });
  it("measures, wraps and reports a framed block that does not fit", async () => {
    const b = await PdfBuilder.create({ unicode: true, size: [226.77, 5000], margin: 10 });
    await b.need(["a long line of words that must wrap"]);
    const lines = b.wrap("a long line of words that must wrap", 80, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((l) => b.measure(l, 10)))).toBeLessThanOrEqual(80);
    b.frame(100, 90).text("x").text("y").text("z");
    expect(b.overflowed).toBe(true);
    expect(b.pageCount).toBe(1);
  });
  it("fitHeight cuts a roll to its content", async () => {
    const b = await PdfBuilder.create({ unicode: true, size: [226.77, 5000], margin: 10 });
    await b.need(["Hello"]);
    b.text("Hello").fitHeight();
    const page = (await PDFDocument.load(await b.save())).getPage(0);
    expect(page.getHeight()).toBeLessThan(100);
  });
});
