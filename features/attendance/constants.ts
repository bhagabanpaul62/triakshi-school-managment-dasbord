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
