import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@smw/themes";
import { TEMPLATE_KEYS, defaultSite, updateSection, type SiteContent } from "./index";
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
    expect(render(site, "contact")).toContain("https://www.google.com/maps?q=");
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
