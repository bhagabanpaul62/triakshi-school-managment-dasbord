import { and, eq, sql } from "drizzle-orm";
import { RateLimiter } from "@smw/auth";
import { plans, schools, users, type Tx } from "@smw/db";
import {
  AppError, CrudService, LimitError, NotFoundError, SchoolService, ValidationError, systemCtx, type Ctx,
} from "@smw/feature-kit";
import { AnnouncementService } from "@smw/feature-announcements/service";
import { EventService } from "@smw/feature-events/service";
import { UploadError, services, uploadKey } from "@smw/integrations";
import { checkContrast, DEFAULT_THEME, PRESETS, themeOf, themeSchema, type Theme } from "@smw/themes";
import {
  PAGE_TEMPLATES, SECTION_DATA, SiteContentError, TEMPLATE_KEYS, addPage, addSection, buildPage, moveSection, removePage, removeSection,
  setFooter, siteContentSchema, sitePaths, starterSite, updatePage, updateSection, type SectionType, type SiteContent, type TemplateKey,
} from "@smw/site-templates";
import websiteFeature from "./feature";
import { enquiryInput, enquiryUpdateInput, manualEnquiryInput, pageInput, pageUpdateInput } from "./inputs";
import { enquiries, schoolSites, type EnquiryStatus } from "./schema";

type Perm = keyof typeof websiteFeature.permissions;
/** Public path of a stored file; the key after it is `<schoolId>/<area>/...`. */
const PHOTO_URL = "/api/files/";
export type SiteRow = typeof schoolSites.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;

/** Shared by every website service: the feature, plan limits and the school's own row. */
abstract class WebsiteService extends SchoolService<Perm> {
  protected feature = websiteFeature;

  protected async schoolRow(tx: Tx) {
    const [row] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    if (!row) throw new NotFoundError("School");
    return row;
  }

  /** The plan's `limits` json ({} when the school has no plan). */
  protected async planLimits(tx: Tx, planId: string | null): Promise<Record<string, number | boolean>> {
    if (!planId) return {};
    const [p] = await tx.select({ limits: plans.limits }).from(plans).where(eq(plans.id, planId)).limit(1);
    return p?.limits ?? {};
  }
}

const siteError = (e: unknown): unknown => {
  if (!(e instanceof SiteContentError)) return e;
  if (e.code === "missing") return new NotFoundError("Page or section");
  if (e.code === "limit") return new LimitError(e.message);
  return new ValidationError(e.fieldErrors ?? { _: e.message }, e.message);
};

/** The website editor: a draft per school, edited section by section, published on demand. */
export class SiteService extends WebsiteService {
  /** The site row. A school that never opened the editor gets the default site (a read-only caller sees it unsaved). */
  async get(): Promise<SiteRow> {
    // Saved on first sight, so the section ids the editor shows are the ones later edits refer to.
    if (this.can("manage") && !this.ctx.readOnly) return this.write("manage", (tx) => this.load(tx, true));
    return this.read("read", (tx) => this.load(tx, false));
  }

  private async load(tx: Tx, create: boolean): Promise<SiteRow> {
    const [row] = await tx.select().from(schoolSites).where(eq(schoolSites.schoolId, this.ctx.schoolId)).limit(1);
    if (row) return row;
    const draft = starterSite("classic", await this.schoolRow(tx));
    if (!create) return { id: "", schoolId: this.ctx.schoolId, templateKey: "classic", draft, published: null, publishedTemplateKey: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date() };
    const [made] = await tx.insert(schoolSites).values({ schoolId: this.ctx.schoolId, templateKey: "classic", draft }).returning();
    return made!;
  }

  /** Apply one pure edit to the draft and save it. */
  private edit(summary: string, fn: (c: SiteContent, ctx: { maxPages?: number }) => SiteContent, extra?: (tx: Tx) => Promise<Partial<SiteRow>>): Promise<SiteRow> {
    return this.write("manage", async (tx) => {
      const row = await this.load(tx, true);
      const limits = await this.planLimits(tx, (await this.schoolRow(tx)).planId);
      let draft: SiteContent;
      try { draft = fn(row.draft, { maxPages: typeof limits.websitePages === "number" ? limits.websitePages : undefined }); } catch (e) { throw siteError(e); }
      const [saved] = await tx.update(schoolSites).set({ draft, ...(extra ? await extra(tx) : {}) }).where(eq(schoolSites.id, row.id)).returning();
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
      const row = await this.load(tx, true);
      const school = await this.schoolRow(tx);
      // Section ids are random, so "untouched" compares everything but them.
      const bare = (c: SiteContent) => JSON.stringify(c, (k, v) => (k === "id" ? undefined : v));
      const fresh = opts.starter === true || (opts.starter === "untouched" && bare(row.draft) === bare(starterSite(row.templateKey, school)));
      const [saved] = await tx.update(schoolSites).set({ templateKey, ...(fresh ? { draft: starterSite(templateKey, school) } : {}) }).where(eq(schoolSites.id, row.id)).returning();
      return saved!;
    }, () => ({ action: "edit", entity: "Website", summary: `Changed website template to ${templateKey}${opts.starter === true ? " and replaced the draft with its sample pages" : ""}` }));
  }

  async addPage(input: unknown) {
    const p = this.parse(pageInput, input);
    const t = PAGE_TEMPLATES[p.template];
    const slug = p.slug || t.slug;
    const title = p.title || t.title;
    const school = await this.read("read", (tx) => this.schoolRow(tx));
    const page = buildPage(p.template, school, { slug, title });
    return this.edit(`Added page ${title}`, (c, { maxPages }) => addPage(c, { slug, title, page }, maxPages));
  }
  removePage(slug: string) { return this.edit(`Removed page ${slug}`, (c) => removePage(c, slug)); }
  async updatePage(slug: string, input: unknown) {
    const p = this.parse(pageUpdateInput, input);
    return this.edit(`Updated page ${slug}`, (c) => updatePage(c, slug, p));
  }
  async addSection(slug: string, type: string) {
    if (!(type in SECTION_DATA)) throw new ValidationError({ type: "Pick a section type" });
    return this.edit(`Added a ${type.replace("_", " ")} section to ${slug}`, (c) => addSection(c, slug, type as SectionType));
  }
  removeSection(slug: string, id: string) { return this.edit(`Removed a section from ${slug}`, (c) => removeSection(c, slug, id)); }
  moveSection(slug: string, id: string, dir: "up" | "down") { return this.edit(`Moved a section on ${slug}`, (c) => moveSection(c, slug, id, dir)); }
  /** `data` is the section's own data (already decoded from the form; the section schema validates it). */
  updateSection(slug: string, id: string, data: unknown) { return this.edit(`Edited a section on ${slug}`, (c) => updateSection(c, slug, id, data)); }
  updateFooter(text: string | undefined) { return this.edit("Edited the footer", (c) => setFooter(c, text)); }

  /** Store a photo for the website editor. Returns the url a section can point at. */
  async uploadPhoto(file: { name: string; type: string; bytes: Uint8Array }): Promise<{ url: string }> {
    this.authorize("manage", "write");
    let key: string;
    try {
      key = uploadKey(this.ctx.schoolId, "public/site", { name: file.name, type: file.type, size: file.bytes.byteLength }, "image");
    } catch (err) {
      if (err instanceof UploadError) throw new ValidationError({ photo: err.message }, err.message);
      throw err;
    }
    await services().storage.put(key, file.bytes, file.type);
    return { url: PHOTO_URL + key };
  }

  /** The school's website photos, newest first. */
  async photos(): Promise<{ url: string; size: number }[]> {
    return this.read("read", async () => {
      const rows = await services().storage.list(`${this.ctx.schoolId}/public/site/`);
      return rows.sort((x, y) => y.modified.getTime() - x.modified.getTime()).map((r) => ({ url: PHOTO_URL + r.key, size: r.size }));
    });
  }

  /** Delete one of this school's website photos. Only keys under its own folder can be removed. */
  async removePhoto(url: string): Promise<void> {
    this.authorize("manage", "write");
    const key = url.startsWith(PHOTO_URL) ? url.slice(PHOTO_URL.length) : "";
    if (!key.startsWith(`${this.ctx.schoolId}/public/site/`) || key.includes("..")) throw new NotFoundError("Photo");
    await services().storage.delete(key);
  }

  /**
   * Make the draft live. Returns the public paths to revalidate (the old and the new pages);
   * the action calls revalidatePath, not the service.
   */
  async publish(): Promise<{ paths: string[]; publishedAt: Date }> {
    return this.write("manage", async (tx) => {
      const row = await this.load(tx, true);
      const ok = siteContentSchema.safeParse(row.draft);
      if (!ok.success) throw new ValidationError({ _: ok.error.issues[0]?.message ?? "The draft is not valid" }, `Cannot publish yet: ${ok.error.issues[0]?.message ?? "the draft is not valid"}`);
      const publishedAt = new Date();
      await tx.update(schoolSites).set({ published: row.draft, publishedTemplateKey: row.templateKey, publishedAt }).where(eq(schoolSites.id, row.id));
      const paths = [...new Set([...sitePaths(row.draft), ...(row.published ? sitePaths(row.published) : [])])];
      return { paths, publishedAt };
    }, (r) => ({ action: "publish", entity: "Website", summary: `Published the website (${r.paths.length} pages)` }));
  }

  /** What going live changes, in words a school admin reads: new, removed and edited pages, template, nav and footer. */
  static changes(row: Pick<SiteRow, "draft" | "published" | "templateKey" | "publishedTemplateKey">): { first: boolean; lines: string[] } {
    const live = row.published;
    if (!live) return { first: true, lines: [`${row.draft.pages.length} pages go live for the first time`] };
    const was = new Map(live.pages.map((p) => [p.slug, p]));
    const now = new Map(row.draft.pages.map((p) => [p.slug, p]));
    const added = row.draft.pages.filter((p) => !was.has(p.slug)).map((p) => p.title);
    const removed = live.pages.filter((p) => !now.has(p.slug)).map((p) => p.title);
    const edited = row.draft.pages.filter((p) => was.has(p.slug) && JSON.stringify(was.get(p.slug)) !== JSON.stringify(p)).map((p) => p.title);
    const lines: string[] = [];
    if (added.length) lines.push(`New: ${added.join(", ")}`);
    if (edited.length) lines.push(`Edited: ${edited.join(", ")}`);
    if (removed.length) lines.push(`Taken down: ${removed.join(", ")}`);
    if (row.templateKey !== row.publishedTemplateKey) lines.push("The template changes the look of every page");
    if (JSON.stringify(row.draft.nav) !== JSON.stringify(live.nav) || JSON.stringify(row.draft.footer) !== JSON.stringify(live.footer)) lines.push("Menu or footer changed");
    return { first: false, lines };
  }

  /** Draft sections that differ from the published copy, for the "unpublished changes" hint. */
  static hasUnpublishedChanges(row: Pick<SiteRow, "draft" | "published" | "templateKey" | "publishedTemplateKey">) {
    return !row.published || JSON.stringify(row.draft) !== JSON.stringify(row.published) || row.templateKey !== row.publishedTemplateKey;
  }
}

// ---------- public ----------

/** What a visitor can see of a teacher. */
export interface PublicStaff { id: string; name: string; subject: string | null }
export interface PublicEvent { id: string; title: string; startsOn: string; location: string | null; description: string | null }

const enquiryLimiter = new RateLimiter(8, 60 * 60_000);
/** One school's whole form, whatever the IPs (a spoofed X-Forwarded-For must not open the floodgate). */
const schoolLimiter = new RateLimiter(200, 60 * 60_000);

/**
 * The website as a visitor sees it. Nobody is signed in, so the public routes build a system context with
 * `systemCtx(schoolId, school.features)` (role admin) and use the feature permission "public", which is granted to
 * admin for exactly this reason. It can only read the published site, public news and events, and record an enquiry.
 */
export class PublicSiteService extends WebsiteService {
  /** Rate limiter shared by all instances; tests reset it. */
  static readonly limiter = enquiryLimiter;

  static forSchool(schoolId: string, features: Iterable<string>, readOnly = false) {
    return new PublicSiteService({ ...systemCtx(schoolId, features), readOnly });
  }

  /** The published site and its template, or null when nothing is published (or the module is off). */
  async published(): Promise<{ templateKey: TemplateKey; content: SiteContent; publishedAt: Date | null } | null> {
    if (!this.can("public")) return null;
    return this.read("public", async (tx) => {
      const [row] = await tx.select().from(schoolSites).where(eq(schoolSites.schoolId, this.ctx.schoolId)).limit(1);
      if (!row?.published) return null;
      const ok = siteContentSchema.safeParse(row.published);
      return ok.success ? { templateKey: row.publishedTemplateKey ?? row.templateKey, content: ok.data, publishedAt: row.publishedAt } : null;
    });
  }

  async news(limit = 6) {
    if (!this.ctx.features.has("announcements")) return [];
    // A published notice always has its time; the filter only tells the types so.
    return (await new AnnouncementService(this.ctx).publicNews(limit)).flatMap((a) => (a.publishedAt ? [{ ...a, publishedAt: a.publishedAt }] : []));
  }

  /** Public events, through the events feature's own service when it offers them. */
  async events(limit = 6): Promise<PublicEvent[]> {
    return loadPublicEvents(this.ctx, limit);
  }

  /** Teachers by name, with a subject when the academics tables are there. Optional by design: [] on any problem. */
  async staff(limit = 8): Promise<PublicStaff[]> {
    if (!this.can("public")) return [];
    return this.read("public", async (tx) => {
      const teachers = await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(eq(users.role, "teacher"), eq(users.status, "active"))).orderBy(users.name).limit(limit);
      const subjects = new Map<string, string[]>();
      try {
        // A savepoint, so a school without academics tables does not poison the transaction.
        await tx.transaction(async (sp) => {
          const rows = await sp.execute<{ teacher_id: string; name: string }>(sql`select distinct st.teacher_id, s.name from section_teachers st join subjects s on s.id = st.subject_id`);
          for (const r of rows) subjects.set(r.teacher_id, [...(subjects.get(r.teacher_id) ?? []), r.name]);
        });
      } catch { /* no academics: names only */ }
      return teachers.map((t) => ({ id: t.id, name: t.name, subject: subjects.get(t.id)?.slice(0, 3).join(", ") ?? null }));
    });
  }

  /**
   * Record an admission enquiry from the public form. Rate limited per school and IP; a filled honeypot
   * is answered with the same success and stores nothing.
   */
  async submitEnquiry(input: unknown, meta: { ip?: string } = {}): Promise<{ received: true }> {
    this.authorize("public", "write");
    // A bot that filled the honeypot gets the same success, before any validation reveals the trap.
    if (input && typeof input === "object" && String((input as Record<string, unknown>).website ?? "").trim()) return { received: true };
    if (!schoolLimiter.take(this.ctx.schoolId) || !PublicSiteService.limiter.take(`${this.ctx.schoolId}:${meta.ip ?? "unknown"}`)) {
      throw new AppError("We have received several enquiries from you. Please try again in an hour, or call the school office.", "rate_limited", 429);
    }
    const data = this.parse(enquiryInput, input);
    if (data.website) return { received: true };
    const { website: _bot, ...values } = data;
    await this.write("public", (tx) => tx.insert(enquiries).values({ ...values, schoolId: this.ctx.schoolId, source: "website" }));
    return { received: true };
  }
}

/** Public events through the events feature's own service. [] when the module is off for this school. */
async function loadPublicEvents(ctx: Ctx, limit: number): Promise<PublicEvent[]> {
  if (!ctx.features.has("events")) return [];
  const svc = new EventService(ctx);
  const [rows, holidays] = await Promise.all([svc.publicEvents(limit), svc.publicHolidays(limit)]);
  const shown = rows.map((r) => ({
    id: r.id, title: r.title, location: r.location, description: r.description,
    startsOn: new Date(r.startsAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  }));
  const days = holidays.map((h) => ({ id: `holiday-${h.startsOn}`, title: h.title, location: null, description: null, startsOn: h.startsOn }));
  return [...shown, ...days].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).slice(0, limit);
}

// ---------- enquiries ----------

/** A link into the students screen with the enquiry prefilled (the website feature does not require students). */
export function studentLink(e: Pick<Enquiry, "studentName" | "dob" | "parentName" | "phone" | "email" | "classApplying">): string {
  const q = new URLSearchParams({ new: "1", name: e.studentName, guardian: e.parentName, phone: e.phone });
  if (e.dob) q.set("dob", e.dob);
  if (e.email) q.set("email", e.email);
  if (e.classApplying) q.set("class", e.classApplying);
  return `/app/students?${q.toString()}`;
}

export class EnquiryService extends CrudService<typeof enquiries, Perm> {
  protected feature = websiteFeature;
  protected table = enquiries;
  protected entityName = "Enquiry";
  protected readPermission = "enquiries" as const;
  protected writePermission = "enquiries" as const;
  protected createSchema = manualEnquiryInput;
  protected updateSchema = enquiryUpdateInput;

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [enquiries.studentName, enquiries.parentName, enquiries.phone]; }
  protected sortColumns() { return { createdAt: enquiries.createdAt, studentName: enquiries.studentName, status: enquiries.status }; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.status ? eq(enquiries.status, f.status as EnquiryStatus) : undefined]; }
  protected describe(r: Enquiry) { return r.studentName; }
  /** An empty notes box clears the notes. */
  protected async beforeUpdate(_tx: Tx, _existing: Enquiry, data: Record<string, unknown>) { return { ...data, notes: data.notes ?? null }; }

  /** Enquiries per status, for the pipeline header. */
  async counts(): Promise<Record<EnquiryStatus, number>> {
    return this.read("enquiries", async (tx) => {
      const rows = await tx.select({ status: enquiries.status, n: sql<number>`count(*)::int` }).from(enquiries).groupBy(enquiries.status);
      const out = { new: 0, contacted: 0, visited: 0, admitted: 0, closed: 0 } as Record<EnquiryStatus, number>;
      for (const r of rows) out[r.status] = r.n;
      return out;
    });
  }

  /** Where "Convert to student" leads. */
  async convertLink(id: string): Promise<string> { return studentLink(await this.get(id)); }
}

// ---------- theme ----------

/** Flat form fields (what the theme editor posts) → the nested Theme. */
export function themeFromForm(f: Record<string, unknown>): unknown {
  const c = (k: string) => f[k];
  return {
    preset: f.preset, radius: f.radius, font: f.font, logoUrl: f.logoUrl || null, faviconUrl: f.faviconUrl || null,
    colors: Object.fromEntries(["primary", "primaryLight", "secondary", "secondaryLight", "accent", "accentLight", "background", "surface", "text", "mutedText"].map((k) => [k, c(k)])),
  };
}

const isFlat = (i: unknown) => !!i && typeof i === "object" && !("colors" in (i as object));

export class ThemeService extends WebsiteService {
  /** The saved theme (or the default), and whether the plan limits the editor to logo and primary colour. */
  async get(): Promise<{ theme: Theme; limited: boolean; logoUrl: string | null }> {
    return this.read("read", async (tx) => {
      const s = await this.schoolRow(tx);
      const limits = await this.planLimits(tx, s.planId);
      return { theme: themeOf(s.theme), limited: limits.fullThemeEditor === false, logoUrl: s.logoUrl };
    });
  }

  /**
   * Save a theme (nested Theme, or flat form fields). Colours that fail WCAG AA are rejected with the failing pairs.
   * On a plan without the full editor only the logo and the primary colour may differ from the saved theme.
   */
  async save(input: unknown): Promise<Theme> {
    this.authorize("manage", "write");
    let next: Theme;
    try { next = this.parse(themeSchema, isFlat(input) ? themeFromForm(input as Record<string, unknown>) : input); } catch (e) {
      if (e instanceof ValidationError) throw new ValidationError(Object.fromEntries(Object.entries(e.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^colors\./, ""), v])), e.message);
      throw e;
    }
    return this.write("manage", async (tx) => {
      const s = await this.schoolRow(tx);
      const current = s.theme ? themeOf(s.theme) : null;
      const limits = await this.planLimits(tx, s.planId);
      if (limits.fullThemeEditor === false) {
        const base = current ?? DEFAULT_THEME;
        const allowed: Theme = { ...base, colors: { ...base.colors, primary: next.colors.primary }, logoUrl: next.logoUrl ?? null };
        if (canon(allowed) !== canon({ ...next, faviconUrl: base.faviconUrl ?? null })) {
          throw new LimitError("Your plan lets you change the logo and the primary colour only. Upgrade to edit the full theme.");
        }
        next = allowed;
      }
      const issues = checkContrast(next);
      if (issues.length) {
        const msg = issues.map((i) => `${i.pair} is ${i.ratio}:1 and needs ${i.min}:1`).join("; ");
        throw new ValidationError({ colors: msg, ...Object.fromEntries(issues.map((i) => [i.pair, `${i.ratio}:1 (needs ${i.min}:1)`])) }, `These colours are hard to read: ${msg}.`);
      }
      await tx.update(schools).set({ theme: next as unknown as Record<string, unknown>, logoUrl: next.logoUrl ?? null }).where(eq(schools.id, this.ctx.schoolId));
      return next;
    }, () => ({ action: "update", entity: "Theme", summary: "Changed the school theme" }));
  }

  /** Apply a named preset, keeping the school's logo. */
  async applyPreset(name: string): Promise<Theme> {
    const preset = PRESETS[name];
    if (!preset) throw new ValidationError({ preset: "Pick one of the presets" });
    const { logoUrl } = await this.get();
    return this.save({ ...preset, logoUrl });
  }
}

/** Key-order independent text of a theme, for comparing two of them. */
const canon = (t: Theme) => {
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return JSON.stringify(sorted({ ...t, logoUrl: t.logoUrl ?? null, faviconUrl: t.faviconUrl ?? null, colors: sorted(t.colors) }));
};
