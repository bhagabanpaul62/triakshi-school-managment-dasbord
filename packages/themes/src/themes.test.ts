import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, PRESETS, checkContrast, contrast, panelCss, primaryRoles, ramp, readable, safeImage, siteCss, siteRoles, themeOf, themeSchema } from "./index";

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

describe("logo and icon addresses", () => {
  const ok = { ...PRESETS.ocean! };
  it("accepts https links and this school's uploaded files only", () => {
    for (const v of ["https://x.test/logo.png", "/api/files/abc/public/theme/logo.png"]) expect(themeSchema.safeParse({ ...ok, logoUrl: v, faviconUrl: v }).success).toBe(true);
    for (const v of ["javascript:alert(1)", "http://x.test/a.png", "data:image/png;base64,AAAA", "//x.test/a.png", "ftp://x/a", "/etc/passwd", "https://x.test/a b.png"]) {
      expect(themeSchema.safeParse({ ...ok, logoUrl: v }).success, v).toBe(false);
      expect(themeSchema.safeParse({ ...ok, faviconUrl: v }).success, v).toBe(false);
    }
  });
  it("a stored theme with a bad address keeps its colours and drops only the address", () => {
    const stored = { ...PRESETS.maroon!, logoUrl: "javascript:alert(1)", faviconUrl: "https://x.test/f.png" };
    const t = themeOf(stored);
    expect(t.preset).toBe("maroon");
    expect(t.colors.primary).toBe(PRESETS.maroon!.colors.primary);
    expect(t.logoUrl).toBeNull();
    expect(t.faviconUrl).toBe("https://x.test/f.png");
    expect(themeOf({ nonsense: true })).toEqual(DEFAULT_THEME);
    expect(safeImage("http://x")).toBeNull();
    expect(safeImage(" https://x.test/a.png ")).toBe("https://x.test/a.png");
  });
});

describe("public site contrast (WCAG AA)", () => {
  const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const next = rnd(7);
  const hexOf = () => "#" + [0, 0, 0].map(() => Math.floor(next() * 256).toString(16).padStart(2, "0")).join("");
  const light = Object.values(PRESETS);
  const random = Array.from({ length: 50 }, () => ({ ...PRESETS.ocean!, colors: { ...PRESETS.ocean!.colors, primary: hexOf() } }));
  const dark = Array.from({ length: 10 }, () => ({ ...PRESETS.ocean!, colors: { ...PRESETS.ocean!.colors, primary: hexOf(), background: "#0B1020", surface: "#141B30", primaryLight: "#1B2540", secondaryLight: "#16263A", accentLight: "#2A2412", text: "#F3F4F6", mutedText: "#9CA3AF" } }));

  it("derives readable text, fills and muted text for every preset, 50 random colours and dark themes", () => {
    for (const t of [...light, ...random, ...dark]) {
      const r = siteRoles(t), c = t.colors, label = JSON.stringify(c.primary) + c.background;
      for (const bg of [c.background, c.surface, c.primaryLight]) {
        expect(contrast(r.primaryText, bg), `primary text ${label}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(r.mutedText, bg), `muted ${label}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(r.text, bg), `text ${label}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(r.onPrimary, r.fill), `on primary ${label}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", r.deep), `deep ${label}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", r.dark), `dark ${label}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(r.onAccent, c.accent), `on accent ${label}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the school colour when it is already readable, and fixes #4f79ff", () => {
    expect(readable("#111111", ["#FFFFFF"])).toBe("#111111");
    const r = siteRoles(PRESETS.ocean!);
    expect(r.primaryText).not.toBe("#4F79FF");
    expect(siteCss(PRESETS.ocean!)).toContain("--site-primary:#4F79FF;");
  });
});
