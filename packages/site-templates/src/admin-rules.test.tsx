import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@smw/themes";
import {
  RESERVED_NEW_SLUGS, TEMPLATE_KEYS, addPage, defaultSite, disclosureTitle, duplicateSection, firstMarkdownImage, setSectionHidden, lastChange, mk, setFooterContent, shareImage, siteChanges,
  siteContentSchema, stampChanges, stripMeta, updateSection, brokenLinks, setPageFlags, PAGE_TEMPLATES, type SiteContent,
} from "./index";
import { SiteView, type SiteData } from "./render";

const school = { name: "Green Valley Public School", city: "Bengaluru", address: "12 MG Road", phone: "9876543210", email: "office@gv.test" };
const enquiry = async () => ({ ok: true as const });
const html = (content: SiteContent, slug: string, template: (typeof TEMPLATE_KEYS)[number] = "classic", data?: SiteData) =>
  renderToStaticMarkup(<SiteView school={{ name: school.name }} template={template} theme={PRESETS.ocean!} content={content} slug={slug} data={data} enquiry={enquiry} />);

describe("who changed what", () => {
  const base = defaultSite(school);
  const hero = base.pages[0]!.sections[0]!;
  it("notes by and at only on what changed; the rest keeps what it had", () => {
    const first = stampChanges(base, base, "Asha", "2026-11-25T10:00:00.000Z");
    expect(first.pages.every((p) => p.by === undefined)).toBe(true);
    const edited = updateSection(base, "home", hero.id, { ...(hero.data as object), heading: "New" });
    const a = stampChanges(base, edited, "Asha", "2026-11-25T10:00:00.000Z");
    expect(a.pages[0]!.sections[0]).toMatchObject({ by: "Asha", at: "2026-11-25T10:00:00.000Z" });
    expect(a.pages[0]!.sections[1]!.by).toBeUndefined();
    // Ravi changes another section later: Asha's note on the first stays.
    const second = a.pages[0]!.sections[1]!;
    const b = stampChanges(a, setSectionHidden(a, "home", second.id, true), "Ravi", "2026-11-25T11:00:00.000Z");
    expect(b.pages[0]!.sections[0]!.by).toBe("Asha");
    expect(b.pages[0]!.sections[1]!.by).toBe("Ravi");
    expect(lastChange(b.pages[0]!)).toEqual({ by: "Ravi", at: "2026-11-25T11:00:00.000Z" });
    const dup = stampChanges(b, duplicateSection(b, "home", hero.id), "Meena", "2026-11-25T12:00:00.000Z");
    expect(dup.pages[0]!.by).toBe("Meena");
    expect(lastChange(base.pages[0]!)).toBeNull();
  });
  it("is optional in the schema, and never counts as a change", () => {
    const edited = updateSection(base, "home", hero.id, { ...(hero.data as object), heading: "New" });
    const stamped = stampChanges(base, edited, "Asha", "2026-11-25T10:00:00.000Z");
    expect(siteContentSchema.safeParse(stamped).success).toBe(true);
    expect(siteContentSchema.safeParse(base).success).toBe(true);
    // The same words, with or without notes: no change line.
    const noted = stampChanges(base, { ...base, pages: base.pages.map((p) => ({ ...p, by: "Asha", at: "x" })) }, "Asha", "2026-11-25T10:00:00.000Z");
    expect(siteChanges({ content: base, templateKey: "classic" }, { content: noted, templateKey: "classic" }).lines).toEqual([]);
    expect(JSON.stringify(stripMeta(stamped))).not.toMatch(/"by"|"at"/);
  });
});

describe("footer columns", () => {
  const base = defaultSite(school);
  const cols = [{ title: "Admissions", links: [{ label: "Fees", href: "/fees" }, { label: "Apply", href: "/admissions" }] }, { title: "Parents", links: [{ label: "Notices", href: "/news" }] }];
  it("keeps older sites valid, takes up to four columns, and draws them in every design", () => {
    expect(siteContentSchema.safeParse(base).success).toBe(true);
    const c = setFooterContent(base, { links: base.footer.links, columns: cols });
    expect(siteContentSchema.safeParse(c).success).toBe(true);
    expect(() => setFooterContent(base, { links: [], columns: [...cols, ...cols, ...cols] })).toThrow(/Four columns/);
    expect(() => setFooterContent(base, { links: [], columns: [{ title: " ", links: [] }] })).toThrow();
    expect(siteContentSchema.safeParse({ ...c, footer: { ...c.footer, columns: Array.from({ length: 5 }, () => cols[0]) } }).success).toBe(false);
    for (const t of TEMPLATE_KEYS) {
      const out = html(c, "home", t);
      expect(out).toContain("<h2>Admissions</h2>");
      expect(out).toContain('href="/fees"');
      expect(out).toContain("<h2>Parents</h2>");
    }
    // Saving the words alone keeps the columns.
    expect(setFooterContent(c, { text: "Words", links: c.footer.links }).footer.columns).toHaveLength(2);
  });
});

describe("photo descriptions and the forms on the page", () => {
  const site = defaultSite(school);
  it("uses the school's description for a photo without a caption, and a caption wins", () => {
    let c = updateSection(site, "home", site.pages[0]!.sections[0]!.id, { ...(site.pages[0]!.sections[0]!.data as object), imageUrl: "/api/files/s/public/site/a.png" });
    c = addPage(c, { slug: "snaps", title: "Snaps" });
    c = { ...c, pages: c.pages.map((p) => (p.slug === "snaps" ? { ...p, sections: [mk("gallery", { images: [{ url: "/api/files/s/public/site/b.png", caption: "Own caption" }, { url: "/api/files/s/public/site/c.png" }] })] } : p)) };
    const alt = { "/api/files/s/public/site/a.png": "Principal at assembly", "/api/files/s/public/site/b.png": "Ignored", "/api/files/s/public/site/c.png": "Football match" };
    const home = html(c, "home", "classic", { news: [], events: [], staff: [], alt });
    expect(home).toContain('alt="Principal at assembly"');
    const snaps = html(c, "snaps", "classic", { news: [], events: [], staff: [], alt });
    expect(snaps).toContain('alt="Own caption"');
    expect(snaps).not.toContain("Ignored");
    expect(snaps).toContain('alt="Football match"');
  });
  it("the admission form offers the school's classes and sessions; the question form says it is a question", () => {
    const adm = mk("admission_form", { heading: "Apply", classes: ["Nursery"] });
    const q = mk("contact_form", { heading: "Ask" });
    const c: SiteContent = { ...site, pages: site.pages.map((p) => (p.slug === "contact" ? { ...p, sections: [adm, q] } : p)) };
    const out = html(c, "contact", "classic", { news: [], events: [], staff: [], forms: { [adm.id]: { classes: ["Class 1", "Class 2"], sessions: ["2026-27", "2027-28"], session: "2026-27", consentText: "I agree to be called." } } });
    expect(out).toContain("Class 2");
    expect(out).not.toContain(">Nursery<");
    expect(out).toContain("2027-28");
    expect(out).toContain("I agree to be called.");
    expect(out).toMatch(/name="kind" value="question"/);
  });
});

describe("shared pictures, titles and reserved addresses", () => {
  it("takes a notice's own picture, else the page's, else the hero, else the logo", () => {
    expect(firstMarkdownImage("Hello ![Sports day](/api/files/s/public/site/x.png) and more")).toBe("/api/files/s/public/site/x.png");
    expect(firstMarkdownImage("![a](https://x.test/a.jpg)")).toBe("https://x.test/a.jpg");
    expect(firstMarkdownImage("![a](javascript:alert(1))")).toBeUndefined();
    expect(firstMarkdownImage("No picture here")).toBeUndefined();
    expect(firstMarkdownImage(null)).toBeUndefined();
    expect(shareImage({ item: "i", page: "p", hero: "h", logo: "l" })).toBe("i");
    expect(shareImage({ page: "p", hero: "h", logo: "l" })).toBe("p");
    expect(shareImage({ hero: "h", logo: "l" })).toBe("h");
    expect(shareImage({ logo: "l" })).toBe("l");
    expect(shareImage({})).toBeUndefined();
  });
  it("calls the disclosure School information for a board that is not CBSE", () => {
    expect(disclosureTitle("CBSE")).toBe("Mandatory public disclosure");
    expect(disclosureTitle("cbse")).toBe("Mandatory public disclosure");
    expect(disclosureTitle(null)).toBe("Mandatory public disclosure");
    for (const b of ["ICSE", "State board", "IB"]) expect(disclosureTitle(b)).toBe("School information");
  });
  it("keeps the thank-you address for the app", () => {
    expect(RESERVED_NEW_SLUGS).toContain("enquiry-sent");
    expect(() => addPage(defaultSite(school), { slug: "enquiry-sent", title: "X" })).toThrow();
  });
});

describe("review fixes", () => {
  const school2 = school;
  it("a hidden page's contact details are not in the header or footer", () => {
    const site = defaultSite(school2);
    const hidden = setPageFlags(site, "contact", { hidden: true });
    const withContact = html(site, "home");
    expect(withContact).toContain("office@gv.test");
    const without = html(hidden, "home");
    expect(without).not.toContain("office@gv.test");
    expect(without).not.toContain("9876543210");
  });
  it("finds a broken link whatever its case, and leaves anchors, queries and the app's own addresses alone", () => {
    let c = defaultSite(school2);
    const hero = c.pages[0]!.sections[0]!;
    const link = (href: string) => brokenLinks(updateSection(c, "home", hero.id, { ...(hero.data as object), ctaHref: href })).some((b) => b.url === href);
    expect(link("/About")).toBe(false);
    expect(link("/ABOUT?x=1#team")).toBe(false);
    expect(link("/about/")).toBe(false);
    expect(link("/Gone")).toBe(true);
    expect(link("/gone#top")).toBe(true);
    expect(link("/gone?x=1")).toBe(true);
    for (const ok of ["/enquiry-sent", "/reset-password", "/verify-email", "/unsubscribe", "/sitemap.xml", "/robots.txt", "/news/abc", "/events", "/privacy", "/login", "/#top", "https://x.test"]) expect(link(ok), ok).toBe(false);
    c = setPageFlags(c, "about", { hidden: true });
    expect(link("/About")).toBe(true);
  });
  it("the news page template places a news section and says it takes /news", () => {
    expect(PAGE_TEMPLATES.news.slug).toBe("news");
    expect(PAGE_TEMPLATES.news.description).toContain("/news");
    expect(PAGE_TEMPLATES.news.build(school2).sections.map((x) => x.type)).toEqual(["news", "events"]);
  });
  it("the live copy keeps one day per page, and nothing about who", () => {
    const site = defaultSite(school2);
    const hero = site.pages[0]!.sections[0]!;
    const edited = stampChanges(site, updateSection(site, "home", hero.id, { ...(hero.data as object), heading: "X" }), "Asha", "2026-11-20T10:00:00.000Z");
    const live = stripMeta(edited, { keepPageDate: true });
    expect(live.pages[0]!.at).toBe("2026-11-20T10:00:00.000Z");
    expect(live.pages[1]!.at).toBeUndefined();
    expect(JSON.stringify(live)).not.toContain("Asha");
    expect(live.pages[0]!.sections.every((x) => !("at" in x))).toBe(true);
    expect(siteContentSchema.safeParse(live).success).toBe(true);
  });
});
