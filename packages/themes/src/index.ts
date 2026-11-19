/**
 * School themes: token schema, presets, CSS variables, WCAG contrast checks.
 * The panel is always dark (Kinetic Monolith); the school's primary colour becomes the kit accent ramp.
 * The public website uses the full light palette.
 * @module @smw/themes
 */
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1E66F5");

export const FONTS = ["Inter", "Poppins", "Merriweather", "Nunito", "Playfair Display", "Source Sans 3"] as const;
export const RADII = { none: "0px", sm: "6px", md: "12px", lg: "20px" } as const;

export const themeSchema = z.object({
  preset: z.string().default("ocean"),
  colors: z.object({
    primary: hex, primaryLight: hex,
    secondary: hex, secondaryLight: hex,
    accent: hex, accentLight: hex,
    background: hex, surface: hex, text: hex, mutedText: hex,
  }),
  radius: z.enum(["none", "sm", "md", "lg"]).default("md"),
  font: z.enum(FONTS).default("Inter"),
  logoUrl: z.string().url().nullish(),
  faviconUrl: z.string().url().nullish(),
});
export type Theme = z.infer<typeof themeSchema>;

export const PRESETS: Record<string, Theme> = {
  ocean: { preset: "ocean", radius: "md", font: "Inter", colors: {
    primary: "#4F79FF", primaryLight: "#E8EEFF", secondary: "#0F766E", secondaryLight: "#E6F4F2",
    accent: "#F59E0B", accentLight: "#FEF3C7", background: "#FFFFFF", surface: "#F6F7FB", text: "#111827", mutedText: "#4B5563" } },
  forest: { preset: "forest", radius: "lg", font: "Nunito", colors: {
    primary: "#16A34A", primaryLight: "#E7F6EC", secondary: "#1E3A8A", secondaryLight: "#E8EDF9",
    accent: "#EAB308", accentLight: "#FEF9C3", background: "#FFFFFF", surface: "#F5F7F4", text: "#14201A", mutedText: "#4A5A50" } },
  maroon: { preset: "maroon", radius: "sm", font: "Merriweather", colors: {
    primary: "#9F1239", primaryLight: "#FCE7EC", secondary: "#B45309", secondaryLight: "#FDF1E3",
    accent: "#0E7490", accentLight: "#E0F2F7", background: "#FFFDF9", surface: "#F8F3EC", text: "#1F1414", mutedText: "#5B4A46" } },
  royal: { preset: "royal", radius: "md", font: "Poppins", colors: {
    primary: "#7C3AED", primaryLight: "#F1EAFE", secondary: "#DB2777", secondaryLight: "#FCE7F3",
    accent: "#F97316", accentLight: "#FFEDD5", background: "#FFFFFF", surface: "#F7F5FC", text: "#17122A", mutedText: "#514A66" } },
};
export const DEFAULT_THEME = PRESETS.ocean!;

// ---------- colour maths ----------

type RGB = [number, number, number];
const toRgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** WCAG relative luminance. */
export function luminance(h: string) {
  const [r, g, b] = toRgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** A 50-900 ramp around a base colour (500 = base), like the kit's primary scale. */
export function ramp(base: string): Record<number, string> {
  const c = toRgb(base), white: RGB = [255, 255, 255], black: RGB = [0, 0, 0];
  const steps: Record<number, [RGB, number]> = { 50: [white, 0.92], 100: [white, 0.82], 200: [white, 0.64], 300: [white, 0.44], 400: [white, 0.22], 500: [c, 0], 600: [black, 0.18], 700: [black, 0.36], 800: [black, 0.56], 900: [black, 0.74] };
  return Object.fromEntries(Object.entries(steps).map(([k, [to, t]]) => [k, toHex(mix(c, to, t))]));
}

export interface ContrastIssue { pair: string; ratio: number; min: number }

/** Pairs that must stay readable (AA: 4.5 body text, 3 for large text and the dark-panel accent). */
export function checkContrast(t: Theme): ContrastIssue[] {
  const c = t.colors;
  const pairs: [string, string, string, number][] = [
    ["Text on background", c.text, c.background, 4.5],
    ["Muted text on background", c.mutedText, c.background, 4.5],
    ["Text on surface", c.text, c.surface, 4.5],
    ["White on primary (buttons)", "#FFFFFF", c.primary, 3],
    ["Primary on dark panel", ramp(c.primary)[400]!, "#161616", 3],
  ];
  return pairs.map(([pair, a, b, min]) => ({ pair, ratio: Math.round(contrast(a, b) * 100) / 100, min })).filter((p) => p.ratio < p.min);
}

/** Parse a stored theme, falling back to the default for anything missing or invalid. */
export function themeOf(stored: unknown): Theme {
  const r = themeSchema.safeParse(stored);
  return r.success ? r.data : DEFAULT_THEME;
}

/** CSS for the dark panel: the kit's primary ramp follows the school colour. */
export function panelCss(t: Theme): string {
  const r = ramp(t.colors.primary);
  const vars = Object.entries(r).map(([k, v]) => `--ds-color-primary-${k}:${v};`).join("");
  return `:root{${vars}--ds-primary:${r[500]};--ds-primary-container:${r[800]};--school-radius:${RADII[t.radius]};}`;
}

/** CSS variables for the light public website and emails. */
export function siteCss(t: Theme): string {
  const c = t.colors;
  const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  const vars = Object.entries(c).map(([k, v]) => `--site-${kebab(k)}:${v};`).join("");
  return `:root{${vars}--site-radius:${RADII[t.radius]};--site-font:'${t.font}',system-ui,sans-serif;}`;
}
