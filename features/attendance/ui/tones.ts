// Token-based text colours for server components (the kit's TONE map lives in a client module).
import type { AttendanceStatus } from "../constants";
import { STATUS_TONE } from "../constants";

export const TEXT = {
  success: "text-[var(--ds-color-success-400)]",
  warning: "text-[var(--ds-color-warning-400)]",
  danger: "text-[var(--ds-color-danger-400)]",
  info: "text-[var(--ds-color-primary-300)]",
} as const;

export const statusText = (s: AttendanceStatus) => TEXT[STATUS_TONE[s]];

/** Colour of a percentage in a gauge. */
export const pctTone = (pct: number) => (pct >= 85 ? "success" : pct >= 75 ? "warning" : "danger") as "success" | "warning" | "danger";

/** Filled dot / text for calendar cells. */
export const DOT = {
  success: "bg-[var(--ds-color-success-400)]",
  warning: "bg-[var(--ds-color-warning-400)]",
  danger: "bg-[var(--ds-color-danger-400)]",
  info: "bg-[var(--ds-color-primary-300)]",
} as const;
