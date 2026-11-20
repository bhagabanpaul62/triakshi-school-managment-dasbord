import { z } from "zod";
import { f } from "@smw/feature-kit";
import { HOUSE_TONES, SHIFTS, STAGES, SUBJECT_KINDS, SUBJECT_TYPES, YEAR_STATUSES } from "./schema";
import { BOARDS, startYear } from "./presets";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const endsAfterStart = (v: { startsOn?: string; endsOn?: string }) => !v.startsOn || !v.endsOn || v.endsOn > v.startsOn;
const dateOrder = { message: "Must end after it starts", path: ["endsOn"] };

const yearNameField = z.preprocess((v) => v ?? "", z.string().trim().regex(/^\d{4}-\d{2}$/, "Use the form 2026-27"))
  .refine((n) => (startYear(n) + 1) % 100 === Number(n.slice(5)), "Years must follow each other, like 2026-27");

export const yearInput = z.object({
  name: yearNameField,
  startsOn: f.optDate(),
  endsOn: f.optDate(),
  isCurrent: f.bool(),
  /** Left out, an update keeps the status and a new year is active. */
  status: z.preprocess(blank, z.enum(YEAR_STATUSES).optional()),
}).refine(endsAfterStart, dateOrder);

export const rolloverInput = z.object({ name: z.preprocess(blank, yearNameField.optional()), copyTeachers: z.boolean().default(true) });

const termBase = z.object({
  yearId: f.id("Pick the year"),
  name: f.text(1, 60, "Name the term"),
  startsOn: f.date(),
  endsOn: f.date(),
  /** Left out, a new term goes last and an update keeps its place. */
  sortOrder: f.optInt(0, 99),
});
export const termInput = termBase.refine(endsAfterStart, dateOrder);
export const termUpdate = termBase.omit({ yearId: true }).refine(endsAfterStart, dateOrder);

export const classInput = z.object({
  name: f.text(1, 40, "Name the class"),
  grade: z.coerce.number().int().min(-2).max(12),
  displayOrder: z.preprocess(blank, z.coerce.number().int().min(-10).max(100).optional()),
  stage: z.preprocess(blank, z.enum(STAGES).optional()),
  boardOverride: z.preprocess(blank, z.enum(BOARDS).optional()),
});

const sectionBase = z.object({
  classId: f.id("Pick the class"),
  yearId: f.optId(),
  name: f.text(1, 10, "Name the section, like A"),
  capacity: z.preprocess(blank, z.coerce.number().int().min(1).max(200).default(40)),
  classTeacherId: f.optId(),
  room: f.optText(40),
  medium: f.optText(40),
  shift: z.preprocess(blank, z.enum(SHIFTS).optional()),
  streamLabel: f.optText(40),
});
export const sectionInput = sectionBase;
export const sectionUpdate = sectionBase.omit({ classId: true, yearId: true });

export const subjectInput = z.object({
  name: f.text(1, 80, "Name the subject"),
  code: f.optText(20),
  shortName: f.optText(12),
  kind: z.preprocess(blank, z.enum(SUBJECT_KINDS).default("scholastic")),
  type: z.preprocess(blank, z.enum(SUBJECT_TYPES).default("theory")),
  maxMarksTheory: f.optInt(1, 1000),
  maxMarksPractical: f.optInt(1, 1000),
  boardCode: f.optText(20),
  tone: z.preprocess(blank, z.enum(HOUSE_TONES).optional()),
  isLanguage: f.bool(),
}).superRefine((v, ctx) => {
  if (v.maxMarksTheory && v.type === "practical") ctx.addIssue({ code: "custom", path: ["maxMarksTheory"], message: "A practical-only subject has no theory marks" });
  if (v.maxMarksPractical && v.type === "theory") ctx.addIssue({ code: "custom", path: ["maxMarksPractical"], message: "A theory-only subject has no practical marks" });
});
export const boardInput = z.object({ board: z.enum(BOARDS) });

export const classSubjectInput = z.object({ classId: f.id("Pick the class"), subjectId: f.id("Pick the subject") });
export const assignSubjectsInput = z.object({ classId: f.id("Pick the class"), subjectIds: f.list().pipe(z.array(z.uuid()).min(1, "Pick at least one subject")) });

export const assignTeacherInput = z.object({ sectionId: f.id(), subjectId: f.id(), teacherId: f.optId() });

export const sectionTeacherInput = z.object({ sectionId: f.id("Pick the section"), subjectId: f.id("Pick the subject"), teacherId: f.id("Pick a teacher") });
export const sectionTeacherUpdate = z.object({ teacherId: f.id("Pick a teacher") });

export const classTeacherInput = z.object({ sectionId: f.id(), teacherId: f.optId() });

export const setElectiveInput = z.object({ id: f.id(), isElective: f.bool() });
export const subjectGroupInput = z.object({
  classId: f.id("Pick the class"),
  name: f.text(1, 60, "Name the group, like Science PCM"),
  subjectIds: f.list().pipe(z.array(z.uuid()).min(1, "Pick at least one subject")),
});
export const groupUpdate = z.object({ name: subjectGroupInput.shape.name, subjectIds: subjectGroupInput.shape.subjectIds });
export const choicesInput = z.object({ studentId: f.id(), subjectIds: f.list().pipe(z.array(z.uuid())) });
export const assignGroupInput = z.object({ studentId: f.id(), groupId: f.optId() });

export const houseInput = z.object({
  name: f.text(1, 40, "Name the house"),
  tone: z.preprocess(blank, z.enum(HOUSE_TONES).default("default")),
  captainStudentId: f.optId(),
});
export const assignHouseInput = z.object({ studentId: f.id(), houseId: f.optId() });
export const awardPointsInput = z.object({
  houseId: f.id("Pick the house"),
  points: z.coerce.number().int().min(-100).max(100).refine((n) => n !== 0, "Points cannot be zero"),
  reason: f.text(1, 200, "Say why"),
});
export const pointsUpdate = awardPointsInput.omit({ houseId: true });
