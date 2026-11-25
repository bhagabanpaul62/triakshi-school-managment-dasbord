import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@smw/themes";
import { SITE_CSS } from "./styles";
import { TEMPLATE_KEYS, defaultSite, mk, noticeActive, updateSection, videoEmbed, whatsappLink, type SiteContent } from "./index";
import { SiteView, type SiteData } from "./render";

const school = { name: "Green Valley Public School", city: "Bengaluru", address: "12 MG Road", phone: "9876543210", email: "office@gv.test" };
const data: SiteData = {
  news: [{ id: "n1", title: "Annual Day on 20 December", body: "Parents are invited.", publishedAt: new Date("2026-11-10T05:00:00Z") }],
  events: [{ id: "e1", title: "Sports Day", startsOn: "2026-12-05", location: "School ground" }],
  staff: [{ id: "t1", name: "Meera Iyer", subject: "Mathematics" }],
};
const enquiry = async () => ({ ok: true as const });
const render = (content: SiteContent, slug: string, template: (typeof TEMPLATE_KEYS)[number] = "classic") =>
  renderToStaticMarkup(<SiteView school={{ name: school.name }} template={template} theme={PRESETS.ocean!} content={content} slug={slug} data={data} enquiry={enquiry} />);

describe("SiteView", () => {
  const site = defaultSite(school);
  it("renders every default page in every template with its data", () => {
    for (const t of TEMPLATE_KEYS) {
      for (const p of site.pages) {
        const html = render(site, p.slug, t);
        expect(html).toContain(`data-template="${t}"`);
        expect(html).toContain("--site-primary:#4F79FF");
        expect(html).toContain(school.name);
      }
    }
    const home = render(site, "home");
    expect(home).toContain("Annual Day on 20 December");
    expect(home).toContain("10 Nov 2026");
    expect(home).toContain("Sports Day");
    expect(home).toContain("Dec 2026");
    expect(home).not.toContain('name="website"');
    expect(render(site, "admissions")).toContain('name="website"');
    expect(render(site, "about")).toContain("Mathematics");
    expect(render(site, "contact")).toContain("Show the map");
  });
  it("escapes text: no raw HTML from content", () => {
    const hero = site.pages[0]!.sections[0]!;
    const bad = updateSection(site, "home", hero.id, { heading: "<script>alert(1)</script> Welcome", subheading: "<img src=x onerror=alert(1)>" });
    const html = render(bad, "home");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it("marks the current page in the nav and shows a preview banner on request", () => {
    expect(render(site, "about")).toMatch(/href="\/about" aria-current="page"/);
    const html = renderToStaticMarkup(<SiteView school={{ name: "S" }} template="minimal" theme={PRESETS.ocean!} content={site} slug="home" enquiry={enquiry} preview />);
    expect(html).toContain("Draft preview");
  });
  it("returns nothing for an unknown page", () => {
    expect(render(site, "nope")).toBe("");
  });
});

const h1s = (html: string) => (html.match(/<h1[ >]/g) ?? []).length;
const site0 = defaultSite(school);
const withPage = (sections: ReturnType<typeof mk>[], extra: Partial<SiteContent["pages"][number]> = {}): SiteContent => ({
  ...site0, pages: [...site0.pages, { slug: "extra", title: "Extra", seo: {}, sections, ...extra }],
});
const settingsOf = (o: object) => ({ social: {}, showDirections: false, indexed: true, hiddenStaff: [], ...o });

describe("new sections", () => {
  const all = [
    mk("video", { heading: "See us", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", title: "Campus walk" }),
    mk("documents", { heading: "Documents", items: [{ label: "Prospectus", url: "/api/files/x/prospectus.pdf", group: "Admission", date: "2026-04-01", size: 340 * 1024 }, { label: "Fee notice", url: "https://example.org/fee.pdf", group: "Fees" }] }),
    mk("people", { heading: "Leadership", items: [{ name: "Asha Rao", role: "Principal" }] }),
    mk("achievers", { heading: "Toppers", items: [{ name: "Ravi Kumar", result: "98.2% in Class 10", year: "2025-26" }] }),
    mk("contact_form", { heading: "Ask us" }),
    mk("disclosure", { data: { values: { name: { text: "Green Valley" }, fire_safety: { url: "https://example.org/fire.pdf", expiresOn: "2027-03-01" }, noc: { na: true } } }, updatedOn: "2026-11-01" }),
  ];
  it("draws all six in every design with one h1", () => {
    for (const t of TEMPLATE_KEYS) {
      const html = render(withPage(all), "extra", t);
      for (const c of ["st-sec-video", "st-sec-documents", "st-sec-people", "st-sec-achievers", "st-sec-contact_form", "st-sec-disclosure"]) expect(html).toContain(c);
      expect(h1s(html)).toBe(1);
      // each design styles the parts itself
      for (const part of [".st-notice", ".st-subnav", ".st-click", ".st-doc", ".st-person", ".st-bar"]) expect(SITE_CSS).toContain(`[data-template=${t}] ${part}`);
    }
  });
  it("video loads nothing before a click and is a plain link without JavaScript", () => {
    const html = render(withPage([all[0]!]), "extra");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
    expect(html).toContain('href="https://www.youtube.com/watch?v=aqz-KE-bpKQ"');
  });
  it("shows documents grouped with date and size, and the disclosure in five parts", () => {
    const html = render(withPage([all[1]!, all[5]!]), "extra");
    expect(html).toContain("Admission");
    expect(html).toContain("1 Apr 2026");
    expect(html).toContain("340 KB");
    for (const part of ["General information", "Documents and information", "Results and academics", "Staff", "School infrastructure"]) expect(html).toContain(part);
    expect(html).toContain("Not applicable");
    expect(html).toContain("Valid until 1 Mar 2027");
    expect(html).toContain("Not available");
  });
  it("leaves out hidden sections and hidden pages", () => {
    const hid = { ...all[2]!, hidden: true } as (typeof all)[number];
    expect(render(withPage([hid, all[3]!]), "extra")).not.toContain("Asha Rao");
    const c = withPage([all[3]!], { hidden: true });
    expect(render(c, "extra")).toBe("");
    expect(renderToStaticMarkup(<SiteView school={{ name: "S" }} template="classic" theme={PRESETS.ocean!} content={c} slug="extra" enquiry={enquiry} preview />)).toContain("Ravi Kumar");
  });
});

describe("site chrome", () => {
  const nav = [{ label: "About", slug: "about", children: [{ label: "Our team", slug: "contact" }, { label: "Board", href: "https://example.org/board" }] }, { label: "Groups" , children: [{ label: "Fees", slug: "admissions" }] }, { label: "Gone", slug: "nope" }];
  it("draws a menu with children, nested on the phone, external links in a new tab", () => {
    const html = render({ ...site0, nav }, "home");
    expect(html).toContain('class="st-subnav"');
    expect(html).toContain('class="st-nest"');
    expect(html).toContain('href="https://example.org/board" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('aria-haspopup="true"');
    expect(html).not.toContain("Gone");
  });
  it("shows the notice only on its days (India), phone buttons and social links", () => {
    const n = { text: "School closed Monday", tone: "important" as const, from: "2026-11-20", until: "2026-11-25" };
    expect(noticeActive(n, new Date("2026-11-25T18:30:00Z"))).toBe(false); // 26 Nov 00:00 in India
    expect(noticeActive(n, new Date("2026-11-25T18:29:00Z"))).toBe(true);
    expect(noticeActive(n, new Date("2026-11-19T18:29:00Z"))).toBe(false);
    expect(noticeActive({ text: "", tone: "info" }, new Date())).toBe(false);
    const html = renderToStaticMarkup(<SiteView school={{ name: "S" }} template="campus" theme={PRESETS.ocean!} content={site0} slug="home" enquiry={enquiry} now={new Date("2026-11-22T05:00:00Z")}
      settings={settingsOf({ notice: n, callNumber: "98765 43210", whatsapp: "9876543210", showDirections: true, social: { instagram: "https://instagram.com/gv" } }) as never} />);
    expect(html).toContain("School closed Monday");
    expect(html).toContain('href="tel:9876543210"');
    expect(html).toContain("https://wa.me/919876543210");
    expect(html).toContain("Directions");
    expect(html).toContain("Instagram");
    expect(html).toContain('href="/privacy"');
    expect(renderToStaticMarkup(<SiteView school={{ name: "S" }} template="campus" theme={PRESETS.ocean!} content={site0} slug="home" enquiry={enquiry} now={new Date("2026-12-30T05:00:00Z")} settings={settingsOf({ notice: n }) as never} />)).not.toContain("School closed Monday");
  });
  it("escapes structured data and gives a home page without a hero an h1", () => {
    const noHero = { ...site0, pages: site0.pages.map((p) => (p.slug === "home" ? { ...p, sections: p.sections.filter((s) => s.type !== "hero") } : p)) };
    const html = renderToStaticMarkup(<SiteView school={{ name: "S" }} template="classic" theme={PRESETS.ocean!} content={noHero} slug="home" enquiry={enquiry} jsonLd={[{ name: "</script><b>" }]} />);
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("\\u003c/script>");
    expect(h1s(html)).toBe(1);
  });
});

describe("helpers", () => {
  it("builds privacy players only for YouTube and Vimeo", () => {
    expect(videoEmbed("https://youtu.be/aqz-KE-bpKQ")?.embed).toContain("youtube-nocookie.com/embed/aqz-KE-bpKQ");
    expect(videoEmbed("https://vimeo.com/123456789")?.embed).toContain("dnt=1");
    expect(videoEmbed("https://evil.example/watch?v=aqz-KE-bpKQ")).toBeNull();
  });
  it("makes WhatsApp links", () => {
    expect(whatsappLink("98765 43210")).toBe("https://wa.me/919876543210");
    expect(whatsappLink("123")).toBeNull();
  });
});
