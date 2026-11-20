// One optional supporting file (leave note, medical certificate), stored the same way assignments store theirs.
import { services, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
/** Notes and certificates are a PDF or a picture; the shared document list also allows Word, Excel and CSV, which we refuse here. */
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export interface StoredRef { fileKey: string; fileName: string }

/** Validates and stores one school's files under `<schoolId>/<area>/...` and signs download links. */
export class FileStore {
  constructor(private readonly schoolId: string, private readonly area: string) {}

  async put(file: UploadedFile): Promise<StoredRef> {
    let key: string;
    if (!ALLOWED.includes(file.type)) throw new ValidationError({ file: "Upload a PDF or an image" }, "Upload a PDF or an image");
    try { key = uploadKey(this.schoolId, this.area, file, "document"); }
    catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ file: e.message }, e.message);
      throw e;
    }
    await services().storage.put(key, file.bytes, file.type);
    return { fileKey: key, fileName: file.name };
  }

  url(key: string | null): Promise<string | null> {
    return key ? services().storage.signedUrl(key, 3600) : Promise.resolve(null);
  }

  /** Best effort: a missing object must never block the change that dropped it. */
  async remove(key: string | null): Promise<void> {
    if (key) await services().storage.delete(key).catch(() => undefined);
  }
}
