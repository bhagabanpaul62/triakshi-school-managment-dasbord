import { describe, expect, it } from "vitest";
import { PRESETS, checkContrast, contrast, panelCss, primaryRoles, ramp, themeOf } from "./index";

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

describe("panel contrast", () => {
  // Panel surfaces: #242424 is the lightest (white/[0.06] over #161616 flattens to it); #1b1b1b is the text surface for links.
  const pairs: [string, string, string][] = [
    ["muted text on #242424", "#808b9d", "#242424"],
    ["muted text on #161616", "#808b9d", "#161616"],
    ["muted text on white/6% over #161616", "#808b9d", "#242424"],
  ];
  it.each(pairs)("%s is at least 4.5:1", (_n, fg, bg) => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));

  const hues = ["#4F79FF", "#FFD700", "#FFFF00", "#16A34A", "#9F1239", "#7C3AED", "#0A1A40", "#FFFFFF", "#000000", "#F59E0B"];
  it.each(hues)("primary roles for %s: white fill and link text reach 4.5:1", (h) => {
    const { fill, text } = primaryRoles(h);
    expect(contrast("#FFFFFF", fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, "#1b1b1b")).toBeGreaterThanOrEqual(4.5);
    expect(panelCss({ ...PRESETS.ocean!, colors: { ...PRESETS.ocean!.colors, primary: h } })).toContain(`--ds-primary:${fill};--ds-primary-text:${text};`);
  });
  it("keeps the ocean blue's 500 only when white passes, else 600", () => {
    expect(primaryRoles("#4F79FF").fill).toBe(ramp("#4F79FF")[600]);
  });
});
