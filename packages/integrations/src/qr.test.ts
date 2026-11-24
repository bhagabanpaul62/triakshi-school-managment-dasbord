import { describe, expect, it } from "vitest";
import { qrCode, qrFromSvg, qrSvg, upiUri } from "./qr";
import { PdfBuilder } from "./pdf";

describe("upiUri", () => {
  it("writes exact rupees and escapes names and notes", () => {
    const u = upiUri({ upiId: "school@okhdfc", name: "Triakshi Public & Sons", amountPaise: 123_456, note: "Fee: Priya #5", ref: "RCP/2026-27/000012" });
    expect(u).toBe("upi://pay?pa=school@okhdfc&pn=Triakshi%20Public%20%26%20Sons&am=1234.56&cu=INR&tn=Fee%3A%20Priya%20%235&tr=RCP%2F2026-27%2F000012");
  });
  it("keeps two decimals on whole and small amounts", () => {
    expect(upiUri({ upiId: "a.b@ybl", name: "S", amountPaise: 50_000 })).toContain("am=500.00");
    expect(upiUri({ upiId: "a.b@ybl", name: "S", amountPaise: 5 })).toContain("am=0.05");
  });
  it("refuses a bad id or amount", () => {
    expect(() => upiUri({ upiId: "nope", name: "S", amountPaise: 100 })).toThrow();
    for (const amountPaise of [0, -1, 1.5]) expect(() => upiUri({ upiId: "a@ybl", name: "S", amountPaise })).toThrow();
  });
});

describe("qr", () => {
  it("round-trips through SVG so the PDF draws what the screen shows", () => {
    const code = qrCode("https://x.example/verify/receipt/abc");
    expect(qrFromSvg(qrSvg("https://x.example/verify/receipt/abc"))).toEqual(code);
    expect(qrFromSvg("<svg></svg>")).toBeNull();
  });
  it("draws on a PDF from text or SVG", async () => {
    const b = await PdfBuilder.create();
    expect(b.qr("hello", { x: 40, top: 700, size: 80 })).toBe(true);
    expect(b.qr(qrSvg("hello"), { x: 140, top: 700, size: 80 })).toBe(true);
    expect(b.qr("<svg viewBox='0 0 3 4'></svg>", { x: 0, top: 100, size: 10 })).toBe(false);
  });
});
