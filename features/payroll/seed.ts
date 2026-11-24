import type { FeatureSeed, Ctx } from "@smw/feature-kit";
import { withSchool } from "@smw/db";
import { addDays, addMonths, monthEnd, monthStart, todayIST } from "@smw/feature-kit/money";
import { staffAttendance } from "@smw/feature-attendance/schema";
import { approveRun } from "./ledger";
import { payLoans } from "./schema";
import { AssignmentService, ExitService, LoanService, PayConfigService, PayoutService, ProfileService, RunService, StructureService } from "./service";

const comp = (label: string, mode: string, value: number, o: Record<string, unknown> = {}) => ({ label, kind: "earning", mode, value, ...o });
const STRUCTURES = {
  teaching: { name: "Teaching staff", components: [comp("Basic", "percent_of_gross", 5000, { isBasic: true, isWage: true }), comp("House rent allowance", "percent_of_basic", 4000), comp("Special allowance", "remainder", 0)] },
  support: { name: "Support staff", components: [comp("Basic", "percent_of_gross", 6000, { isBasic: true, isWage: true }), comp("Allowance", "remainder", 0)] },
  visiting: { name: "Visiting and hourly", components: [] },
};
const GROSS: Record<string, number> = { PGT: 52_000, TGT: 38_000, PRT: 30_000 };

/** Demo payroll: pay details and pay for every staff member, three paid months, a loan, this month as a draft with two people whose days are unmarked, and one exit in draft. Skipped when payroll was already set up. */
const seed: FeatureSeed = async (ctx) => {
  const profiles = new ProfileService(ctx);
  const staff = (await profiles.all());
  if (!staff.length) return;
  if ((await new StructureService(ctx).list()).length) return;
  await new PayConfigService(ctx).save({ pf: true, esi: false, pt: true, lwf: false, tds: true, state: "Karnataka", lopBasis: "calendar" });
  const made: Record<string, string> = {};
  for (const [k, s] of Object.entries(STRUCTURES)) made[k] = (await new StructureService(ctx).save(s)).id;

  const today = todayIST(), thisMonth = monthStart(today), start = addMonths(thisMonth, -6);
  const assign = new AssignmentService(ctx);
  for (const [i, p] of staff.entries()) {
    await profiles.save(p.id, { pan: `ABCDE${String(1000 + i)}F`, uan: String(100_000_000_000 + i * 7919), bankAccount: String(5_000_000_000 + i * 104_729), bankName: "Demo Bank", ifsc: "DEMO0001234", payBy: i === staff.length - 1 ? "cash" : "bank", state: "Karnataka" });
    const designation = (p.designation ?? "").toUpperCase();
    await assign.assign({ userId: p.id, structureId: made[GROSS[designation] ? "teaching" : "support"], grossPaise: (GROSS[designation] ?? 25_000) * 100, fromDate: start, reason: "Starting pay" });
  }
  if (staff[2]) await assign.assign({ userId: staff[2].id, structureId: made.teaching!, grossPaise: Math.round(((GROSS[(staff[2].designation ?? "").toUpperCase()] ?? 25_000) * 110) / 100) * 100, fromDate: addMonths(thisMonth, 1), reason: "Yearly raise, from next month" });

  // The first loan, given before the past runs so they recover it.
  if (staff[1]) {
    const loan = await withSchool(ctx.schoolId, async (tx) => (await tx.insert(payLoans).values({ schoolId: ctx.schoolId, userId: staff[1]!.id, amountPaise: 3_000_000, emiPaise: 200_000, startsOn: addMonths(thisMonth, -3), reason: "Medical advance", status: "active", createdBy: ctx.userId }).returning())[0]!);
    await new LoanService(ctx).give(loan.id, { date: today });
  }

  // Past months: days by hand (full months), approved and paid.
  const noAttendance: Ctx = { ...ctx, features: new Set([...ctx.features].filter((f) => f !== "attendance")) };
  for (const back of [3, 2, 1]) {
    const runs = new RunService(noAttendance);
    const run = await runs.create({ month: addMonths(thisMonth, -back) });
    await runs.review(run.id);
    await withSchool(ctx.schoolId, (tx) => approveRun(tx, { schoolId: ctx.schoolId, userId: ctx.userId }, run.id, ctx.userId));
    await new PayoutService(noAttendance).markPaid(run.id, { date: today, reference: `DEMO-${back}` });
  }

  // This month: attendance for everyone except two people, so the draft has two blockers to fix.
  if (ctx.features.has("attendance")) {
    const days: string[] = [];
    for (let d = thisMonth; d <= monthEnd(thisMonth); d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) days.push(d);
    await withSchool(ctx.schoolId, async (tx) => {
      const rows = staff.flatMap((p, i) => (i < 2 ? days.slice(0, -2) : days).map((date) => ({ schoolId: ctx.schoolId, userId: p.id, date, status: "present" as const })));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(staffAttendance).values(rows.slice(i, i + 500)).onConflictDoNothing();
    });
  }
  await new RunService(ctx).create({ month: thisMonth });

  const leaver = staff.at(-1);
  if (leaver) await new ExitService(ctx).create({ userId: leaver.id, lastDay: monthEnd(thisMonth), reason: "Moving to another city", noticeDays: 0 });
};
export default seed;
