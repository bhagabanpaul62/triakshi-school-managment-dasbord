import { and, eq, gt, isNotNull, supportVisits, withSchool } from "@smw/db";
import { supportMayEnter } from "@smw/feature-kit";

const EMERGENCY_WINDOW_MS = 3_600_000;

/**
 * Is a support session still allowed in this school? A normal session costs no query: the school row is already loaded.
 * When the school has since said no (`never`, or `until` a time now past), only an owner's emergency visit by the same person keeps it alive.
 */
export async function supportSessionAllowed(
  school: { id: string; row: { supportAccess: string; supportAccessUntil: Date | null } },
  supportStaffId: string | null,
  now = new Date(),
): Promise<boolean> {
  if (!supportStaffId || supportMayEnter(school.row, now)) return true;
  const rows = await withSchool(school.id, (tx) => tx.select({ id: supportVisits.id }).from(supportVisits).where(and(
    eq(supportVisits.staffId, supportStaffId), eq(supportVisits.emergency, true), isNotNull(supportVisits.enteredAt), gt(supportVisits.createdAt, new Date(now.getTime() - EMERGENCY_WINDOW_MS)),
  )).limit(1));
  return rows.length > 0;
}
