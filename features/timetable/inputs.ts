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
