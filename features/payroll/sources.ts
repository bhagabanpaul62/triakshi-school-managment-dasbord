// What payroll takes from other modules, as small interfaces so tests (and a school with attendance off) can stand in.
import type { Tx } from "@smw/db";
import { encashable, monthDays } from "@smw/feature-attendance/leave-api";

export interface MonthDaysRow {
  calendarDays: number; holidays: number; sundays: number; workingDays?: number; present: number; half: number;
  paidLeaveHalfDays: number; unpaidLeaveHalfDays: number; absentDays: number; lateDays: number; unmarkedDays: number;
}
export interface DaysSource {
  monthDays(tx: Tx, userIds: string[], month: string, opts?: { leftOn?: Record<string, string> }): Promise<Record<string, MonthDaysRow>>;
  encashable(tx: Tx, userId: string, day: string): Promise<{ typeId: string; code: string; name: string; halfDays: number }[]>;
}
export const attendanceDays: DaysSource = { monthDays, encashable };

export interface OpenClaim { id: string; userId: string; amountPaise: number; label: string }
export interface ClaimsSource {
  open(tx: Tx, userIds: string[]): Promise<OpenClaim[]>;
  markPaid(tx: Tx, ids: string[], o: { runId: string; date: string }): Promise<void>;
}
/** Used until the expenses module's claims are wired in (see the report): no claim rides on salary. */
export const noClaims: ClaimsSource = { open: async () => [], markPaid: async () => {} };

export interface Sources { days: DaysSource; claims: ClaimsSource }
export const defaultSources: Sources = { days: attendanceDays, claims: noClaims };
