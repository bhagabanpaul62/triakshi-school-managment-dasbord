import { describe, expect, it } from "vitest";
import { KINDS, LAYOUTS, applyHidden, copyLabels, defaultConfig, parseConfig, sampleData } from "./config";

describe("template config", () => {
  it("every kind has defaults that parse and survive a JSON round trip", () => {
    for (const kind of KINDS) {
      const cfg = defaultConfig(kind, ["School"]);
      expect(parseConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(parseConfig(cfg));
      expect(new Set(cfg.columns.map((c) => c.key)).size).toBe(cfg.columns.length);
      expect(cfg.title.length).toBeGreaterThan(0);
    }
  });
  it("refuses an unknown layout, an empty title and an image from outside our file route", () => {
    const ok = defaultConfig("receipt");
    expect(() => parseConfig({ ...ok, layout: "a3" })).toThrow();
    expect(() => parseConfig({ ...ok, title: "  " })).toThrow();
    expect(() => parseConfig({ ...ok, logoUrl: "https://evil.example/x.png" })).toThrow();
    expect(() => parseConfig({ ...ok, signature: { name: "A", title: "B", imageUrl: "javascript:alert(1)" } })).toThrow();
    expect(parseConfig({ ...ok, logoUrl: "/api/files/s/finance-docs/logo/x.png" }).logoUrl).toBe("/api/files/s/finance-docs/logo/x.png");
  });
  it("fills missing hidden lists", () => {
    const { hiddenFacts, hiddenTotals, ...rest } = defaultConfig("receipt");
    void hiddenFacts; void hiddenTotals;
    expect(parseConfig(rest)).toMatchObject({ hiddenFacts: [], hiddenTotals: [] });
  });
  it("hides chosen details and totals by label and keeps the rest", () => {
    const d = sampleData("receipt");
    const out = applyHidden({ hiddenFacts: ["Guardian", "Payment reference"], hiddenTotals: ["Balance after payment"] }, d);
    expect(out.facts.map(([k]) => k)).not.toContain("Guardian");
    expect(out.facts.map(([k]) => k)).toContain("Student");
    expect(out.totals.map(([k]) => k)).toEqual(["Total", "Received"]);
    expect(d.facts.length).toBeGreaterThan(out.facts.length);
  });
  it("two_up prints both copy labels, other layouts the first", () => {
    expect(copyLabels({ layout: "two_up" })).toEqual(["School copy", "Family copy"]);
    expect(copyLabels({ layout: "two_up", copies: ["Office"] })).toEqual(["Office", "Family copy"]);
    expect(copyLabels({ layout: "a4", copies: ["Office", "Family"] })).toEqual(["Office"]);
    expect(copyLabels({ layout: "a4" })).toEqual([undefined]);
    expect(LAYOUTS).toContain("thermal80");
  });
});
