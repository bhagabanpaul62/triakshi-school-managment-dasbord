import { ValidationError } from "@smw/feature-kit";
import type { UploadFile } from "../util";

/** The uploaded file in a form post, as plain bytes for a service (keeps `File` out of services). */
export async function fileFrom(fd: FormData, key = "file"): Promise<UploadFile> {
  const file = fd.get(key);
  if (!(file instanceof File) || file.size === 0) throw new ValidationError({ [key]: "Choose a file" });
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** The text of an uploaded CSV. */
export async function csvFrom(fd: FormData, key = "file"): Promise<string> {
  return new TextDecoder().decode((await fileFrom(fd, key)).bytes);
}
