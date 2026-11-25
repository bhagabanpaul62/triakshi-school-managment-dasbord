// Message files: checked by content, kept in the private area, opened only through the module's own route with a 60 second link.
import { assertFileContent, downloadDisposition, services, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";
import { FILE_TYPES, MAX_FILES } from "./constants";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
export interface StoredFile { fileKey: string; fileName: string; contentType: string; size: number }

export const filePrefix = (schoolId: string, threadId: string) => `${schoolId}/private/messages/${threadId}/`;

/** All files are checked before the first is stored, so one bad file stores nothing. */
export async function storeFiles(schoolId: string, threadId: string, files: UploadedFile[]): Promise<StoredFile[]> {
  if (files.length > MAX_FILES) throw new ValidationError({ files: `Attach at most ${MAX_FILES} files` });
  const keyed = files.map((file) => {
    try {
      const real = assertFileContent(file, FILE_TYPES);
      return { file, key: uploadKey(schoolId, `private/messages/${threadId}`, { name: file.name, type: real, size: file.bytes.byteLength }, "document") };
    } catch (e) {
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

/** A file read back for the module's route: the bytes with the name and type they were checked as. */
export interface StoredBytes { bytes: Uint8Array; name: string; type: string }
export const readStored = (fileKey: string) => services().storage.get(fileKey);

/** The answer of the module's own file route: the bytes with the headers a private file needs. */
export const fileResponse = (f: StoredBytes) => new Response(Buffer.from(f.bytes), {
  headers: { "Content-Type": f.type, "Content-Disposition": downloadDisposition(f.type, f.name), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
});

export const signedLink = (fileKey: string, seconds: number) => services().storage.signedUrl(fileKey, seconds);
