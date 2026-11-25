import { desc, eq, max } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { siteChanges, stableJson, stripMeta, type SiteContent, type TemplateKey } from "@smw/site-templates";
import { WebsiteService } from "./base";
import { schoolSites, siteVersions } from "./schema";

export type VersionRow = typeof siteVersions.$inferSelect;
/** A version without its content (a list of 40 sites is heavy). */
export type VersionLine = Omit<VersionRow, "content"> & { /** The copy visitors see now. */ live: boolean };

/** Every published copy, and the draft saved before a restore. Never edited, only named and brought back. */
export class VersionService extends WebsiteService {
  async list(): Promise<VersionLine[]> {
    return this.read(this.sees(), async (tx) => {
      const [site] = await tx.select({ published: schoolSites.published }).from(schoolSites).limit(1);
      const rows = await tx.select({ id: siteVersions.id, schoolId: siteVersions.schoolId, createdAt: siteVersions.createdAt, updatedAt: siteVersions.updatedAt, number: siteVersions.number, kind: siteVersions.kind, templateKey: siteVersions.templateKey, name: siteVersions.name, changes: siteVersions.changes, byUserId: siteVersions.byUserId, byName: siteVersions.byName }).from(siteVersions).orderBy(desc(siteVersions.number));
      const latest = rows.find((r) => r.kind !== "before_restore");
      const liveContent = latest && site?.published ? (await tx.select({ c: siteVersions.content }).from(siteVersions).where(eq(siteVersions.number, latest.number)).limit(1))[0]?.c : null;
      const isLive = !!liveContent && stableJson(liveContent) === stableJson(site?.published);
      return rows.map((r) => ({ ...r, live: isLive && r.number === latest!.number }));
    });
  }

  async get(number: number): Promise<VersionRow> {
    return this.read(this.sees(), async (tx) => {
      const [v] = await tx.select().from(siteVersions).where(eq(siteVersions.number, number)).limit(1);
      if (!v) throw new NotFoundError("Version");
      return v;
    });
  }

  /** Give a version a name ("Before admissions 2027"). An empty name clears it. */
  async name(number: number, name: string): Promise<void> {
    const text = name.trim();
    if (text.length > 120) throw new ValidationError({ name: "120 characters at most" });
    await this.write("manage", async (tx) => {
      const [v] = await tx.update(siteVersions).set({ name: text || null }).where(eq(siteVersions.number, number)).returning({ n: siteVersions.number });
      if (!v) throw new NotFoundError("Version");
    }, () => ({ action: "update", entity: "Website version", entityId: String(number), summary: `Named version ${number}` }));
  }

  /** What changed going from version `a` to version `b`, as a list of lines. */
  async compare(a: number, b: number): Promise<{ from: number; to: number; lines: string[] }> {
    if (a === b) throw new ValidationError({ b: "Pick two different versions" });
    const [x, y] = await Promise.all([this.get(a), this.get(b)]);
    const [from, to] = x.number < y.number ? [x, y] : [y, x];
    const { lines } = siteChanges({ content: from.content, templateKey: from.templateKey }, { content: to.content, templateKey: to.templateKey });
    return { from: from.number, to: to.number, lines: lines.length ? lines : ["The two versions are the same."] };
  }

  /**
   * Bring a version back as the draft (W3). The draft as it is now is saved first as its own version, so a restore loses nothing.
   * News and events are not in a version (they come from their own screens), so restoring never touches them. It does not publish.
   */
  async restore(number: number): Promise<{ saved: number | null }> {
    return this.write("manage", async (tx) => {
      const row = await this.siteRow(tx, { create: true, lock: true });
      const [v] = await tx.select().from(siteVersions).where(eq(siteVersions.number, number)).limit(1);
      if (!v) throw new NotFoundError("Version");
      if (stableJson(stripMeta(row.draft)) === stableJson(v.content) && row.templateKey === v.templateKey) throw new ConflictError(`The draft is already the same as version ${number}.`);
      const [m] = await tx.select({ n: max(siteVersions.number) }).from(siteVersions);
      const saved = (m?.n ?? 0) + 1;
      await tx.insert(siteVersions).values({ schoolId: this.ctx.schoolId, number: saved, kind: "before_restore", templateKey: row.templateKey, content: stripMeta(row.draft), changes: [`Your draft as it was before you brought back version ${number}`], byUserId: this.ctx.userId, byName: this.ctx.name });
      await tx.update(schoolSites).set({ draft: v.content as SiteContent, templateKey: v.templateKey as TemplateKey, draftAt: new Date(), draftBy: this.ctx.userId }).where(eq(schoolSites.id, row.id));
      return { saved };
    }, (r) => ({ action: "restore", entity: "Website version", entityId: String(number), summary: `Brought version ${number} back as the draft${r.saved ? ` (draft saved as version ${r.saved})` : ""}` }));
  }
}
