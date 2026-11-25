import { withSchool, type Tx } from "@smw/db";

/** What the public check page may show about a document. Nothing else leaves the database. */
export interface VerifyFound {
  /** "Valid", "Reversed", "Cancelled"... */
  status: string;
  /** False for a reversed or cancelled document, so the page does not look like a pass. */
  ok: boolean;
  number: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Money documents only; the page hides the row when it is missing. */
  amountPaise?: number;
  /** Full name; masked here before it reaches the page. */
  studentName: string | null;
  /** What the document is called, when it has a title (a circular). */
  title?: string;
  /** Text the page may print as is: only when the document's owner made it public. */
  text?: string | null;
}
/** Finds one document by its random token inside the school's own scope. The app passes one per kind, so this module never imports fees or payroll. */
export type VerifyLookup = (tx: Tx, token: string) => Promise<VerifyFound | null>;
export type VerifyLookups = Record<string, VerifyLookup>;
export type Verified = Omit<VerifyFound, "studentName"> & { maskedName: string | null };

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** "Rakesh Sharma" -> "R*** S***". */
export function maskName(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.map((w) => `${[...w][0]}***`).join(" ") : null;
}

/** A bad kind, a badly shaped token and an unknown token all give the same null. */
export async function checkDocument(lookups: VerifyLookups, schoolId: string, kind: string, token: string): Promise<Verified | null> {
  const lookup = Object.hasOwn(lookups, kind) ? lookups[kind] : undefined;
  if (!lookup || !TOKEN_PATTERN.test(token)) return null;
  const found = await withSchool(schoolId, (tx) => lookup(tx, token));
  if (!found) return null;
  const { studentName, ...rest } = found;
  return { ...rest, maskedName: maskName(studentName) };
}
