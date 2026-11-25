/** Pure edits of a site's content: add, remove, move and fill pages and sections. Each returns a new object. */
import {
  HOME_SLUG, RESERVED_NEW_SLUGS, SECTION_DATA, SECTION_META, TEMPLATES, newSectionId, pageSchema, sectionSchema, slugSchema,
  type NavItem, type Page, type Section, type SectionType, type SiteContent, type TemplateKey,
} from "./content";

export type SiteErrorCode = "missing" | "invalid" | "limit";
/** The menu holds this many top entries in the builder. */
export const MENU_TOP_MAX = 8;

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
  if ((RESERVED_NEW_SLUGS as readonly string[]).includes(slug.data)) throw new SiteContentError("This address is reserved by the system. Pick another.", "invalid", { slug: "This address is reserved by the system. Pick another." });
  const title = input.title.trim();
  if (!title) throw new SiteContentError("Give the page a title", "invalid", { title: "Give the page a title" });
  if (content.pages.some((p) => p.slug === slug.data)) throw new SiteContentError("A page already uses this address.", "invalid", { slug: "A page already uses this address" });
  if (maxPages != null && content.pages.length >= maxPages) throw new SiteContentError(`Your plan allows ${maxPages} pages. Remove one or upgrade.`, "limit");
  const c = clone(content);
  c.pages.push(input.page ? { ...input.page, slug: slug.data, title } : { slug: slug.data, title, seo: {}, sections: [] });
  // The menu holds eight top items at most; a page that does not fit is still reachable by its address and its links.
  if (c.nav.length < MENU_TOP_MAX) c.nav.push({ label: title, slug: slug.data });
  return c;
}

export function removePage(content: SiteContent, slug: string): SiteContent {
  if (slug === HOME_SLUG) throw new SiteContentError("The home page cannot be removed.", "invalid");
  pageOf(content, slug);
  const c = clone(content);
  c.pages = c.pages.filter((p) => p.slug !== slug);
  c.nav = c.nav.filter((n) => n.slug !== slug).map((n) => (n.children ? { ...n, children: n.children.filter((x) => x.slug !== slug) } : n));
  return c;
}

export function updatePage(content: SiteContent, slug: string, input: { title: string; intro?: string; seoTitle?: string; seoDescription?: string; seoImageUrl?: string }): SiteContent {
  pageOf(content, slug);
  const title = input.title.trim();
  if (!title) throw new SiteContentError("Give the page a title", "invalid", { title: "Give the page a title" });
  const c = clone(content);
  const p = pageOf(c, slug);
  const was = p.title;
  p.title = title;
  // A menu entry still called by the old title follows it; one the school renamed keeps its name.
  for (const n of [...c.nav, ...c.nav.flatMap((x) => x.children ?? [])]) if (n.slug === slug && n.label === was) n.label = title;
  p.intro = input.intro?.trim() || undefined;
  p.seo = { title: input.seoTitle?.trim() || undefined, description: input.seoDescription?.trim() || undefined, imageUrl: input.seoImageUrl?.trim() || undefined };
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
  // The disclosure rows are filled on their own screen; the section editor holds only its heading and note.
  const given = cur.type === "disclosure" && data && typeof data === "object" ? { data: cur.data.data, updatedOn: cur.data.updatedOn, ...data } : data;
  const r = SECTION_DATA[cur.type].safeParse(blanksOut(given));
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

// ---------- sections: duplicate, hide, reorder, copy, restore ----------

/** A short stable fingerprint of what the editor shows of a section (its data and whether it is hidden). Not a secret. */
export function sectionHash(s: Pick<Section, "data" | "hidden">): string {
  const text = stableJson({ d: s.data, h: !!s.hidden });
  // cyrb53: 53 bits, plenty to tell "someone else saved" from "nobody did".
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** JSON with sorted keys and no undefined, so equal content gives equal text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function sectionIndex(p: Page, id: string): number {
  const i = p.sections.findIndex((s) => s.id === id);
  if (i < 0) throw new SiteContentError("That section does not exist.", "missing");
  return i;
}
const roomFor = (p: Page) => { if (p.sections.length >= 30) throw new SiteContentError("A page can have 30 sections at most.", "limit"); };
const fresh = (s: Section): Section => ({ ...clone(s), id: newSectionId(s.type) }) as Section;

export function duplicateSection(content: SiteContent, slug: string, id: string): SiteContent {
  const c = clone(content);
  const p = pageOf(c, slug);
  const i = sectionIndex(p, id);
  roomFor(p);
  p.sections.splice(i + 1, 0, fresh(p.sections[i]!));
  return c;
}

export function setSectionHidden(content: SiteContent, slug: string, id: string, hidden: boolean): SiteContent {
  const c = clone(content);
  const p = pageOf(c, slug);
  const s = p.sections[sectionIndex(p, id)]!;
  if (hidden) s.hidden = true; else delete s.hidden;
  return c;
}

/** Put a section at a position (0 = first); drag and drop sends the target index. */
export function moveSectionTo(content: SiteContent, slug: string, id: string, index: number): SiteContent {
  const c = clone(content);
  const p = pageOf(c, slug);
  const from = sectionIndex(p, id);
  const to = Math.max(0, Math.min(p.sections.length - 1, Math.trunc(index)));
  if (from === to) return content;
  const [s] = p.sections.splice(from, 1);
  p.sections.splice(to, 0, s!);
  return c;
}

/** A copy of a section at the end of another page (a new id). */
export function copySectionToPage(content: SiteContent, slug: string, id: string, toSlug: string): SiteContent {
  const c = clone(content);
  const s = pageOf(c, slug).sections[sectionIndex(pageOf(c, slug), id)]!;
  const to = pageOf(c, toSlug);
  roomFor(to);
  to.sections.push(fresh(s));
  return c;
}

/** Put a removed section back (the undo after remove). It keeps its id when that id is free. */
export function restoreSection(content: SiteContent, slug: string, section: unknown, index: number): SiteContent {
  const r = sectionSchema.safeParse(section);
  if (!r.success) throw new SiteContentError("That section cannot be put back.", "invalid");
  const c = clone(content);
  const p = pageOf(c, slug);
  roomFor(p);
  const s = p.sections.some((x) => x.id === r.data.id) ? fresh(r.data as Section) : (r.data as Section);
  p.sections.splice(Math.max(0, Math.min(p.sections.length, Math.trunc(index))), 0, s);
  return c;
}

// ---------- pages: duplicate, hide, no-index, rename address, restore ----------

const OTHER_ADDRESS_TAKEN = "A page already uses this address";

function freeSlug(c: SiteContent, base: string): string {
  const root = base.slice(0, 34);
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? `${root}-copy` : `${root}-copy-${n}`;
    if (!c.pages.some((p) => p.slug === slug)) return slug;
  }
  return `${root}-${crypto.randomUUID().slice(0, 4)}`;
}

/** A copy of a page under a new address and title (both optional: "about-copy", "About (copy)"). The copy is hidden until the school shows it. */
export function duplicatePage(content: SiteContent, slug: string, input: { slug?: string; title?: string } = {}, maxPages?: number): SiteContent {
  const src = pageOf(content, slug);
  const next = slugSchema.safeParse(input.slug?.trim() || freeSlug(content, slug));
  if (!next.success) throw new SiteContentError(next.error.issues[0]!.message, "invalid", { slug: next.error.issues[0]!.message });
  if ((RESERVED_NEW_SLUGS as readonly string[]).includes(next.data)) throw new SiteContentError("This address is reserved by the system. Pick another.", "invalid", { slug: "This address is reserved by the system. Pick another." });
  if (content.pages.some((p) => p.slug === next.data)) throw new SiteContentError(OTHER_ADDRESS_TAKEN, "invalid", { slug: OTHER_ADDRESS_TAKEN });
  if (maxPages != null && content.pages.length >= maxPages) throw new SiteContentError(`Your plan allows ${maxPages} pages. Remove one or upgrade.`, "limit");
  const c = clone(content);
  const copy: Page = { ...clone(src), slug: next.data, title: input.title?.trim() || `${src.title} (copy)`, hidden: true, sections: src.sections.map(fresh) };
  c.pages.push(copy);
  return c;
}

export function setPageFlags(content: SiteContent, slug: string, flags: { hidden?: boolean; noindex?: boolean }): SiteContent {
  if (slug === HOME_SLUG && flags.hidden) throw new SiteContentError("The home page cannot be hidden.", "invalid");
  const c = clone(content);
  const p = pageOf(c, slug);
  for (const k of ["hidden", "noindex"] as const) if (flags[k] !== undefined) { if (flags[k]) p[k] = true; else delete p[k]; }
  return c;
}

/** Put a removed page back (the undo after remove), with its menu entry when there is room. */
export function restorePage(content: SiteContent, page: unknown, maxPages?: number): SiteContent {
  const r = pageSchema.safeParse(page);
  if (!r.success) throw new SiteContentError("That page cannot be put back.", "invalid");
  if (content.pages.some((p) => p.slug === r.data.slug)) throw new SiteContentError(OTHER_ADDRESS_TAKEN, "invalid", { slug: OTHER_ADDRESS_TAKEN });
  if (maxPages != null && content.pages.length >= maxPages) throw new SiteContentError(`Your plan allows ${maxPages} pages. Remove one or upgrade.`, "limit");
  const c = clone(content);
  c.pages.push(r.data);
  if (c.nav.length < MENU_TOP_MAX) c.nav.push({ label: r.data.title, slug: r.data.slug });
  return c;
}

/** Replace `/old` by `/new` in every string that is a link to it (`/old`, `/old#x`, `/old?y`), anywhere in the content. */
function relink(v: unknown, from: string, to: string): unknown {
  if (typeof v === "string") return v === from || v.startsWith(`${from}#`) || v.startsWith(`${from}?`) ? to + v.slice(from.length) : v;
  if (Array.isArray(v)) return v.map((x) => relink(x, from, to));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x, from, to)]));
  return v;
}

/** Change a page's address. Menu entries and links inside the site follow; the caller keeps the old address alive with a redirect. */
export function renamePage(content: SiteContent, slug: string, to: string): { content: SiteContent; from: string; to: string } {
  if (slug === HOME_SLUG) throw new SiteContentError("The home page keeps its address.", "invalid");
  pageOf(content, slug);
  const next = slugSchema.safeParse(to);
  if (!next.success) throw new SiteContentError(next.error.issues[0]!.message, "invalid", { slug: next.error.issues[0]!.message });
  if ((RESERVED_NEW_SLUGS as readonly string[]).includes(next.data)) throw new SiteContentError("This address is reserved by the system. Pick another.", "invalid", { slug: "This address is reserved by the system. Pick another." });
  if (next.data === slug) return { content, from: `/${slug}`, to: `/${slug}` };
  if (content.pages.some((p) => p.slug === next.data)) throw new SiteContentError(OTHER_ADDRESS_TAKEN, "invalid", { slug: OTHER_ADDRESS_TAKEN });
  const moved = relink(content, `/${slug}`, `/${next.data}`) as SiteContent;
  const swap = <T extends { slug?: string }>(n: T): T => (n.slug === slug ? { ...n, slug: next.data } : n);
  const out: SiteContent = {
    ...moved,
    pages: moved.pages.map((p) => (p.slug === slug ? { ...p, slug: next.data } : p)),
    nav: moved.nav.map((n) => ({ ...swap(n), ...(n.children ? { children: n.children.map(swap) } : {}) })),
  };
  return { content: out, from: `/${slug}`, to: `/${next.data}` };
}

export interface Redirect { from: string; to: string }
/**
 * The redirect table after `from` now leads to `to`. Chains collapse (anything that led to `from` now leads to `to`),
 * a redirect that would start where a live page now stands is dropped, and a redirect to itself never exists.
 */
export function mergeRedirects(existing: Redirect[], add: Redirect): Redirect[] {
  const out = existing.filter((r) => r.from !== add.from && r.from !== add.to).map((r) => (r.to === add.from ? { ...r, to: add.to } : r));
  return add.from === add.to ? out.filter((r) => r.from !== r.to) : [...out, add].filter((r) => r.from !== r.to);
}

// ---------- the menu ----------

type Path = number[];
function listAt(nav: NavItem[], path: Path): NavItem[] {
  if (path.length === 1) return nav;
  const parent = nav[path[0]!];
  if (!parent?.children) throw new SiteContentError("That menu entry does not exist.", "missing");
  return parent.children as NavItem[];
}
const at = (nav: NavItem[], path: Path): NavItem => {
  const it = listAt(nav, path)[path.at(-1)!];
  if (!it) throw new SiteContentError("That menu entry does not exist.", "missing");
  return it;
};

/** Move an entry up or down inside its own list. */
export function moveNavItem(content: SiteContent, path: Path, delta: -1 | 1): SiteContent {
  at(content.nav, path);
  const c = clone(content);
  const list = listAt(c.nav, path);
  const i = path.at(-1)!, j = i + delta;
  if (j < 0 || j >= list.length) return content;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return c;
}

/** Move a top entry under the entry above it (one level only). */
export function nestNavItem(content: SiteContent, index: number): SiteContent {
  const item = at(content.nav, [index]);
  if (index === 0) throw new SiteContentError("There is no entry above to put it under.", "invalid");
  if (item.children?.length) throw new SiteContentError("This entry has items under it already. Menus go one level deep.", "invalid");
  const c = clone(content);
  const parent = c.nav[index - 1]!;
  if ((parent.children?.length ?? 0) >= 8) throw new SiteContentError("Eight items under one menu entry at most.", "limit");
  const [moved] = c.nav.splice(index, 1);
  parent.children = [...(parent.children ?? []), { label: moved!.label, ...(moved!.slug ? { slug: moved!.slug } : {}), ...(moved!.href ? { href: moved!.href } : {}) }];
  return c;
}

/** Bring a nested entry back to the top level, right after its parent. */
export function unnestNavItem(content: SiteContent, parent: number, child: number): SiteContent {
  at(content.nav, [parent, child]);
  if (content.nav.length >= MENU_TOP_MAX) throw new SiteContentError(`The menu holds ${MENU_TOP_MAX} entries at the top. Remove or move one first.`, "limit");
  const c = clone(content);
  const [moved] = c.nav[parent]!.children!.splice(child, 1);
  if (!c.nav[parent]!.children!.length) delete c.nav[parent]!.children;
  c.nav.splice(parent + 1, 0, moved!);
  return c;
}

export function renameNavItem(content: SiteContent, path: Path, label: string): SiteContent {
  const text = label.trim();
  if (!text) throw new SiteContentError("Give the entry a name", "invalid", { label: "Give the entry a name" });
  if (text.length > 30) throw new SiteContentError("30 characters at most", "invalid", { label: "30 characters at most" });
  at(content.nav, path);
  const c = clone(content);
  at(c.nav, path).label = text;
  return c;
}

/** Remove an entry (with what is under it). The page itself stays. */
export function removeNavItem(content: SiteContent, path: Path): SiteContent {
  at(content.nav, path);
  const c = clone(content);
  listAt(c.nav, path).splice(path.at(-1)!, 1);
  return c;
}

/** A link to somewhere else, or a page of the site, at the end of the menu. */
export function addNavEntry(content: SiteContent, e: { label: string; href?: string; slug?: string }): SiteContent {
  const label = e.label.trim();
  if (!label) throw new SiteContentError("Give the entry a name", "invalid", { label: "Give the entry a name" });
  if (label.length > 30) throw new SiteContentError("30 characters at most", "invalid", { label: "30 characters at most" });
  if (content.nav.length >= MENU_TOP_MAX) throw new SiteContentError(`The menu holds ${MENU_TOP_MAX} entries at the top. Remove or nest one first.`, "limit");
  if (e.slug) pageOf(content, e.slug);
  else if (!/^(\/(?![/\\])[^\s\\]*|https?:\/\/[^\s]+)$/i.test(e.href ?? "")) throw new SiteContentError("Use a page like /admissions or a full https:// link", "invalid", { href: "Use a page like /admissions or a full https:// link" });
  const c = clone(content);
  c.nav.push({ label, ...(e.slug ? { slug: e.slug } : { href: e.href }) });
  return c;
}

/** Footer words and links in one go (the links are validated by the site schema on publish and by the editor form). */
export function setFooterContent(content: SiteContent, f: { text?: string; links: { label: string; href: string }[]; columns?: { title: string; links: { label: string; href: string }[] }[] }): SiteContent {
  if (f.links.length > 8) throw new SiteContentError("Eight links at most", "limit");
  const cols = f.columns ?? content.footer.columns ?? [];
  if (cols.length > 4) throw new SiteContentError("Four columns at most", "limit");
  for (const c of cols) {
    if (!c.title.trim()) throw new SiteContentError("Give each column a title", "invalid", { columns: "Give each column a title" });
    if (c.links.length > 8) throw new SiteContentError("Eight links in a column at most", "limit");
  }
  const c = clone(content);
  const tidy = (l: { label: string; href: string }) => ({ label: l.label.trim(), href: l.href.trim() });
  c.footer = { text: f.text?.trim() || undefined, links: f.links.map(tidy), ...(cols.length ? { columns: cols.map((x) => ({ title: x.title.trim(), links: x.links.map(tidy) })) } : {}) };
  return c;
}

// ---------- who changed what (draft only) ----------

/** The content without the draft-only `by` and `at` notes: what is published, compared, hashed and shown to the public. */
export function stripMeta<T extends SiteContent>(c: T, o: { keepPageDate?: boolean } = {}): T {
  return {
    ...c,
    pages: c.pages.map((p) => {
      const { by: _by, at, sections, ...rest } = p;
      // `keepPageDate`: the live copy keeps one day per page (when it last changed) for the sitemap; never who, never per section.
      const day = o.keepPageDate ? [at, ...sections.map((s) => s.at)].filter((x): x is string => !!x).sort().at(-1) : undefined;
      return { ...rest, ...(day ? { at: day } : {}), sections: sections.map(({ by: _sb, at: _sa, ...s }) => s as Section) };
    }),
  } as T;
}

/**
 * After an edit: note `by` and `at` on every page and section that is new or whose words, place or visibility changed
 * against `prev`; the others keep what they had.
 */
export function stampChanges(prev: SiteContent, next: SiteContent, by: string, at: string): SiteContent {
  const old = new Map(prev.pages.map((p) => [p.slug, p]));
  const head = (p: Page) => stableJson({ ...p, sections: p.sections.map((s) => s.id), by: undefined, at: undefined });
  return {
    ...next,
    pages: next.pages.map((p) => {
      const was = old.get(p.slug);
      const wasSec = new Map((was?.sections ?? []).map((s) => [s.id, s]));
      const sections = p.sections.map((s) => {
        const w = wasSec.get(s.id);
        return !w || sectionHash(w) !== sectionHash(s) ? { ...s, by, at } : s;
      }) as Section[];
      return !was || head(was) !== head(p) ? { ...p, sections, by, at } : { ...p, sections };
    }),
  };
}

/** The newest note on a page or any of its sections. */
export function lastChange(p: Page): { by: string; at: string } | null {
  const all = [{ by: p.by, at: p.at }, ...p.sections.map((s) => ({ by: s.by, at: s.at }))].filter((x): x is { by: string; at: string } => !!x.by && !!x.at);
  return all.sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
}

// ---------- reading a site: what it links to, what it shows, what changed ----------

export interface Ref { /** The link or file address. */ url: string; page: string; /** The page address, when the place is a page. */ slug?: string; /** "Hero banner", "Menu", "Footer", "Search image". */ where: string; sectionId?: string }

const FILE = /^\/api\/files\//;
const walk = (v: unknown, f: (s: string, key: string) => void, key = ""): void => {
  if (typeof v === "string") f(v, key);
  else if (Array.isArray(v)) v.forEach((x) => walk(x, f, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, f, k);
};

/** Every stored file the content points at (photos and documents), and where. */
export function fileRefs(c: SiteContent): Ref[] {
  const out: Ref[] = [];
  for (const p of c.pages) {
    walk(p.seo, (s) => { if (FILE.test(s)) out.push({ url: s, page: p.title, slug: p.slug, where: "Search image" }); });
    for (const s of p.sections) walk(s.data, (v) => { if (FILE.test(v)) out.push({ url: v, page: p.title, slug: p.slug, where: SECTION_META[s.type].label, sectionId: s.id }); });
  }
  return out;
}

/** Addresses the app itself answers, so a link to them is never broken. */
const NOT_PAGES = new Set(["news", "events", "login", "privacy", "app", "api", "forgot-password", "support-login", "reset-password", "verify-email", "confirm-email", "unsubscribe", "verify", "enquiry-sent", "sitemap.xml", "robots.txt", "favicon.ico", "manifest.webmanifest"]);
/** Links to pages of this site that lead nowhere: a deleted, renamed or hidden page. Visitors would see "not found". */
export function brokenLinks(c: SiteContent): Ref[] {
  const live = new Set(c.pages.filter((p) => !p.hidden).map((p) => p.slug));
  const bad = (href: string) => {
    if (!href.startsWith("/") || href.startsWith("//") || FILE.test(href)) return false;
    // Address words are not case sensitive on the site; `?x`, `#team` and a trailing slash do not change the page.
    const seg = decodeURIComponent(href.slice(1).split(/[?#]/)[0]!.split("/")[0]!.toLowerCase());
    return !!seg && seg !== HOME_SLUG && !live.has(seg) && !NOT_PAGES.has(seg);
  };
  const out: Ref[] = [];
  const hrefKey = (k: string) => k === "href" || k.endsWith("Href");
  for (const p of c.pages) for (const s of p.sections) walk(s.data, (v, k) => { if (hrefKey(k) && bad(v)) out.push({ url: v, page: p.title, where: SECTION_META[s.type].label, sectionId: s.id }); });
  const nav = c.nav.flatMap((n) => [n, ...(n.children ?? [])]);
  for (const n of nav) {
    if (n.href && bad(n.href)) out.push({ url: n.href, page: "Menu", where: n.label });
    if (n.slug && !live.has(n.slug)) out.push({ url: `/${n.slug}`, page: "Menu", where: n.label });
  }
  for (const l of c.footer.links) if (bad(l.href)) out.push({ url: l.href, page: "Footer", where: l.label });
  return out;
}

/** What differs between two copies of a site, in words a school admin reads. `was` null = nothing live yet. */
export function siteChanges(was: { content: SiteContent; templateKey: TemplateKey } | null, now: { content: SiteContent; templateKey: TemplateKey }): { first: boolean; lines: string[] } {
  if (!was) return { first: true, lines: [`${now.content.pages.length} pages go live for the first time`] };
  was = { ...was, content: stripMeta(was.content) };
  now = { ...now, content: stripMeta(now.content) };
  const before = new Map(was.content.pages.map((p) => [p.slug, p]));
  const after = new Map(now.content.pages.map((p) => [p.slug, p]));
  const lines: string[] = [];
  // A page whose address changed has the same title: it is neither new nor taken down.
  const moved = now.content.pages.filter((p) => !before.has(p.slug) && was.content.pages.some((o) => o.title === p.title && !after.has(o.slug))).map((p) => p.title);
  const added = now.content.pages.filter((p) => !before.has(p.slug) && !moved.includes(p.title)).map((p) => p.title);
  const removed = was.content.pages.filter((p) => !after.has(p.slug) && !moved.includes(p.title)).map((p) => p.title);
  if (added.length) lines.push(`New: ${added.join(", ")}`);
  const edited: string[] = [];
  for (const p of now.content.pages) {
    const old = before.get(p.slug) ?? was.content.pages.find((o) => moved.includes(p.title) && o.title === p.title && !after.has(o.slug));
    if (!old || stableJson(old) === stableJson(p)) continue;
    const parts: string[] = [];
    const oldIds = new Map(old.sections.map((s) => [s.id, s]));
    const add = p.sections.filter((s) => !oldIds.has(s.id)).length;
    const del = old.sections.filter((s) => !p.sections.some((x) => x.id === s.id)).length;
    const changed = p.sections.filter((s) => oldIds.has(s.id) && sectionHash(oldIds.get(s.id)!) !== sectionHash(s)).length;
    if (add) parts.push(`${add} added`);
    if (del) parts.push(`${del} removed`);
    if (changed) parts.push(`${changed} changed`);
    const order = p.sections.filter((s) => oldIds.has(s.id)).map((s) => s.id).join() !== old.sections.filter((s) => p.sections.some((x) => x.id === s.id)).map((s) => s.id).join();
    if (order) parts.push("reordered");
    if (!parts.length) parts.push("details changed");
    edited.push(`${p.title} (${parts.join(", ")})`);
  }
  if (edited.length) lines.push(`Edited: ${edited.join("; ")}`);
  if (removed.length) lines.push(`Taken down: ${removed.join(", ")}`);
  if (moved.length) lines.push(`Address changed: ${moved.join(", ")}`);
  if (now.templateKey !== was.templateKey) lines.push(`The design changes from ${TEMPLATES[was.templateKey].name} to ${TEMPLATES[now.templateKey].name}`);
  if (stableJson(now.content.nav) !== stableJson(was.content.nav) || stableJson(now.content.footer) !== stableJson(was.content.footer)) lines.push("Menu or footer changed");
  return { first: false, lines };
}
