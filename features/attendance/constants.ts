// Plain constants shared by schema, services and client components (no drizzle, no React).
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "leave"] as const;
export const STAFF_STATUSES = [...ATTENDANCE_STATUSES, "half_day"] as const;
export type AttendanceStatus = (typeof STAFF_STATUSES)[number];

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present", absent: "Absent", late: "Late", leave: "On leave", half_day: "Half day",
};
export const STATUS_TONE: Record<AttendanceStatus, "success" | "danger" | "warning" | "info"> = {
  present: "success", absent: "danger", late: "warning", leave: "info", half_day: "warning",
};
/** One letter for the register matrix. */
export const STATUS_LETTER: Record<AttendanceStatus, string> = { present: "P", absent: "A", late: "L", leave: "V", half_day: "H" };

/** Below this attendance percentage a student is a defaulter. */
export const DEFAULTER_BELOW = 75;

/** "daily": one sheet per section per day. "period": each teacher marks their own period and the day is worked out from them. */
export const ATTENDANCE_MODES = ["daily", "period"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];
/** A student is present for the day when present or late in at least this share of the periods marked (the school can change it). */
export const DEFAULT_ROLLUP = 50;
/** One missed period is not an absence alert: a student needs this many absent periods before the family is told. */
export const MIN_PERIODS_FOR_ALERT = 2;

export const LEAVE_KINDS = ["student", "staff"] as const;
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export const CONDONATION_REASONS = ["medical", "sports", "other"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Board exams need this much attendance over the academic year (the school can change it in settings). */
export const DEFAULT_THRESHOLD = 75;
/** Classes whose students sit board exams. */
export const BOARD_GRADES = [10, 12] as const;

export const LEDGER_KINDS = ["credit", "carry", "used", "reversed", "adjust", "encash"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const HALF_DAY_SLOTS = ["first", "second"] as const;

/** Created for a school the first time anyone opens leave. Days are stored in half-days (24 = 12 days). */
export const DEFAULT_LEAVE_TYPES = [
  { code: "CL", name: "Casual", paid: true, yearlyHalfDays: 24, carryForwardHalfDays: 0, encashable: false, halfDayAllowed: true, needsFileAfterDays: null, sort: 1 },
  { code: "SL", name: "Sick", paid: true, yearlyHalfDays: 20, carryForwardHalfDays: 0, encashable: false, halfDayAllowed: true, needsFileAfterDays: 2, sort: 2 },
  { code: "EL", name: "Earned", paid: true, yearlyHalfDays: 30, carryForwardHalfDays: 60, encashable: true, halfDayAllowed: true, needsFileAfterDays: null, sort: 3 },
  { code: "LOP", name: "Unpaid", paid: false, yearlyHalfDays: 0, carryForwardHalfDays: 0, encashable: false, halfDayAllowed: true, needsFileAfterDays: null, sort: 4 },
] as const;
