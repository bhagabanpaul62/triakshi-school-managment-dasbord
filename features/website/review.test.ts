import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, eq, schoolModuleOverrides, schools, withConsole, withSchool } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import announcementsFeature from "@smw/feature-announcements/feature";
import eventsFeature from "@smw/feature-events/feature";
import { MemoryStorage, useServices } from "@smw/integrations";
import { HOME_SLUG, sectionHash } from "@smw/site-templates";
import { themeOf } from "@smw/themes";
import websiteFeature from "./feature";
import { DisclosureService, InsightsService, MediaService, PublicEnquiryService, PublicSiteService, SiteService, SiteSettingsService, ThemeService, VersionService } from "./service";
import { enquiries, schoolSites, sitePageDays } from "./schema";
import { homeAlias, pageOf } from "./ui/site-routes";
import { withPreview } from "./ui/preview-href";

const stub = (key: string, requires: string[] = []) => ({ key, name: key, description: "", stage: "ga", requires, permissions: {}, core: true }) as never;
const FEATURES = ["announcements", "events", "website"];
let a: TestSchool, jobs: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => {
  await registerFeatures([stub("academics"), stub("students", ["academics"]), announcementsFeature, eventsFeature, websiteFeature]);
  useServices({ storage });
  a = await createTestSchool("rva", FEATURES);
  jobs = await createTestSchool("rvj", FEATURES);
});
afterAll(closeDb);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const hero = (row: { draft: { pages: { slug: string; sections: { id: string; type: string; data: unknown }[] }[] } }) => row.draft.pages.find((p) => p.slug === HOME_SLUG)!.sections.find((s) => s.type === "hero")!;
const status = (s: TestSchool, v: "active" | "suspended" | "cancelled" | "read_only") => withConsole((tx) => tx.update(schools).set({ status: v }).where(eq(schools.id, s.id)));

describe("worker jobs use the school's real state", () => {
  it("a scheduled publish waits for a read-only school, and skips a suspended, cancelled or website-less one", async () => {
    const svc = new SiteService(jobs.as.admin);
    await svc.get();
    await svc.updateFooter("Scheduled footer");
    await svc.schedule(new Date(Date.now() + 3_600_000));
    const due = () => withConsole((tx) => tx.update(schoolSites).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(schoolSites.schoolId, jobs.id)));
    await due();
    const waiting = async () => (await svc.get()).scheduled !== null;
    for (const s of ["suspended", "cancelled", "read_only"] as const) {
      await status(jobs, s);
      expect(await SiteService.publishDue(), s).toBe(0);
      expect(await waiting(), s).toBe(true);
    }
    // Read-only: the Overview says why it waits.
    await status(jobs, "read_only");
    const ov = await new InsightsService({ ...jobs.as.admin, readOnly: true }).overview();
    expect(ov.scheduleNote).toContain("Waiting: the school is read-only");
    await status(jobs, "active");
    await withConsole((tx) => tx.insert(schoolModuleOverrides).values({ schoolId: jobs.id, moduleKey: "website", enabled: false }));
    expect(await SiteService.publishDue()).toBe(0);
    expect(await waiting()).toBe(true);
    await withConsole((tx) => tx.delete(schoolModuleOverrides).where(and(eq(schoolModuleOverrides.schoolId, jobs.id), eq(schoolModuleOverrides.moduleKey, "website"))));
    expect(await SiteService.publishDue()).toBeGreaterThanOrEqual(1);
    expect(await waiting()).toBe(false);
    expect((await PublicSiteService.forSchool(jobs.id, FEATURES).published())!.content.footer.text).toBe("Scheduled footer");
  });

  it("the document warning job leaves a suspended school alone", async () => {
    const d = new DisclosureService(jobs.as.admin);
    const soon = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await d.setValue("fire_safety", { url: "https://x.test/f.pdf", expiresOn: soon });
    await status(jobs, "suspended");
    expect(await DisclosureService.expiry()).toBe(0);
    await status(jobs, "active");
    expect(await DisclosureService.expiry()).toBe(1);
  });

  it("old day counts are pruned, recent ones stay", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await withConsole((tx) => tx.insert(sitePageDays).values([
      { schoolId: a.id, day: day(401), path: "/old", origin: "direct", views: 1 }, { schoolId: a.id, day: day(399), path: "/keep", origin: "direct", views: 1 },
    ]));
    expect(await InsightsService.prunePageDays()).toBeGreaterThanOrEqual(1);
    const rows = await withSchool(a.id, (tx) => tx.select().from(sitePageDays));
    expect(rows.some((r) => r.path === "/old")).toBe(false);
    expect(rows.some((r) => r.path === "/keep")).toBe(true);
  });
});

describe("teachers on the public site", () => {
  it("are not named until the list was checked, and the publish check says so", async () => {
    const svc = new SiteService(a.as.admin);
    await svc.get();
    const row = await svc.addSection("about", "staff");
    expect(row.draft.pages.find((p) => p.slug === "about")!.sections.some((s) => s.type === "staff")).toBe(true);
    const warn = (await svc.checks()).warnings.join("\n");
    expect(warn).toContain("teachers are not shown yet");
    // The wizard publish is not blocked by it.
    await expect(svc.publish()).resolves.toBeDefined();
    expect(await PublicSiteService.forSchool(a.id, FEATURES).staff()).toEqual([]);
    await new SiteSettingsService(a.as.admin).update({ hiddenStaff: [] });
    expect((await svc.checks()).warnings.join("\n")).not.toContain("teachers are not shown yet");
    expect((await PublicSiteService.forSchool(a.id, FEATURES).staff()).map((s) => s.id)).toContain(a.users.teacher);
  });
});

describe("logo and icon", () => {
  it("an uploaded logo is saved, a javascript: address is refused, and a stored bad one keeps the theme", async () => {
    const t = new ThemeService(a.as.admin);
    const { url } = await t.uploadAsset("logo", { name: "logo.png", type: "image/png", bytes: PNG });
    const { theme } = await t.get();
    const saved = await t.save({ ...theme, logoUrl: url });
    expect(saved.logoUrl).toBe(url);
    await expect(t.save({ ...theme, logoUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.save({ ...theme, faviconUrl: "http://x.test/f.png" })).rejects.toBeInstanceOf(ValidationError);
    await withConsole((tx) => tx.update(schools).set({ theme: { ...saved, preset: "royal", logoUrl: "javascript:alert(1)" } as never, logoUrl: "javascript:alert(1)" }).where(eq(schools.id, a.id)));
    const again = await t.get();
    expect(again.theme.preset).toBe("royal");
    expect(again.theme.logoUrl).toBeNull();
    expect(again.logoUrl).toBeNull();
    expect(themeOf((await withSchool(a.id, (tx) => tx.select().from(schools)))[0]!.theme).preset).toBe("royal");
  });
});

describe("publish checks for files", () => {
  it("need the file to be in this school's public files and to exist", async () => {
    const svc = new SiteService(a.as.admin);
    const h = hero(await svc.get());
    const set = (imageUrl: string) => svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl });
    await storage.put(`${a.id}/private/secret.png`, PNG, "image/png");
    await set(`/api/files/${a.id}/private/secret.png`);
    expect((await svc.checks()).blockers.join("\n")).toContain("not in your school's public files");
    await storage.put(`${a.id}/public/theme/mark.png`, PNG, "image/png");
    await set(`/api/files/${a.id}/public/theme/mark.png`);
    expect((await svc.checks()).blockers).toEqual([]);
    await set(`/api/files/${a.id}/public/theme/nothing.png`);
    expect((await svc.checks()).blockers.join("\n")).toContain("was deleted");
    await set(`/api/files/${jobs.id}/public/site/theirs.png`);
    expect((await svc.checks()).blockers.join("\n")).toContain("not in your school's public files");
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object) });
  });
});

describe("media remove and publish never leave the live site without its file", () => {
  it("the file is kept when the publish won, and the publish is refused when the delete won", async () => {
    const m = new MediaService(a.as.admin);
    const svc = new SiteService(a.as.admin);
    for (let round = 0; round < 4; round++) {
      const photo = await m.uploadPhoto({ name: `race${round}.png`, type: "image/png", bytes: PNG });
      const h = hero(await svc.get());
      await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: photo.url });
      const [removed, published] = await Promise.allSettled([m.remove(photo.id), svc.publish()]);
      // Whatever the order, a file the live site uses is never gone; and a publish that lost the race is refused, not left pointing at nothing.
      const key = photo.url.slice("/api/files/".length);
      expect(removed.status === "fulfilled" || published.status === "fulfilled", `round ${round}`).toBe(true);
      expect(storage.files.has(key), `round ${round}`).toBe(published.status === "fulfilled");
      await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: undefined });
      await svc.publish();
    }
  });
  it("lists where a used file is, with a link to take it off", async () => {
    const m = new MediaService(a.as.admin);
    const photo = await m.uploadPhoto({ name: "linked.png", type: "image/png", bytes: PNG });
    const svc = new SiteService(a.as.admin);
    const h = hero(await svc.get());
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: photo.url });
    await svc.publish();
    const item = (await m.list()).find((i) => i.id === photo.id)!;
    expect(item.places.map((p) => p.href)).toEqual(["/app/website/edit?page=home", "/app/website/edit?page=home"]);
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: undefined });
    await svc.publish();
  });
});

describe("redirects", () => {
  it("are tidied, refuse the system's and the generated paths with a sentence, and are 307 by hand and 308 for an address change", async () => {
    const s = new SiteSettingsService(a.as.admin);
    const r = await s.addRedirect({ from: "/Old-Fees/", to: "/admissions/" });
    expect(r).toMatchObject({ fromPath: "/old-fees", toPath: "/admissions" });
    for (const from of ["/news", "/events/abc", "/privacy", "/home", "/sitemap.xml", "/enquiry-sent", "/login", "/app/x"]) {
      const err = await s.addRedirect({ from, to: "/contact" }).catch((e) => e);
      expect(err, from).toBeInstanceOf(ValidationError);
      expect(err.fieldErrors.from, from).toMatch(/\.$/);
    }
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    expect(await pub.redirectFor("/old-fees/")).toEqual({ to: "/admissions", permanent: false });
    const svc = new SiteService(a.as.admin);
    await svc.addPage({ slug: "tour", title: "Tour" });
    await svc.publish();
    await svc.renamePage("tour", "campus-tour");
    expect(await pub.redirectFor("/tour")).toEqual({ to: "/campus-tour", permanent: true });
  });
});

describe("section saves from the editor", () => {
  it("need the hash unless the person chose to keep theirs", async () => {
    const svc = new SiteService(a.as.admin);
    const h = hero(await svc.get());
    const data = { ...(h.data as object), heading: "Needs hash" };
    await expect(svc.updateSection(HOME_SLUG, h.id, data, { requireHash: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.updateSection(HOME_SLUG, h.id, data, { requireHash: true, hash: sectionHash(h as never) })).resolves.toBeDefined();
    await expect(svc.updateSection(HOME_SLUG, h.id, { ...data, heading: "Forced" }, { requireHash: true, force: true })).resolves.toBeDefined();
    // Code with nobody to ask (setup, seeds) is unchanged.
    await expect(svc.updateSection(HOME_SLUG, h.id, { ...data, heading: "Seed" })).resolves.toBeDefined();
  });
});

describe("versions and the sitemap day", () => {
  it("the draft saved before a restore carries no notes; the live copy has one day per page", async () => {
    const svc = new SiteService(a.as.admin);
    const v = new VersionService(a.as.admin);
    const h = hero(await svc.get());
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), heading: "For the sitemap" });
    const r = await svc.publish();
    const live = (await PublicSiteService.forSchool(a.id, FEATURES).published())!.content;
    expect(live.pages.find((p) => p.slug === HOME_SLUG)!.at).toBeTruthy();
    expect(JSON.stringify(live)).not.toContain('"by"');
    expect(live.pages.flatMap((p) => p.sections).every((x) => !("at" in x))).toBe(true);
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), heading: "Later" });
    const restored = await v.restore(r.version);
    const kept = await v.get(restored.saved!);
    expect(JSON.stringify(kept.content)).not.toMatch(/"by"|"at"/);
  });
});

describe("enquiries per day and per page", () => {
  it("keeps the page a form was sent from and counts by day and page", async () => {
    const pe = PublicEnquiryService.forSchool(a.id, FEATURES);
    PublicEnquiryService.limiter.reset(`${a.id}:9.9.9.9`);
    const base = { parentName: "Sunita Sharma", consent: "true", ts: String(Date.now() - 60_000) };
    await pe.submit({ ...base, studentName: "Page One", phone: "9876540001", page: "/admissions?utm=x" }, { ip: "9.9.9.9" });
    await pe.submit({ ...base, studentName: "Page Two", phone: "9876540002", page: "/admissions" }, { ip: "9.9.9.9" });
    await pe.submit({ ...base, studentName: "Page Three", phone: "9876540003", page: "https://evil.example/x" }, { ip: "9.9.9.9" });
    const rows = await withSchool(a.id, (tx) => tx.select({ n: enquiries.studentName, p: enquiries.pagePath }).from(enquiries));
    expect(rows.find((r) => r.n === "Page One")!.p).toBe("/admissions");
    expect(rows.find((r) => r.n === "Page Three")!.p).toBeNull();
    const i = await new InsightsService(a.as.admin).insights(30);
    expect(i.enquiriesByPage["/admissions"]).toBe(2);
    expect(i.enquiriesByDay.reduce((s, d) => s + d.n, 0)).toBe(i.enquiries);
    expect(i.enquiriesByDay.at(-1)!.n).toBeGreaterThanOrEqual(3);
  });
});

describe("small rules of the public routes", () => {
  it("keeps the preview in every internal link, and nothing else", () => {
    expect(withPreview("/about", "preview=1")).toBe("/about?preview=1");
    expect(withPreview("/about#team", "preview=1&version=3")).toBe("/about?preview=1&version=3#team");
    expect(withPreview("/about?x=1", "preview=1")).toBe("/about?x=1&preview=1");
    expect(withPreview("/about?preview=1", "preview=1")).toBe("/about?preview=1");
    expect(withPreview("/", "preview=1")).toBe("/?preview=1");
    for (const same of ["https://x.test/a", "//x.test/a", "/app/website", "/api/files/x", "/login", "mailto:a@b.c", "tel:1"]) expect(withPreview(same, "preview=1")).toBe(same);
  });
  it("sends /home to the home page, except in a preview", () => {
    expect(homeAlias(["home"], false)).toBe("/");
    expect(homeAlias(["home"], true)).toBeNull();
    expect(homeAlias(["about"], false)).toBeNull();
    expect(homeAlias([], false)).toBeNull();
  });
  it("opens long lists twelve at a time and clamps the page number", () => {
    expect(pageOf(30, undefined)).toEqual({ page: 1, pages: 3, from: 0, to: 12 });
    expect(pageOf(30, "2")).toEqual({ page: 2, pages: 3, from: 12, to: 24 });
    expect(pageOf(30, "99").page).toBe(3);
    expect(pageOf(30, "-4").page).toBe(1);
    expect(pageOf(30, "abc").page).toBe(1);
    expect(pageOf(0, "1").pages).toBe(1);
  });
});

