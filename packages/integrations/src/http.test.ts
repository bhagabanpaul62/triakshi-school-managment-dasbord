import { describe, expect, it } from "vitest";
import { csvText, slugOf } from "./http";

describe("csv and file names", () => {
  it("quotes what needs it and defuses formulas", () => {
    expect(csvText([["Sharma, Riya", "=SUM(A1)", null, 7]])).toBe(`"Sharma, Riya",'=SUM(A1),,7\r\n`);
  });
  it("makes a short file-name part", () => {
    expect(slugOf("Half-yearly exam!", "x")).toBe("half-yearly-exam");
    expect(slugOf("!!!", "notice")).toBe("notice");
  });
});
