/**
 * The school's public disclosure in five parts. The rows follow the CBSE mandatory disclosure format as commonly published;
 * boards change it, so the panel tells schools to check the current circular. Pure data, no React.
 */
import { z } from "zod";

export const DISCLOSURE_PARTS = { general: "General information", documents: "Documents and information", results: "Results and academics", staff: "Staff", infrastructure: "School infrastructure" } as const;
export type DisclosurePart = keyof typeof DISCLOSURE_PARTS;

export interface DisclosureRow {
  key: string; part: DisclosurePart; label: string;
  kind: "text" | "document" | "link";
  /** Filled from the school profile when empty. */
  profile?: "name" | "affiliationNo" | "schoolCode" | "address" | "head" | "email" | "phone";
  /** The document runs out, so the school gives a date and is warned. */
  expires?: true;
}
const t = (part: DisclosurePart, key: string, label: string, extra: Partial<DisclosureRow> = {}): DisclosureRow => ({ part, key, label, kind: "text", ...extra });
const doc = (part: DisclosurePart, key: string, label: string, expires?: true): DisclosureRow => ({ part, key, label, kind: "document", ...(expires ? { expires } : {}) });

export const DISCLOSURE_ROWS: readonly DisclosureRow[] = [
  t("general", "name", "Name of the school", { profile: "name" }),
  t("general", "affiliation", "Affiliation number", { profile: "affiliationNo" }),
  t("general", "code", "School code", { profile: "schoolCode" }),
  t("general", "address", "Complete address with PIN code", { profile: "address" }),
  t("general", "head", "Principal's name and qualification", { profile: "head" }),
  t("general", "email", "School email", { profile: "email" }),
  t("general", "phone", "Contact numbers", { profile: "phone" }),
  doc("documents", "affiliation_letter", "Affiliation or upgradation letter and recent extension", true),
  doc("documents", "trust", "Society, trust or company registration and renewal", true),
  doc("documents", "noc", "No objection certificate of the State"),
  doc("documents", "recognition", "Recognition certificate under the RTE Act and renewal", true),
  doc("documents", "building_safety", "Building safety certificate", true),
  doc("documents", "fire_safety", "Fire safety certificate", true),
  doc("documents", "self_certification", "DEO certificate or self certification by the school"),
  doc("documents", "health_sanitation", "Water, health and sanitation certificates", true),
  doc("results", "fee_structure", "Fee structure of the school"),
  doc("results", "academic_calendar", "Annual academic calendar"),
  doc("results", "smc", "School management committee"),
  doc("results", "pta", "Parent teacher association members"),
  doc("results", "board_results", "Last three years' board results"),
  t("staff", "principal", "Principal"),
  t("staff", "teachers", "Total teachers (PGT, TGT, PRT)"),
  t("staff", "ratio", "Teachers to section ratio"),
  t("staff", "special_educator", "Special educator"),
  t("staff", "counsellor", "Counsellor and wellness teacher"),
  t("infrastructure", "campus_area", "Campus area (square metres)"),
  t("infrastructure", "classrooms", "Number and size of classrooms (square metres)"),
  t("infrastructure", "labs", "Number and size of laboratories, including computer labs"),
  t("infrastructure", "internet", "Internet facility"),
  t("infrastructure", "girls_toilets", "Number of girls' toilets"),
  t("infrastructure", "boys_toilets", "Number of boys' toilets"),
  { part: "infrastructure", key: "video", label: "Video of the school's inspection or infrastructure", kind: "link" },
];

export const disclosureValue = z.object({
  text: z.string().trim().max(600).optional(),
  /** A stored public file (`/api/files/...`) or a full https link. */
  url: z.string().trim().regex(/^(https?:\/\/[^\s]+|\/api\/files\/[^\s\\]+)$/i, "Upload a file, or use a full link starting with https://").max(500).optional(),
  fileName: z.string().trim().max(160).optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  na: z.boolean().optional(),
});
export type DisclosureValue = z.infer<typeof disclosureValue>;
export const disclosureSchema = z.object({ values: z.record(z.string(), disclosureValue).default({}) });
export type DisclosureData = z.infer<typeof disclosureSchema>;

/** A row counts as done when it is filled in or marked not applicable. `profile` holds the school's own details. */
export const disclosureFilled = (row: DisclosureRow, data: DisclosureData, profile: Partial<Record<NonNullable<DisclosureRow["profile"]>, string | null>> = {}): boolean => {
  const v = data.values[row.key];
  return !!(v?.na || v?.text || v?.url || (row.profile && profile[row.profile]));
};

export type DisclosureProfile = Partial<Record<NonNullable<DisclosureRow["profile"]>, string | null>>;
export type DisclosureState = "filled" | "missing" | "na" | "expiring" | "expired";
/** A document warns this many days before it runs out. */
export const EXPIRY_WARN_DAYS = 30;

/** Whole days from `today` to `day` (both "YYYY-MM-DD", IST); negative once it has passed. */
export const daysUntil = (day: string, today: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** One row: filled, missing, not applicable, or filled with a date that is near or past. */
export function disclosureState(row: DisclosureRow, data: DisclosureData, profile: DisclosureProfile, today: string): { state: DisclosureState; days?: number } {
  const v = data.values[row.key];
  if (v?.na) return { state: "na" };
  if (!disclosureFilled(row, data, profile)) return { state: "missing" };
  if (row.expires && v?.expiresOn) {
    const days = daysUntil(v.expiresOn, today);
    if (days < 0) return { state: "expired", days };
    if (days <= EXPIRY_WARN_DAYS) return { state: "expiring", days };
  }
  return { state: "filled" };
}

/** The data as the public page shows it: school profile details written into rows the school left empty. A frozen copy. */
export function disclosureWithProfile(data: DisclosureData, profile: DisclosureProfile): DisclosureData {
  const values = { ...data.values };
  for (const r of DISCLOSURE_ROWS) {
    const text = r.profile ? profile[r.profile] : null;
    if (text && !values[r.key]?.text && !values[r.key]?.na) values[r.key] = { ...values[r.key], text };
  }
  return { values };
}

/** Part A calls itself "School information" for a school that is not CBSE. */
export const disclosureTitle = (board: string | null | undefined) => (/cbse/i.test(board ?? "") || !board ? "Mandatory public disclosure" : "School information");
