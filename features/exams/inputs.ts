import { z } from "zod";
import { f } from "@smw/feature-kit";
import { CO_SCHOLASTIC_GRADES, EXAM_KINDS, EXAM_STATUSES } from "./schema";

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
  marks: z.number().min(0).nullable(),
  absent: z.boolean(),
});
export const marksSaveInput = z.object({ paperId: f.id(), entries: z.preprocess(json, z.array(marksEntryInput).min(1, "Nothing to save")) });

export const coScholasticInput = z.object({
  examId: f.id(),
  entries: z.preprocess(json, z.array(z.object({ studentId: f.id(), subjectId: f.id(), grade: z.enum(CO_SCHOLASTIC_GRADES) })).min(1, "Nothing to save")),
});

export const removePaperInput = z.object({ id: f.id() });
export type ExamWithPapersInput = z.infer<typeof examWithPapersInput>;
export type PapersInput = z.infer<typeof papersInput>;
