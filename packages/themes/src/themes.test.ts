import { describe, expect, it } from "vitest";
import { PRESETS, checkContrast, contrast, panelCss, ramp, themeOf } from "./index";

describe("themes", () => {
  it("computes WCAG contrast", () => {
    expect(Math.round(contrast("#000000", "#FFFFFF"))).toBe(21);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
  it("every preset passes contrast", () => {
    for (const t of Object.values(PRESETS)) expect(checkContrast(t)).toEqual([]);
  });
  it("blocks unreadable text", () => {
    const bad = { ...PRESETS.ocean!, colors: { ...PRESETS.ocean!.colors, text: "#EEEEEE" } };
    expect(checkContrast(bad).map((i) => i.pair)).toContain("Text on background");
  });
  it("builds a ramp with the base at 500", () => {
    expect(ramp("#4F79FF")[500]).toBe("#4f79ff");
    expect(panelCss(PRESETS.ocean!)).toContain("--ds-color-primary-400:");
  });
  it("falls back to the default theme", () => {
    expect(themeOf({ junk: true }).preset).toBe("ocean");
  });
});
