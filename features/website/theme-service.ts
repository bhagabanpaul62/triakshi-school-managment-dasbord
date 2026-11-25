import { eq } from "drizzle-orm";
import { schools } from "@smw/db";
import { LimitError, ValidationError } from "@smw/feature-kit";
import { checkContrast, DEFAULT_THEME, PRESETS, safeImage, themeOf, themeSchema, type Theme } from "@smw/themes";
import { UPLOAD_RULES, UploadError, assertFileContent, services, uploadKey } from "@smw/integrations";
import { PHOTO_URL, WebsiteService } from "./base";

// ---------- theme ----------

/** Flat form fields (what the theme editor posts) → the nested Theme. */
export function themeFromForm(f: Record<string, unknown>): unknown {
  const c = (k: string) => f[k];
  return {
    preset: f.preset, radius: f.radius, font: f.font, logoUrl: f.logoUrl || null, faviconUrl: f.faviconUrl || null,
    colors: Object.fromEntries(["primary", "primaryLight", "secondary", "secondaryLight", "accent", "accentLight", "background", "surface", "text", "mutedText"].map((k) => [k, c(k)])),
  };
}

const isFlat = (i: unknown) => !!i && typeof i === "object" && !("colors" in (i as object));

export class ThemeService extends WebsiteService {
  /** The saved theme (or the default), and whether the plan limits the editor to logo and primary colour. */
  async get(): Promise<{ theme: Theme; limited: boolean; logoUrl: string | null }> {
    return this.read(this.sees(), async (tx) => {
      const s = await this.schoolRow(tx);
      const limits = await this.planLimits(tx, s.planId);
      return { theme: themeOf(s.theme), limited: limits.fullThemeEditor === false, logoUrl: safeImage(s.logoUrl) };
    });
  }

  /**
   * Save a theme (nested Theme, or flat form fields). Colours that fail WCAG AA are rejected with the failing pairs.
   * On a plan without the full editor only the logo and the primary colour may differ from the saved theme.
   */
  async save(input: unknown): Promise<Theme> {
    this.authorize("manage", "write");
    let next: Theme;
    try { next = this.parse(themeSchema, isFlat(input) ? themeFromForm(input as Record<string, unknown>) : input); } catch (e) {
      if (e instanceof ValidationError) throw new ValidationError(Object.fromEntries(Object.entries(e.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^colors\./, ""), v])), e.message);
      throw e;
    }
    return this.write("manage", async (tx) => {
      const s = await this.schoolRow(tx);
      const current = s.theme ? themeOf(s.theme) : null;
      const limits = await this.planLimits(tx, s.planId);
      if (limits.fullThemeEditor === false) {
        const base = current ?? DEFAULT_THEME;
        const allowed: Theme = { ...base, colors: { ...base.colors, primary: next.colors.primary }, logoUrl: next.logoUrl ?? null };
        if (canon(allowed) !== canon({ ...next, faviconUrl: base.faviconUrl ?? null })) {
          throw new LimitError("Your plan lets you change the logo and the primary colour only. Upgrade to edit the full theme.");
        }
        next = allowed;
      }
      const issues = checkContrast(next);
      if (issues.length) {
        const msg = issues.map((i) => `${i.pair} is ${i.ratio}:1 and needs ${i.min}:1`).join("; ");
        throw new ValidationError({ colors: msg, ...Object.fromEntries(issues.map((i) => [i.pair, `${i.ratio}:1 (needs ${i.min}:1)`])) }, `These colours are hard to read: ${msg}.`);
      }
      await tx.update(schools).set({ theme: next as unknown as Record<string, unknown>, logoUrl: next.logoUrl ?? null }).where(eq(schools.id, this.ctx.schoolId));
      return next;
    }, () => ({ action: "update", entity: "Theme", summary: "Changed the school theme" }));
  }

  /** Store a logo or favicon under the school's public folder. Returns its address; the theme form saves it. */
  async uploadAsset(kind: "logo" | "favicon", file: { name: string; type: string; bytes: Uint8Array }): Promise<{ url: string }> {
    this.authorize("manage", "write");
    try {
      const type = assertFileContent(file, UPLOAD_RULES.image.types);
      const key = uploadKey(this.ctx.schoolId, "public/theme", { name: `${kind}-${file.name}`, type, size: file.bytes.byteLength }, "image");
      await services().storage.put(key, file.bytes, type);
      return { url: PHOTO_URL + key };
    } catch (err) {
      if (err instanceof UploadError) throw new ValidationError({ [kind === "logo" ? "logoUrl" : "faviconUrl"]: err.message }, err.message);
      throw err;
    }
  }

  /** Back to the school's starting theme (the default colours and font), keeping the logo and favicon. */
  async reset(): Promise<Theme> {
    const { theme, logoUrl } = await this.get();
    return this.save({ ...DEFAULT_THEME, logoUrl: theme.logoUrl ?? logoUrl, faviconUrl: theme.faviconUrl ?? null });
  }

  /** Apply a named preset, keeping the school's logo. */
  async applyPreset(name: string): Promise<Theme> {
    const preset = PRESETS[name];
    if (!preset) throw new ValidationError({ preset: "Pick one of the presets" });
    const { logoUrl } = await this.get();
    return this.save({ ...preset, logoUrl });
  }
}

/** Key-order independent text of a theme, for comparing two of them. */
const canon = (t: Theme) => {
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return JSON.stringify(sorted({ ...t, logoUrl: t.logoUrl ?? null, faviconUrl: t.faviconUrl ?? null, colors: sorted(t.colors) }));
};
