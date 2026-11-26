// Who is on a section's roll for a stretch of days. A child who left stays in the register of the month they left (and any
// month they have a mark in) up to their last day; today's live lists hold children at school only.
import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { students } from "@smw/feature-students/schema";
import { todayIST } from "./stats";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const GONE: ("left" | "alumni")[] = ["left", "alumni"];

/** At school, or left/graduated with the last day on or after `from`, or with a mark between `from` and `to`. For a month, year or other past-days summary. */
export const onRollBetween = (from: string, to: string): SQL =>
  or(eq(students.status, "active"), and(inArray(students.status, GONE), or(gte(students.leftOn, from), sql`exists (select 1 from student_attendance a where a.student_id = ${students.id} and a.date between ${from}::date and ${to}::date)`)))!;

/** On the roll of one day: at school, or (for a day before today) left with the last day on or after it. Today's list never holds a child who left. */
export const onRollOn = (date: string): SQL =>
  date < todayIST() ? or(eq(students.status, "active"), and(inArray(students.status, GONE), gte(students.leftOn, date)))! : eq(students.status, "active");

/** Accepted by "mark": at school, or left with the last day on or after the date being marked. */
export const markableOn = (date: string): SQL => or(eq(students.status, "active"), and(inArray(students.status, GONE), gte(students.leftOn, date)))!;

/** "Left 10 Nov" for a child who is not at school, else null. */
export const leftNote = (s: { status: string; leftOn: string | null }): string | null =>
  s.status === "left" || s.status === "alumni" ? `Left${s.leftOn ? ` ${Number(s.leftOn.slice(8))} ${MONTHS[Number(s.leftOn.slice(5, 7)) - 1]}` : ""}` : null;
