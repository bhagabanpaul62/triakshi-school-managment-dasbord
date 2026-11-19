/** Rules for a school's subdomain: lowercase a-z, 0-9 and hyphens, 3 to 30 characters. */
export class SlugPolicy {
  static readonly MIN = 3;
  static readonly MAX = 30;
  static readonly RESERVED: ReadonlySet<string> = new Set([
    "www", "app", "api", "console", "admin", "mail", "login", "support", "static", "assets", "help", "blog",
    "status", "docs", "billing", "sites", "cdn", "test", "dev", "staging",
  ]);

  /** Turn free text ("St. Mary's School") into slug-shaped text. Not guaranteed valid: run `check` after. */
  static normalize(text: string): string {
    return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SlugPolicy.MAX).replace(/-+$/, "");
  }

  /** A human reason the slug is not allowed, or null when it is fine. */
  static check(slug: string): string | null {
    if (slug.length < SlugPolicy.MIN) return `Use at least ${SlugPolicy.MIN} characters.`;
    if (slug.length > SlugPolicy.MAX) return `Use at most ${SlugPolicy.MAX} characters.`;
    if (!/^[a-z0-9-]+$/.test(slug)) return "Use only lowercase letters, numbers and hyphens.";
    if (slug.startsWith("-") || slug.endsWith("-")) return "Do not start or end with a hyphen.";
    if (slug.includes("--")) return "Do not use two hyphens in a row.";
    if (SlugPolicy.RESERVED.has(slug)) return "That name is reserved. Try another.";
    return null;
  }

  static isValid(slug: string) { return SlugPolicy.check(slug) === null; }

  /** The first `base-2`, `base-3`... that `taken` does not report as used. */
  static async suggest(base: string, taken: (slug: string) => Promise<boolean>): Promise<string | null> {
    const root = SlugPolicy.normalize(base).slice(0, SlugPolicy.MAX - 3).replace(/-+$/, "");
    if (root.length < SlugPolicy.MIN) return null;
    for (let n = 2; n < 20; n++) {
      const candidate = `${root}-${n}`;
      if (SlugPolicy.isValid(candidate) && !(await taken(candidate))) return candidate;
    }
    return null;
  }
}
