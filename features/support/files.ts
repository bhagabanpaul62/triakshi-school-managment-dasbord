// Files on a ticket. Stored privately under `<school>/private/support/<ticketId>/`, served only through a checked route.
import { TICKET_FILE_RULES, ValidationError, filesTotalProblem } from "@smw/feature-kit";
import { services, storeTicketFile, UploadError } from "@smw/integrations";

/** A file as a service receives it: `File` stays in the action. */
export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }
/** A link to a stored file lives this long. */
export const LINK_SECONDS = 60;

/** The file route of a stored file. Nothing else is ever put in a page. */
export const fileHref = (id: string) => `/api/support/files/${id}`;

/** Store a batch (the same check the console uses). Counts and sizes are checked first; if one is refused, the ones already stored are removed again. */
export async function storeAll(schoolId: string, ticketId: string, files: UploadedFile[]): Promise<{ key: string; file: UploadedFile }[]> {
  if (files.length > TICKET_FILE_RULES.maxFiles) throw new ValidationError({ files: `You can attach up to ${TICKET_FILE_RULES.maxFiles} files` });
  const tooMuch = filesTotalProblem(files.map((f) => f.size));
  if (tooMuch) throw new ValidationError({ files: tooMuch });
  const done: { key: string; file: UploadedFile }[] = [];
  try { for (const file of files) done.push({ key: await storeTicketFile(schoolId, ticketId, file), file }); }
  catch (e) { await dropKeys(done.map((d) => d.key)); if (e instanceof UploadError) throw new ValidationError({ files: e.message }); throw e; }
  return done;
}

/** Best effort: a missing object never blocks. */
export async function dropKeys(keys: string[]) {
  for (const k of keys) await services().storage.delete(k).catch(() => undefined);
}
