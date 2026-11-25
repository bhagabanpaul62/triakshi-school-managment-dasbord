import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_ROWS, HOME_SLUG, MENU_TOP_MAX, SiteContentError, addNavEntry, addPage, addSection, brokenLinks, copySectionToPage, defaultSite, disclosureState, disclosureWithProfile,
  duplicatePage, duplicateSection, fileRefs, mergeRedirects, moveNavItem, moveSectionTo, nestNavItem, removeNavItem, removePage, removeSection, renameNavItem,
  renamePage, restorePage, restoreSection, sectionHash, setFooterContent, setPageFlags, setSectionHidden, siteChanges, siteContentSchema, unnestNavItem, updatePage, updateSection,
} from "./index";

const school = { name: "Green Valley Public School", city: "Bengaluru", board: "CBSE", address: "12 MG Road", phone: "9876543210", email: "office@gv.test" };
const site = () => defaultSite(school);
const about = (c = site()) => c.pages.find((p) => p.slug === "about")!;

describe("sections", () => {
  it("duplicates after the original with a new id, hides, reorders to an index, copies to another page", () => {
    const c = site();
    const [first, second] = about(c).sections;
    const dup = duplicateSection(c, "about", first!.id);
    expect(about(dup).sections).toHaveLength(about(c).sections.length + 1);
    expect(about(dup).sections[1]!.id).not.toBe(first!.id);
    expect(about(dup).sections[1]!.data).toEqual(first!.data);
    const hid = setSectionHidden(c, "about", first!.id, true);
    expect(about(hid).sections[0]!.hidden).toBe(true);
    expect(about(setSectionHidden(hid, "about", first!.id, false)).sections[0]!.hidden).toBeUndefined();
    const moved = moveSectionTo(c, "about", first!.id, 99);
    expect(about(moved).sections.at(-1)!.id).toBe(first!.id);
    expect(about(moveSectionTo(moved, "about", first!.id, 0)).sections[0]!.id).toBe(first!.id);
    expect(moveSectionTo(c, "about", second!.id, 1)).toBe(c);
    const copied = copySectionToPage(c, "about", first!.id, "contact");
    expect(copied.pages.find((p) => p.slug === "contact")!.sections.at(-1)!.id).not.toBe(first!.id);
    expect(() => duplicateSection(c, "about", "nope")).toThrow(SiteContentError);
  });

  it("puts a removed section back where it was, with its id when free", () => {
    const c = site();
    const s = about(c).sections[1]!;
    const gone = removeSection(c, "about", s.id);
    const back = restoreSection(gone, "about", s, 1);
    expect(about(back).sections[1]).toEqual(s);
    const again = restoreSection(back, "about", s, 0);
    expect(about(again).sections[0]!.id).not.toBe(s.id);
    expect(() => restoreSection(c, "about", { id: "x", type: "hero", data: {} }, 0)).toThrow(SiteContentError);
  });

  it("hashes what the editor shows: equal content equals equal hash, any change differs", () => {
    const s = about(site()).sections[0]!;
    expect(sectionHash(s)).toBe(sectionHash(structuredClone(s)));
    expect(sectionHash(s)).not.toBe(sectionHash({ ...s, hidden: true }));
    expect(sectionHash({ data: { b: 1, a: 2 } as never })).toBe(sectionHash({ data: { a: 2, b: 1 } as never }));
    expect(sectionHash({ data: { ...(s.data as object), heading: "Other" } as never })).not.toBe(sectionHash(s));
  });
});

describe("pages", () => {
  it("duplicates a page hidden, with new section ids and a free address", () => {
    const c = duplicatePage(site(), "about");
    const copy = c.pages.find((p) => p.slug === "about-copy")!;
    expect(copy.hidden).toBe(true);
    expect(copy.sections.map((s) => s.id)).not.toContain(about(c).sections[0]!.id);
    expect(duplicatePage(c, "about").pages.some((p) => p.slug === "about-copy-2")).toBe(true);
    expect(() => duplicatePage(c, "about", { slug: "contact" })).toThrow(SiteContentError);
    expect(() => duplicatePage(site(), "about", {}, 5)).toThrow(/plan allows 5/);
  });

  it("hides and no-indexes a page; the home page cannot be hidden", () => {
    const c = setPageFlags(site(), "about", { hidden: true, noindex: true });
    expect(about(c)).toMatchObject({ hidden: true, noindex: true });
    expect(about(setPageFlags(c, "about", { hidden: false })).hidden).toBeUndefined();
    expect(() => setPageFlags(site(), HOME_SLUG, { hidden: true })).toThrow(SiteContentError);
  });

  it("renames an address: menu, links and page follow, and the old address is returned for a redirect", () => {
    const c = site();
    const withLink = updateSection(c, HOME_SLUG, c.pages[0]!.sections[0]!.id, { ...(c.pages[0]!.sections[0]!.data as object), ctaHref: "/about#team" });
    const r = renamePage(withLink, "about", "our-story");
    expect(r).toMatchObject({ from: "/about", to: "/our-story" });
    expect(r.content.pages.some((p) => p.slug === "about")).toBe(false);
    expect(r.content.nav.some((n) => n.slug === "our-story")).toBe(true);
    expect(JSON.stringify(r.content)).toContain("/our-story#team");
    expect(JSON.stringify(r.content)).not.toContain('"/about#team"');
    expect(siteContentSchema.safeParse(r.content).success).toBe(true);
    expect(() => renamePage(c, HOME_SLUG, "start")).toThrow(SiteContentError);
    expect(() => renamePage(c, "about", "contact")).toThrow(SiteContentError);
    expect(() => renamePage(c, "about", "api")).toThrow(SiteContentError);
    expect(() => renamePage(c, "about", "Bad Slug")).toThrow(SiteContentError);
  });

  it("collapses redirect chains and never makes a loop", () => {
    let t = mergeRedirects([], { from: "/a", to: "/b" });
    t = mergeRedirects(t, { from: "/b", to: "/c" });
    expect(t).toEqual(expect.arrayContaining([{ from: "/a", to: "/c" }, { from: "/b", to: "/c" }]));
    t = mergeRedirects(t, { from: "/c", to: "/a" });
    expect(t.some((r) => r.from === r.to)).toBe(false);
    expect(t.find((r) => r.from === "/a")).toBeUndefined();
    expect(t).toEqual(expect.arrayContaining([{ from: "/b", to: "/a" }, { from: "/c", to: "/a" }]));
    expect(mergeRedirects([{ from: "/x", to: "/y" }], { from: "/z", to: "/z" })).toEqual([{ from: "/x", to: "/y" }]);
  });

  it("keeps the search image when a page is edited, and clears it when asked", () => {
    const c = updatePage(site(), "about", { title: "About", seoImageUrl: "/api/files/s/public/site/a.png" });
    expect(about(c).seo.imageUrl).toBe("/api/files/s/public/site/a.png");
    expect(about(updatePage(c, "about", { title: "About" })).seo.imageUrl).toBeUndefined();
  });

  it("puts a removed page back once, and removing it also leaves the menu", () => {
    const c = site();
    const page = about(c);
    const gone = removePage(c, "about");
    expect(gone.nav.some((n) => n.slug === "about")).toBe(false);
    const back = restorePage(gone, page);
    expect(back.pages.some((p) => p.slug === "about")).toBe(true);
    expect(() => restorePage(back, page)).toThrow(SiteContentError);
  });
});

describe("menu", () => {
  it("reorders, nests one level, brings back to the top, renames, removes", () => {
    const c = site();
    const labels = (x: typeof c) => x.nav.map((n) => n.label);
    const [a, b] = labels(c);
    expect(labels(moveNavItem(c, [1], -1))[0]).toBe(b);
    expect(moveNavItem(c, [0], -1)).toBe(c);
    const nested = nestNavItem(c, 1);
    expect(nested.nav[0]!.children!.map((x) => x.label)).toEqual([b]);
    expect(nested.nav).toHaveLength(c.nav.length - 1);
    expect(() => nestNavItem(c, 0)).toThrow(SiteContentError);
    expect(() => nestNavItem(nested, 1 - 1 + 0)).toThrow(SiteContentError);
    const up = unnestNavItem(nested, 0, 0);
    expect(labels(up)).toEqual(labels(c));
    expect(renameNavItem(c, [0], "Home page").nav[0]!.label).toBe("Home page");
    expect(() => renameNavItem(c, [0], " ")).toThrow(SiteContentError);
    expect(removeNavItem(nested, [0, 0]).nav[0]!.children).toEqual([]);
    expect(labels(removeNavItem(c, [0]))).not.toContain(a);
    expect(siteContentSchema.safeParse(nested).success).toBe(true);
  });

  it("adds an external link, refuses a bad one and a ninth top entry", () => {
    let c = site();
    c = addNavEntry(c, { label: "Alumni", href: "https://alumni.example.org" });
    expect(c.nav.at(-1)).toEqual({ label: "Alumni", href: "https://alumni.example.org" });
    expect(() => addNavEntry(c, { label: "Bad", href: "javascript:alert(1)" })).toThrow(SiteContentError);
    while (c.nav.length < MENU_TOP_MAX) c = addNavEntry(c, { label: `L${c.nav.length}`, href: "https://x.test" });
    expect(() => addNavEntry(c, { label: "Nine", href: "https://x.test" })).toThrow(/8 entries/);
    // A new page beyond the eighth entry stays out of the menu but exists.
    const more = addPage(c, { slug: "extra", title: "Extra" });
    expect(more.pages.some((p) => p.slug === "extra")).toBe(true);
    expect(more.nav).toHaveLength(MENU_TOP_MAX);
  });

  it("sets the footer text and links", () => {
    const c = setFooterContent(site(), { text: " Hello ", links: [{ label: "Privacy", href: "/privacy" }] });
    expect(c.footer).toEqual({ text: "Hello", links: [{ label: "Privacy", href: "/privacy" }] });
    expect(() => setFooterContent(site(), { links: Array.from({ length: 9 }, () => ({ label: "x", href: "/x" })) })).toThrow(SiteContentError);
  });
});

describe("reading a site", () => {
  it("finds links to pages that do not exist or are hidden, and files the content uses", () => {
    let c = site();
    expect(brokenLinks(c)).toEqual([]);
    c = setPageFlags(c, "contact", { hidden: true });
    expect(brokenLinks(c).length).toBeGreaterThan(0);
    const hero = c.pages[0]!.sections[0]!;
    c = updateSection(c, HOME_SLUG, hero.id, { ...(hero.data as object), ctaHref: "/gone", imageUrl: "/api/files/s1/public/site/a.png" });
    expect(brokenLinks(c).some((b) => b.url === "/gone")).toBe(true);
    expect(fileRefs(c)).toEqual([expect.objectContaining({ url: "/api/files/s1/public/site/a.png", page: "Home" })]);
  });

  it("says in words what a publish changes", () => {
    const was = { content: site(), templateKey: "classic" as const };
    expect(siteChanges(null, was)).toEqual({ first: true, lines: [expect.stringContaining("pages go live")] });
    expect(siteChanges(was, was)).toEqual({ first: false, lines: [] });
    const first = about(was.content).sections[0]!;
    let next = updateSection(was.content, "about", first.id, { ...(first.data as object), heading: "New heading" });
    next = duplicateSection(next, "about", about(next).sections[1]!.id);
    const lines = siteChanges(was, { content: next, templateKey: "modern" }).lines;
    expect(lines.join("|")).toContain("Edited: About us (1 added, 1 changed)");
    expect(lines.join("|")).toContain("from Classic to Modern");
    const renamed = renamePage(was.content, "about", "our-story").content;
    expect(siteChanges(was, { content: renamed, templateKey: "classic" }).lines.join("|")).toContain("Address changed: About us");
  });
});

describe("disclosure rows", () => {
  const today = "2026-11-25";
  const doc = DISCLOSURE_ROWS.find((r) => r.key === "fire_safety")!;
  it("tells filled, missing, not applicable, expiring and expired", () => {
    const data = (v: object) => ({ values: { fire_safety: v } });
    expect(disclosureState(doc, { values: {} }, {}, today).state).toBe("missing");
    expect(disclosureState(doc, data({ na: true }), {}, today).state).toBe("na");
    expect(disclosureState(doc, data({ url: "https://x.test/a.pdf", expiresOn: "2027-06-01" }), {}, today).state).toBe("filled");
    expect(disclosureState(doc, data({ url: "https://x.test/a.pdf", expiresOn: "2026-12-20" }), {}, today)).toEqual({ state: "expiring", days: 25 });
    expect(disclosureState(doc, data({ url: "https://x.test/a.pdf", expiresOn: "2026-12-25" }), {}, today).state).toBe("expiring");
    expect(disclosureState(doc, data({ url: "https://x.test/a.pdf", expiresOn: "2026-12-26" }), {}, today).state).toBe("filled");
    expect(disclosureState(doc, data({ url: "https://x.test/a.pdf", expiresOn: "2026-11-24" }), {}, today)).toEqual({ state: "expired", days: -1 });
  });
  it("writes the school profile into empty rows only, as a copy", () => {
    const base = { values: { name: { text: "Own name" } } };
    const out = disclosureWithProfile(base, { name: "Profile name", affiliationNo: "2130999" });
    expect(out.values.name!.text).toBe("Own name");
    expect(out.values.affiliation!.text).toBe("2130999");
    expect(base.values).not.toHaveProperty("affiliation");
  });
});

describe("sections the editor adds keep working with the new ops", () => {
  it("a new page's menu entry is put in the menu while there is room", () => {
    const c = addSection(addPage(site(), { slug: "fees", title: "Fees" }), "fees", "rich_text");
    expect(c.nav.at(-1)).toEqual({ label: "Fees", slug: "fees" });
  });
});
