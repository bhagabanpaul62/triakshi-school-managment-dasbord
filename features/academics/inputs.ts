import { z } from "zod";
import { f } from "@smw/feature-kit";
import { SUBJECT_KINDS } from "./schema";
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
}).refine(endsAfterStart, dateOrder);

export const rolloverInput = z.object({ name: z.preprocess(blank, yearNameField.optional()) });

const termBase = z.object({
  yearId: f.id("Pick the year"),
  name: f.text(1, 60, "Name the term"),
  startsOn: f.date(),
  endsOn: f.date(),
});
export const termInput = termBase.refine(endsAfterStart, dateOrder);
export const termUpdate = termBase.omit({ yearId: true }).refine(endsAfterStart, dateOrder);

export const classInput = z.object({
  name: f.text(1, 40, "Name the class"),
  grade: z.coerce.number().int().min(-2).max(12),
});

const sectionBase = z.object({
  classId: f.id("Pick the class"),
  yearId: f.optId(),
  name: f.text(1, 10, "Name the section, like A"),
  capacity: z.preprocess(blank, z.coerce.number().int().min(1).max(200).default(40)),
  classTeacherId: f.optId(),
  room: f.optText(40),
});
export const sectionInput = sectionBase;
export const sectionUpdate = sectionBase.omit({ classId: true, yearId: true });

export const subjectInput = z.object({
  name: f.text(1, 80, "Name the subject"),
  code: f.optText(20),
  kind: z.preprocess(blank, z.enum(SUBJECT_KINDS).default("scholastic")),
});
export const boardInput = z.object({ board: z.enum(BOARDS) });

export const classSubjectInput = z.object({ classId: f.id("Pick the class"), subjectId: f.id("Pick the subject") });
export const assignSubjectsInput = z.object({ classId: f.id("Pick the class"), subjectIds: f.list().pipe(z.array(z.uuid()).min(1, "Pick at least one subject")) });

export const assignTeacherInput = z.object({ sectionId: f.id(), subjectId: f.id(), teacherId: f.optId() });

export const sectionTeacherInput = z.object({ sectionId: f.id("Pick the section"), subjectId: f.id("Pick the subject"), teacherId: f.id("Pick a teacher") });
export const sectionTeacherUpdate = z.object({ teacherId: f.id("Pick a teacher") });

export const classTeacherInput = z.object({ sectionId: f.id(), teacherId: f.optId() });
