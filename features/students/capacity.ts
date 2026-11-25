import { and, count, eq, max } from "drizzle-orm";
import { schools, type Tx } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { academicYears, sections } from "@smw/feature-academics/schema";
import { students } from "./schema";

/** Student cap: the plan allows `cap`; warn from 90%, block past 110%. Joining children are not counted until their day. */
export interface StudentCapacity {
  active: number; cap: number; percent: number; hardLimit: number;
  warning: boolean; blocked: boolean; message: string | null;
}

const WARN_AT = 0.9;
const BLOCK_ABOVE = 1.1;

export async function capacityOf(tx: Tx, schoolId: string): Promise<StudentCapacity> {
  const [[row], [school]] = await Promise.all([
    tx.select({ n: count() }).from(students).where(eq(students.status, "active")),
    tx.select({ cap: schools.studentCap }).from(schools).where(eq(schools.id, schoolId)).limit(1),
  ]);
  const active = Number(row?.n ?? 0), cap = school?.cap ?? 0;
  const hardLimit = Math.floor(cap * BLOCK_ABOVE);
  const percent = cap > 0 ? Math.round((active / cap) * 100) : 0;
  const warning = cap > 0 && active >= cap * WARN_AT;
  const message = !warning ? null
    : active >= cap ? `You have ${active} students against a plan limit of ${cap}. New admissions stop at ${hardLimit}. Upgrade the plan to keep admitting.`
      : `You have used ${percent}% of your plan (${active} of ${cap} students).`;
  return { active, cap, percent, hardLimit, warning, blocked: active >= hardLimit, message };
}

/** The next roll number of a section: after the highest one among its active students. */
export async function nextRollIn(tx: Tx, sectionId: string): Promise<number> {
  const [r] = await tx.select({ top: max(students.rollNo) }).from(students).where(and(eq(students.sectionId, sectionId), eq(students.status, "active")));
  return (r?.top ?? 0) + 1;
}

/** A section of the current academic year (placing a student, or bringing one back). */
export async function currentYearSection(tx: Tx, id: string) {
  const [s] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1);
  if (!s) throw new ValidationError({ sectionId: "Choose a section" });
  const [current] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  if (current && s.yearId !== current.id) throw new ValidationError({ sectionId: "Choose a section of the current academic year" });
  return s;
}
