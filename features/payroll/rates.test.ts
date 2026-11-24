import { describe, expect, it } from "vitest";
import { RATES, builtIn } from "./rates";

describe("rates", () => {
  it("PF ceiling changes on 17 September 2026", () => {
    expect([builtIn("pf_ceiling", "2026-09-16")!.value, builtIn("pf_ceiling", "2026-09-17")!.value]).toEqual([1_500_000, 2_500_000]);
  });
  it("state rows need the state; an unknown state has none", () => {
    expect(builtIn("pt", "2026-11-01", " karnataka ")!.state).toBe("Karnataka");
    expect(builtIn("pt", "2026-11-01", "Kerala")).toBeNull();
    expect(builtIn("pt", "2026-11-01", null)).toBeNull();
    expect((builtIn<unknown[]>("pt", "2026-11-01", "West Bengal")!.value)).toHaveLength(4);
    expect(builtIn("pt", "2026-09-30", "West Bengal")!.to).toBe("2026-09-30");
  });
  it("a year without tax rows has none, so tax is typed, not guessed", () => expect(builtIn("tax_slabs_new", "2027-04-01")).toBeNull());
  it("every row has a source and no two rows overlap", () => {
    for (const r of RATES) expect(r.source).toMatch(/^https:/);
    const by = new Map<string, typeof RATES>();
    for (const r of RATES) by.set(`${r.key}|${r.state ?? ""}`, [...(by.get(`${r.key}|${r.state ?? ""}`) ?? []), r]);
    for (const rows of by.values()) {
      const s = [...rows].sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 1; i < s.length; i++) expect(s[i - 1]!.to && s[i - 1]!.to! < s[i]!.from).toBe(true);
    }
  });
});
