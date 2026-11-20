// Small pure helpers shared by the services and the pages. No framework imports.

/** Today as "YYYY-MM-DD" in Indian time. */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** "Class 5" + "A" -> "5-A"; "Nursery" + "B" -> "Nursery-B". */
export const sectionLabel = (className: string, sectionName: string) => `${className.replace(/^class\s+/i, "")}-${sectionName}`;

/** "+91 98765 43210" / "919876543210" -> "9876543210". Anything else is returned digits-only for the validator to reject. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

/** "2014-03-09" -> "09032014" (the student's first password). */
export const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** A student's day-one password: date of birth as DDMMYYYY, or the admission number when there is none. */
export const firstPassword = (dob: string | null | undefined, admissionNo: string) => (dob ? ddmmyyyy(dob) : admissionNo);

/** Whole years between an ISO date and today. */
export function ageOn(dob: string | null | undefined, on = today()): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = on.split("-").map(Number);
  return ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0);
}

/** A file handed to a service (keeps `File` out of the framework-free layer). */
export interface UploadFile { name: string; type: string; bytes: Uint8Array }
