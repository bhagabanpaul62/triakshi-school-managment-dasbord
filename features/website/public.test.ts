import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { announcements } from "@smw/feature-announcements/schema";
import { NoticeService } from "@smw/feature-announcements/service";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { istDay } from "@smw/site-templates";
import { PublicSiteService, SiteService, countable, originOf } from "./service";
import { schoolSites, sitePageDays, siteRedirects } from "./schema";

const FEATURES = ["announcements", "events", "website"];
let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(FEATURES, "pubsite")); });
afterAll(closeDb);

const views = (s: TestSchool) => withSchool(s.id, (tx) => tx.select().from(sitePageDays).where(eq(sitePageDays.schoolId, s.id)));

describe("what a visit is (pure)", () => {
  it("classifies the referrer by host only", () => {
    expect(originOf(undefined)).toBe("direct");
    expect(originOf("not a url")).toBe("direct");
    expect(originOf("https://www.google.com/search?q=school")).toBe("search");
    expect(originOf("https://www.bing.com/")).toBe("search");
    expect(originOf("https://l.facebook.com/l.php?u=x")).toBe("social");
    expect(originOf("https://t.co/abc")).toBe("social");
    expect(originOf("https://www.instagram.com/")).toBe("social");
    expect(originOf("https://blog.example.org/post")).toBe("other");
    expect(originOf("https://school.example.app/about", ["school.example.app:3000"])).toBe("direct");
  });
  it("skips bots, previews and signed-in people", () => {
    const chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
    expect(countable({ userAgent: chrome })).toBe(true);
    expect(countable({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })).toBe(false);
    expect(countable({ userAgent: "WhatsApp/2.23 preview" })).toBe(false);
    expect(countable({ userAgent: "curl/8.4" })).toBe(false);
    expect(countable({ userAgent: null })).toBe(false);
    expect(countable({ userAgent: chrome, preview: true })).toBe(false);
    expect(countable({ userAgent: chrome, signedIn: true })).toBe(false);
  });
});

describe("PublicSiteService: page views", () => {
  it("adds up per day, path and origin, and each school counts alone", async () => {
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    await pub.countView("/about", "search");
    await pub.countView("/about", "search");
    await pub.countView("/about", "direct");
    await pub.countView("/", "direct");
    // Counted in memory and written together.
    expect(await views(a)).toEqual([]);
    await PublicSiteService.flushViews();
    const rows = await views(a);
    const get = (path: string, origin: string) => rows.find((r) => r.path === path && r.origin === origin);
    expect(get("/about", "search")?.views).toBe(2);
    expect(get("/about", "direct")?.views).toBe(1);
    expect(get("/", "direct")?.day).toBe(istDay());
    expect(await views(b)).toEqual([]);
  });
  it("never breaks the page: a module that is off or a school that does not exist is a quiet no-op", async () => {
    await expect(PublicSiteService.forSchool(a.id, []).countView("/x", "direct")).resolves.toBeUndefined();
    await expect(PublicSiteService.forSchool("00000000-0000-4000-8000-000000000000", FEATURES).countView("/x", "direct")).resolves.toBeUndefined();
  });
});

describe("PublicSiteService: redirects", () => {
  it("returns the new address of an old one, in its own school only", async () => {
    await withSchool(a.id, (tx) => tx.insert(siteRedirects).values([
      { schoolId: a.id, fromPath: "/old-page", toPath: "/new-page", automatic: true },
      { schoolId: a.id, fromPath: "/ext", toPath: "https://example.org/x" },
      { schoolId: a.id, fromPath: "/bad", toPath: "javascript:alert(1)" },
      { schoolId: a.id, fromPath: "/loop", toPath: "/loop" },
    ]));
    const pa = PublicSiteService.forSchool(a.id, FEATURES);
    expect(await pa.redirectFor("/old-page")).toEqual({ to: "/new-page", permanent: true });
    expect(await pa.redirectFor("/Old-Page/")).toEqual({ to: "/new-page", permanent: true });
    expect(await pa.redirectFor("/ext")).toEqual({ to: "https://example.org/x", permanent: false });
    expect(await pa.redirectFor("/bad")).toBeNull();
    expect(await pa.redirectFor("/loop")).toBeNull();
    expect(await pa.redirectFor("/nothing")).toBeNull();
    expect(await PublicSiteService.forSchool(b.id, FEATURES).redirectFor("/old-page")).toBeNull();
  });
});

describe("PublicSiteService: site state and staff", () => {
  it("reports the offline time and the settings of the published copy", async () => {
    const svc = new SiteService(a.as.admin);
    await svc.get();
    await svc.publish();
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    const live = await pub.published();
    expect(live?.offlineAt).toBeNull();
    expect(live?.settings.indexed).toBe(true);
    const at = new Date();
    await withSchool(a.id, (tx) => tx.update(schoolSites).set({ offlineAt: at, settings: { indexed: false, offlineMessage: "Back tomorrow" } as never }).where(eq(schoolSites.schoolId, a.id)));
    const off = await pub.published();
    expect(off?.offlineAt?.getTime()).toBe(at.getTime());
    expect(off?.settings).toMatchObject({ indexed: false, offlineMessage: "Back tomorrow" });
    expect(await PublicSiteService.forSchool(b.id, FEATURES).published()).toBeNull();
  });
  it("leaves out a teacher the school chose not to name", async () => {
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    // Nobody is named until the school has looked at the list.
    expect(await pub.staff()).toEqual([]);
    await withSchool(a.id, (tx) => tx.update(schoolSites).set({ settings: { teachersChecked: true } as never }).where(eq(schoolSites.schoolId, a.id)));
    expect((await pub.staff()).map((s) => s.id)).toContain(a.users.teacher);
    await withSchool(a.id, (tx) => tx.update(schoolSites).set({ settings: { teachersChecked: true, hiddenStaff: [a.users.teacher] } as never }).where(eq(schoolSites.schoolId, a.id)));
    expect((await pub.staff()).map((s) => s.id)).not.toContain(a.users.teacher);
    await withSchool(a.id, (tx) => tx.update(schoolSites).set({ settings: { teachersChecked: true } as never }).where(eq(schoolSites.schoolId, a.id)));
    expect((await pub.staff()).map((s) => s.id)).toContain(a.users.teacher);
  });
});

describe("PublicSiteService: one notice, one event", () => {
  const everyone = { include: [{ type: "everyone" }], exclude: [] };
  const send = async (input: Record<string, unknown>) => {
    const n = new NoticeService(a.as.admin);
    const id = (await n.saveDraft({ type: "notice", ...input })).id;
    await n.publish(id, { confirmed: true });
    await withSchool(a.id, (tx) => tx.update(announcements).set({ state: "published" }).where(eq(announcements.id, id)));
    return id;
  };
  it("opens a public notice, says a withdrawn one was withdrawn without its text, and hides the rest", async () => {
    const open = await send({ title: "Annual day", body: "On **20 December**", audience: everyone, website: true });
    const priv = await send({ title: "Private", body: "x", audience: everyone });
    const gone = await send({ title: "Secret title", body: "Secret body", audience: everyone, website: true });
    await withSchool(a.id, (tx) => tx.update(announcements).set({ state: "withdrawn" }).where(eq(announcements.id, gone)));
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    expect(await pub.newsItem(open)).toMatchObject({ title: "Annual day", withdrawn: false });
    expect(await pub.newsItem(priv)).toBeNull();
    expect(await pub.newsItem(gone)).toEqual({ id: gone, title: "", body: "", publishedAt: null, withdrawn: true });
    expect(await pub.newsItem("not-an-id")).toBeNull();
    expect(await PublicSiteService.forSchool(b.id, FEATURES).newsItem(open)).toBeNull();
    expect(await PublicSiteService.forSchool(a.id, ["website"]).newsItem(open)).toBeNull();
  });
  it("finds no event that is not public, and takes only real ids", async () => {
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    expect(await pub.eventItem("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await pub.eventItem("x")).toBeNull();
  });
});
