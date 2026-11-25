import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, eq, plans, schools, withConsole, withSchool } from "@smw/db";
import { announcements } from "@smw/feature-announcements/schema";
import { AppError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { NoticeService } from "@smw/feature-announcements/service";
import { PRESETS } from "@smw/themes";
import seed from "./seed";
import { EnquiryService, PublicSiteService, SiteService, ThemeService, studentLink } from "./service";

const FEATURES = ["announcements", "events", "website"];
let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => { ({ a, b } = await createSchoolPair(FEATURES)); useServices({ storage }); });
afterAll(closeDb);
beforeEach(() => PublicSiteService.limiter.reset(`${a.id}:1.2.3.4`));

const setPlan = (s: TestSchool, limits: Record<string, number | boolean>) => withConsole(async (tx) => {
  const [p] = await tx.insert(plans).values({ key: `p-${Math.random().toString(36).slice(2, 8)}`, name: "T", studentCap: 100, priceAnnualPaise: 0, priceMonthlyPaise: 0, limits }).returning();
  await tx.update(schools).set({ planId: p!.id }).where(eq(schools.id, s.id));
});

describe("SiteService", () => {
  it("creates the default site on first sight, with stable section ids", async () => {
    const svc = new SiteService(a.as.admin);
    const first = await svc.get();
    expect(first.draft.pages.map((p) => p.slug)).toEqual(["home", "about", "academics", "admissions", "contact"]);
    expect(first.id).not.toBe("");
    expect((await svc.get()).draft.pages[0]!.sections[0]!.id).toBe(first.draft.pages[0]!.sections[0]!.id);
    await svc.setTemplate("modern");
    expect((await svc.get()).templateKey).toBe("modern");
  });

  it("a read-only school sees the default site without saving it", async () => {
    const ro = new SiteService({ ...b.as.admin, readOnly: true });
    const row = await ro.get();
    expect(row.id).toBe("");
    expect(row.draft.pages).toHaveLength(5);
    await expect(ro.publish()).rejects.toMatchObject({ code: "read_only" });
  });

  it("blocks reserved and duplicate page addresses", async () => {
    const svc = new SiteService(a.as.admin);
    for (const slug of ["app", "login", "api", "_next", "support-login", "reset-password", "verify-email"]) {
      await expect(svc.addPage({ slug, title: "X" })).rejects.toMatchObject({ fieldErrors: { slug: expect.any(String) } });
    }
    await expect(svc.addPage({ slug: "about", title: "Again" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addPage({ slug: "Bad Slug!", title: "X" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.removePage("home")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.removePage("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("adds a page with its nav entry, then sections can be added, moved, edited and removed", async () => {
    const svc = new SiteService(a.as.admin);
    await svc.addPage({ slug: "fees", title: "Fees" });
    let row = await svc.addSection("fees", "rich_text");
    const page = () => row.draft.pages.find((p) => p.slug === "fees")!;
    expect(row.draft.nav.some((n) => n.slug === "fees")).toBe(true);
    row = await svc.addSection("fees", "stats");
    const [first, second] = page().sections;
    row = await svc.moveSection("fees", second!.id, "up");
    expect(page().sections[0]!.id).toBe(second!.id);
    row = await svc.updateSection("fees", first!.id, { heading: "Fee structure", body: "Paid in three installments." });
    expect((page().sections.find((s) => s.id === first!.id)!.data as { heading: string }).heading).toBe("Fee structure");
    await expect(svc.updateSection("fees", first!.id, { body: "" })).rejects.toMatchObject({ fieldErrors: { body: expect.any(String) } });
    row = await svc.removeSection("fees", first!.id);
    expect(page().sections).toHaveLength(1);
    row = await svc.removePage("fees");
    expect(row.draft.nav.some((n) => n.slug === "fees")).toBe(false);
  });

  it("publish copies the draft; later edits stay in the draft until published again", async () => {
    const svc = new SiteService(a.as.admin);
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    expect(await pub.published()).toBeNull();
    expect(SiteService.changes(await svc.get()).first).toBe(true);
    const r = await svc.publish();
    expect(r.paths).toContain("/");
    expect(r.paths).toContain("/about");
    const live = await pub.published();
    expect(live?.templateKey).toBe("modern");
    expect(live?.content.pages).toHaveLength((await svc.get()).draft.pages.length);
    expect(SiteService.changes(await svc.get())).toEqual({ first: false, lines: [] });
    await svc.updateFooter("New footer");
    expect((await pub.published())?.content.footer.text).not.toBe("New footer");
    expect(SiteService.hasUnpublishedChanges(await svc.get())).toBe(true);
    expect(SiteService.changes(await svc.get()).lines).toEqual(["Menu or footer changed"]);
    await svc.publish();
    expect((await pub.published())?.content.footer.text).toBe("New footer");
    expect(SiteService.hasUnpublishedChanges(await svc.get())).toBe(false);
  });

  it("rejects an invalid template and enforces the plan's page limit", async () => {
    const svc = new SiteService(b.as.admin);
    await expect(svc.setTemplate("fancy")).rejects.toBeInstanceOf(ValidationError);
    await setPlan(b, { websitePages: 6 });
    await svc.addPage({ slug: "fees", title: "Fees" });
    await expect(svc.addPage({ slug: "sports", title: "Sports" })).rejects.toBeInstanceOf(LimitError);
  });

  it("adds a page from a template, with its sections and title", async () => {
    const svc = new SiteService(a.as.admin);
    const row = await svc.addPage({ template: "gallery" });
    const page = row.draft.pages.at(-1)!;
    expect(page.slug).toBe("gallery");
    expect(page.title).toBeTruthy();
    expect(page.sections.length).toBeGreaterThan(0);
    await svc.removePage("gallery");
  });

  it("stores an uploaded photo under the school's site folder and returns a /api/files url", async () => {
    const svc = new SiteService(a.as.admin);
    const { url } = await svc.uploadPhoto({ name: "Sports Day.PNG", type: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) });
    expect(url).toMatch(/^\/api\/files\/.+\/public\/site\/.+\.png$/);
    const key = url.replace("/api/files/", "");
    expect(key.startsWith(`${a.id}/public/site/`)).toBe(true);
    expect(storage.files.has(key)).toBe(true);
    expect((await svc.photos()).map((p) => p.url)).toContain(url);
  });

  it("refuses a photo that is not an image", async () => {
    const err = await new SiteService(a.as.admin).uploadPhoto({ name: "notes.txt", type: "text/plain", bytes: new Uint8Array([1]) }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors.photo).toBeDefined();
  });

  it("removes one of its own photos and refuses another school's", async () => {
    const svc = new SiteService(a.as.admin);
    const { url } = await svc.uploadPhoto({ name: "bus.jpg", type: "image/jpeg", bytes: new Uint8Array([255, 216]) });
    const key = url.replace("/api/files/", "");
    const other = `/api/files/${b.id}/public/site/x.png`;
    await expect(svc.removePhoto(other)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.removePhoto(`/api/files/${a.id}/public/site/../../${b.id}/x.png`)).rejects.toBeInstanceOf(NotFoundError);
    await svc.removePhoto(url);
    expect(storage.files.has(key)).toBe(false);
    expect((await svc.photos()).map((p) => p.url)).not.toContain(url);
  });

  it("only admins edit; others are refused", async () => {
    await expect(new SiteService(a.as.teacher).publish()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SiteService(a.as.accountant).get()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: each school has its own site", async () => {
    const aDraft = (await new SiteService(a.as.admin).get()).draft;
    const bSvc = new SiteService(b.as.admin);
    await bSvc.updateFooter("School B footer");
    expect((await new SiteService(a.as.admin).get()).draft.footer.text).not.toBe("School B footer");
    expect(aDraft.footer.text).not.toBe("School B footer");
    expect(await PublicSiteService.forSchool(b.id, FEATURES).published()).toBeNull();
  });
});

describe("PublicSiteService", () => {
  it("shows public news only, teachers by name, and nothing when the module is off", async () => {
    const everyone = { include: [{ type: "everyone" }], exclude: [] };
    // Without the fan-out job (this package has no academics tables for it to read): send, then mark as published by hand.
    const publish = async (input: Record<string, unknown>) => {
      const n = new NoticeService(a.as.admin);
      await n.publish((await n.saveDraft({ type: "notice", ...input })).id, { confirmed: true });
      await withSchool(a.id, (tx) => tx.update(announcements).set({ state: "published" }).where(eq(announcements.state, "sending")));
    };
    await publish({ title: "Open day", body: "Come see us", audience: everyone, website: true });
    await publish({ title: "Not on the website", body: "x", audience: everyone });
    await expect(publish({ title: "Staff only", body: "x", audience: { include: [{ type: "staff" }], exclude: [] }, website: true })).rejects.toBeInstanceOf(ValidationError);
    await publish({ title: "Staff only", body: "x", audience: { include: [{ type: "staff" }], exclude: [] } });
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    const titles = (await pub.news()).map((n) => n.title);
    expect(titles).toEqual(["Open day"]);
    expect((await pub.staff()).map((s) => s.name)).toContain("teacher a");
    expect(await pub.events()).toEqual([]);
    expect(await PublicSiteService.forSchool(a.id, ["announcements"]).published()).toBeNull();
  });

  it("records an enquiry without a login", async () => {
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    await pub.submitEnquiry({ studentName: "Riya Sharma", parentName: "Sunita Sharma", phone: "9876543210", classApplying: "Class 3", dob: "2018-05-02" }, { ip: "1.2.3.4" });
    const list = await new EnquiryService(a.as.admin).list({ q: "Riya" });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ status: "new", source: "website", classApplying: "Class 3" });
    await expect(pub.submitEnquiry({ studentName: "R", parentName: "S", phone: "123" }, { ip: "1.2.3.4" })).rejects.toMatchObject({ fieldErrors: { phone: expect.any(String) } });
  });

  it("a filled honeypot is accepted but stores nothing", async () => {
    const before = (await new EnquiryService(a.as.admin).list()).total;
    const r = await PublicSiteService.forSchool(a.id, FEATURES).submitEnquiry({ studentName: "Bot Kid", parentName: "Bot Parent", phone: "9876543211", website: "http://spam.example" }, { ip: "1.2.3.4" });
    expect(r).toEqual({ received: true });
    expect((await new EnquiryService(a.as.admin).list()).total).toBe(before);
  });

  it("rate limits one visitor after 8 enquiries an hour", async () => {
    const pub = PublicSiteService.forSchool(a.id, FEATURES);
    const send = () => pub.submitEnquiry({ studentName: "Kid Name", parentName: "Parent Name", phone: "9876543212" }, { ip: "1.2.3.4" });
    for (let i = 0; i < 8; i++) await send();
    const err = await send().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(429);
    await expect(pub.submitEnquiry({ studentName: "Kid Name", parentName: "Parent Name", phone: "9876543212" }, { ip: "5.6.7.8" })).resolves.toEqual({ received: true });
  });
});

describe("EnquiryService", () => {
  it("moves an enquiry through the pipeline, filters by status and clears notes", async () => {
    const svc = new EnquiryService(a.as.accountant);
    const e = await svc.create({ studentName: "Aman Verma", parentName: "Raj Verma", phone: "9811111111", source: "phone" });
    await svc.update(e.id, { status: "contacted", notes: "Call back Friday" });
    expect((await svc.get(e.id)).notes).toBe("Call back Friday");
    expect((await svc.list({ filters: { status: "contacted" } })).rows.map((r) => r.id)).toContain(e.id);
    expect((await svc.list({ filters: { status: "closed" } })).rows.map((r) => r.id)).not.toContain(e.id);
    await svc.update(e.id, { status: "visited" });
    expect((await svc.get(e.id)).notes).toBeNull();
    expect((await svc.counts()).visited).toBeGreaterThanOrEqual(1);
    await expect(svc.update(e.id, { status: "bogus" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("builds the convert-to-student link", async () => {
    const svc = new EnquiryService(a.as.admin);
    const e = await svc.create({ studentName: "Meera Nair", parentName: "Anil Nair", phone: "9822222222", classApplying: "Class 1", dob: "2019-01-09" });
    const link = await svc.convertLink(e.id);
    expect(link).toMatch(/^\/app\/students\?new=1&name=Meera\+Nair/);
    expect(studentLink(e)).toBe(link);
    expect(link).toContain("dob=2019-01-09");
  });

  it("teachers cannot see enquiries", async () => {
    await expect(new EnquiryService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B cannot see or change A's enquiries", async () => {
    const x = await new EnquiryService(a.as.admin).create({ studentName: "Only In A", parentName: "Parent A", phone: "9833333333" });
    const bSvc = new EnquiryService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === x.id)).toBe(false);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(x.id, { status: "closed" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ThemeService", () => {
  it("saves a valid preset and reads it back", async () => {
    const svc = new ThemeService(a.as.admin);
    await svc.applyPreset("forest");
    const got = await svc.get();
    expect(got.theme.preset).toBe("forest");
    expect(got.limited).toBe(false);
  });

  it("blocks colours that fail the contrast check and lists the failing pairs", async () => {
    const svc = new ThemeService(a.as.admin);
    const bad = { ...PRESETS.ocean!, colors: { ...PRESETS.ocean!.colors, text: "#CCCCCC", primary: "#FFFF99" } };
    const err = await svc.save(bad).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors["Text on background"]).toBeDefined();
    expect(err.fieldErrors["White on primary (buttons)"]).toBeDefined();
    expect((await svc.get()).theme.preset).toBe("forest");
  });

  it("accepts the flat form shape and rejects a bad colour by field name", async () => {
    const svc = new ThemeService(a.as.admin);
    const flat = { preset: "ocean", radius: "lg", font: "Poppins", ...PRESETS.ocean!.colors };
    expect((await svc.save(flat)).radius).toBe("lg");
    await expect(svc.save({ ...flat, primary: "blue" })).rejects.toMatchObject({ fieldErrors: { primary: expect.any(String) } });
  });

  it("plan without the full editor: only the logo and primary colour may change", async () => {
    await setPlan(b, { fullThemeEditor: false });
    const svc = new ThemeService(b.as.admin);
    expect((await svc.get()).limited).toBe(true);
    const base = (await svc.get()).theme;
    const saved = await svc.save({ ...base, logoUrl: "https://cdn.example.com/logo.png", colors: { ...base.colors, primary: "#0B5FFF" } });
    expect(saved.colors.primary).toBe("#0B5FFF");
    expect(saved.logoUrl).toBe("https://cdn.example.com/logo.png");
    await expect(svc.save({ ...saved, font: "Nunito" })).rejects.toBeInstanceOf(LimitError);
    await expect(svc.save({ ...saved, radius: "lg" })).rejects.toBeInstanceOf(LimitError);
    await expect(svc.save({ ...saved, colors: { ...saved.colors, accent: "#111111" } })).rejects.toBeInstanceOf(LimitError);
  });

  it("only admins change the theme", async () => {
    await expect(new ThemeService(a.as.teacher).save(PRESETS.ocean)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("seed", () => {
  it("publishes a themed site and six enquiries across the pipeline", async () => {
    const { a: s } = await createSchoolPair(FEATURES, "seed");
    await seed(s.as.admin, { slug: "sunrise" });
    const live = await PublicSiteService.forSchool(s.id, FEATURES).published();
    expect(live?.templateKey).toBe("modern");
    expect(live?.content.pages[0]!.sections[0]!.type).toBe("hero");
    expect((await new ThemeService(s.as.admin).get()).theme.preset).toBe("maroon");
    const e = new EnquiryService(s.as.admin);
    expect((await e.list()).total).toBe(6);
    expect(await e.counts()).toEqual({ new: 2, contacted: 1, visited: 1, admitted: 1, closed: 1 });
  });
});
