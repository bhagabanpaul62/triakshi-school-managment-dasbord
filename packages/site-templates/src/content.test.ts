import { describe, expect, it } from "vitest";
import {
  EDITOR_FIELDS, HOME_SLUG, PAGE_TEMPLATE_KEYS, RESERVED_SLUGS, SECTION_DATA, SECTION_TYPES, addPage, addSection, buildPage, defaultSite, moveSection, pageSchema,
  removePage, removeSection, siteContentSchema, slugSchema, updateSection, SiteContentError, type SectionType,
} from "./index";

const school = { name: "Green Valley Public School", city: "Bengaluru", board: "CBSE", address: "12 MG Road", phone: "9876543210", email: "office@gv.test" };

describe("section schemas", () => {
  it("reject bad data", () => {
    expect(SECTION_DATA.hero.safeParse({ heading: "" }).success).toBe(false);
    expect(SECTION_DATA.hero.safeParse({ heading: "Hi", imageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(SECTION_DATA.hero.safeParse({ heading: "Hi", ctaHref: "javascript:alert(1)" }).success).toBe(false);
    expect(SECTION_DATA.hero.safeParse({ heading: "Hi", ctaHref: "/admissions", imageUrl: "https://x.test/a.jpg" }).success).toBe(true);
    expect(SECTION_DATA.stats.safeParse({ items: [] }).success).toBe(false);
    expect(SECTION_DATA.stats.safeParse({ items: Array.from({ length: 7 }, () => ({ value: "1", label: "x" })) }).success).toBe(false);
    expect(SECTION_DATA.gallery.safeParse({ images: [{ url: "not a url" }] }).success).toBe(false);
    expect(SECTION_DATA.news.safeParse({ heading: "News", limit: 99 }).success).toBe(false);
    expect(SECTION_DATA.contact.safeParse({ address: "x", email: "nope" }).success).toBe(false);
    expect(SECTION_DATA.testimonials.safeParse({ items: [{ name: "A", quote: "" }] }).success).toBe(false);
  });
  it("defaults the limit of dynamic sections", () => {
    expect(SECTION_DATA.news.parse({ heading: "News" }).limit).toBe(4);
  });
});

describe("slugs", () => {
  it("blocks every reserved slug and malformed ones", () => {
    for (const s of RESERVED_SLUGS) expect(slugSchema.safeParse(s).success).toBe(false);
    expect(slugSchema.safeParse("Our Story").success).toBe(false);
    expect(slugSchema.safeParse("a/b").success).toBe(false);
    expect(slugSchema.parse("Our-Story")).toBe("our-story");
  });
});

describe("defaultSite", () => {
  const site = defaultSite(school, new Date("2026-06-01"));
  it("is a valid site with home, about, academics, admissions and contact", () => {
    expect(siteContentSchema.safeParse(site).success).toBe(true);
    expect(site.pages.map((p) => p.slug)).toEqual([HOME_SLUG, "about", "academics", "admissions", "contact"]);
    expect(site.footer.text).toContain("2026");
    expect(site.pages[0]!.sections[0]!.type).toBe("hero");
  });
  it("works for a school with almost no details", () => {
    expect(siteContentSchema.safeParse(defaultSite({ name: "Tiny School" })).success).toBe(true);
  });
});

describe("content ops", () => {
  const site = defaultSite(school);
  it("addPage enforces slugs, duplicates and the plan limit and never mutates its input", () => {
    expect(() => addPage(site, { slug: "login", title: "Login" })).toThrow(SiteContentError);
    expect(() => addPage(site, { slug: "about", title: "Again" })).toThrow(/already/);
    expect(() => addPage(site, { slug: "fees", title: "Fees" }, 5)).toThrow(/plan allows 5/);
    const next = addPage(site, { slug: "fees", title: "Fees" }, 6);
    expect(next.pages).toHaveLength(6);
    expect(next.nav.at(-1)).toEqual({ label: "Fees", slug: "fees" });
    expect(site.pages).toHaveLength(5);
  });
  it("every template page is a valid page", () => {
    for (const k of PAGE_TEMPLATE_KEYS) expect(pageSchema.safeParse(buildPage(k, school)).success).toBe(true);
  });
  it("addPage with a prebuilt page adds its sections under the validated slug and title", () => {
    const page = buildPage("about", school);
    const next = addPage(site, { slug: "our-story", title: "Our story", page }, 6);
    const added = next.pages.at(-1)!;
    expect(added.slug).toBe("our-story");
    expect(added.title).toBe("Our story");
    expect(added.sections).toEqual(page.sections);
    expect(siteContentSchema.safeParse(next).success).toBe(true);
  });
  it("removePage keeps the home page", () => {
    expect(() => removePage(site, HOME_SLUG)).toThrow();
    expect(removePage(site, "about").nav.some((n) => n.slug === "about")).toBe(false);
  });
  it("adds every section type with valid starting data", () => {
    let c = site;
    const before = site.pages.find((p) => p.slug === "contact")!.sections.length;
    for (const t of SECTION_TYPES) c = addSection(c, "contact", t);
    expect(siteContentSchema.safeParse(c).success).toBe(true);
    expect(c.pages.find((p) => p.slug === "contact")!.sections).toHaveLength(before + SECTION_TYPES.length);
  });
  it("moves and removes sections", () => {
    const [h, s] = site.pages[0]!.sections;
    const moved = moveSection(site, HOME_SLUG, s!.id, "up");
    expect(moved.pages[0]!.sections[0]!.id).toBe(s!.id);
    expect(moveSection(site, HOME_SLUG, h!.id, "up")).toBe(site);
    expect(removeSection(site, HOME_SLUG, h!.id).pages[0]!.sections).toHaveLength(site.pages[0]!.sections.length - 1);
    expect(() => removeSection(site, HOME_SLUG, "nope")).toThrow(/does not exist/);
  });
  it("updateSection validates against the section's own schema", () => {
    const hero = site.pages[0]!.sections[0]!;
    expect(() => updateSection(site, HOME_SLUG, hero.id, { heading: "" })).toThrow(SiteContentError);
    const ok = updateSection(site, HOME_SLUG, hero.id, { heading: "New headline" });
    expect((ok.pages[0]!.sections[0]!.data as { heading: string }).heading).toBe("New headline");
  });
});

describe("editor fields", () => {
  it("name only keys the section's schema has, lists included", () => {
    for (const t of SECTION_TYPES as readonly SectionType[]) {
      const shape = SECTION_DATA[t].shape as Record<string, unknown>;
      for (const f of EDITOR_FIELDS[t]) expect(shape, `${t}.${f.name}`).toHaveProperty(f.name);
      // The disclosure rows and their date are filled on the Disclosure screen, not in the section editor.
      const screen = t === "disclosure" ? ["data", "updatedOn"] : [];
      expect(Object.keys(shape).filter((k) => !screen.includes(k) && !EDITOR_FIELDS[t].some((f) => f.name === k)), `${t} has a field the editor cannot reach`).toEqual([]);
    }
  });
  it("a cleared optional field is saved as not set, and table cells may stay empty", () => {
    const site = defaultSite(school);
    const hero = site.pages[0]!.sections[0]!;
    const saved = updateSection(site, HOME_SLUG, hero.id, { heading: "Hello", subheading: "", ctaLabel: "", ctaHref: "", imageUrl: "  " });
    expect(saved.pages[0]!.sections[0]!.data).toEqual({ heading: "Hello" });
    const withTable = addSection(site, HOME_SLUG, "table");
    const table = withTable.pages[0]!.sections.at(-1)!;
    const rows = updateSection(withTable, HOME_SLUG, table.id, { columns: ["A", "B"], rows: [["x", ""]], note: "" }).pages[0]!.sections.at(-1)!.data as { rows: string[][] };
    expect(rows.rows).toEqual([["x", ""]]);
  });
});

import { SECTION_DATA as _SD } from "./content";
describe("protocol-relative links", () => {
  it("rejects //evil.com and /\\evil.com as a button link", () => {
    for (const bad of ["//evil.com", "/\\evil.com"]) expect(_SD.hero.safeParse({ heading: "x", ctaLabel: "Go", ctaHref: bad }).success).toBe(false);
    expect(_SD.hero.safeParse({ heading: "x", ctaLabel: "Go", ctaHref: "/admissions" }).success).toBe(true);
  });
});
