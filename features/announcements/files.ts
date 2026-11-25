// Files on a notice, and one optional slip for a paper answer. Stored privately, served only through checked routes with a 60-second link.
import { and, asc, eq, inArray } from "drizzle-orm";
import { withSchool, type Tx } from "@smw/db";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { services, uploadKey, UploadError } from "@smw/integrations";
import { NoticeBase } from "./base";
import { MAX_FILES } from "./constants";
import { announcementFiles, announcementResponses } from "./schema";
import { transition } from "./state";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
export const LINK_SECONDS = 60;

/** Check and store one file under `<school>/private/announcements/<owner>/`. */
export async function storeFile(schoolId: string, owner: string, file: UploadedFile, types = ALLOWED): Promise<string> {
  if (!types.includes(file.type)) throw new ValidationError({ file: "Upload a PDF, a picture, a Word or an Excel file" });
  let key: string;
  try { key = uploadKey(schoolId, `private/announcements/${owner}`, file, "document"); }
  catch (e) { if (e instanceof UploadError) throw new ValidationError({ file: e.message }); throw e; }
  await services().storage.put(key, file.bytes, file.type);
  return key;
}

export class FileBin {
  /** Delete stored objects that no notice file or answer still points to (a copied notice shares its files). Best effort: a missing object never blocks. */
  static async dropUnused(schoolId: string, keys: string[]) {
    if (!keys.length) return;
    const used = await withSchool(schoolId, async (tx) => new Set([
      ...(await tx.select({ k: announcementFiles.fileKey }).from(announcementFiles).where(inArray(announcementFiles.fileKey, keys))).map((r) => r.k),
      ...(await tx.select({ k: announcementResponses.fileKey }).from(announcementResponses).where(inArray(announcementResponses.fileKey, keys))).map((r) => r.k),
    ]));
    for (const k of keys.filter((k) => !used.has(k))) await services().storage.delete(k).catch(() => undefined);
  }
}

export class NoticeFileService extends NoticeBase {
  /** Add a file to a draft (up to ten). */
  async add(noticeId: string, file: UploadedFile): Promise<{ id: string }> {
    this.staffOnly();
    const owner = await this.write("draft", async (tx) => {
      const n = await this.find(tx, noticeId, true);
      this.own(n);
      transition(n.state, "edit");
      if (!(await this.settings(tx)).attachments) throw new ConflictError("This school has turned attachments off.");
      const have = await tx.select({ id: announcementFiles.id }).from(announcementFiles).where(eq(announcementFiles.announcementId, n.id));
      if (have.length >= MAX_FILES) throw new ConflictError(`A notice can have up to ${MAX_FILES} files.`);
      return n.id;
    });
    const fileKey = await storeFile(this.ctx.schoolId, owner, file);
    return this.write("draft", async (tx) => {
      const [row] = await tx.insert(announcementFiles).values({ schoolId: this.ctx.schoolId, announcementId: owner, fileKey, fileName: file.name.slice(0, 120), contentType: file.type, size: file.size, sort: 1000 }).returning({ id: announcementFiles.id });
      await this.renumber(tx, owner);
      return row!;
    });
  }

  async remove(fileId: string): Promise<{ id: string }> {
    this.staffOnly();
    const key = await this.write("draft", async (tx) => {
      const [f] = await tx.select().from(announcementFiles).where(eq(announcementFiles.id, fileId));
      if (!f) throw new ConflictError("That file is already gone.");
      const n = await this.find(tx, f.announcementId, true);
      this.own(n);
      transition(n.state, "edit");
      await tx.delete(announcementFiles).where(eq(announcementFiles.id, f.id));
      return f.fileKey;
    });
    await FileBin.dropUnused(this.ctx.schoolId, [key]);
    return { id: fileId };
  }

  /** `ids` in the order they should show. */
  async reorder(noticeId: string, ids: string[]): Promise<{ id: string }> {
    this.staffOnly();
    return this.write("draft", async (tx) => {
      const n = await this.find(tx, noticeId, true);
      this.own(n);
      transition(n.state, "edit");
      for (const [i, id] of ids.entries()) await tx.update(announcementFiles).set({ sort: i }).where(and(eq(announcementFiles.id, id), eq(announcementFiles.announcementId, n.id)));
      return { id: n.id };
    });
  }

  private async renumber(tx: Tx, noticeId: string) {
    const rows = await tx.select({ id: announcementFiles.id }).from(announcementFiles).where(eq(announcementFiles.announcementId, noticeId)).orderBy(asc(announcementFiles.sort), asc(announcementFiles.createdAt));
    for (const [i, r] of rows.entries()) await tx.update(announcementFiles).set({ sort: i }).where(eq(announcementFiles.id, r.id));
  }

  /**
   * A 60-second link to one notice file. A reader must be on the notice (or write it); a draft is only for its writer.
   * Never in a support session. Families use it too: the same check finds only notices sent to them.
   */
  async url(fileId: string): Promise<{ url: string; name: string; contentType: string }> {
    this.noSupport();
    return this.read("read", async (tx) => {
      const [f] = await tx.select().from(announcementFiles).where(eq(announcementFiles.id, fileId));
      if (!f) throw new ConflictError("That file is already gone.");
      const n = await this.find(tx, f.announcementId); // a draft is its writer's; a sent notice, its recipients'
      if (n.state === "withdrawn" && n.createdBy !== this.ctx.userId && !this.isManager) throw new ConflictError("This notice was withdrawn.");
      return { url: await services().storage.signedUrl(f.fileKey, LINK_SECONDS), name: f.fileName, contentType: f.contentType };
    });
  }
}
