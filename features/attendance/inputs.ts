import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ATTENDANCE_MODES, ATTENDANCE_STATUSES, CONDONATION_REASONS, HALF_DAY_SLOTS, STAFF_STATUSES } from "./constants";

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
  /** Staff only (required for them): the leave type, a half day, and taking the days beyond the balance as unpaid. */
  typeId: f.optId(),
  halfDay: z.enum(["", ...HALF_DAY_SLOTS]).transform((v) => v || undefined).optional(),
  split: f.bool(),
});

/** What the apply form shows before sending: the same dates and type, nothing else. */
export const leavePreviewInput = leaveApplyInput.pick({ fromDate: true, toDate: true, typeId: true, halfDay: true });

/** Edit a waiting request: same dates and reason as applying (the student and the file stay as they were). */
export const leaveEditInput = leaveApplyInput.omit({ studentId: true, split: true }).extend({ id: f.id() });

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

/** A half-day count from days in steps of a half. */
const halfSteps = (max: number) => z.coerce.number().min(0).max(max).refine((v) => Number.isInteger(v * 2), "Use whole or half days");

export const leaveTypeInput = z.object({
  name: f.text(2, 40, "Name the leave type"),
  code: f.text(1, 8, "Give it a short code").transform((v) => v.toUpperCase()),
  paid: f.bool(),
  yearlyDays: halfSteps(366),
  carryDays: halfSteps(366),
  encashable: f.bool(),
  halfDayAllowed: f.bool(),
  needsFileAfterDays: f.optInt(0, 60),
  isActive: f.bool(),
  sort: f.optInt(0, 99),
}).transform(({ yearlyDays, carryDays, sort, ...r }) => ({ ...r, yearlyHalfDays: yearlyDays * 2, carryForwardHalfDays: carryDays * 2, sort: sort ?? 0 }));

export const leaveAdjustInput = z.object({
  userId: f.id("Pick a person"),
  typeId: f.id("Pick a leave type"),
  days: z.coerce.number().refine((v) => v !== 0 && Number.isInteger(v * 2), "Use whole or half days, not zero").refine((v) => Math.abs(v) <= 366, "Too many days"),
  reason: f.text(3, 200, "Say why"),
});
