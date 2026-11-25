import { describe, expect, it } from "vitest";
import { assertFileContent, downloadDisposition, sniffType, UploadError } from "./index";

const bytes = (...xs: (number | string)[]) => Uint8Array.from(xs.flatMap((x) => (typeof x === "number" ? [x] : [...x].map((c) => c.charCodeAt(0)))));
const zip = (part: string) => bytes(0x50, 0x4b, 0x03, 0x04, "\x14\x00\x00\x00\x08\x00....", part, "/document.xml");

describe("sniffType", () => {
  it("knows pdf, png, jpeg, webp, docx and xlsx by their bytes", () => {
    expect(sniffType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10))).toBe("image/png");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(zip("word"))).toContain("wordprocessingml");
    expect(sniffType(zip("xl"))).toContain("spreadsheetml");
    expect(sniffType(zip("ppt"))).toBeNull();
  });

  it("tells csv from plain text, and refuses binary, scripts in disguise and empty files", () => {
    expect(sniffType(bytes("name,class\nAnn,5A\n"))).toBe("text/csv");
    expect(sniffType(bytes("just a line of words\nand another"))).toBe("text/plain");
    expect(sniffType(bytes("MZ", 0, 0, 3, 0))).toBeNull();
    expect(sniffType(bytes(0x7f, "ELF", 2, 1, 1, 0))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
    expect(sniffType(bytes(0xff, 0xfe, 0xfd, 0xfc))).toBeNull();
  });
});

describe("assertFileContent", () => {
  const pdf = bytes("%PDF-1.7 hello");
  it("returns the real type when it is allowed and matches what was declared", () => {
    expect(assertFileContent({ name: "a.pdf", type: "application/pdf", bytes: pdf }, ["application/pdf", "image/png"])).toBe("application/pdf");
    expect(assertFileContent({ name: "a.csv", type: "text/csv", bytes: bytes("one column only\nsecond") }, ["text/csv"])).toBe("text/csv");
  });
  it("throws UploadError for a lie, a kind that is not allowed, or unknown bytes", () => {
    expect(() => assertFileContent({ name: "evil.pdf", type: "application/pdf", bytes: bytes(0x89, 0x50, 0x4e, 0x47) }, ["application/pdf", "image/png"])).toThrow(UploadError);
    expect(() => assertFileContent({ name: "a.pdf", type: "application/pdf", bytes: pdf }, ["image/png"])).toThrow(UploadError);
    expect(() => assertFileContent({ name: "x.exe", type: "application/pdf", bytes: bytes("MZ", 0, 0) }, ["application/pdf"])).toThrow(/not a kind of file/);
  });
});

describe("downloadDisposition", () => {
  it("opens pictures and PDFs in the browser, and downloads everything else", () => {
    expect(downloadDisposition("application/pdf", "Fees.pdf")).toBe(`inline; filename="Fees.pdf"; filename*=UTF-8''Fees.pdf`);
    expect(downloadDisposition("image/png", "a.png")).toMatch(/^inline/);
    for (const t of ["image/svg+xml", "text/html", "text/csv", "application/octet-stream"]) expect(downloadDisposition(t, "x")).toMatch(/^attachment/);
  });
  it("cannot break out of the header through the name", () => {
    const h = downloadDisposition("text/html", 'a"\r\nSet-Cookie: x=1/../é.html');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/filename="([^"]*)"/)![1]).not.toMatch(/["\\/]/);
  });
});
