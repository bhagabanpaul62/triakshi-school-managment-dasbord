// Event files are private: the key lives under private/events/<event>, and the event's own route serves the bytes after checking who is asking.
import { assertFileContent, services, UPLOAD_RULES, uploadKey, UploadError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
export const MAX_FILES = 5;

export interface StoredFile { fileKey: string; fileName: string; contentType: string; size: number }

export const EventFiles = {
  async put(schoolId: string, eventId: string, file: UploadedFile): Promise<StoredFile> {
    let key: string, type: string;
    try {
      // The bytes decide what the file is, never its name or the type the browser claimed.
      type = assertFileContent(file, UPLOAD_RULES.document.types);
      key = uploadKey(schoolId, `private/events/${eventId}`, { ...file, type }, "document");
    }
    catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ files: e.message }, e.message);
      throw e;
    }
    await services().storage.put(key, file.bytes, type);
    return { fileKey: key, fileName: file.name.slice(0, 200), contentType: type, size: file.size };
  },
  read: (key: string) => services().storage.get(key),
  /** Best effort: a missing object must never block the change that dropped it. */
  remove: (key: string) => services().storage.delete(key).catch(() => undefined),
};
