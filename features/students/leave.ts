import { and, eq } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { LEFT_ACCESS_DAYS } from "@smw/auth";
import { studentEnrollments, students } from "./schema";
import { accessUntilOf, today } from "./util";

/**
 * What leaving (or graduating) does to the record, for the office and for promotion alike. Keeps `section_id`.
 * Every enrolment still "studying" closes, also of years to come. The family's login works until `access_until`.
 * The code goes in `left_reason`, the office's words in `left_note`.
 */
export async function closeRecord(tx: Tx, id: string, outcome: "left" | "graduated", lastDay: string, code: string, note?: string | null) {
  await tx.update(students).set({
    status: outcome === "graduated" ? "alumni" : "left", leftOn: lastDay, leftReason: code, leftNote: note || null, accessUntil: accessUntilOf(lastDay, LEFT_ACCESS_DAYS, today()),
  }).where(eq(students.id, id));
  await tx.update(studentEnrollments).set({ outcome }).where(and(eq(studentEnrollments.studentId, id), eq(studentEnrollments.outcome, "studying")));
}
