import { z } from "zod";
import { f } from "@smw/feature-kit";
import { BOARDS, CLASS_BANDS, EXAM_KINDS, EXAM_STATUSES } from "./schema";

const examShape = {
  yearId: f.id("Pick the academic year"),
  termId: f.optId(),
  name: f.text(3, 120, "Name the exam"),
  kind: z.enum(EXAM_KINDS).default("other"),
  startsOn: f.date("Pick the first day"),
  endsOn: f.date("Pick the last day"),
};
const paperShape = {
  classIds: f.list().pipe(z.array(z.uuid()).min(1, "Pick at least one class")),
  /** Empty = every scholastic subject the class studies. */
  subjectIds: f.list().pipe(z.array(z.uuid())),
  maxMarks: f.int(1, 1000),
  passMarks: f.int(0, 1000),
};

const endsAfterStart = (v: { startsOn: string; endsOn: string }) => v.endsOn >= v.startsOn;
const passWithinMax = (v: { maxMarks: number; passMarks: number }) => v.passMarks <= v.maxMarks;
const DATES = { message: "The last day is before the first day", path: ["endsOn"] };
const PASS = { message: "Pass marks cannot be more than the maximum", path: ["passMarks"] };

export const examInput = z.object(examShape).refine(endsAfterStart, DATES);
export const papersInput = z.object(paperShape).refine(passWithinMax, PASS);
/** Create an exam and its papers in one go. */
export const examWithPapersInput = z.object({ ...examShape, ...paperShape }).refine(endsAfterStart, DATES).refine(passWithinMax, PASS);

export const transitionInput = z.object({ id: f.id(), to: z.enum(EXAM_STATUSES), force: f.bool() });

export const gradeScaleInput = z.object({ name: f.text(2, 60, "Name the scale"), isDefault: f.bool() });
export const gradeBandsInput = z.array(z.object({
  grade: f.text(1, 6, "Name the grade"),
  minPercent: z.coerce.number().int().min(0).max(100),
  maxPercent: z.coerce.number().int().min(0).max(100),
  gradePoint: z.coerce.number().int().min(0).max(10).default(0),
  remark: f.optText(80),
})).min(1, "Add at least one grade");

/** Entries arrive from the marks grid as one JSON string field. */
const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } };

export const marksEntryInput = z.object({
  studentId: f.id(),
  /** Ignored when the paper has components: the total is the sum of the parts. */
  marks: z.number().min(0).nullable(),
  absent: z.boolean(),
  components: z.array(z.object({ componentId: f.id(), marks: z.number().min(0).nullable(), absent: z.boolean().default(false) })).optional(),
});
export const marksSaveInput = z.object({ paperId: f.id(), entries: z.preprocess(json, z.array(marksEntryInput).min(1, "Nothing to save")) });

/** Co-scholastic grades are keyed by term. An exam id still works for old callers: it stands for that exam's term. */
export const coScholasticInput = z.object({
  termId: f.optId(),
  examId: f.optId(),
  entries: z.preprocess(json, z.array(z.object({ studentId: f.id(), subjectId: f.id(), grade: f.text(1, 6, "Pick a grade") })).min(1, "Nothing to save")),
}).refine((v) => v.termId || v.examId, { message: "Pick the term", path: ["termId"] });

export const coScaleInput = z.object({
  id: f.optId(),
  name: f.text(2, 60, "Name the scale"),
  isDefault: f.bool(),
  grades: z.preprocess(json, z.array(z.object({ grade: f.text(1, 6, "Name the grade"), description: f.text(1, 60, "Describe the grade") })).min(1, "Add at least one grade")),
});

export const templateInput = z.object({
  classBand: z.enum(CLASS_BANDS),
  board: z.enum(BOARDS).default("cbse"),
  scaleId: f.optId(),
  coScaleId: f.optId(),
  showGrade: f.bool(),
  showRank: f.bool(),
  /** "40,60": the share of each term in the final result, in term order. Blank = plain average. */
  termSplit: z.preprocess((v) => (typeof v === "string" ? v.split(/[,/\s]+/).filter(Boolean).map(Number) : v ?? []), z.array(z.number().min(0).max(100))),
}).refine((v) => v.termSplit.length === 0 || v.termSplit.reduce((a, b) => a + b, 0) === 100, { message: "The split must add up to 100", path: ["termSplit"] });

export const presetInput = z.object({ preset: z.enum(["cbse_9", "cbse_co", "icse_marks_only"]), classBand: z.enum(CLASS_BANDS).optional() });

export const componentsInput = z.object({
  paperId: f.id(),
  components: z.preprocess(json, z.array(z.object({ name: f.text(1, 40, "Name the part"), maxMarks: z.coerce.number().int().min(1).max(1000) }))),
});

export const weightsInput = z.object({
  termId: f.id("Pick the term"),
  weights: z.preprocess(json, z.array(z.object({ examId: f.id(), weightPercent: z.coerce.number().int().min(0).max(100) }))),
});

export const remarksInput = z.object({
  sectionId: f.id("Pick the section"),
  termId: f.id("Pick the term"),
  entries: z.preprocess(json, z.array(z.object({ studentId: f.id(), text: z.string().trim().max(300, "Keep it under 300 characters") })).min(1, "Nothing to save")),
});

const time = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable());
export const dateSheetInput = z.object({
  examId: f.id(),
  papers: z.preprocess(json, z.array(z.object({ paperId: f.id(), date: f.date(), startTime: time, endTime: time }).refine((p) => (p.startTime === null) === (p.endTime === null) && (!p.startTime || p.endTime! > p.startTime), { message: "Give both times, with the end after the start", path: ["endTime"] })).min(1, "Nothing to save")),
});

export const removePaperInput = z.object({ id: f.id() });
export type ExamWithPapersInput = z.infer<typeof examWithPapersInput>;
export type PapersInput = z.infer<typeof papersInput>;
