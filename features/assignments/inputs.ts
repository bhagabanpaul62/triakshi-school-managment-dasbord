import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ASSIGNMENT_STATUSES } from "./schema";
import { parseDue } from "./rules";

export const assignmentInput = z.object({
  sectionId: f.id("Pick a section"),
  subjectId: f.id("Pick a subject"),
  title: f.text(3, 160, "Give it a title"),
  instructions: f.text(1, 5000, "Write the instructions"),
  dueAt: z.preprocess((v) => parseDue(v) ?? undefined, z.date({ message: "Pick a due date and time" })),
  maxMarks: f.optInt(1, 1000),
  status: z.enum(ASSIGNMENT_STATUSES).default("published"),
});

export const submitInput = z.object({
  assignmentId: f.id(),
  text: f.optText(5000),
});

export const gradeInput = z.object({
  marks: f.optInt(0, 1000),
  feedback: f.optText(2000),
  /** Send it back to the student to redo instead of grading. */
  returnForRework: f.bool(),
});
