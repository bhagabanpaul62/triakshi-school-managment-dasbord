import { and, eq, max, sql } from "drizzle-orm";
import { withConsole, type Tx } from "@smw/db";
import { AppError, ConflictError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { services } from "@smw/integrations";
import {
  DISCLOSURE_ROWS, HOME_SLUG, PAGE_TEMPLATES, SECTION_DATA, SiteContentError, TEMPLATE_KEYS, addNavEntry, addPage, addSection, brokenLinks, buildPage, copySectionToPage,
  disclosureState, duplicatePage, duplicateSection, fileRefs, mergeRedirects, moveNavItem, moveSection, moveSectionTo, nestNavItem, removeNavItem, removePage, removeSection,
  renameNavItem, renamePage, restorePage, restoreSection, sectionHash, setFooterContent, setPageFlags, setSectionHidden, siteChanges, siteContentSchema, sitePaths, stableJson,
  stampChanges, siteSettingsOf, starterSite, stripMeta, unnestNavItem, updatePage, updateSection, type Section, type SectionType, type SiteContent, type TemplateKey,
} from "@smw/site-templates";
import { jobSchools } from "./job-schools";
import { istToday, keyOfUrl, WebsiteService, type SiteRow } from "./base";
import { addressInput, pageInput, pageUpdateInput } from "./inputs";
import { MediaService, type UploadFile } from "./media-service";
import { schoolSites, siteDisclosure, siteRedirects, siteVersions } from "./schema";

/** Subject of the "please approve" rows, so they close together when the site is published or sent back. */
const ASK = "website-publish";
/** A scheduled publish may be set this far ahead. */
const SCHEDULE_DAYS = 366;

const siteError = (e: unknown): unknown => {
  if (!(e instanceof SiteContentError)) return e;
  if (e.code === "missing") return new NotFoundError("Page or section");
  if (e.code === "limit") return new LimitError(e.message);
  return new ValidationError(e.fieldErrors ?? { _: e.message }, e.message);
};

const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "a moment ago");

/** Somebody saved this section after you opened it. Carries their version so the editor can offer "keep mine" or "take theirs". */
export class SectionChangedError extends ConflictError {
  constructor(readonly by: string | null, readonly at: Date | null, readonly theirs: Section, readonly theirsHash: string, mine: boolean) {
    super(`${mine ? "You" : by ?? "Someone"} changed this section at ${when(at)}, after you opened it. Your changes were not saved.`);
  }
}

export interface PublishChecks { blockers: string[]; warnings: string[] }
interface Env { tx: Tx; row: SiteRow; maxPages?: number }
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** The website editor: a draft per school, edited section by section, published on demand. */
export class SiteService extends WebsiteService {
  /** The site row. A school that never opened the editor gets the default site (a read-only caller sees it unsaved). */
  async get(): Promise<SiteRow> {
    // Saved on first sight, so the section ids the editor shows are the ones later edits refer to.
    if (this.can("manage") && !this.ctx.readOnly) return this.write("manage", (tx) => this.siteRow(tx, { create: true }));
    return this.read(this.sees(), (tx) => this.siteRow(tx, { create: false }));
  }

  /**
   * Apply one pure edit to the draft and save it. The row is locked first, so a second person saving at the same time reads
   * what the first one wrote instead of overwriting it with a stale copy (W1).
   */
  private async edit(summary: string, fn: (c: SiteContent, env: Env) => SiteContent | Promise<SiteContent>, after?: (tx: Tx, saved: SiteRow, was: SiteContent) => Promise<void>): Promise<SiteRow> {
    return this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const limits = await this.planLimits(tx, (await this.schoolRow(tx)).planId);
      let draft: SiteContent;
      try { draft = await fn(row.draft, { tx, row, maxPages: typeof limits.websitePages === "number" ? limits.websitePages : undefined }); } catch (e) { throw siteError(e); }
      draft = stampChanges(row.draft, draft, this.ctx.name, new Date().toISOString());
      const [saved] = await tx.update(schoolSites).set({ draft, draftAt: new Date(), draftBy: this.ctx.userId }).where(eq(schoolSites.id, row.id)).returning();
      await after?.(tx, saved!, row.draft);
      return saved!;
    }, () => ({ action: "edit", entity: "Website", summary }));
  }

  /**
   * Change the design. `starter: true` also replaces the draft with that design's sample site (the live site stays
   * until publish); `"untouched"` does so only while the draft is still the sample nobody has edited (the setup wizard).
   */
  async setTemplate(key: unknown, opts: { starter?: boolean | "untouched" } = {}): Promise<SiteRow> {
    if (!TEMPLATE_KEYS.includes(key as TemplateKey)) throw new ValidationError({ template: "Pick one of the templates" });
    const templateKey = key as TemplateKey;
    return this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const school = await this.schoolRow(tx);
      // Section ids are random, so "untouched" compares everything but them.
      const bare = (c: SiteContent) => JSON.stringify(c, (k, v) => (k === "id" ? undefined : v));
      const fresh = opts.starter === true || (opts.starter === "untouched" && bare(row.draft) === bare(starterSite(row.templateKey, school)));
      const [saved] = await tx.update(schoolSites).set({ templateKey, draftAt: new Date(), draftBy: this.ctx.userId, ...(fresh ? { draft: starterSite(templateKey, school) } : {}) }).where(eq(schoolSites.id, row.id)).returning();
      return saved!;
    }, () => ({ action: "edit", entity: "Website", summary: `Changed website template to ${templateKey}${opts.starter === true ? " and replaced the draft with its sample pages" : ""}` }));
  }

  // ---------- pages ----------

  async addPage(input: unknown) {
    const p = this.parse(pageInput, input);
    const t = PAGE_TEMPLATES[p.template];
    const slug = p.slug || t.slug;
    const title = p.title || t.title;
    const school = await this.read(this.sees(), (tx) => this.schoolRow(tx));
    const page = buildPage(p.template, school, { slug, title });
    return this.edit(`Added page ${title}`, (c, { maxPages }) => addPage(c, { slug, title, page }, maxPages));
  }
  removePage(slug: string) { return this.edit(`Removed page ${slug}`, (c) => removePage(c, slug)); }
  async updatePage(slug: string, input: unknown) {
    const p = this.parse(pageUpdateInput, input);
    return this.edit(`Updated page ${slug}`, (c) => updatePage(c, slug, p));
  }
  /** Put a page back after "remove" (the 30 second undo). The page arrives as the person's browser held it; the schema checks it again. */
  restorePage(page: unknown) { return this.edit("Put a removed page back", (c, { maxPages }) => restorePage(c, page, maxPages)); }
  duplicatePage(slug: string, input: unknown = {}) {
    const p = this.parse(addressInput, input);
    return this.edit(`Copied page ${slug}`, (c, { maxPages }) => duplicatePage(c, slug, p, maxPages));
  }
  setPageHidden(slug: string, hidden: boolean) { return this.edit(`${hidden ? "Hid" : "Showed"} page ${slug}`, (c) => setPageFlags(c, slug, { hidden })); }
  setPageNoindex(slug: string, noindex: boolean) { return this.edit(`Asked search engines ${noindex ? "not to list" : "to list"} page ${slug}`, (c) => setPageFlags(c, slug, { noindex })); }

  /**
   * Give a page a new address (W2). The old address leads to the new one for ever (a redirect row), menu entries and links
   * inside the site follow, chains collapse (a to b, then b to c: a now leads to c), and a loop cannot be made.
   */
  renamePage(slug: string, to: string) {
    const m = this.parse(addressInput, { slug: to });
    let r!: ReturnType<typeof renamePage>;
    return this.edit(`Changed the address of ${slug} to ${m.slug}`, (c) => { r = renamePage(c, slug, m.slug ?? ""); return r.content; }, async (tx) => {
      if (r.from === r.to) return;
      const rows = await tx.select({ from: siteRedirects.fromPath, to: siteRedirects.toPath, automatic: siteRedirects.automatic }).from(siteRedirects);
      const next = mergeRedirects(rows.map((x) => ({ from: x.from, to: x.to })), { from: r.from, to: r.to });
      const auto = new Set(rows.filter((x) => x.automatic).map((x) => x.from));
      await tx.delete(siteRedirects).where(sql`true`);
      if (next.length) await tx.insert(siteRedirects).values(next.map((x) => ({ schoolId: this.ctx.schoolId, fromPath: x.from, toPath: x.to, automatic: auto.has(x.from) || x.from === r.from })));
    });
  }

  // ---------- sections ----------

  async addSection(slug: string, type: string) {
    if (!(type in SECTION_DATA)) throw new ValidationError({ type: "Pick a section type" });
    return this.edit(`Added a ${type.replace("_", " ")} section to ${slug}`, (c) => addSection(c, slug, type as SectionType));
  }
  removeSection(slug: string, id: string) { return this.edit(`Removed a section from ${slug}`, (c) => removeSection(c, slug, id)); }
  moveSection(slug: string, id: string, dir: "up" | "down") { return this.edit(`Moved a section on ${slug}`, (c) => moveSection(c, slug, id, dir)); }
  moveSectionTo(slug: string, id: string, index: number) { return this.edit(`Moved a section on ${slug}`, (c) => moveSectionTo(c, slug, id, index)); }
  duplicateSection(slug: string, id: string) { return this.edit(`Copied a section on ${slug}`, (c) => duplicateSection(c, slug, id)); }
  setSectionHidden(slug: string, id: string, hidden: boolean) { return this.edit(`${hidden ? "Hid" : "Showed"} a section on ${slug}`, (c) => setSectionHidden(c, slug, id, hidden)); }
  copySectionToPage(slug: string, id: string, toSlug: string) { return this.edit(`Copied a section from ${slug} to ${toSlug}`, (c) => copySectionToPage(c, slug, id, toSlug)); }
  /** Put a section back after "remove" (the undo toast). */
  restoreSection(slug: string, section: unknown, index: number) { return this.edit(`Put a removed section back on ${slug}`, (c) => restoreSection(c, slug, section, index)); }

  /**
   * `data` is the section's own data (already decoded from the form; the section schema validates it).
   * `opts.hash` is the hash of the section as the person opened it: when the section has changed since, nothing is saved and a
   * `SectionChangedError` carries the other version (W1). `opts.force` saves anyway ("keep mine").
   */
  updateSection(slug: string, id: string, data: unknown, opts: { hash?: string; force?: boolean; /** The editor must send the hash; code with nobody to ask (setup, seeds) need not. */ requireHash?: boolean } = {}) {
    if (opts.requireHash && !opts.hash && !opts.force) return Promise.reject(new ValidationError({ _: "This section could not be checked against the saved one. Reload the editor, then save again." }));
    return this.edit(`Edited a section on ${slug}`, async (c, { tx, row }) => {
      const cur = c.pages.find((p) => p.slug === slug)?.sections.find((s) => s.id === id);
      if (cur && opts.hash && !opts.force && sectionHash(cur) !== opts.hash) {
        // Who changed THIS section, from its own note; the draft's last writer only for a section saved before notes existed.
        const by = cur.by ?? (await this.nameOf(tx, row.draftBy));
        throw new SectionChangedError(by, cur.at ? new Date(cur.at) : row.draftAt, cur, sectionHash(cur), by === this.ctx.name);
      }
      return updateSection(c, slug, id, data);
    });
  }

  // ---------- menu and footer ----------

  moveNav(path: number[], delta: -1 | 1) { return this.edit("Moved a menu entry", (c) => moveNavItem(c, path, delta)); }
  nestNav(index: number) { return this.edit("Put a menu entry under another", (c) => nestNavItem(c, index)); }
  unnestNav(parent: number, child: number) { return this.edit("Moved a menu entry to the top", (c) => unnestNavItem(c, parent, child)); }
  renameNav(path: number[], label: string) { return this.edit("Renamed a menu entry", (c) => renameNavItem(c, path, label)); }
  removeNav(path: number[]) { return this.edit("Removed a menu entry", (c) => removeNavItem(c, path)); }
  addNav(e: { label: string; href?: string; slug?: string }) { return this.edit(`Added menu entry ${e.label}`, (c) => addNavEntry(c, e)); }
  updateFooter(text: string | undefined) { return this.edit("Edited the footer", (c) => setFooterContent(c, { text, links: c.footer.links })); }
  setFooter(f: { text?: string; links: { label: string; href: string }[]; columns?: { title: string; links: { label: string; href: string }[] }[] }) { return this.edit("Edited the footer", (c) => setFooterContent(c, f)); }

  // ---------- files (kept here for the editor's photo picker; the work is in MediaService) ----------

  /** Store a photo for the website editor. Returns the url a section can point at. */
  async uploadPhoto(file: UploadFile): Promise<{ url: string }> {
    const m = await new MediaService(this.ctx).uploadPhoto(file);
    return { url: m.url };
  }
  /** The school's website photos, newest first. */
  async photos(): Promise<{ url: string; size: number }[]> {
    return (await new MediaService(this.ctx).list({ kind: "photo" })).map((m) => ({ url: m.url, size: m.size }));
  }
  removePhoto(url: string) { return new MediaService(this.ctx).remove(url); }

  // ---------- what a visitor would see, without publishing ----------

  /** The draft, or one saved version, for the preview. Anyone who edits the site may preview it, whatever their role is called. */
  async previewContent(o: { version?: number } = {}): Promise<{ content: SiteContent; templateKey: TemplateKey; label: string } | null> {
    return this.read(this.sees(), async (tx) => {
      if (o.version == null) {
        const row = await this.siteRow(tx, { create: false });
        return { content: row.draft, templateKey: row.templateKey, label: "Draft" };
      }
      const [v] = await tx.select().from(siteVersions).where(eq(siteVersions.number, o.version)).limit(1);
      return v ? { content: v.content, templateKey: v.templateKey, label: `Version ${v.number}` } : null;
    });
  }

  // ---------- publishing ----------

  /** What stops a publish (blockers) and what only deserves a look (warnings). */
  async checks(): Promise<PublishChecks> {
    return this.read(this.sees(), async (tx) => this.checksOf(tx, (await this.siteRow(tx, { create: false })).draft));
  }

  private async checksOf(tx: Tx, c: SiteContent): Promise<PublishChecks> {
    const blockers: string[] = [], warnings: string[] = [];
    const ok = siteContentSchema.safeParse(c);
    if (!ok.success) blockers.push(`The draft is not valid: ${ok.error.issues[0]?.message ?? "check every page"}`);
    const home = c.pages.find((p) => p.slug === HOME_SLUG);
    if (!home?.sections.some((s) => s.type === "hero" && !s.hidden && s.data.heading.trim())) blockers.push("The home page has no headline. Add a banner section with a headline.");
    for (const b of brokenLinks(c).slice(0, 8)) blockers.push(`${b.page}, ${b.where}: the link ${b.url} leads to a page that does not exist or is hidden.`);
    const refs = fileRefs(c);
    if (refs.length) {
      // A file must be in this school's public area (private files would not open for visitors) and must still exist.
      const area = `${this.ctx.schoolId}/public/`;
      const listed = await services().storage.list(area);
      const have = new Set(listed.map((f) => f.key));
      for (const r of refs) {
        const key = keyOfUrl(r.url) ?? "";
        const at = `${r.page}, ${r.where}`;
        if (!key.startsWith(area)) blockers.push(`${at}: this file is not in your school's public files, so visitors could not open it. Upload it again under Media.`);
        else if (!have.has(key) && !(listed.length >= 1000 && (await services().storage.list(key)).some((f) => f.key === key))) blockers.push(`${at}: a photo or file was deleted. Choose another one.`);
      }
    }
    if (c.pages.some((p) => !p.hidden && p.sections.some((s) => s.type === "staff" && !s.hidden)) && !siteSettingsOf((await tx.select({ s: schoolSites.settings }).from(schoolSites).limit(1))[0]?.s).teachersChecked) {
      warnings.push("Your teachers are not shown yet. Look at the list under Settings, Teachers shown, and choose whose names appear.");
    }
    if (home && !home.seo.description) warnings.push("The home page has no search description. Search engines will pick words themselves.");
    const sample = JSON.stringify(c).match(/images\.unsplash\.com/g)?.length ?? 0;
    if (sample) warnings.push(`${sample} sample photo${sample === 1 ? " is" : "s are"} still on the site. Replace ${sample === 1 ? "it" : "them"} with your own.`);
    const [disc] = await tx.select({ data: siteDisclosure.data }).from(siteDisclosure).limit(1);
    if (disc && c.pages.some((p) => p.sections.some((s) => s.type === "disclosure"))) {
      const lapsed = DISCLOSURE_ROWS.filter((r) => disclosureState(r, disc.data, {}, istToday()).state === "expired").length;
      if (lapsed) warnings.push(`${lapsed} document${lapsed === 1 ? "" : "s"} in the public disclosure ${lapsed === 1 ? "has" : "have"} run out.`);
    }
    return { blockers, warnings };
  }

  /** The next number: publishes, scheduled publishes and the drafts saved before a restore share one count. */
  private async nextNumber(tx: Tx): Promise<number> {
    const [m] = await tx.select({ n: max(siteVersions.number) }).from(siteVersions);
    return (m?.n ?? 0) + 1;
  }

  /** Put `content` live: the row, a version and the notifications. The caller holds the row lock. */
  private async goLive(tx: Tx, row: SiteRow, rawContent: SiteContent, templateKey: TemplateKey, by: { id: string; name: string }, o: { note?: string; kind: "publish" | "schedule" }) {
    const publishedAt = new Date();
    // The live copy carries no notes about who edited what.
    const content = stripMeta(rawContent, { keepPageDate: true });
    const changes = siteChanges(row.published ? { content: row.published, templateKey: row.publishedTemplateKey ?? row.templateKey } : null, { content, templateKey });
    await tx.update(schoolSites).set({
      published: content, publishedTemplateKey: templateKey, publishedAt, publishedBy: by.id,
      scheduled: null, scheduledTemplateKey: null, scheduledFor: null, scheduledBy: null, askedAt: null, askedBy: null, askedNote: null,
    }).where(eq(schoolSites.id, row.id));
    const number = await this.nextNumber(tx);
    await tx.insert(siteVersions).values({ schoolId: this.ctx.schoolId, number, kind: o.kind, templateKey, content, name: o.note?.trim().slice(0, 120) || null, changes: changes.lines, byUserId: by.id, byName: by.name });
    await NotificationWriter.done(tx, this.ctx.schoolId, { type: ASK, id: row.id });
    if (row.askedBy && row.askedBy !== by.id) {
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: row.askedBy, topic: "work.decision", title: "Your website changes are live", body: `${by.name} published them.`, href: "/app/website/versions", subject: { type: ASK, id: row.id } }]);
    }
    const paths = [...new Set([...sitePaths(content), ...(row.published ? sitePaths(row.published) : [])])];
    return { paths, publishedAt, version: number, warnings: [] as string[] };
  }

  /**
   * Make the draft live and keep a version of it. Needs `website:publish` (an editor asks instead). Returns the public paths to
   * revalidate; the action calls revalidatePath, not the service. Warnings stop it unless `acceptWarnings` (the default for code
   * that has nobody to ask: the setup wizard and seeds).
   */
  async publish(o: { note?: string; acceptWarnings?: boolean } = {}): Promise<{ paths: string[]; publishedAt: Date; version: number; warnings: string[] }> {
    return this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const { blockers, warnings } = await this.checksOf(tx, row.draft);
      if (blockers.length) throw new ValidationError({ _: blockers[0]! }, `Cannot publish yet: ${blockers.join(" ")}`);
      if (warnings.length && o.acceptWarnings === false) throw new ConflictError(`Look at this first: ${warnings.join(" ")}`);
      const r = await this.goLive(tx, row, row.draft, row.templateKey, { id: this.ctx.userId, name: this.ctx.name }, { note: o.note, kind: "publish" });
      return { ...r, warnings };
    }, (r) => ({ action: "publish", entity: "Website", summary: `Published the website (${r.paths.length} pages, version ${r.version})` }));
  }

  /** Someone who may edit but not publish asks. Everyone who may publish gets an action row. */
  async askToPublish(note?: string): Promise<{ to: string[] }> {
    this.authorize("manage", "write");
    if (this.can("publish")) throw new ConflictError("You can publish this yourself.");
    const text = note?.trim().slice(0, 300) || null;
    return this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const { blockers } = await this.checksOf(tx, row.draft);
      if (blockers.length) throw new ValidationError({ _: blockers[0]! }, `Fix this before asking: ${blockers.join(" ")}`);
      const to = (await this.holdersOf(tx, "publish")).filter((u) => u.id !== this.ctx.userId);
      if (!to.length) throw new ConflictError("Nobody else can publish yet. An admin can give a role the right to publish under Settings, Roles.");
      await tx.update(schoolSites).set({ askedAt: new Date(), askedBy: this.ctx.userId, askedNote: text }).where(eq(schoolSites.id, row.id));
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: ASK, id: row.id });
      await NotificationWriter.insert(tx, this.ctx.schoolId, to.map((u) => ({
        userId: u.id, topic: "work.approval" as const, title: "Website changes waiting for you to publish", body: `${this.ctx.name}${text ? `: ${text}` : ""}`,
        href: "/app/website", subject: { type: ASK, id: row.id }, action: true,
      })));
      return { to: to.map((u) => u.name) };
    }, (r) => ({ action: "ask", entity: "Website", summary: `Asked ${r.to.join(", ")} to publish the website` }));
  }

  /** The asker takes the request back. */
  async withdrawAsk(): Promise<void> {
    await this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: false, lock: true });
      if (!row.askedAt) return;
      if (row.askedBy !== this.ctx.userId && !this.can("publish")) throw new AppError("Only the person who asked can take the request back.", "forbidden", 403);
      await tx.update(schoolSites).set({ askedAt: null, askedBy: null, askedNote: null }).where(eq(schoolSites.id, row.id));
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: ASK, id: row.id });
    }, () => ({ action: "withdraw", entity: "Website", summary: "Took back the request to publish" }));
  }

  /** A publisher declines the request, with a reason the editor reads. */
  async sendBack(reason: string): Promise<void> {
    const text = reason.trim();
    if (text.length < 3) throw new ValidationError({ reason: "Say what to change" });
    await this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: false, lock: true });
      if (!row.askedAt || !row.askedBy) throw new ConflictError("Nobody is waiting for this. It may have been published or taken back.");
      await tx.update(schoolSites).set({ askedAt: null, askedBy: null, askedNote: null }).where(eq(schoolSites.id, row.id));
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: ASK, id: row.id });
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: row.askedBy, topic: "work.decision", title: "Website changes sent back", body: `${this.ctx.name}: ${text.slice(0, 300)}`, href: "/app/website/edit", subject: { type: ASK, id: row.id } }]);
    }, () => ({ action: "send_back", entity: "Website", summary: "Sent the website changes back" }));
  }

  /** Freeze the draft as it is now and publish it at `at`. Edits made later wait for the next publish. */
  async schedule(at: Date | string): Promise<{ scheduledFor: Date }> {
    const when = new Date(at);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) throw new ValidationError({ at: "Pick a time at least a minute from now" });
    if (when.getTime() > Date.now() + SCHEDULE_DAYS * 86_400_000) throw new ValidationError({ at: "Pick a time within a year" });
    return this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const { blockers } = await this.checksOf(tx, row.draft);
      if (blockers.length) throw new ValidationError({ _: blockers[0]! }, `Cannot schedule yet: ${blockers.join(" ")}`);
      await tx.update(schoolSites).set({ scheduled: row.draft, scheduledTemplateKey: row.templateKey, scheduledFor: when, scheduledBy: this.ctx.userId }).where(eq(schoolSites.id, row.id));
      return { scheduledFor: when };
    }, (r) => ({ action: "schedule", entity: "Website", summary: `Scheduled the website to go live at ${when.toISOString()}`, meta: { scheduledFor: r.scheduledFor.toISOString() } }));
  }

  async cancelSchedule(): Promise<void> {
    await this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: false, lock: true });
      if (!row.id || !row.scheduledFor) throw new ConflictError("Nothing is scheduled.");
      await tx.update(schoolSites).set({ scheduled: null, scheduledTemplateKey: null, scheduledFor: null, scheduledBy: null }).where(eq(schoolSites.id, row.id));
    }, () => ({ action: "cancel_schedule", entity: "Website", summary: "Cancelled the scheduled publish" }));
  }

  /**
   * Worker job "website.publish-due": publish every frozen copy whose time has come. One school failing does not stop the others.
   * A copy that no longer passes the checks (a photo was deleted since) is not published: it is dropped and the person who scheduled it is told.
   */
  static async publishDue(now = new Date()): Promise<number> {
    const due = await withConsole((tx) => tx.select({ schoolId: schoolSites.schoolId }).from(schoolSites).where(and(sql`${schoolSites.scheduledFor} <= ${now.toISOString()}::timestamptz`, sql`${schoolSites.scheduled} is not null`)));
    // The school's real modules and state: a suspended or cancelled school, or one without the website module, is skipped; a read-only one waits.
    const ctxs = await jobSchools(due.map((d) => d.schoolId));
    let done = 0, failed = 0;
    for (const ctx of ctxs) {
      if (ctx.readOnly) continue;
      try { if (await new SiteService(ctx).publishScheduled(now)) done++; }
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "scheduled publish failed", schoolId: ctx.schoolId, err: String(err) })); }
    }
    if (failed) throw new Error(`Scheduled publish failed for ${failed} of ${ctxs.length} schools`);
    return done;
  }

  private async publishScheduled(now: Date): Promise<boolean> {
    return this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: false, lock: true });
      if (!row.id || !row.scheduled || !row.scheduledFor || row.scheduledFor > now) return false;
      const by = row.scheduledBy ?? this.ctx.userId;
      const name = (await this.nameOf(tx, by)) ?? "Scheduled publish";
      const { blockers } = await this.checksOf(tx, row.scheduled);
      const clear = { scheduled: null, scheduledTemplateKey: null, scheduledFor: null, scheduledBy: null };
      if (blockers.length) {
        await tx.update(schoolSites).set(clear).where(eq(schoolSites.id, row.id));
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: by, topic: "work.decision", title: "The scheduled website publish did not go out", body: blockers[0], href: "/app/website", subject: { type: ASK, id: row.id } }]);
        return false;
      }
      await this.goLive(tx, row, row.scheduled, row.scheduledTemplateKey ?? row.templateKey, { id: by, name }, { kind: "schedule" });
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: by, topic: "work.decision", title: "Your website went live as scheduled", href: "/app/website/versions", subject: { type: ASK, id: row.id } }]);
      return true;
    }, (ok) => ({ action: "publish", entity: "Website", summary: ok ? "Published the website on schedule" : "Scheduled publish skipped" }));
  }

  /** Take the site down for visitors ("website is being updated" page) after the person typed OFFLINE. The draft and the live copy are kept. */
  async takeOffline(confirm: string): Promise<void> {
    if (confirm.trim().toUpperCase() !== "OFFLINE") throw new ValidationError({ confirm: "Type OFFLINE to confirm" });
    await this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      await tx.update(schoolSites).set({ offlineAt: new Date() }).where(eq(schoolSites.id, row.id));
    }, () => ({ action: "offline", entity: "Website", summary: "Took the website offline" }));
  }

  async bringBack(): Promise<void> {
    await this.write("publish", async (tx) => {
      const row = await this.siteRow(tx, { create: false, lock: true });
      if (row.id) await tx.update(schoolSites).set({ offlineAt: null }).where(eq(schoolSites.id, row.id));
    }, () => ({ action: "online", entity: "Website", summary: "Brought the website back online" }));
  }

  // ---------- reading the state ----------

  /** What going live changes, in words a school admin reads: new, removed and edited pages, template, nav and footer. */
  static changes(row: Pick<SiteRow, "draft" | "published" | "templateKey" | "publishedTemplateKey">): { first: boolean; lines: string[] } {
    return siteChanges(row.published ? { content: row.published, templateKey: row.publishedTemplateKey ?? row.templateKey } : null, { content: row.draft, templateKey: row.templateKey });
  }

  /** Draft sections that differ from the published copy, for the "unpublished changes" hint. */
  static hasUnpublishedChanges(row: Pick<SiteRow, "draft" | "published" | "templateKey" | "publishedTemplateKey">) {
    return !row.published || !same(stripMeta(row.draft), stripMeta(row.published)) || row.templateKey !== row.publishedTemplateKey;
  }

  /** The most pages the plan allows, or null for no limit. */
  async pageLimit(): Promise<number | null> {
    return this.read(this.sees(), async (tx) => { const l = await this.planLimits(tx, (await this.schoolRow(tx)).planId); return typeof l.websitePages === "number" ? l.websitePages : null; });
  }

  /** Who saved the draft last, for the "Asha is editing" hint. */
  async draftInfo(): Promise<{ at: string | null; by: string | null; byId: string | null }> {
    return this.read(this.sees(), async (tx) => {
      const row = await this.siteRow(tx, { create: false });
      return { at: row.draftAt?.toISOString() ?? null, by: await this.nameOf(tx, row.draftBy), byId: row.draftBy };
    });
  }
}
