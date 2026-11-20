import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ATTENDANCE_MODES, ATTENDANCE_STATUSES, CONDONATION_REASONS, STAFF_STATUSES } from "./constants";

/** A grid posts its rows as one JSON field. */
const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } };
const rows = <S extends z.ZodType>(item: S) => z.preprocess(json, z.array(item).min(1, "Mark at least one"));

export const markStudentsInput = z.object({
  sectionId: f.id("Pick a section"),
  date: f.date(),
  entries: rows(z.object({ studentId: f.id(), status: z.enum(ATTENDANCE_STATUSES), note: f.optText(200) })),
});

/** One period of one day: an ordinary one (`slotId`) or one option of an elective block (`blockSlotId` + `optionId`). */
export const markPeriodInput = z.object({
  date: f.date(),
  slotId: f.optId(), blockSlotId: f.optId(), optionId: f.optId(),
  entries: rows(z.object({ studentId: f.id(), status: z.enum(ATTENDANCE_STATUSES) })),
}).refine((r) => !!r.slotId || (!!r.blockSlotId && !!r.optionId), { message: "Pick a period", path: ["slotId"] });

export const markStaffInput = z.object({
  date: f.date(),
  entries: rows(z.object({ userId: f.id(), status: z.enum(STAFF_STATUSES), note: f.optText(200) })),
});

export const holidayInput = z.object({ date: f.date(), name: f.text(2, 80, "Name the holiday") });

export const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");

export const leaveApplyInput = z.object({
  /** Student logins only; a login with one student can leave it out. */
  studentId: f.optId(),
  fromDate: f.date("Pick the first day"),
  toDate: f.date("Pick the last day"),
  reason: f.text(3, 500, "Tell the school why"),
});

/** Edit a waiting request: same dates and reason as applying (the student and the file stay as they were). */
export const leaveEditInput = leaveApplyInput.omit({ studentId: true }).extend({ id: f.id() });

export const leaveReverseInput = z.object({ id: f.id(), note: f.optText(300) });

export const leaveDecisionInput = z.object({
  id: f.id(),
  decision: z.enum(["approved", "rejected"], { message: "Approve or reject" }),
  note: f.optText(300),
});

export const settingsInput = z.object({
  alertsEnabled: f.bool(),
  thresholdPercent: f.int(1, 100),
  /** Left out, they stay as they were. */
  mode: z.enum(ATTENDANCE_MODES, { message: "Pick how attendance is taken" }).optional(),
  rollupPercent: f.optInt(1, 100),
});

const condonationBody = { reason: z.enum(CONDONATION_REASONS, { message: "Pick a reason" }), note: f.optText(300) };
export const condonationInput = z.object({ studentId: f.id("Pick a student"), ...condonationBody });
export const condonationEditInput = z.object({ id: f.id(), ...condonationBody });
