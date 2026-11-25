import { WITHDREW_BEFORE_JOINING } from "./constants";
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

/** "2026-11-26" plus `n` days (calendar arithmetic, no time zone). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Why a student left. The code is stored in `left_reason`, with the words after a colon ("other: moved abroad"). */
export const LEAVE_REASONS = [
  { value: "moved_city", label: "Moved to another city" },
  { value: "changed_school", label: "Changed school" },
  { value: "fees", label: "Fees" },
  { value: "completed", label: "Completed the school" },
  { value: "other", label: "Other" },
] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number]["value"];

export const leftReasonCode = (code: string, note?: string) => (note ? `${code}: ${note}` : code);
/** "moved_city" -> "Moved to another city"; "other: moved abroad" -> "Other: moved abroad". Unknown words pass through. */
export function leftReasonText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [code, ...rest] = raw.split(": ");
  if (raw === WITHDREW_BEFORE_JOINING) return "Withdrew before joining";
  const label = LEAVE_REASONS.find((r) => r.value === code)?.label;
  return label ? [label, ...rest].join(": ") : raw;
}

/** Expected age in a class is grade + 5, two years either way. Only a hint for the office: never a reason to refuse. */
export function classAgeWarning(dob: string | null | undefined, grade: number | null | undefined, className: string, on = today()): string | null {
  const age = ageOn(dob, on);
  if (age == null || grade == null) return null;
  const usual = grade + 5;
  return age < usual - 2 || age > usual + 2 ? `The child is ${age} years old. ${className} is usually for ages ${usual - 2} to ${usual + 2}. Check the birth date and the class.` : null;
}
