// What stops a run from being reviewed, and from being approved. One list, used by the run screen, by review and again at approval.
import type { ItemRow, LineRow } from "./compute";
import { TYPED_CODES } from "./compute";
import type { Flag } from "./engine";
import type { RunRow } from "./ledger";
import type { payProfiles } from "./schema";

export interface Blocker { code: "unmarked" | "negative" | "bank" | "typed" | "empty" | "stale"; message: string; itemId?: string; userId?: string; href: string; fix?: "switch_pay_by" | "count_worked" }

/** `live` are the run's people who are not left out. `attendanceOn` adds the unmarked-days check, which only matters while the run is being built. */
export function reviewBlockers(run: RunRow, live: ItemRow[], names: Map<string, string>, lines: LineRow[], profiles: (typeof payProfiles.$inferSelect)[], attendanceOn = false): Blocker[] {
  const out: Blocker[] = [];
  if (!live.length) out.push({ code: "empty", message: "Nobody is in this run. Add people with pay set up.", href: "/app/payroll/people" });
  for (const i of live) {
    const name = names.get(i.userId) ?? "Someone", here = `/app/payroll/runs/${run.id}?item=${i.id}`, mine = lines.filter((l) => l.itemId === i.id), net = Number(i.netPaise);
    const at = { itemId: i.id, userId: i.userId };
    if (attendanceOn && i.unmarkedDays > (i.unmarkedOk ?? 0)) out.push({ code: "unmarked", message: `${name} has ${i.unmarkedDays} unmarked day${i.unmarkedDays === 1 ? "" : "s"}. Mark attendance or leave for them, or count the days as worked.`, ...at, href: `/app/attendance/staff/register?month=${run.month.slice(0, 7)}`, fix: "count_worked" });
    if (net < 0) out.push({ code: "negative", message: `${name}'s deductions are ${(Math.abs(net) / 100).toLocaleString("en-IN")} rupees more than pay. Lower a deduction or pause a loan.`, ...at, href: here });
    const prof = profiles.find((p) => p.userId === i.userId);
    if (net > 0 && (prof?.payBy ?? "bank") === "bank" && !(prof?.bankSealed && prof.ifsc)) out.push({ code: "bank", message: `${name} has no bank account. Add one or pay by cash or cheque.`, ...at, href: `/app/payroll/people/${i.userId}?next=${encodeURIComponent(`/app/payroll/runs/${run.id}`)}`, fix: "switch_pay_by" });
    for (const l of mine) if (!l.manual && Number(l.amountPaise) === 0 && (TYPED_CODES as readonly string[]).includes(l.code ?? "")) out.push({ code: "typed", message: `${name}: ${l.note ?? `${l.label} needs an amount.`}`, ...at, href: here });
    for (const f of ((i.snapshot as { flags?: Flag[] }).flags ?? []).filter((f) => f.code === "needs_input" && f.line === "rates")) out.push({ code: "typed", message: `${name}: ${f.message}`, ...at, href: "/app/payroll/statutory" });
    const sum = (kind: LineRow["kind"]) => mine.filter((l) => l.kind === kind && l.code !== "claim").reduce((a, l) => a + Number(l.amountPaise), 0);
    if (sum("earning") !== Number(i.grossPaise) || sum("deduction") !== Number(i.deductionsPaise) || sum("employer") !== Number(i.employerPaise)) out.push({ code: "stale", message: `${name}'s pay no longer matches its lines, for example a typed amount for a charge that does not apply now. Work the run out again.`, ...at, href: here });
  }
  return out;
}
