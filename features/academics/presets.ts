// Pure data and helpers: Indian class presets, board subject presets, April-March year maths. No framework imports.
import type { STAGES, SUBJECT_KINDS } from "./schema";

type Kind = (typeof SUBJECT_KINDS)[number];

export const CLASS_PRESETS: { name: string; grade: number }[] = [
  { name: "Nursery", grade: -2 },
  { name: "LKG", grade: -1 },
  { name: "UKG", grade: 0 },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `Class ${i + 1}`, grade: i + 1 })),
];

const s = (name: string, code: string): { name: string; code: string; kind: Kind } => ({ name, code, kind: "scholastic" });
const c = (name: string, code: string): { name: string; code: string; kind: Kind } => ({ name, code, kind: "co_scholastic" });

export const BOARDS = ["CBSE", "ICSE", "State"] as const;
export type Board = (typeof BOARDS)[number];

export const SUBJECT_PRESETS: Record<Board, { name: string; code: string; kind: Kind }[]> = {
  CBSE: [s("English", "ENG"), s("Hindi", "HIN"), s("Mathematics", "MAT"), s("EVS", "EVS"), s("Science", "SCI"), s("Social Science", "SST"), s("Sanskrit", "SAN"), s("Computer Science", "CS"), c("Art", "ART"), c("Physical Education", "PE")],
  ICSE: [s("English", "ENG"), s("Hindi", "HIN"), s("Mathematics", "MAT"), s("Physics", "PHY"), s("Chemistry", "CHE"), s("Biology", "BIO"), s("History and Civics", "HIS"), s("Geography", "GEO"), s("Computer Applications", "CA"), c("Art", "ART"), c("Physical Education", "PE")],
  State: [s("English", "ENG"), s("Regional Language", "REG"), s("Mathematics", "MAT"), s("Science", "SCI"), s("Social Studies", "SST"), s("Environmental Studies", "EVS"), c("Drawing", "DRW"), c("Physical Education", "PE"), c("Work Education", "WE")],
};

/** "2026-27" → 2026. */
export const startYear = (name: string) => Number(name.slice(0, 4));
/** 2026 → "2026-27". */
export const yearName = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
export const nextYearName = (name: string) => yearName(startYear(name) + 1);

/** Default Indian school year: 1 April to 31 March. */
export function aprilToMarch(name: string) {
  const y = startYear(name);
  return { startsOn: `${y}-04-01`, endsOn: `${y + 1}-03-31` };
}

export function defaultTerms(name: string) {
  const y = startYear(name);
  return [
    { name: "Term 1", startsOn: `${y}-04-01`, endsOn: `${y}-09-30` },
    { name: "Term 2", startsOn: `${y}-10-01`, endsOn: `${y + 1}-03-31` },
  ];
}

/** The school stage of a grade (-2 Nursery ... 12): pre-primary up to UKG, primary 1-5, middle 6-8, secondary 9-10, senior secondary 11-12. */
export const stageOf = (grade: number): (typeof STAGES)[number] =>
  grade <= 0 ? "pre_primary" : grade <= 5 ? "primary" : grade <= 8 ? "middle" : grade <= 10 ? "secondary" : "senior_secondary";
