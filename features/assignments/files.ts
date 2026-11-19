// File handling for assignments and submissions, so the services only deal in plain values.
import { services, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
export interface StoredRef { fileKey: string; fileName: string; size: number }
export interface FileLink { id: string; fileName: string; size: number; url: string }

const LINK_SECONDS = 3600;

/** Validates and stores one school's files under `<schoolId>/<area>/...` and signs download links. */
export class FileStore {
  constructor(private readonly schoolId: string, private readonly area: string) {}

  private key(file: UploadedFile): string {
    try { return uploadKey(this.schoolId, this.area, file, "document"); }
    catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ files: e.message }, e.message);
      throw e;
    }
  }

  /** All files are checked before the first is stored, so a bad one stores nothing. */
  async putAll(files: UploadedFile[], max = 5): Promise<StoredRef[]> {
    if (files.length > max) throw new ValidationError({ files: `Attach at most ${max} files` });
    const keyed = files.map((file) => ({ file, key: this.key(file) }));
    for (const { file, key } of keyed) await services().storage.put(key, file.bytes, file.type);
    return keyed.map(({ file, key }) => ({ fileKey: key, fileName: file.name, size: file.size }));
  }

  async withUrls(rows: { id: string; fileKey: string; fileName: string; size: number }[]): Promise<FileLink[]> {
    return Promise.all(rows.map(async (r) => ({ id: r.id, fileName: r.fileName, size: r.size, url: await services().storage.signedUrl(r.fileKey, LINK_SECONDS) })));
  }

  /** Best effort: a missing object must never block deleting the record that pointed at it. */
  async removeAll(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => services().storage.delete(k).catch(() => undefined)));
  }
}
