import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ATTENDANCE_STATUSES, STAFF_STATUSES } from "./constants";

/** A grid posts its rows as one JSON field. */
const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } };
const rows = <S extends z.ZodType>(item: S) => z.preprocess(json, z.array(item).min(1, "Mark at least one"));

export const markStudentsInput = z.object({
  sectionId: f.id("Pick a section"),
  date: f.date(),
  entries: rows(z.object({ studentId: f.id(), status: z.enum(ATTENDANCE_STATUSES), note: f.optText(200) })),
});

export const markStaffInput = z.object({
  date: f.date(),
  entries: rows(z.object({ userId: f.id(), status: z.enum(STAFF_STATUSES), note: f.optText(200) })),
});

export const holidayInput = z.object({ date: f.date(), name: f.text(2, 80, "Name the holiday") });

export const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");
