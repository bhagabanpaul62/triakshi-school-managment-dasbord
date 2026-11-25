import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { type Tx } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { UPLOAD_RULES, UploadError, assertFileContent, services, uploadKey } from "@smw/integrations";
import { DISCLOSURE_ROWS, fileRefs, type SiteContent } from "@smw/site-templates";
import { PHOTO_URL, WebsiteService, keyOfUrl, siteFolder } from "./base";
import { schoolSites, siteDisclosure, siteMedia } from "./schema";

export type MediaRow = typeof siteMedia.$inferSelect;
export interface Place { where: "draft" | "live" | "disclosure"; label: string; /** Where to take it off. */ href: string }
export interface MediaItem {
  id: string; kind: "photo" | "document"; /** Stable address; the same after a replace. */ url: string;
  /** The address with a counter that changes on a replace, for thumbnails. */ viewUrl: string;
  fileName: string; size: number; contentType: string; alt: string | null; createdAt: Date; places: Place[];
}
export interface UploadFile { name: string; type: string; bytes: Uint8Array }

const EXT: Record<string, { kind: "photo" | "document"; type: string }> = {
  png: { kind: "photo", type: "image/png" }, jpg: { kind: "photo", type: "image/jpeg" }, jpeg: { kind: "photo", type: "image/jpeg" },
  webp: { kind: "photo", type: "image/webp" }, pdf: { kind: "document", type: "application/pdf" },
};
const uploadFail = (e: unknown, field: string): never => {
  if (e instanceof UploadError) throw new ValidationError({ [field]: e.message }, e.message);
  throw e;
};

/** Photos and documents of the website: where they are used, alt text, replace in place, safe delete. */
export class MediaService extends WebsiteService {
  /**
   * Make site_media match the storage folder: files that were uploaded before this table existed get a row the first time
   * somebody opens Media, and rows whose file is gone are dropped. (Only when the listing is complete: storage lists 1000 at most.)
   */
  private async sync(tx: Tx) {
    const files = await services().storage.list(siteFolder(this.ctx.schoolId));
    const rows = await tx.select({ id: siteMedia.id, key: siteMedia.fileKey }).from(siteMedia);
    const have = new Set(rows.map((r) => r.key));
    const found = new Set(files.map((f) => f.key));
    const fresh = files.flatMap((f) => {
      const kind = EXT[f.key.split(".").pop()?.toLowerCase() ?? ""];
      return kind && !have.has(f.key) ? [{ schoolId: this.ctx.schoolId, kind: kind.kind, fileKey: f.key, fileName: f.key.split("/").pop()!.slice(37) || "file", contentType: kind.type, size: f.size }] : [];
    });
    if (fresh.length) await tx.insert(siteMedia).values(fresh).onConflictDoNothing();
    const gone = files.length < 1000 ? rows.filter((r) => !found.has(r.key)).map((r) => r.id) : [];
    if (gone.length) await tx.delete(siteMedia).where(inArray(siteMedia.id, gone));
  }

  /** Every place a stored file is used, by storage key: the draft, the live copy and the disclosure documents. */
  private async places(tx: Tx): Promise<Map<string, Place[]>> {
    const [site] = await tx.select({ draft: schoolSites.draft, published: schoolSites.published }).from(schoolSites).limit(1);
    const [disc] = await tx.select({ data: siteDisclosure.data }).from(siteDisclosure).limit(1);
    const out = new Map<string, Place[]>();
    const add = (url: string, p: Place) => {
      const key = keyOfUrl(url);
      if (!key) return;
      const list = out.get(key) ?? [];
      if (!list.some((x) => x.where === p.where && x.label === p.label)) out.set(key, [...list, p]);
    };
    const scan = (c: SiteContent | null | undefined, where: "draft" | "live") => { for (const r of c ? fileRefs(c) : []) add(r.url, { where, label: `${r.page}, ${r.where}`, href: `/app/website/edit?page=${r.slug ?? "home"}` }); };
    scan(site?.draft, "draft");
    scan(site?.published, "live");
    for (const row of DISCLOSURE_ROWS) { const u = disc?.data.values[row.key]?.url; if (u) add(u, { where: "disclosure", label: `Disclosure, ${row.label}`, href: "/app/website/disclosure" }); }
    return out;
  }

  private item(r: MediaRow, places: Map<string, Place[]>): MediaItem {
    const url = PHOTO_URL + r.fileKey;
    return { id: r.id, kind: r.kind, url, viewUrl: r.replacedKey ? `${url}?v=${r.replacedKey}` : url, fileName: r.fileName, size: r.size, contentType: r.contentType, alt: r.alt, createdAt: r.createdAt, places: places.get(r.fileKey) ?? [] };
  }

  /** The library, newest first. `q` searches name and alt text. */
  async list(o: { q?: string; kind?: "photo" | "document"; unused?: boolean } = {}): Promise<MediaItem[]> {
    const load = async (tx: Tx) => {
      const where = and(o.kind ? eq(siteMedia.kind, o.kind) : undefined, o.q ? sql`(${ilike(siteMedia.fileName, `%${o.q}%`)} or ${ilike(sql`coalesce(${siteMedia.alt}, '')`, `%${o.q}%`)})` : undefined);
      const [rows, places] = await Promise.all([tx.select().from(siteMedia).where(where).orderBy(sql`${siteMedia.createdAt} desc`), this.places(tx)]);
      const items = rows.map((r) => this.item(r, places));
      return o.unused ? items.filter((i) => !i.places.length) : items;
    };
    if (this.can("manage") && !this.ctx.readOnly) return this.write("manage", async (tx) => { await this.sync(tx); return load(tx); });
    return this.read(this.sees(), load);
  }

  async altOf(urls: string[]): Promise<Record<string, string>> {
    const keys = urls.map(keyOfUrl).filter((k): k is string => !!k);
    if (!keys.length) return {};
    return this.read(this.sees(), async (tx) => Object.fromEntries((await tx.select({ key: siteMedia.fileKey, alt: siteMedia.alt }).from(siteMedia).where(inArray(siteMedia.fileKey, keys))).flatMap((r) => (r.alt ? [[PHOTO_URL + r.key, r.alt]] : []))));
  }

  private async store(file: UploadFile, kind: "photo" | "document", extra: { alt?: string } = {}): Promise<MediaItem> {
    this.authorize("manage", "write");
    const field = kind === "photo" ? "photo" : "file";
    try {
      const type = assertFileContent(file, kind === "photo" ? UPLOAD_RULES.image.types : ["application/pdf"]);
      const key = uploadKey(this.ctx.schoolId, "public/site", { name: file.name, type, size: file.bytes.byteLength }, kind === "photo" ? "image" : "document");
      await services().storage.put(key, file.bytes, type);
      return await this.write("manage", async (tx) => {
        const [row] = await tx.insert(siteMedia).values({ schoolId: this.ctx.schoolId, kind, fileKey: key, fileName: file.name.slice(0, 160), contentType: type, size: file.bytes.byteLength, alt: extra.alt?.trim() || null, uploadedBy: this.ctx.userId }).returning();
        return this.item(row!, new Map());
      }, (m) => ({ action: "upload", entity: "Website file", entityId: m.id, summary: `Uploaded ${kind === "photo" ? "photo" : "document"} ${m.fileName}` }));
    } catch (e) { return uploadFail(e, field); }
  }

  uploadPhoto(file: UploadFile, alt?: string) { return this.store(file, "photo", { alt }); }
  /** A public PDF. The bytes must be a PDF whatever the name says. */
  uploadDocument(file: UploadFile) { return this.store(file, "document"); }

  async setAlt(id: string, alt: string): Promise<MediaItem> {
    const text = alt.trim();
    if (text.length > 200) throw new ValidationError({ alt: "200 characters at most" });
    return this.write("manage", async (tx) => {
      const [row] = await tx.update(siteMedia).set({ alt: text || null }).where(eq(siteMedia.id, id)).returning();
      if (!row) throw new NotFoundError("File");
      return this.item(row, await this.places(tx));
    }, (m) => ({ action: "update", entity: "Website file", entityId: m.id, summary: `Changed the description of ${m.fileName}` }));
  }

  /**
   * Put a new file behind the same address. Every page that shows the old one shows the new one at once: the stored object is
   * overwritten under the same key (the file route checks that key) and a counter in the thumbnail address changes.
   */
  async replace(id: string, file: UploadFile): Promise<MediaItem> {
    this.authorize("manage", "write");
    const row = await this.read("manage", async (tx) => (await tx.select().from(siteMedia).where(eq(siteMedia.id, id)).limit(1))[0]);
    if (!row) throw new NotFoundError("File");
    try {
      const type = assertFileContent(file, row.kind === "photo" ? UPLOAD_RULES.image.types : ["application/pdf"]);
      uploadKey(this.ctx.schoolId, "public/site", { name: file.name, type, size: file.bytes.byteLength }, row.kind === "photo" ? "image" : "document");
      return await this.write("manage", async (tx) => {
        // The site row is locked first, so a publish or an edit that is using this file cannot run between the check and the overwrite.
        await this.siteRow(tx, { create: false, lock: true });
        const [still] = await tx.select().from(siteMedia).where(eq(siteMedia.id, id)).for("update");
        if (!still) throw new NotFoundError("File");
        await services().storage.put(row.fileKey, file.bytes, type);
        const [saved] = await tx.update(siteMedia).set({ size: file.bytes.byteLength, contentType: type, replacedKey: String(Number(row.replacedKey ?? 1) + 1) }).where(eq(siteMedia.id, id)).returning();
        return this.item(saved!, await this.places(tx));
      }, (m) => ({ action: "update", entity: "Website file", entityId: m.id, summary: `Replaced ${m.fileName}` }));
    } catch (e) { return uploadFail(e, row.kind === "photo" ? "photo" : "file"); }
  }

  /** Delete one file by id or address. Refused while the live site uses it: the message names the places. */
  async remove(idOrUrl: string): Promise<void> {
    const key = keyOfUrl(idOrUrl);
    if (key && (!key.startsWith(siteFolder(this.ctx.schoolId)) || key.includes(".."))) throw new NotFoundError("File");
    const gone = await this.write("manage", async (tx) => {
      // Locked first: nothing can publish or point a page at this file while it is being checked and removed.
      await this.siteRow(tx, { create: false, lock: true });
      await this.sync(tx);
      const [row] = await tx.select().from(siteMedia).where(key ? eq(siteMedia.fileKey, key) : eq(siteMedia.id, idOrUrl)).limit(1);
      if (!row) throw new NotFoundError("File");
      const places = (await this.places(tx)).get(row.fileKey) ?? [];
      const used = places.filter((p) => p.where !== "draft");
      if (used.length) throw new ConflictError(`${row.fileName} is used on ${used.map((p) => p.label).join("; ")}. Take it off ${used.length === 1 ? "that place" : "those places"} and publish first.`);
      await tx.delete(siteMedia).where(eq(siteMedia.id, row.id));
      return row;
    }, (m) => ({ action: "delete", entity: "Website file", entityId: m.id, summary: `Deleted ${m.fileName}` }));
    // After the commit, with the site row locked again, and only when the live site or the disclosure still does not use it: a publish that
    // came in between keeps the file; one that comes after finds it gone and is refused by its own check.
    await this.write("manage", async (tx) => {
      await this.siteRow(tx, { create: false, lock: true });
      const used = ((await this.places(tx)).get(gone.fileKey) ?? []).some((p) => p.where !== "draft");
      if (!used) await services().storage.delete(gone.fileKey);
    });
  }
}
