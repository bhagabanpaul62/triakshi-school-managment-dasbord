// Vehicle document copies in private storage, under `<schoolId>/vehicle-documents/`, shown through signed links.
import { services, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }

const LINK_SECONDS = 3600;

export class DocumentFiles {
  constructor(private readonly schoolId: string) {}

  /** Checks the type and size, then stores the file. */
  async put(file: UploadedFile): Promise<{ fileKey: string; fileName: string }> {
    let key: string;
    try { key = uploadKey(this.schoolId, "vehicle-documents", file, "document"); }
    catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ file: e.message }, e.message);
      throw e;
    }
    await services().storage.put(key, file.bytes, file.type);
    return { fileKey: key, fileName: file.name };
  }

  url(key: string | null): Promise<string | null> {
    return key ? services().storage.signedUrl(key, LINK_SECONDS) : Promise.resolve(null);
  }

  /** Best effort: a missing object must never block the record change. */
  async remove(keys: (string | null)[]): Promise<void> {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => services().storage.delete(k).catch(() => undefined)));
  }
}
