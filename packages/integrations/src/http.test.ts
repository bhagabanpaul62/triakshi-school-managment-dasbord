import { describe, expect, it } from "vitest";
import { csvResponse, csvText, pdfResponse, slugOf } from "./http";

describe("csv and file names", () => {
  it("quotes what needs it and defuses formulas", () => {
    expect(csvText([["Sharma, Riya", "=SUM(A1)", null, 7]])).toBe(`"Sharma, Riya",'=SUM(A1),,7\r\n`);
  });
  it("leaves a plain phone number as it is, and still defuses a formula that only starts like one", () => {
    expect(csvText([["+919811100000", "+91 98111 00000", "-5", "080-2345 6789"]])).toBe("+919811100000,+91 98111 00000,-5,080-2345 6789\r\n");
    expect(csvText([["+cmd|' /C calc'!A0", "@SUM(1)", "-2+3a", "=1+1", "+"]])).toBe(`'+cmd|' /C calc'!A0,'@SUM(1),'-2+3a,'=1+1,'+\r\n`);
  });
  it("makes a short file-name part", () => {
    expect(slugOf("Half-yearly exam!", "x")).toBe("half-yearly-exam");
    expect(slugOf("!!!", "notice")).toBe("notice");
  });

  it("file names in headers are a safe slug plus the RFC 5987 form", () => {
    const h = pdfResponse(new Uint8Array(), 'a"b\r\nSet-Cookie: x=1/../Ünï.pdf').headers.get("content-disposition")!;
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toMatch(/^inline; filename="[a-z0-9._-]+"; filename\*=UTF-8''[A-Za-z0-9%._'-]+$/);
    expect(csvResponse("a", "Class 5/A report.csv").headers.get("content-disposition")).toBe(`attachment; filename="class-5-a-report.csv"; filename*=UTF-8''Class%205%2FA%20report.csv`);
  });
});
