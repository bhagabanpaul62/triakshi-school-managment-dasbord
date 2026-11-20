import { z } from "zod";
import { f } from "@smw/feature-kit";
import { minutesOf } from "./bell";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:40");

export const periodInput = z.object({
  name: f.text(1, 40, "Name the period"),
  startsAt: hhmm,
  endsAt: hhmm,
  sortOrder: f.int(1, 30),
  isBreak: f.bool(),
}).refine((v) => minutesOf(v.endsAt) > minutesOf(v.startsAt), { message: "Ends after it starts", path: ["endsAt"] });

const cell = {
  versionId: f.optId(),
  sectionId: f.id("Pick a section"),
  dayOfWeek: f.int(1, 6),
  periodId: f.id("Pick a period"),
};

export const slotInput = z.object({
  ...cell,
  subjectId: f.id("Pick a subject"),
  teacherId: f.id("Pick a teacher"),
  room: f.optText(40),
});

export const cellInput = z.object(cell);
export const sectionInput = z.object({ sectionId: f.id("Pick a section") });

export const copyWeekInput = z.object({
  fromSectionId: f.id("Pick the section to copy from"),
  toSectionId: f.id("Pick the section to copy to"),
  versionId: f.optId(),
  /** Clear the target's unlocked periods first. Off: only empty periods are filled. */
  replace: f.bool(),
});

/** An elective block: alternative subjects (each with its teacher and optional fixed room) taught at the same time to a whole class. */
export const blockInput = z.object({
  id: f.optId(),
  classId: f.id("Pick a class"),
  name: f.text(1, 60, "Name the block"),
  periodsPerWeek: f.int(1, 12),
  doubles: f.int(0, 6),
  options: z.array(z.object({ subjectId: f.id("Pick a subject"), teacherId: f.id("Pick a teacher for every subject"), roomId: f.optId() })).min(2, "A block needs at least two subjects").max(12),
});

/** Put a block at a cell. `sectionId` is the section whose grid the admin is editing (the block still fills the whole class). */
export const blockCellInput = z.object({ ...cell, blockId: f.id("Pick a block") });
