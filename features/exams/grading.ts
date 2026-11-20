// Pure grading and result maths. No database, no framework: the mobile API and the tests use it as is.

export interface Band { grade: string; minPercent: number; maxPercent: number; gradePoint: number; remark: string | null }

/** The CBSE 9-point scale every school starts with (percent ranges are whole numbers, inclusive). */
export const CBSE_BANDS: readonly Band[] = [
  { grade: "A1", minPercent: 91, maxPercent: 100, gradePoint: 10, remark: "Outstanding" },
  { grade: "A2", minPercent: 81, maxPercent: 90, gradePoint: 9, remark: "Excellent" },
  { grade: "B1", minPercent: 71, maxPercent: 80, gradePoint: 8, remark: "Very good" },
  { grade: "B2", minPercent: 61, maxPercent: 70, gradePoint: 7, remark: "Good" },
  { grade: "C1", minPercent: 51, maxPercent: 60, gradePoint: 6, remark: "Above average" },
  { grade: "C2", minPercent: 41, maxPercent: 50, gradePoint: 5, remark: "Average" },
  { grade: "D", minPercent: 33, maxPercent: 40, gradePoint: 4, remark: "Needs improvement" },
  { grade: "E1", minPercent: 21, maxPercent: 32, gradePoint: 0, remark: "Needs serious improvement" },
  { grade: "E2", minPercent: 0, maxPercent: 20, gradePoint: 0, remark: "Needs serious improvement" },
];

/** A set of grade bands with a lookup. The percent is rounded to the nearest whole number first, so 90.5 is A1. */
export class GradeScale {
  private readonly sorted: Band[];

  constructor(bands: readonly Band[]) {
    if (bands.length === 0) throw new Error("A grade scale needs at least one band");
    this.sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  }

  static cbse() { return new GradeScale(CBSE_BANDS); }

  /** The bands, highest first. */
  get bands(): readonly Band[] { return this.sorted; }

  gradeFor(percent: number): Band {
    const p = Math.min(100, Math.max(0, Math.round(percent)));
    return this.sorted.find((b) => p >= b.minPercent && p <= b.maxPercent) ?? this.sorted[this.sorted.length - 1]!;
  }

  /** A human message when the bands do not cover 0-100 exactly once; null when they do. */
  static problem(bands: readonly Pick<Band, "grade" | "minPercent" | "maxPercent">[]): string | null {
    if (bands.length === 0) return "Add at least one grade";
    const asc = [...bands].sort((a, b) => a.minPercent - b.minPercent);
    for (const b of asc) if (b.minPercent > b.maxPercent) return `${b.grade}: the lowest percent is above the highest`;
    if (asc[0]!.minPercent !== 0) return "The lowest grade must start at 0%";
    if (asc[asc.length - 1]!.maxPercent !== 100) return "The top grade must end at 100%";
    for (let i = 1; i < asc.length; i++) {
      const gap = asc[i]!.minPercent - asc[i - 1]!.maxPercent;
      if (gap > 1) return `No grade covers ${asc[i - 1]!.maxPercent + 1}% to ${asc[i]!.minPercent - 1}%`;
      if (gap < 1) return `${asc[i - 1]!.grade} and ${asc[i]!.grade} overlap`;
    }
    return null;
  }
}

/** Class band of a grade level (nursery counts with 1-5). */
export function classBandOf(grade: number): "1-5" | "6-8" | "9-10" | "11-12" {
  return grade <= 5 ? "1-5" : grade <= 8 ? "6-8" : grade <= 10 ? "9-10" : "11-12";
}

/** The legend printed under a report card, built from the scale actually used. */
export function legendFor(bands: readonly Pick<Band, "grade" | "minPercent" | "maxPercent">[]): string {
  const list = [...bands].sort((a, b) => b.minPercent - a.minPercent).map((b) => `${b.grade} ${b.minPercent}-${b.maxPercent}`).join(", ");
  return `Grading: ${list}. AB = absent.`;
}

/** Built-in co-scholastic scale (CBSE A-C). */
export const CBSE_CO_GRADES: readonly { grade: string; description: string }[] = [
  { grade: "A", description: "Outstanding" }, { grade: "B", description: "Very good" }, { grade: "C", description: "Needs improvement" },
];

/** Presets for paper components. */
export const COMPONENT_PRESETS: Record<string, { name: string; maxMarks: number }[]> = {
  "Theory 80 + Internal 20": [{ name: "Theory", maxMarks: 80 }, { name: "Internal", maxMarks: 20 }],
  "Theory 70 + Practical 30": [{ name: "Theory", maxMarks: 70 }, { name: "Practical", maxMarks: 30 }],
  "Theory 60 + Practical 20 + Internal 20": [{ name: "Theory", maxMarks: 60 }, { name: "Practical", maxMarks: 20 }, { name: "Internal", maxMarks: 20 }],
};

export interface Slot { id: string; label: string; date: string; startTime: string | null; endTime: string | null }

/** Papers of ONE class that sit in the same slot. Two papers on one day clash unless both have times that do not overlap. */
export function findClashes(papers: Slot[]): [Slot, Slot][] {
  const out: [Slot, Slot][] = [];
  for (let i = 0; i < papers.length; i++) for (let j = i + 1; j < papers.length; j++) {
    const [a, b] = [papers[i]!, papers[j]!];
    if (a.date !== b.date) continue;
    const timed = a.startTime && a.endTime && b.startTime && b.endTime;
    if (!timed || (a.startTime! < b.endTime! && b.startTime! < a.endTime!)) out.push([a, b]);
  }
  return out;
}

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Dates for `count` papers of one class across an exam window, skipping Sundays and wrapping when there are more papers than days. */
export function spreadDates(startsOn: string, endsOn: string, count: number): string[] {
  const days: number[] = [];
  for (let t = toTime(startsOn); t <= toTime(endsOn); t += DAY) days.push(t);
  const open = days.filter((t) => new Date(t).getUTCDay() !== 0);
  const pool = open.length ? open : days.length ? days : [toTime(startsOn)];
  return Array.from({ length: count }, (_, i) => toIso(pool[i % pool.length]!));
}

// ---------- results ----------

export type SubjectStatus = "pass" | "fail" | "absent" | "pending";
export type OverallResult = "pass" | "fail" | "pending";

export interface PaperInfo { id: string; subjectId: string; subject: string; date: string; maxMarks: number; passMarks: number }
export interface MarkInfo { marks: number | null; absent: boolean }
export interface StudentInfo {
  id: string; name: string; admissionNo: string; rollNo: number | null; dob: string | null;
  sectionId: string; sectionName: string; classId: string; className: string;
}

export interface SubjectResult extends PaperInfo {
  marks: number | null;
  status: SubjectStatus;
  percent: number | null;
  grade: string | null;
}

export interface StudentResult {
  student: StudentInfo;
  subjects: SubjectResult[];
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  gradePoint: number | null;
  remark: string | null;
  result: OverallResult;
  rank: number | null;
  sectionSize: number;
}

export interface ClassSummary {
  count: number;
  passPercent: number;
  averagePercent: number;
  subjects: { paperId: string; subject: string; averagePercent: number; passPercent: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Turns marks into subject results, overall results and ranks for one section. */
export class ResultCalculator {
  constructor(private readonly scale: GradeScale) {}

  subject(paper: PaperInfo, mark?: MarkInfo): SubjectResult {
    const marks = mark?.marks ?? null;
    const base = { ...paper, marks };
    if (mark?.absent) return { ...base, marks: null, status: "absent", percent: 0, grade: null };
    if (marks === null) return { ...base, status: "pending", percent: null, grade: null };
    const percent = round1((marks / paper.maxMarks) * 100);
    return { ...base, status: marks >= paper.passMarks ? "pass" : "fail", percent, grade: this.scale.gradeFor(percent).grade };
  }

  /** Overall figures for one student. Papers still waiting for marks are left out of the total and make the result "pending". */
  student(student: StudentInfo, papers: PaperInfo[], markOf: (paperId: string) => MarkInfo | undefined): StudentResult {
    const subjects = papers.map((p) => this.subject(p, markOf(p.id)));
    const counted = subjects.filter((s) => s.status !== "pending");
    const total = counted.reduce((n, s) => n + (s.marks ?? 0), 0);
    const maxTotal = counted.reduce((n, s) => n + s.maxMarks, 0);
    const percent = maxTotal > 0 ? round1((total / maxTotal) * 100) : null;
    const band = percent === null ? null : this.scale.gradeFor(percent);
    const failed = subjects.some((s) => s.status === "fail" || s.status === "absent");
    const result: OverallResult = failed ? "fail" : subjects.some((s) => s.status === "pending") || subjects.length === 0 ? "pending" : "pass";
    return { student, subjects, total, maxTotal, percent, grade: band?.grade ?? null, gradePoint: band?.gradePoint ?? null, remark: band?.remark ?? null, result, rank: null, sectionSize: 0 };
  }

  /** Results for a whole section, in roll order, each with a competition rank by percent (ties share a rank). Pending results are not ranked. */
  section(students: StudentInfo[], papers: PaperInfo[], markOf: (studentId: string, paperId: string) => MarkInfo | undefined, studies?: (studentId: string, subjectId: string) => boolean): StudentResult[] {
    // A student who does not take an elective has no paper for it (never shown absent).
    const results = students.map((s) => this.student(s, studies ? papers.filter((p) => studies(s.id, p.subjectId)) : papers, (pid) => markOf(s.id, pid)));
    const ranked = results.filter((r) => r.percent !== null && r.result !== "pending").sort((a, b) => b.percent! - a.percent!);
    ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1]!.percent === r.percent ? ranked[i - 1]!.rank : i + 1; });
    for (const r of results) r.sectionSize = results.length;
    return results;
  }

  /** One result for several exams of a term: marks and maximums add up per subject. Rank is not meaningful across exams, so it stays empty. */
  combine(results: StudentResult[]): StudentResult {
    const first = results[0]!;
    const bySubject = new Map<string, SubjectResult[]>();
    for (const r of results) for (const s of r.subjects) bySubject.set(s.subjectId, [...(bySubject.get(s.subjectId) ?? []), s]);
    const merged = new Map<string, MarkInfo | undefined>();
    const papers: PaperInfo[] = [...bySubject.entries()].map(([subjectId, rows]) => {
      const done = rows.filter((s) => s.status !== "pending");
      const paper: PaperInfo = {
        id: subjectId, subjectId, subject: rows[0]!.subject, date: rows[0]!.date,
        maxMarks: done.reduce((n, s) => n + s.maxMarks, 0) || rows[0]!.maxMarks, passMarks: done.reduce((n, s) => n + s.passMarks, 0) || rows[0]!.passMarks,
      };
      const absent = done.length > 0 && done.every((s) => s.status === "absent");
      merged.set(subjectId, done.length === 0 ? undefined : { marks: absent ? null : done.reduce((n, s) => n + (s.marks ?? 0), 0), absent });
      return paper;
    });
    return { ...this.student(first.student, papers, (id) => merged.get(id)), rank: null, sectionSize: first.sectionSize };
  }

  summary(results: StudentResult[], papers: PaperInfo[]): ClassSummary {
    const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);
    const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const decided = results.filter((r) => r.result !== "pending");
    return {
      count: results.length,
      passPercent: pct(decided.filter((r) => r.result === "pass").length, decided.length),
      averagePercent: mean(results.flatMap((r) => (r.percent === null ? [] : [r.percent]))),
      subjects: papers.map((p) => {
        const rows = results.flatMap((r) => r.subjects.filter((s) => s.id === p.id && s.status !== "pending"));
        return {
          paperId: p.id, subject: p.subject,
          averagePercent: mean(rows.filter((s) => s.status !== "absent").map((s) => s.percent!)),
          passPercent: pct(rows.filter((s) => s.status === "pass").length, rows.length),
        };
      }),
    };
  }
}
