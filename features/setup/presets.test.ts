import { describe, expect, it } from "vitest";
import { bandOf, boardPreset, sectionNames, splitTerms, usualBands, yearNameOn } from "./presets";
import { backHref, nextHref } from "./steps";

describe("wizard presets", () => {
  it("April to March: January belongs to the year that started the April before", () => {
    expect(yearNameOn(new Date(2026, 3, 1))).toBe("2026-27");
    expect(yearNameOn(new Date(2027, 0, 15))).toBe("2026-27");
    expect(yearNameOn(new Date(2026, 2, 31))).toBe("2025-26");
  });

  it("splits April-March into the usual two terms, and into three", () => {
    expect(splitTerms("2026-04-01", "2027-03-31", 2)).toEqual([
      { name: "Term 1", startsOn: "2026-04-01", endsOn: "2026-09-30" },
      { name: "Term 2", startsOn: "2026-10-01", endsOn: "2027-03-31" },
    ]);
    expect(splitTerms("2026-04-01", "2027-03-31", 3).map((t) => [t.startsOn, t.endsOn])).toEqual([
      ["2026-04-01", "2026-07-31"], ["2026-08-01", "2026-11-30"], ["2026-12-01", "2027-03-31"],
    ]);
    expect(splitTerms("2026-04-01", "2026-05-31", 3)).toEqual([]);
  });

  it("puts classes in stages and subjects in the stages they usually run", () => {
    expect([-2, 0, 1, 5, 6, 8, 9, 12].map(bandOf)).toEqual(["pre", "pre", "primary", "primary", "middle", "middle", "secondary", "secondary"]);
    expect(usualBands("EVS")).toEqual(["pre", "primary"]);
    expect(usualBands("English")).toHaveLength(4);
  });

  it("maps a school's board to a subject list", () => {
    expect([boardPreset("CBSE"), boardPreset("ICSE"), boardPreset("State board"), boardPreset("IB"), boardPreset(null)]).toEqual(["CBSE", "ICSE", "State", "State", "CBSE"]);
    expect(sectionNames(3)).toEqual(["A", "B", "C"]);
  });

  it("walks the steps a school has, and ends on the review page", () => {
    const some = ["profile", "year", "classes", "subjects"] as const;
    expect(nextHref("year", some)).toBe("/app/setup/classes");
    expect(nextHref("subjects", some)).toBe("/app/setup/done");
    expect(backHref("profile", some)).toBeNull();
    expect(backHref("classes", some)).toBe("/app/setup/year");
  });
});
