import { and, eq, sql, CURRENT_SCHOOL, type Tx } from "@smw/db";
import type { DocumentData } from "./config";
import { finPrints } from "../schema";

export const DUPLICATE = "DUPLICATE";

/**
 * Record one print or download of a numbered document and say which copy it is (1 = the original).
 * Runs in the caller's transaction, so a print that fails to log fails to print.
 */
export async function logPrint(tx: Tx, p: { docType: string; docId: string; userId: string }): Promise<number> {
  // Two people printing at once can pick the same number; the unique index refuses one and it tries the next.
  for (let attempt = 0; attempt < 5; attempt++) {
    const where = and(eq(finPrints.docType, p.docType), eq(finPrints.docId, p.docId));
    const [{ next } = { next: 1 }] = await tx.select({ next: sql<number>`coalesce(max(${finPrints.copyNo}), 0) + 1` }).from(finPrints).where(where);
    const [row] = await tx.insert(finPrints).values({ schoolId: sql`${CURRENT_SCHOOL}` as unknown as string, docType: p.docType, docId: p.docId, copyNo: Number(next), printedBy: p.userId })
      .onConflictDoNothing().returning({ copyNo: finPrints.copyNo });
    if (row) return row.copyNo;
  }
  throw new Error("Could not record the print. Try again.");
}

/** The data for copy number `copyNo`: the stamp DUPLICATE is added from the second copy on. */
export function withCopyMark(data: DocumentData, copyNo: number): DocumentData {
  return copyNo >= 2 && !data.marks.includes(DUPLICATE) ? { ...data, marks: [...data.marks, DUPLICATE] } : data;
}
