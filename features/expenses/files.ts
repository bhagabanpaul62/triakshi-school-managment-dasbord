// Slips and bills in private storage under `<schoolId>/expenses/`, shown through short-lived links.
import { services } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";
import { FILE_TYPES, MAX_FILE_BYTES } from "./constants";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }

export class ExpenseFiles {
  constructor(private readonly schoolId: string) {}

  async put(file: UploadedFile, field = "file"): Promise<{ fileKey: string; fileName: string }> {
    if (!(FILE_TYPES as readonly string[]).includes(file.type)) throw new ValidationError({ [field]: "Attach a PDF, JPG or PNG." });
    if (file.bytes.byteLength > MAX_FILE_BYTES) throw new ValidationError({ [field]: "The file is larger than 10 MB." });
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
    const key = `${this.schoolId}/expenses/${crypto.randomUUID()}-${safe}`;
    await services().storage.put(key, file.bytes, file.type);
    return { fileKey: key, fileName: file.name };
  }
  url(key: string | null): Promise<string | null> { return key ? services().storage.signedUrl(key, 3600) : Promise.resolve(null); }
  /** Best effort: a missing object must never block the record change. */
  async remove(keys: (string | null)[]) {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => services().storage.delete(k).catch(() => undefined)));
  }
}
