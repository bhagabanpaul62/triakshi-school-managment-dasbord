import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, eq, schools, schoolRoles, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import announcementsFeature from "@smw/feature-announcements/feature";
import eventsFeature from "@smw/feature-events/feature";
import websiteFeature from "./feature";
import { notifications } from "@smw/feature-notifications/schema";
import { MemoryStorage, useServices } from "@smw/integrations";
import { HOME_SLUG, sectionHash } from "@smw/site-templates";
import {
  DisclosureService, InsightsService, MediaService, PublicSiteService, SectionChangedError, SiteService, SiteSettingsService, VersionService,
} from "./service";
import { schoolSites, siteDisclosure, siteMedia, sitePageDays, siteRedirects, siteVersions } from "./schema";
import { enquiries } from "./schema";

/** The modules the three under test need, so the worker jobs find the website switched on. */
const stub = (key: string, requires: string[] = []) => ({ key, name: key, description: "", stage: "ga", requires, permissions: {}, core: true }) as never;
const FEATURES = ["announcements", "events", "website"];
let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => { await registerFeatures([stub("academics"), stub("students", ["academics"]), announcementsFeature, eventsFeature, websiteFeature]); ({ a, b } = await createSchoolPair(FEATURES, "sa")); useServices({ storage }); });
afterAll(closeDb);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 49]);
const png = (name = "a.png") => ({ name, type: "image/png", bytes: PNG });
/** A custom role that edits but may not publish. */
const editor = (s: TestSchool) => ({ ...s.as.teacher, grants: new Set(["website:read", "website:manage"]) });
const hero = (row: { draft: { pages: { slug: string; sections: { id: string; type: string; data: unknown }[] }[] } }) => row.draft.pages.find((p) => p.slug === HOME_SLUG)!.sections.find((s) => s.type === "hero")!;
const inbox = (s: TestSchool, userId: string, topic: string) => withSchool(s.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.topic, topic as never))));

describe("W1: two people editing at once", () => {
  it("serialises saves, so the second does not drop the first", async () => {
    const svc = new SiteService(a.as.admin);
    const row = await svc.get();
    const home = row.draft.pages.find((p) => p.slug === HOME_SLUG)!;
    const [s0, s1] = home.sections;
    await Promise.all([
      new SiteService(a.as.admin).updateSection(HOME_SLUG, s0!.id, { ...(s0!.data as object), heading: "Written by one" }),
      new SiteService(editor(a)).updateSection(HOME_SLUG, s1!.id, { ...(s1!.data as object), heading: s1!.type === "hero" ? "Written by two" : "Written by two" }),
      new SiteService(a.as.admin).addPage({ slug: "parallel", title: "Parallel" }),
    ]);
    const after = await svc.get();
    const h = after.draft.pages.find((p) => p.slug === HOME_SLUG)!;
    expect((h.sections[0]!.data as { heading?: string }).heading).toBe("Written by one");
    expect((h.sections[1]!.data as { heading?: string }).heading).toBe("Written by two");
    expect(after.draft.pages.some((p) => p.slug === "parallel")).toBe(true);
    expect(after.draftBy).not.toBeNull();
    expect(after.draftAt).not.toBeNull();
  });

  it("refuses a save made on an old copy of the section, names the other person and sends their version", async () => {
    const admin = new SiteService(a.as.admin);
    const row = await admin.get();
    const sec = hero(row);
    const opened = sectionHash(sec as never);
    // The other person saves first.
    await new SiteService(editor(a)).updateSection(HOME_SLUG, sec.id, { ...(sec.data as object), heading: "Theirs" });
    const err = await admin.updateSection(HOME_SLUG, sec.id, { ...(sec.data as object), heading: "Mine" }, { hash: opened }).catch((e) => e);
    expect(err).toBeInstanceOf(SectionChangedError);
    expect(err.by).toBe("teacher asa");
    expect(err.message).toContain("teacher asa");
    expect(err.at).toBeInstanceOf(Date);
    expect((err.theirs.data as { heading: string }).heading).toBe("Theirs");
    expect((hero(await admin.get()).data as { heading: string }).heading).toBe("Theirs");
    // Keep mine.
    await admin.updateSection(HOME_SLUG, sec.id, { ...(sec.data as object), heading: "Mine" }, { hash: opened, force: true });
    expect((hero(await admin.get()).data as { heading: string }).heading).toBe("Mine");
    // Fresh hash saves, and a save with no hash (setup, seeds) still works.
    const fresh = sectionHash(hero(await admin.get()) as never);
    await admin.updateSection(HOME_SLUG, sec.id, { ...(sec.data as object), heading: "Again" }, { hash: fresh });
    await admin.updateSection(HOME_SLUG, sec.id, { ...(sec.data as object), heading: "No hash" });
    expect((hero(await admin.get()).data as { heading: string }).heading).toBe("No hash");
  });
});

describe("W2: pages, menu and footer", () => {
  it("renames an address with a redirect, fixes menu and links, collapses chains, never loops", async () => {
    const svc = new SiteService(a.as.admin);
    await svc.addPage({ slug: "fees", title: "Fees" });
    await svc.renamePage("fees", "fee-details");
    await svc.renamePage("fee-details", "school-fees");
    const row = await svc.get();
    expect(row.draft.pages.some((p) => p.slug === "school-fees")).toBe(true);
    expect(row.draft.nav.some((n) => n.slug === "school-fees")).toBe(true);
    const redirects = () => withSchool(a.id, (tx) => tx.select().from(siteRedirects));
    const r1 = await redirects();
    expect(r1.find((r) => r.fromPath === "/fees")).toMatchObject({ toPath: "/school-fees", automatic: true });
    expect(r1.find((r) => r.fromPath === "/fee-details")).toMatchObject({ toPath: "/school-fees", automatic: true });
    // Back to an old address: the redirect from it goes, nothing points at itself.
    await svc.renamePage("school-fees", "fees");
    const r2 = await redirects();
    expect(r2.some((r) => r.fromPath === "/fees")).toBe(false);
    expect(r2.filter((r) => r.fromPath === r.toPath)).toEqual([]);
    expect(r2.find((r) => r.fromPath === "/fee-details")?.toPath).toBe("/fees");
    await expect(svc.renamePage("fees", "about")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.renamePage(HOME_SLUG, "start")).rejects.toBeInstanceOf(ValidationError);
  });

  it("duplicates, hides and reorders sections, copies to a page, and puts a removed section back", async () => {
    const svc = new SiteService(a.as.admin);
    await svc.addPage({ slug: "play", title: "Play" });
    await svc.addSection("play", "rich_text");
    let row = await svc.addSection("play", "stats");
    const play = () => row.draft.pages.find((p) => p.slug === "play")!;
    const [t, st] = play().sections;
    row = await svc.duplicateSection("play", t!.id);
    expect(play().sections).toHaveLength(3);
    row = await svc.setSectionHidden("play", st!.id, true);
    expect(play().sections.find((s) => s.id === st!.id)!.hidden).toBe(true);
    row = await svc.moveSectionTo("play", st!.id, 0);
    expect(play().sections[0]!.id).toBe(st!.id);
    row = await svc.copySectionToPage("play", t!.id, "contact");
    expect(row.draft.pages.find((p) => p.slug === "contact")!.sections.at(-1)!.type).toBe("rich_text");
    const gone = play().sections[1]!;
    row = await svc.removeSection("play", gone.id);
    row = await svc.restoreSection("play", gone, 1);
    expect(play().sections[1]!.id).toBe(gone.id);
  });

  it("hides, no-indexes, copies and restores a page; edits the search image", async () => {
    const svc = new SiteService(a.as.admin);
    let row = await svc.duplicatePage("about");
    expect(row.draft.pages.find((p) => p.slug === "about-copy")!.hidden).toBe(true);
    await svc.setPageNoindex("about-copy", true);
    row = await svc.setPageHidden("about-copy", false);
    expect(row.draft.pages.find((p) => p.slug === "about-copy")).toMatchObject({ noindex: true });
    row = await svc.updatePage("about", { title: "About us", seoImageUrl: "https://x.test/share.png" });
    expect(row.draft.pages.find((p) => p.slug === "about")!.seo.imageUrl).toBe("https://x.test/share.png");
    await expect(svc.updatePage("about", { title: "About us", seoImageUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(ValidationError);
    const page = row.draft.pages.find((p) => p.slug === "about-copy")!;
    await svc.removePage("about-copy");
    row = await svc.restorePage(page);
    expect(row.draft.pages.some((p) => p.slug === "about-copy")).toBe(true);
  });

  it("builds the menu: reorder, nest, external link, rename, remove, at most eight at the top", async () => {
    const svc = new SiteService(a.as.admin);
    let row = await svc.get();
    // Earlier tests filled the menu: make room first.
    while (row.draft.nav.length > 5) row = await svc.removeNav([row.draft.nav.length - 1]);
    const n0 = row.draft.nav.length;
    row = await svc.addNav({ label: "Alumni", href: "https://alumni.example.org" });
    expect(row.draft.nav.at(-1)).toEqual({ label: "Alumni", href: "https://alumni.example.org" });
    row = await svc.nestNav(row.draft.nav.length - 1);
    expect(row.draft.nav).toHaveLength(Math.min(n0, 8));
    row = await svc.renameNav([0], "Start");
    expect(row.draft.nav[0]!.label).toBe("Start");
    row = await svc.moveNav([1], -1);
    expect(row.draft.nav[4]!.children).toEqual([{ label: "Alumni", href: "https://alumni.example.org" }]);
    row = await svc.removeNav([4, 0]);
    for (let i = row.draft.nav.length; i < 8; i++) await svc.addNav({ label: `Link ${i}`, href: "https://x.test" });
    await expect(svc.addNav({ label: "Ninth", href: "https://x.test" })).rejects.toThrow(/8 entries/);
    row = await svc.setFooter({ text: "Footer", links: [{ label: "Privacy", href: "/privacy" }] });
    expect(row.draft.footer).toEqual({ text: "Footer", links: [{ label: "Privacy", href: "/privacy" }] });
  });
});

describe("W3, W4: publishing, versions, approval", () => {
  it("every publish writes a version with its changes and name; restore keeps the current draft first; compare and preview work", async () => {
    const svc = new SiteService(b.as.admin);
    const v = new VersionService(b.as.admin);
    await svc.get();
    const first = await svc.publish({ note: "First" });
    expect(first.version).toBe(1);
    await svc.addPage({ slug: "fees", title: "Fees" });
    const second = await svc.publish();
    expect(second.version).toBe(2);
    const list = await v.list();
    expect(list.map((x) => x.number)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ live: true, kind: "publish" });
    expect(list[0]!.byName).toBe("admin bsa");
    expect(list[0]!.changes.join()).toContain("New: Fees");
    expect(list[1]!.name).toBe("First");
    await v.name(2, "With fees");
    expect((await v.get(2)).name).toBe("With fees");

    // Edit the draft, then bring version 1 back: the draft being replaced is kept first.
    await svc.updateFooter("Unsaved footer words");
    const r = await v.restore(1);
    expect(r.saved).toBe(3);
    const draft = await svc.get();
    expect(draft.draft.pages.some((p) => p.slug === "fees")).toBe(false);
    const kept = await v.get(3);
    expect(kept).toMatchObject({ kind: "before_restore" });
    expect(kept.content.footer.text).toBe("Unsaved footer words");
    expect(kept.content.pages.some((p) => p.slug === "fees")).toBe(true);
    // The live site is untouched by a restore.
    expect((await PublicSiteService.forSchool(b.id, FEATURES).published())!.content.pages.some((p) => p.slug === "fees")).toBe(true);
    await expect(v.restore(1)).rejects.toBeInstanceOf(ConflictError);

    const diff = await v.compare(1, 2);
    expect(diff.lines.join()).toContain("New: Fees");
    await expect(v.compare(1, 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(v.get(99)).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.previewContent({ version: 2 }))!.content.pages.some((p) => p.slug === "fees")).toBe(true);
    expect((await svc.previewContent())!.label).toBe("Draft");
    expect(await svc.previewContent({ version: 99 })).toBeNull();
  });

  it("a role that edits but may not publish: sees its draft, cannot publish, asks, and the publisher decides", async () => {
    const ed = new SiteService(editor(a));
    const admin = new SiteService(a.as.admin);
    // W4: preview of the draft works for manage without any admin role.
    expect((await ed.previewContent())!.label).toBe("Draft");
    await expect(ed.publish()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ed.schedule(new Date(Date.now() + 3_600_000))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ed.takeOffline("OFFLINE")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(admin.askToPublish()).rejects.toBeInstanceOf(ConflictError);

    const asked = await ed.askToPublish("New fees page");
    expect(asked.to).toEqual(["admin asa"]);
    const rows = await inbox(a, a.users.admin, "work.approval");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: true, doneAt: null, href: "/app/website" });
    expect(rows[0]!.body).toContain("New fees page");
    expect((await inbox(a, a.users.teacher, "work.approval"))).toHaveLength(0);

    // Send back with a reason: the row closes and the editor is told.
    await expect(admin.sendBack(" ")).rejects.toBeInstanceOf(ValidationError);
    await admin.sendBack("Fix the fee table first");
    expect((await inbox(a, a.users.admin, "work.approval"))[0]!.doneAt).not.toBeNull();
    const told = await inbox(a, a.users.teacher, "work.decision");
    expect(told[0]!.body).toContain("Fix the fee table first");
    await expect(admin.sendBack("again")).rejects.toBeInstanceOf(ConflictError);

    // Ask again, then publish: the request closes and the editor is told it is live.
    await ed.askToPublish();
    const pub = await admin.publish({ note: "Approved" });
    expect(pub.version).toBeGreaterThan(0);
    const row = await admin.get();
    expect(row.askedAt).toBeNull();
    expect((await inbox(a, a.users.admin, "work.approval")).every((r) => r.doneAt)).toBe(true);
    expect((await inbox(a, a.users.teacher, "work.decision")).length).toBe(2);
  });

  it("a custom role holding website:publish is asked too", async () => {
    const roleId = await withConsole(async (tx) => {
      const [r] = await tx.insert(schoolRoles).values({ schoolId: a.id, name: "Web approver", base: "staff", grants: ["website:read", "website:publish"] }).returning();
      await tx.update(users).set({ roleId: r!.id }).where(eq(users.id, a.users.accountant));
      return r!.id;
    });
    expect(roleId).toBeTruthy();
    await new SiteService(editor(a)).askToPublish("Please look");
    expect(await inbox(a, a.users.accountant, "work.approval")).toHaveLength(1);
    await new SiteService(editor(a)).withdrawAsk();
    expect((await inbox(a, a.users.accountant, "work.approval")).every((r) => r.doneAt)).toBe(true);
    // The settings page lists who may publish.
    expect((await new SiteSettingsService(a.as.admin).publishers()).sort()).toEqual(["accountant asa", "admin asa"]);
  });

  it("schedules a frozen copy, keeps later edits for the next publish, cancels, and the job publishes it", async () => {
    const svc = new SiteService(a.as.admin);
    await expect(svc.schedule(new Date(Date.now() - 1000))).rejects.toBeInstanceOf(ValidationError);
    await svc.updateFooter("Footer at schedule time");
    const at = new Date(Date.now() + 3_600_000);
    await svc.schedule(at);
    await svc.updateFooter("Footer edited after scheduling");
    let row = await svc.get();
    expect(row.scheduledFor?.getTime()).toBe(at.getTime());
    await svc.cancelSchedule();
    await expect(svc.cancelSchedule()).rejects.toBeInstanceOf(ConflictError);

    await svc.updateFooter("Frozen footer");
    await svc.schedule(at);
    await svc.updateFooter("Later footer");
    // Not yet due: the job does nothing.
    expect(await SiteService.publishDue(new Date())).toBe(0);
    const before = (await PublicSiteService.forSchool(a.id, FEATURES).published())?.content.footer.text;
    expect(before).not.toBe("Frozen footer");
    expect(await SiteService.publishDue(new Date(at.getTime() + 1000))).toBeGreaterThanOrEqual(1);
    expect((await PublicSiteService.forSchool(a.id, FEATURES).published())!.content.footer.text).toBe("Frozen footer");
    row = await svc.get();
    expect(row.scheduled).toBeNull();
    expect(row.draft.footer.text).toBe("Later footer");
    const last = (await new VersionService(a.as.admin).list())[0]!;
    expect(last.kind).toBe("schedule");
    expect(last.byName).toBe("admin asa");
    expect((await inbox(a, a.users.admin, "work.decision")).some((n) => n.title.includes("as scheduled"))).toBe(true);
  });

  it("checks before publishing: a deleted photo, a dead link and a missing headline stop it; warnings can be accepted", async () => {
    const svc = new SiteService(b.as.admin);
    const row = await svc.get();
    const h = hero(row);
    const missing = `/api/files/${b.id}/public/site/gone.png`;
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: missing, ctaHref: "/nowhere" });
    const c = await svc.checks();
    expect(c.blockers.join("\n")).toContain("was deleted");
    expect(c.blockers.join("\n")).toContain("/nowhere");
    await expect(svc.publish()).rejects.toBeInstanceOf(ValidationError);
    await svc.updateSection(HOME_SLUG, h.id, { ...(h.data as object), imageUrl: undefined, ctaHref: "/admissions" });
    await svc.setSectionHidden(HOME_SLUG, h.id, true);
    expect((await svc.checks()).blockers.join()).toContain("no headline");
    await svc.setSectionHidden(HOME_SLUG, h.id, false);
    const ok = await svc.checks();
    expect(ok.blockers).toEqual([]);
    expect(ok.warnings.length).toBeGreaterThan(0);
    await expect(svc.publish({ acceptWarnings: false })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.publish({ acceptWarnings: true })).resolves.toMatchObject({ warnings: expect.any(Array) });
  });

  it("offline needs the typed word and the publish right; bring back", async () => {
    const svc = new SiteService(a.as.admin);
    await expect(svc.takeOffline("nope")).rejects.toBeInstanceOf(ValidationError);
    await svc.takeOffline("offline");
    expect((await svc.get()).offlineAt).not.toBeNull();
    expect((await new InsightsService(a.as.admin).overview()).state).toBe("offline");
    await svc.bringBack();
    expect((await svc.get()).offlineAt).toBeNull();
  });
});

describe("W8: media", () => {
  it("stores photos and PDFs with sniffing, shows where they are used, replaces in place, and refuses to delete what the live site uses", async () => {
    const m = new MediaService(a.as.admin);
    await expect(m.uploadPhoto({ name: "x.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(ValidationError);
    await expect(m.uploadDocument({ name: "x.pdf", type: "application/pdf", bytes: PNG })).rejects.toBeInstanceOf(ValidationError);
    const photo = await m.uploadPhoto(png("Sports Day.png"), "Children running");
    const doc = await m.uploadDocument({ name: "Fire certificate.pdf", type: "application/pdf", bytes: PDF });
    expect(photo.url).toMatch(new RegExp(`^/api/files/${a.id}/public/site/`));
    expect(doc.kind).toBe("document");

    const svc = new SiteService(a.as.admin);
    const row = await svc.get();
    const g = row.draft.pages.flatMap((p) => p.sections).find((s) => s.type === "hero")!;
    await svc.updateSection(HOME_SLUG, g.id, { ...(g.data as object), imageUrl: photo.url });
    let item = (await m.list()).find((i) => i.id === photo.id)!;
    expect(item.alt).toBe("Children running");
    expect(item.places.map((p) => p.where)).toEqual(["draft"]);
    await svc.publish();
    item = (await m.list()).find((i) => i.id === photo.id)!;
    expect(item.places.map((p) => p.where).sort()).toEqual(["draft", "live"]);
    expect(item.places[0]!.label).toContain("Home");

    // Delete: refused while live uses it; the message names the place.
    const err = await m.remove(photo.url).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain("Home, Hero banner");
    // Replace in place: same address, new bytes, counter moves.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
    const replaced = await m.replace(photo.id, { name: "new.png", type: "image/png", bytes });
    expect(replaced.url).toBe(photo.url);
    expect(replaced.viewUrl).not.toBe(replaced.url);
    expect([...(await storage.get(photo.url.slice("/api/files/".length)))]).toEqual([...bytes]);
    await expect(m.replace(photo.id, { name: "x.pdf", type: "application/pdf", bytes: PDF })).rejects.toBeInstanceOf(ValidationError);
    // Take it off the page and publish: now it can go.
    await svc.updateSection(HOME_SLUG, g.id, { ...(g.data as object), imageUrl: undefined });
    await expect(m.remove(photo.url)).rejects.toBeInstanceOf(ConflictError);
    await svc.publish();
    await m.remove(photo.id);
    expect((await m.list()).some((i) => i.id === photo.id)).toBe(false);
    expect(storage.files.has(photo.url.slice("/api/files/".length))).toBe(false);
    expect((await m.setAlt(doc.id, "Fire NOC")).alt).toBe("Fire NOC");
    expect((await m.altOf([doc.url]))[doc.url]).toBe("Fire NOC");
  });

  it("fills its list from storage the first time, and drops rows whose file is gone", async () => {
    const key = `${b.id}/public/site/00000000-0000-4000-8000-000000000001-old-photo.jpg`;
    await storage.put(key, new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/jpeg");
    const m = new MediaService(b.as.admin);
    const items = await m.list();
    expect(items.find((i) => i.url === `/api/files/${key}`)).toMatchObject({ kind: "photo", fileName: "old-photo.jpg" });
    await storage.delete(key);
    expect((await m.list()).some((i) => i.url.endsWith("old-photo.jpg"))).toBe(false);
  });

  it("isolation: school B cannot see, change or delete A's files", async () => {
    const photo = await new MediaService(a.as.admin).uploadPhoto(png("private.png"));
    const mb = new MediaService(b.as.admin);
    expect((await mb.list()).some((i) => i.id === photo.id)).toBe(false);
    await expect(mb.setAlt(photo.id, "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(mb.remove(photo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(mb.remove(photo.url)).rejects.toBeInstanceOf(NotFoundError);
    expect(storage.files.has(photo.url.slice("/api/files/".length))).toBe(true);
    const rows = await withSchool(b.id, (tx) => tx.select().from(siteMedia));
    expect(rows.some((r) => r.id === photo.id)).toBe(false);
  });
});

describe("disclosure", () => {
  it("fills from the school profile, takes documents with an expiry, and puts a frozen copy on the draft with a footer link", async () => {
    await withConsole((tx) => tx.update(schools).set({ affiliationNo: "2130123", schoolCode: "45678", headName: "Dr Asha Menon", headQualification: "M.Ed", pincode: "560001", district: "Bengaluru Urban", board: "CBSE" }).where(eq(schools.id, a.id)));
    const d = new DisclosureService(a.as.admin);
    let v = await d.get();
    const general = v.parts[0]!.lines;
    expect(general.find((l) => l.row.key === "affiliation")).toMatchObject({ state: "filled", profileText: "2130123" });
    expect(general.find((l) => l.row.key === "head")!.profileText).toBe("Dr Asha Menon, M.Ed");
    expect(general.find((l) => l.row.key === "address")!.profileText).toContain("560001");
    expect(v.title).toBe("Mandatory public disclosure");
    expect(v.counts.missing).toBeGreaterThan(10);
    expect(v.onSite).toBeNull();

    await d.uploadDocument("fire_safety", { name: "fire.pdf", type: "application/pdf", bytes: PDF }, "2099-01-01");
    await expect(d.uploadDocument("fire_safety", { name: "x.png", type: "image/png", bytes: PNG })).rejects.toBeInstanceOf(ValidationError);
    await expect(d.uploadDocument("name", { name: "fire.pdf", type: "application/pdf", bytes: PDF })).rejects.toBeInstanceOf(ValidationError);
    await expect(d.setValue("name", { expiresOn: "2030-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(d.setValue("nope", { text: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(d.setValue("fire_safety", { url: `/api/files/${b.id}/public/site/x.pdf` })).rejects.toBeInstanceOf(ValidationError);
    await d.setValue("teachers", { text: "42" });
    await d.setValue("campus_area", { na: true });

    const put = await d.putOnSite();
    expect(put).toEqual({ slug: "disclosure", created: true });
    const site = await new SiteService(a.as.admin).get();
    const page = site.draft.pages.find((p) => p.slug === "disclosure")!;
    const sec = page.sections[0]!;
    expect(sec.type).toBe("disclosure");
    const frozen = (sec.data as { data: { values: Record<string, { text?: string }> } }).data.values;
    expect(frozen.affiliation!.text).toBe("2130123");
    expect(frozen.teachers!.text).toBe("42");
    expect(site.draft.footer.links.some((l) => l.href === "/disclosure")).toBe(true);
    // A second press updates the same page; no second footer link.
    await d.putOnSite();
    const again = await new SiteService(a.as.admin).get();
    expect(again.draft.pages.filter((p) => p.slug === "disclosure")).toHaveLength(1);
    expect(again.draft.footer.links.filter((l) => l.href === "/disclosure")).toHaveLength(1);
    // The copy is frozen: later changes show "changed since" until it is put on again.
    await d.setValue("teachers", { text: "50" });
    v = await d.get();
    expect(v.onSite).toMatchObject({ slug: "disclosure", live: false, changedSince: true });
    expect((((await new SiteService(a.as.admin).get()).draft.pages.find((p) => p.slug === "disclosure")!.sections[0]!.data) as { data: { values: Record<string, { text?: string }> } }).data.values.teachers!.text).toBe("42");
    expect(await new DisclosureService(a.as.admin).get().then((x) => x.onSite!.slug)).toBe("disclosure");
  });

  it("warns 30 days before and once expired, each only once, and starts over with a new date", async () => {
    const d = new DisclosureService(a.as.admin);
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await d.setValue("building_safety", { url: "https://x.test/b.pdf", expiresOn: day(10) });
    const mine = () => inbox(a, a.users.admin, "work.update");
    const before = (await mine()).length;
    expect(await DisclosureService.expiry()).toBeGreaterThanOrEqual(1);
    const rows = (await mine()).slice(before);
    expect(rows.some((r) => r.title.includes("Building safety certificate") && r.title.includes("expires in 10 days"))).toBe(true);
    expect(await DisclosureService.expiry()).toBe(0);
    // Passes: told once more.
    await d.setValue("building_safety", { url: "https://x.test/b.pdf", expiresOn: day(-1) });
    expect(await DisclosureService.expiry()).toBe(1);
    expect((await mine()).some((r) => r.title.includes("has expired"))).toBe(true);
    expect(await DisclosureService.expiry()).toBe(0);
    expect((await d.get()).counts.expired).toBe(1);
    const [row] = await withSchool(a.id, (tx) => tx.select({ warned: siteDisclosure.warned }).from(siteDisclosure));
    expect(Object.keys(row!.warned)).toEqual(["building_safety:expired"]);
  });

  it("isolation and permission", async () => {
    expect((await new DisclosureService(b.as.admin).get()).onSite).toBeNull();
    await expect(new DisclosureService(a.as.teacher).get()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DisclosureService(editor(a)).putOnSite()).resolves.toBeDefined();
    await expect(new DisclosureService({ ...a.as.admin, readOnly: true }).putOnSite()).rejects.toMatchObject({ code: "read_only" });
  });
});

describe("insights and overview", () => {
  it("counts visits by day, origin and page, enquiries and their share, for 30 and 90 days", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const ago = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    await withConsole(async (tx) => {
      await tx.insert(sitePageDays).values([
        { schoolId: a.id, day: today, path: "/", origin: "search", views: 10 }, { schoolId: a.id, day: today, path: "/admissions", origin: "direct", views: 5 },
        { schoolId: a.id, day: ago(45), path: "/", origin: "social", views: 7 }, { schoolId: a.id, day: ago(400), path: "/", origin: "other", views: 99 },
        { schoolId: b.id, day: today, path: "/", origin: "search", views: 1000 },
      ]);
      await tx.insert(enquiries).values({ schoolId: a.id, studentName: "Child", parentName: "Parent", phone: "9876500000", phoneKey: "9876500000", source: "website" });
    });
    const i = new InsightsService(a.as.admin);
    const m30 = await i.insights(30);
    expect(m30).toMatchObject({ views: 15, enquiries: 1, before: 7 });
    expect(m30.byDay).toHaveLength(30);
    expect(m30.byDay.at(-1)).toEqual({ day: today, views: 15 });
    expect(m30.top[0]).toEqual({ path: "/", title: "Home", views: 10, enquiries: 0 });
    expect(m30.origins).toEqual({ direct: 5, search: 10, social: 0, other: 0 });
    expect(m30.rate).toBeCloseTo(1 / 15);
    const m90 = await i.insights(90);
    expect(m90).toMatchObject({ views: 22, before: null });
    expect(m90.origins.social).toBe(7);
    await expect(i.insights(7 as never)).rejects.toBeInstanceOf(ValidationError);
    expect((await new InsightsService(b.as.admin).insights(30)).views).toBe(1000);
    const o = await i.overview();
    expect(o).toMatchObject({ views30: 15, enquiries30: 1, canPublish: true, canManage: true });
    expect(o.checklist.map((c) => c.key)).toContain("disclosure");
  });

  it("the poster is a PDF of the address", async () => {
    const pdf = await new InsightsService(a.as.admin).poster("https://greenvalley.example/");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    await expect(new InsightsService(a.as.admin).poster("javascript:alert(1)")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("site settings and redirects", () => {
  it("keeps the notice bar, buttons and teachers; a foreign teacher id is dropped", async () => {
    const s = new SiteSettingsService(a.as.admin);
    await s.update({ notice: { text: "School closed Monday", tone: "important", href: "/news" }, callNumber: "9876543210", indexed: false });
    expect((await s.get())).toMatchObject({ notice: { text: "School closed Monday", tone: "important" }, callNumber: "9876543210", indexed: false });
    await expect(s.update({ social: { facebook: "http://insecure" } })).rejects.toBeInstanceOf(ValidationError);
    await s.update({ notice: null });
    expect((await s.get()).notice).toBeUndefined();
    const teachers = await s.teachers();
    expect(teachers.map((t) => t.id)).toContain(a.users.teacher);
    await s.update({ hiddenStaff: [a.users.teacher, b.users.teacher, a.users.admin] });
    expect((await s.get()).hiddenStaff).toEqual([a.users.teacher]);
    expect((await s.get()).teachersChecked).toBe(true);
    expect((await s.teachers()).find((t) => t.id === a.users.teacher)!.hidden).toBe(true);
    await expect(new SiteSettingsService(a.as.teacher).update({ indexed: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new SiteSettingsService(b.as.admin).get()).hiddenStaff).toEqual([]);
  });

  it("adds, lists and removes redirects; refuses a live page, a system path, a loop; tidies chains", async () => {
    const s = new SiteSettingsService(a.as.admin);
    const r = await s.addRedirect({ from: "/old-admissions", to: "/admissions" });
    expect(r).toMatchObject({ fromPath: "/old-admissions", toPath: "/admissions", automatic: false });
    await expect(s.addRedirect({ from: "/about", to: "/contact" })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.addRedirect({ from: "/app/x", to: "/contact" })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.addRedirect({ from: "/same", to: "/same" })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.addRedirect({ from: "old", to: "/x" })).rejects.toBeInstanceOf(ValidationError);
    await s.addRedirect({ from: "/older", to: "/old-admissions" });
    expect((await s.redirects()).find((x) => x.fromPath === "/older")!.toPath).toBe("/admissions");
    await expect(s.addRedirect({ from: "/admissions-x", to: "/older" })).resolves.toMatchObject({ toPath: "/admissions" });
    await s.addRedirect({ from: "/loop-a", to: "/loop-b" });
    await expect(s.addRedirect({ from: "/loop-b", to: "/loop-a" })).rejects.toBeInstanceOf(ValidationError);
    await s.removeRedirect(r.id);
    await expect(s.removeRedirect(r.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new SiteSettingsService(b.as.admin).redirects()).some((x) => x.fromPath === "/older")).toBe(false);
  });
});

describe("isolation and permissions of the editor", () => {
  it("school B's draft, versions and schedule are its own; a teacher cannot read or edit", async () => {
    const sa = await new SiteService(a.as.admin).get();
    const sb = await new SiteService(b.as.admin).get();
    expect(sa.id).not.toBe(sb.id);
    expect((await new VersionService(b.as.admin).list()).every((x) => x.schoolId === b.id)).toBe(true);
    const vs = await withSchool(b.id, (tx) => tx.select().from(siteVersions));
    expect(vs.every((x) => x.schoolId === b.id)).toBe(true);
    await expect(new SiteService(a.as.teacher).get()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SiteService(a.as.teacher).previewContent()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SiteService(a.as.teacher).updateSection(HOME_SLUG, "x", {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new VersionService(a.as.teacher).restore(1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new MediaService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    const ro = new SiteService({ ...a.as.admin, readOnly: true });
    await expect(ro.updateFooter("x")).rejects.toMatchObject({ code: "read_only" });
    await expect(ro.schedule(new Date(Date.now() + 3_600_000))).rejects.toMatchObject({ code: "read_only" });
    const stored = await withSchool(a.id, (tx) => tx.select({ id: schoolSites.id }).from(schoolSites));
    expect(stored).toHaveLength(1);
  });
});

describe("notes on who changed what, and who may see the rooms", () => {
  it("names the person who last changed THAT section, though someone else saved another section after", async () => {
    const admin = new SiteService(a.as.admin);
    const row = await admin.get();
    const sections = row.draft.pages.find((p) => p.slug === "about")!.sections;
    const [s0, s1] = sections;
    const opened = sectionHash(s0 as never);
    await new SiteService(editor(a)).updateSection("about", s0!.id, { ...(s0!.data as object), heading: "By the editor" });
    // The admin then saves a different section: the draft's last writer is now the admin.
    await admin.setSectionHidden("about", s1!.id, true);
    await admin.setSectionHidden("about", s1!.id, false);
    const err = await admin.updateSection("about", s0!.id, { ...(s0!.data as object), heading: "Mine" }, { hash: opened }).catch((e) => e);
    expect(err).toBeInstanceOf(SectionChangedError);
    expect(err.by).toBe("teacher asa");
    expect(err.message).toContain("teacher asa");
    const page = (await admin.get()).draft.pages.find((p) => p.slug === "about")!;
    expect(page.sections[0]).toMatchObject({ by: "teacher asa" });
    expect(page.sections[1]).toMatchObject({ by: "admin asa" });
  });

  it("the live copy and the public payload carry no notes, and notes are not an unpublished change", async () => {
    const admin = new SiteService(a.as.admin);
    await admin.updateFooter("Notes check");
    const before = await admin.get();
    expect(JSON.stringify(before.draft)).toMatch(/"by"/);
    await admin.publish();
    const after = await admin.get();
    expect(JSON.stringify(after.published)).not.toMatch(/"by"/);
    // Only one day per page stays on the live copy (for the sitemap), never a section note.
    expect(after.published!.pages.every((p) => p.sections.every((x) => !("at" in x) && !("by" in x)))).toBe(true);
    expect(SiteService.hasUnpublishedChanges(after)).toBe(false);
    expect(SiteService.changes(after).lines).toEqual([]);
    const live = await PublicSiteService.forSchool(a.id, FEATURES).published();
    expect(JSON.stringify(live!.content)).not.toMatch(/"by"/);
    const [v] = await new VersionService(a.as.admin).list();
    expect(JSON.stringify((await new VersionService(a.as.admin).get(v!.number)).content)).not.toMatch(/"by"/);
  });

  it("edit, publish or read alone is enough to see the Website screens; none of them means no", async () => {
    for (const grant of ["website:read", "website:manage", "website:publish"]) {
      const ctx = { ...a.as.teacher, grants: new Set([grant]) };
      const site = new SiteService(ctx);
      expect(site.canSee()).toBe(true);
      await expect(site.get()).resolves.toBeDefined();
      await expect(site.previewContent()).resolves.toMatchObject({ label: "Draft" });
      await expect(new MediaService(ctx).list()).resolves.toBeDefined();
      await expect(new VersionService(ctx).list()).resolves.toBeDefined();
      await expect(new DisclosureService(ctx).get()).resolves.toBeDefined();
      await expect(new SiteSettingsService(ctx).get()).resolves.toBeDefined();
      await expect(new InsightsService(ctx).overview()).resolves.toBeDefined();
    }
    const none = { ...a.as.teacher, grants: new Set(["students:read"]) };
    expect(new SiteService(none).canSee()).toBe(false);
    await expect(new SiteService(none).get()).rejects.toBeInstanceOf(ForbiddenError);
    const { default: feature } = await import("./feature");
    const item = feature.menu!.find((m) => m.href === "/app/website")!;
    expect(item.also).toEqual(expect.arrayContaining(["manage", "publish"]));
  });

  it("the public service no longer takes enquiries (they go through PublicEnquiryService)", () => {
    expect((PublicSiteService.prototype as unknown as Record<string, unknown>).submitEnquiry).toBeUndefined();
    expect((PublicSiteService as unknown as Record<string, unknown>).limiter).toBeUndefined();
  });

  it("describes photos from the Media list for the public page", async () => {
    const m = new MediaService(a.as.admin);
    const p = await m.uploadPhoto(png("kids.png"), "Children in class");
    const page = { slug: "x", title: "X", seo: {}, sections: [{ id: "g1", type: "gallery" as const, data: { images: [{ url: p.url }, { url: `/api/files/${b.id}/public/site/other.png` }] } }] };
    const alt = await PublicSiteService.forSchool(a.id, FEATURES).altFor(page as never, []);
    expect(alt).toEqual({ [p.url]: "Children in class" });
  });

  it("a school that is not CBSE calls it School information in the panel, the page and the footer link", async () => {
    await withConsole((tx) => tx.update(schools).set({ board: "ICSE" }).where(eq(schools.id, a.id)));
    const d = new DisclosureService(a.as.admin);
    expect((await d.get()).title).toBe("School information");
    await d.putOnSite();
    const site = await new SiteService(a.as.admin).get();
    const page = site.draft.pages.find((p) => p.slug === "disclosure")!;
    expect(page.title).toBe("School information");
    expect(site.draft.footer.links.find((l) => l.href === "/disclosure")!.label).toBe("School information");
    expect((page.sections[0]!.data as { heading: string }).heading).toBe("School information");
    expect((await new InsightsService(a.as.admin).overview()).checklist.find((c) => c.key === "disclosure")!.label).toContain("School information");
    // Back to CBSE: the same page and link are renamed, not doubled.
    await withConsole((tx) => tx.update(schools).set({ board: "CBSE" }).where(eq(schools.id, a.id)));
    await d.putOnSite();
    const again = (await new SiteService(a.as.admin).get()).draft;
    expect(again.pages.find((p) => p.slug === "disclosure")!.title).toBe("Mandatory public disclosure");
    expect(again.footer.links.filter((l) => l.href === "/disclosure")).toHaveLength(1);
  });

  it("footer columns are saved, kept when only the words change, and cleared when asked", async () => {
    const svc = new SiteService(a.as.admin);
    let row = await svc.setFooter({ text: "T", links: [], columns: [{ title: "Admissions", links: [{ label: "Fees", href: "/fees" }] }] });
    expect(row.draft.footer.columns).toHaveLength(1);
    row = await svc.updateFooter("Only words");
    expect(row.draft.footer.columns).toHaveLength(1);
    row = await svc.setFooter({ text: "T", links: [], columns: [] });
    expect(row.draft.footer.columns).toBeUndefined();
    await expect(svc.setFooter({ links: [], columns: Array.from({ length: 5 }, () => ({ title: "x", links: [] })) })).rejects.toBeInstanceOf(Error);
  });
});
