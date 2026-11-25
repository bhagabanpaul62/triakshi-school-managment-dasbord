// Message files: checked by content, kept in the private area, opened only through the module's own route with a 60 second link.
import { services, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";
import { FILE_TYPES, MAX_FILES } from "./constants";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
export interface StoredFile { fileKey: string; fileName: string; contentType: string; size: number }

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** What the bytes really are. A name and a declared type can lie. */
export function sniff(b: Uint8Array): (typeof FILE_TYPES)[number] | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export const filePrefix = (schoolId: string, threadId: string) => `${schoolId}/private/messages/${threadId}/`;

/** All files are checked before the first is stored, so one bad file stores nothing. */
export async function storeFiles(schoolId: string, threadId: string, files: UploadedFile[]): Promise<StoredFile[]> {
  if (files.length > MAX_FILES) throw new ValidationError({ files: `Attach at most ${MAX_FILES} files` });
  const keyed = files.map((file) => {
    const real = sniff(file.bytes);
    if (!real || real !== file.type) throw new ValidationError({ files: `${file.name} is not a PDF or picture the school accepts.` });
    try { return { file, key: uploadKey(schoolId, `private/messages/${threadId}`, { name: file.name, type: real, size: file.bytes.byteLength }, "document") }; }
    catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ files: `${file.name}: ${e.message}` });
      throw e;
    }
  });
  const stored: StoredFile[] = [];
  try {
    for (const { file, key } of keyed) {
      await services().storage.put(key, file.bytes, file.type);
      stored.push({ fileKey: key, fileName: file.name.slice(0, 120), contentType: file.type, size: file.bytes.byteLength });
    }
  } catch (e) { await removeStored(stored.map((s) => s.fileKey)); throw e; }
  return stored;
}

/** Best effort: a missing object must never block the rest. */
export async function removeStored(keys: string[]) {
  await Promise.all(keys.map((k) => services().storage.delete(k).catch(() => undefined)));
}

export const signedLink = (fileKey: string, seconds: number) => services().storage.signedUrl(fileKey, seconds);
