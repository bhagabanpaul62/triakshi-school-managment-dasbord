import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSheet, SheetError } from "./sheet";

const xlsx = new Uint8Array(readFileSync(new URL("./fixtures/people.xlsx", import.meta.url)));
const csv = new TextEncoder().encode("﻿Name,Admission No,DOB,Class\nAarav Sharma,,2015-06-14,Class 4\n,,,\nDiya Verma,GR9,2014-11-02,Class 5\n");

describe("parseSheet", () => {
  it("gives identical rows for .xlsx and .csv, with Excel dates as YYYY-MM-DD and blank rows skipped", async () => {
    const a = await parseSheet({ name: "people.xlsx", bytes: xlsx });
    const b = await parseSheet({ name: "people.csv", bytes: csv });
    expect(a).toEqual(b);
    expect(a.columns).toEqual(["name", "admission_no", "dob", "class"]);
    expect(a.rows[0]).toEqual({ name: "Aarav Sharma", admission_no: "", dob: "2015-06-14", class: "Class 4" });
    expect(a.lines).toEqual([2, 4]);
  });

  it("refuses a file without a header row, a broken xlsx and anything over 5 MB", async () => {
    await expect(parseSheet({ name: "x.csv", bytes: new TextEncoder().encode("\n\n") })).rejects.toBeInstanceOf(SheetError);
    await expect(parseSheet({ name: "x.xlsx", bytes: new Uint8Array([0x50, 0x4b, 1, 2]) })).rejects.toBeInstanceOf(SheetError);
    await expect(parseSheet({ name: "x.csv", bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).rejects.toBeInstanceOf(SheetError);
  });
});
