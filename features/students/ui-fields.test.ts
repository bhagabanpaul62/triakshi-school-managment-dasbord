import { describe, expect, it } from "vitest";
import { forYear, studentFields } from "./ui/fields";

describe("Planned section of the admit form", () => {
  const joining = {
    classes: [{ value: "c", label: "Class 1" }], years: [{ value: "y1", label: "2026-27" }, { value: "y2", label: "2027-28" }],
    sections: [{ value: "s1", label: "1 A (2026-27)", yearId: "y1" }, { value: "s2", label: "1 A (2027-28)", yearId: "y2" }],
  };
  const planned = (year: string) => forYear(studentFields([], "admit", joining), year).find((f) => f.name === "joinsSectionId")!.options!.map((o) => o.value);
  it("lists only the sections of the chosen year, and all of them before one is chosen", () => {
    expect(planned("")).toEqual(["s1", "s2"]);
    expect(planned("y2")).toEqual(["s2"]);
    expect(planned("y1")).toEqual(["s1"]);
  });
  it("leaves dialogs whose sections are already of one year alone", () => {
    const f = [{ name: "joinsSectionId", label: "x", type: "select" as const, options: [{ value: "a", label: "A" }] }];
    expect(forYear(f, "y1")).toEqual(f);
  });
});
