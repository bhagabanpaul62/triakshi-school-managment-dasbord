// What payroll takes from other modules, as small interfaces so tests (and a school with attendance off) can stand in.
import type { Tx } from "@smw/db";
import { and, eq } from "drizzle-orm";
import { encashable, monthDays } from "@smw/feature-attendance/leave-api";
import { markClaimsPaid, openSalaryClaims } from "@smw/feature-expenses/claims";
import { expClaims } from "@smw/feature-expenses/schema";

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
  /** Marks the claims paid by this run. Posts nothing: the run's own entry debits claims payable. */
  markPaid(tx: Tx, ids: string[], o: { runId: string; date: string }): Promise<void>;
  /** Puts back every claim a recalled run had marked paid. */
  unmark(tx: Tx, runId: string): Promise<void>;
}
export const expenseClaims: ClaimsSource = {
  open: async (tx, userIds) => (await openSalaryClaims(tx, userIds)).map((c) => ({ id: c.id, userId: c.userId, amountPaise: Number(c.amountPaise), label: c.title })),
  markPaid: async (tx, ids, o) => { await markClaimsPaid(tx, ids, o); },
  unmark: async (tx, runId) => { await tx.update(expClaims).set({ status: "approved", paidOn: null, payrollRef: null }).where(and(eq(expClaims.payrollRef, runId), eq(expClaims.status, "paid"))); },
};

export interface Sources { days: DaysSource; claims: ClaimsSource }
export const defaultSources: Sources = { days: attendanceDays, claims: expenseClaims };
