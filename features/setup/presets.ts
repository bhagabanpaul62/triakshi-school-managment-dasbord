// Pure helpers for the wizard: stages of a school, which subjects usually run in which stage, year and term maths.
import { aprilToMarch, yearName, type Board } from "@smw/feature-academics/presets";

export interface Band { key: "pre" | "primary" | "middle" | "secondary"; label: string; min: number; max: number }
export const BANDS: readonly Band[] = [
  { key: "pre", label: "Nursery to UKG", min: -2, max: 0 },
  { key: "primary", label: "Class 1 to 5", min: 1, max: 5 },
  { key: "middle", label: "Class 6 to 8", min: 6, max: 8 },
  { key: "secondary", label: "Class 9 to 12", min: 9, max: 12 },
];
export type BandKey = Band["key"];
export const BAND_KEYS = BANDS.map((b) => b.key) as [BandKey, ...BandKey[]];

/** The stage a class grade (-2 Nursery ... 12) belongs to. */
export const bandOf = (grade: number): BandKey => BANDS.find((b) => grade >= b.min && grade <= b.max)?.key ?? "secondary";

const ALL: BandKey[] = ["pre", "primary", "middle", "secondary"];
const FROM_1: BandKey[] = ["primary", "middle", "secondary"];
const FROM_6: BandKey[] = ["middle", "secondary"];

/** Where each preset subject normally runs. Anything not listed runs in every stage. */
const USUAL_BANDS: Record<string, BandKey[]> = {
  EVS: ["pre", "primary"],
  "Environmental Studies": ["pre", "primary"],
  Science: FROM_1,
  "Social Science": FROM_6,
  "Social Studies": FROM_6,
  Sanskrit: FROM_6,
  Physics: FROM_6, Chemistry: FROM_6, Biology: FROM_6,
  "History and Civics": FROM_6, Geography: FROM_6,
  "Computer Science": FROM_1, "Computer Applications": FROM_6,
  "Work Education": FROM_6,
};
export const usualBands = (subject: string): BandKey[] => USUAL_BANDS[subject] ?? ALL;

/** CBSE and ICSE map to their own presets; every other board (state boards, IB, Cambridge) starts from the State list. */
export function boardPreset(board: string | null | undefined): Board {
  const b = (board ?? "").toLowerCase();
  return b.startsWith("cbse") ? "CBSE" : b.startsWith("icse") ? "ICSE" : b ? "State" : "CBSE";
}

/** The academic year a date falls in: April to March, so January 2027 is 2026-27. */
export function yearNameOn(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return yearName(y);
}

export { aprilToMarch };

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Split a year into `n` terms of whole months. Two terms of April-March are Term 1 Apr-Sep and Term 2 Oct-Mar. */
export function splitTerms(startsOn: string, endsOn: string, n: number): { name: string; startsOn: string; endsOn: string }[] {
  const [sy, sm] = startsOn.split("-").map(Number) as [number, number];
  const [ey, em] = endsOn.split("-").map(Number) as [number, number];
  const months = (ey - sy) * 12 + (em - sm) + 1;
  if (n < 1 || months < n) return [];
  const per = Math.floor(months / n);
  const at = (i: number) => { const m0 = sm - 1 + i * per; return { y: sy + Math.floor(m0 / 12), m: (m0 % 12) + 1 }; };
  return Array.from({ length: n }, (_, i) => {
    const next = at(i + 1);
    const lastDay = new Date(Date.UTC(next.y, next.m - 1, 0)); // day 0 of the next term's first month
    const e = i === n - 1 ? endsOn : ymd(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1, lastDay.getUTCDate());
    return { name: `Term ${i + 1}`, startsOn: i === 0 ? startsOn : ymd(at(i).y, at(i).m, 1), endsOn: e };
  });
}

/** "A", "B", ... the section names for a count. */
export const sectionNames = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
