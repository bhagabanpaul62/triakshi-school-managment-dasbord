import { describe, expect, it } from "vitest";
import { HOME_SLUG, TEMPLATE_KEYS, pageSchema, siteContentSchema, type SchoolInfo, type SiteContent } from "./content";
import { PAGE_TEMPLATE_KEYS, buildPage } from "./pages";
import { starterSite } from "./starters";

const school: SchoolInfo = { name: "Green Valley Public School", city: "Bengaluru", board: "CBSE", address: "12 MG Road", phone: "9876543210", email: "office@gv.test" };

const homeOf = (site: SiteContent) => {
  const home = site.pages.find((p) => p.slug === HOME_SLUG);
  if (!home) throw new Error("no home page");
  return home;
};

const heroHeading = (key: (typeof TEMPLATE_KEYS)[number]) => {
  const first = homeOf(starterSite(key, school)).sections[0];
  return first?.type === "hero" ? first.data.heading : "";
};

describe("starter sites", () => {
  for (const key of TEMPLATE_KEYS) {
    it(`${key} passes the site schema`, () => {
      const result = siteContentSchema.safeParse(starterSite(key, school));
      if (!result.success) console.log(JSON.stringify(result.error.issues, null, 2));
      expect(result.success).toBe(true);
    });

    it(`${key} has a long home page that starts with a hero and ends with a call to action`, () => {
      const sections = homeOf(starterSite(key, school)).sections;
      expect(sections.length).toBeGreaterThanOrEqual(11);
      expect(sections[0]?.type).toBe("hero");
      expect(sections.at(-1)?.type).toBe("cta");
    });

    it(`${key} passes the schema for a school with only a name`, () => {
      const result = siteContentSchema.safeParse(starterSite(key, { name: "Tiny School" }));
      if (!result.success) console.log(JSON.stringify(result.error.issues, null, 2));
      expect(result.success).toBe(true);
    });
  }

  it("gives the five designs five different hero headings", () => {
    const headings = TEMPLATE_KEYS.map(heroHeading);
    expect(new Set(headings).size).toBe(TEMPLATE_KEYS.length);
  });

  it("every page template passes the page schema, and disclosure and documents use their own sections", () => {
    for (const k of PAGE_TEMPLATE_KEYS) expect(pageSchema.safeParse(buildPage(k, school)).success, k).toBe(true);
    expect(buildPage("disclosure", school).sections.map((s) => s.type)).toEqual(["disclosure"]);
    expect(buildPage("documents", school).sections.map((s) => s.type)).toEqual(["documents"]);
  });
});
