// Transport fee billing (A10). The fee is a monthly charge on the student's fee ledger, posted through the
// fees feature's charge API. It starts the first of the month after the assignment and runs to the end of the
// academic year; moving or unassigning ends the old months from the month after, and nothing is pro-rated.
import { eq, inArray } from "drizzle-orm";
import { students } from "@smw/feature-students/schema";
import { withSchool, type Tx } from "@smw/db";
import { cancelUnpaidCharges, ledgerYear, postCharges } from "@smw/feature-fees/charges";
import { monthLabel, monthStarts, monthlyFeeFor, nextMonthStart } from "./rules";
import { routeStops, studentTransport } from "./schema";

/**
 * Make the student's unpaid transport charges match `feePaise` a month from `from` (a first of a month). 0 stops billing.
 * Months already paid are left alone. A school with no academic year has no ledger yet, so nothing is posted.
 */
export async function syncTransportCharges(tx: Tx, schoolId: string, studentId: string, feePaise: number, from: string): Promise<number> {
  const year = await ledgerYear(tx);
  if (!year) return 0;
  await cancelUnpaidCharges(tx, studentId, "transport", from);
  if (feePaise <= 0) return 0;
  const first = from < year.startsOn ? year.startsOn.slice(0, 8) + "01" : from;
  const rows = monthStarts(first, year.endsOn).map((d) => ({
    studentId, kind: "transport" as const, label: `Transport, ${monthLabel(d)}`, dueDate: d, amountPaise: feePaise, sourceKey: `transport:${studentId}:${d.slice(0, 7)}`,
  }));
  return postCharges(tx, schoolId, year.id, rows);
}

/**
 * Monthly re-sync for one school: every rider's unpaid transport months from this month (or the month after they
 * joined) to the end of the current academic year match today's stop fee. Fills the new year's months after a rollover
 * and re-prices unpaid months after a stop fee changes. Paid months are never touched; safe to run any number of times.
 */
export async function resyncSchoolTransport(schoolId: string, today: string): Promise<number> {
  const thisMonth = today.slice(0, 8) + "01";
  return withSchool(schoolId, async (tx) => {
    const riders = await tx.select({ studentId: studentTransport.studentId, startsOn: studentTransport.startsOn, pickup: studentTransport.pickup, drop: studentTransport.drop, fee: routeStops.monthlyFeePaise })
      .from(studentTransport).innerJoin(routeStops, eq(routeStops.id, studentTransport.stopId));
    const state = riders.length ? await tx.select({ id: students.id, status: students.status, leftOn: students.leftOn }).from(students).where(inArray(students.id, riders.map((r) => r.studentId))) : [];
    const stateOf = new Map(state.map((x) => [x.id, x]));
    let posted = 0;
    for (const r of riders) {
      // A student who left keeps their stop row but pays for no more months: what is unpaid from the month after they left is cancelled.
      const st = stateOf.get(r.studentId);
      if (st && st.status !== "active") { await syncTransportCharges(tx, schoolId, r.studentId, 0, nextMonthStart(st.leftOn ?? today)); continue; }
      const joined = nextMonthStart(r.startsOn);
      posted += await syncTransportCharges(tx, schoolId, r.studentId, monthlyFeeFor(r.fee, r.pickup, r.drop), joined > thisMonth ? joined : thisMonth);
    }
    return posted;
  });
}
