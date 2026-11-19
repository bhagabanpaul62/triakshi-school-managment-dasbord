/** Pure edits of a site's content: add, remove, move and fill pages and sections. Each returns a new object. */
import {
  HOME_SLUG, SECTION_DATA, SECTION_META, newSectionId, slugSchema, type Page, type Section, type SectionType, type SiteContent,
} from "./content";

export type SiteErrorCode = "missing" | "invalid" | "limit";

export class SiteContentError extends Error {
  constructor(message: string, readonly code: SiteErrorCode, readonly fieldErrors?: Record<string, string>) { super(message); this.name = "SiteContentError"; }
}

const clone = <T>(v: T): T => structuredClone(v);

function pageOf(c: SiteContent, slug: string): Page {
  const p = c.pages.find((x) => x.slug === slug);
  if (!p) throw new SiteContentError("That page does not exist.", "missing");
  return p;
}

export function addPage(content: SiteContent, input: { slug: string; title: string; page?: Page }, maxPages?: number): SiteContent {
  const slug = slugSchema.safeParse(input.slug);
  if (!slug.success) throw new SiteContentError(slug.error.issues[0]!.message, "invalid", { slug: slug.error.issues[0]!.message });
  const title = input.title.trim();
  if (!title) throw new SiteContentError("Give the page a title", "invalid", { title: "Give the page a title" });
  if (content.pages.some((p) => p.slug === slug.data)) throw new SiteContentError("A page already uses this address.", "invalid", { slug: "A page already uses this address" });
  if (maxPages != null && content.pages.length >= maxPages) throw new SiteContentError(`Your plan allows ${maxPages} pages. Remove one or upgrade.`, "limit");
  const c = clone(content);
  c.pages.push(input.page ? { ...input.page, slug: slug.data, title } : { slug: slug.data, title, seo: {}, sections: [] });
  c.nav.push({ label: title, slug: slug.data });
  return c;
}

export function removePage(content: SiteContent, slug: string): SiteContent {
  if (slug === HOME_SLUG) throw new SiteContentError("The home page cannot be removed.", "invalid");
  pageOf(content, slug);
  const c = clone(content);
  c.pages = c.pages.filter((p) => p.slug !== slug);
  c.nav = c.nav.filter((n) => n.slug !== slug);
  return c;
}

export function updatePage(content: SiteContent, slug: string, input: { title: string; intro?: string; seoTitle?: string; seoDescription?: string }): SiteContent {
  pageOf(content, slug);
  const title = input.title.trim();
  if (!title) throw new SiteContentError("Give the page a title", "invalid", { title: "Give the page a title" });
  const c = clone(content);
  const p = pageOf(c, slug);
  p.title = title;
  p.intro = input.intro?.trim() || undefined;
  p.seo = { title: input.seoTitle?.trim() || undefined, description: input.seoDescription?.trim() || undefined };
  const n = c.nav.find((x) => x.slug === slug);
  if (n) n.label = title;
  return c;
}

export function addSection(content: SiteContent, slug: string, type: SectionType): SiteContent {
  pageOf(content, slug);
  if (!(type in SECTION_DATA)) throw new SiteContentError("Unknown section type.", "invalid");
  const c = clone(content);
  const p = pageOf(c, slug);
  if (p.sections.length >= 30) throw new SiteContentError("A page can have 30 sections at most.", "limit");
  p.sections.push({ id: newSectionId(type), type, data: clone(SECTION_META[type].initial) } as Section);
  return c;
}

export function removeSection(content: SiteContent, slug: string, id: string): SiteContent {
  const p = pageOf(content, slug);
  if (!p.sections.some((s) => s.id === id)) throw new SiteContentError("That section does not exist.", "missing");
  const c = clone(content);
  const q = pageOf(c, slug);
  q.sections = q.sections.filter((s) => s.id !== id);
  return c;
}

export function moveSection(content: SiteContent, slug: string, id: string, dir: "up" | "down"): SiteContent {
  const p = pageOf(content, slug);
  const i = p.sections.findIndex((s) => s.id === id);
  if (i < 0) throw new SiteContentError("That section does not exist.", "missing");
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= p.sections.length) return content;
  const c = clone(content);
  const q = pageOf(c, slug);
  [q.sections[i], q.sections[j]] = [q.sections[j]!, q.sections[i]!];
  return c;
}

/** A cleared form field arrives as "": on an object that means "not set". Strings inside arrays (table cells) stay. */
function blanksOut(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(blanksOut);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" && !x.trim() ? undefined : blanksOut(x)]));
  return v;
}

/** Replace a section's data after validating it against its own schema. */
export function updateSection(content: SiteContent, slug: string, id: string, data: unknown): SiteContent {
  const p = pageOf(content, slug);
  const cur = p.sections.find((s) => s.id === id);
  if (!cur) throw new SiteContentError("That section does not exist.", "missing");
  const r = SECTION_DATA[cur.type].safeParse(blanksOut(data));
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
    throw new SiteContentError("Please fix the highlighted fields.", "invalid", fieldErrors);
  }
  const c = clone(content);
  const s = pageOf(c, slug).sections.find((x) => x.id === id)!;
  s.data = r.data as never;
  return c;
}

export function setFooter(content: SiteContent, text: string | undefined): SiteContent {
  const c = clone(content);
  c.footer = { ...c.footer, text: text?.trim() || undefined };
  return c;
}

/** Public paths of a site, for cache revalidation and the sitemap ("/" for home). */
export const sitePaths = (c: SiteContent) => c.pages.map((p) => (p.slug === HOME_SLUG ? "/" : `/${p.slug}`));
