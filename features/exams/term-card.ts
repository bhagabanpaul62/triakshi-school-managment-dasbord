// Term maths: each exam of a term counts by its weight, the terms then make a final result. Pure, no database.
import type { GradeScale, OverallResult, StudentResult, SubjectStatus } from "./grading";

export interface TermExam { examId: string; name: string; weight: number; result: StudentResult }
export interface TermSubject {
  subjectId: string; subject: string;
  /** Weighted marks out of `outOf` (the weights of the exams this subject has a paper in). */
  score: number; outOf: number; passScore: number;
  percent: number | null; grade: string | null; status: SubjectStatus;
}
export interface TermBlock {
  termId: string; name: string; exams: { examId: string; name: string; weight: number }[];
  subjects: TermSubject[]; total: number; outOf: number; percent: number | null; grade: string | null; result: OverallResult;
  attendance: { working: number; present: number } | null;
}
export interface FinalSubject { subjectId: string; subject: string; percent: number | null; grade: string | null; status: SubjectStatus }
export interface FinalBlock { subjects: FinalSubject[]; percent: number | null; grade: string | null; result: OverallResult }

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One term for one student. A subject is pending while any of its papers has no mark; absent papers count as zero. */
export function termBlock(scale: GradeScale, term: { id: string; name: string }, exams: TermExam[]): TermBlock {
  const ids = [...new Map(exams.flatMap((e) => e.result.subjects).map((s) => [s.subjectId, s.subject])).entries()];
  const subjects: TermSubject[] = ids.map(([subjectId, subject]) => {
    const parts = exams.flatMap((e) => e.result.subjects.filter((s) => s.subjectId === subjectId).map((s) => ({ w: e.weight, s })));
    const score = r2(parts.reduce((n, p) => n + (p.w * (p.s.marks ?? 0)) / p.s.maxMarks, 0));
    const outOf = parts.reduce((n, p) => n + p.w, 0);
    const passScore = r2(parts.reduce((n, p) => n + (p.w * p.s.passMarks) / p.s.maxMarks, 0));
    const pending = parts.some((p) => p.s.status === "pending");
    const status: SubjectStatus = pending ? "pending" : parts.every((p) => p.s.status === "absent") ? "absent" : score + 1e-9 >= passScore ? "pass" : "fail";
    const percent = pending || outOf <= 0 ? null : r1((score / outOf) * 100);
    return { subjectId, subject, score, outOf, passScore, percent, grade: percent === null ? null : scale.gradeFor(percent).grade, status };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
  const counted = subjects.filter((s) => s.status !== "pending");
  const total = r2(counted.reduce((n, s) => n + s.score, 0));
  const outOf = counted.reduce((n, s) => n + s.outOf, 0);
  const percent = outOf > 0 ? r1((total / outOf) * 100) : null;
  const result: OverallResult = subjects.some((s) => s.status === "fail" || s.status === "absent") ? "fail" : subjects.some((s) => s.status === "pending") || subjects.length === 0 ? "pending" : "pass";
  return { termId: term.id, name: term.name, exams: exams.map((e) => ({ examId: e.examId, name: e.name, weight: e.weight })), subjects, total, outOf, percent, grade: percent === null ? null : scale.gradeFor(percent).grade, result, attendance: null };
}

/** The share each term has in the final result: the configured split when it fits the terms and adds to 100, else an equal average. */
export function termShares(count: number, split?: number[]): number[] {
  return split && split.length === count && split.reduce((a, b) => a + b, 0) === 100 ? split : Array.from({ length: count }, () => 100 / count);
}

/** Final result across terms. A subject counts only the terms it has a mark in. */
export function finalBlock(scale: GradeScale, blocks: TermBlock[], split?: number[]): FinalBlock {
  const shares = termShares(blocks.length, split);
  const avg = (rows: { w: number; v: number }[]) => { const w = rows.reduce((n, r) => n + r.w, 0); return w > 0 ? r1(rows.reduce((n, r) => n + r.w * r.v, 0) / w) : null; };
  const ids = [...new Map(blocks.flatMap((b) => b.subjects).map((s) => [s.subjectId, s.subject])).entries()];
  const subjects: FinalSubject[] = ids.map(([subjectId, subject]) => {
    const rows = blocks.flatMap((b, i) => b.subjects.filter((s) => s.subjectId === subjectId).map((s) => ({ w: shares[i]!, s })));
    const pending = rows.some((r) => r.s.status === "pending");
    const percent = pending ? null : avg(rows.map((r) => ({ w: r.w, v: r.s.percent ?? 0 })));
    const need = avg(rows.map((r) => ({ w: r.w, v: (r.s.passScore / r.s.outOf) * 100 })));
    const status: SubjectStatus = pending ? "pending" : rows.every((r) => r.s.status === "absent") ? "absent" : (percent ?? 0) + 1e-9 >= (need ?? 0) ? "pass" : "fail";
    return { subjectId, subject, percent, grade: percent === null ? null : scale.gradeFor(percent).grade, status };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
  const percent = avg(blocks.flatMap((b, i) => (b.percent === null ? [] : [{ w: shares[i]!, v: b.percent }])));
  const result: OverallResult = subjects.some((s) => s.status === "fail" || s.status === "absent") ? "fail" : subjects.some((s) => s.status === "pending") || subjects.length === 0 ? "pending" : "pass";
  return { subjects, percent, grade: percent === null ? null : scale.gradeFor(percent).grade, result };
}
