import type { FeatureSeed } from "@smw/feature-kit";
import type { Ctx } from "@smw/feature-kit";
import { and, eq, inArray, users, withSchool } from "@smw/db";
import { addDays, fyOf, todayIST } from "@smw/feature-kit/money";
import { systemAccounts } from "@smw/feature-finance/chart";
import { finAccounts } from "@smw/feature-finance/schema";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { SettingsService } from "@smw/feature-finance/service";
import { expensesApprovals } from "./approval-handlers";
import { BillService } from "./bills";
import { BudgetService } from "./budgets";
import { ClaimService } from "./claims";
import { IncomeService } from "./income";
import { PaymentService } from "./payments";
import { PettyCashService } from "./petty";
import { RecurringService } from "./recurring";
import { VendorService } from "./vendors";
import { expVendors } from "./schema";

const R = 100;
/** A one-pixel picture: the slip photo the demo spends and claims carry. */
const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const slip = { name: "slip.png", type: "image/png", size: PIXEL.byteLength, bytes: PIXEL };

/**
 * Demo spending: 6 vendors, 14 bills in every state, payments (one for several bills, two part), a petty cash float,
 * three claims, budgets, two recurring costs and two other receipts. Skipped when vendors already exist.
 */
const seed: FeatureSeed = async (ctx) => {
  if (await withSchool(ctx.schoolId, async (tx) => (await tx.select({ id: expVendors.id }).from(expVendors).limit(1)).length > 0)) return;
  const today = todayIST(), at = (n: number) => addDays(today, n);
  const { acc, sys } = await withSchool(ctx.schoolId, async (tx) => {
    const sys = await systemAccounts(tx, ctx.schoolId);
    const rows = await tx.select({ id: finAccounts.id, code: finAccounts.code }).from(finAccounts).where(inArray(finAccounts.code, ["5100", "5110", "5120", "5130", "5140", "5170"]));
    return { sys, acc: Object.fromEntries(rows.map((r) => [r.code, r.id])) as Record<string, string> };
  });

  const settings = new SettingsService(ctx), cur = await settings.get();
  await settings.update({ ...cur, billLimitPaise: 50_000 * R });

  const vendors = new VendorService(ctx);
  const [stationers, electric, housekeeping, landlord, internet, repairs] = await Promise.all([
    vendors.create({ name: "Sharma Stationers", phone: "9810000001", gstin: "07ABCDE1234F1Z5", defaultAccountId: acc["5130"], ifsc: "DEMO0001111", bankAccount: "11112222333", upiId: "sharma@okdemo" }),
    vendors.create({ name: "City Electricals", phone: "9810000002", defaultAccountId: acc["5120"], ifsc: "DEMO0002222", bankAccount: "22223333444" }),
    vendors.create({ name: "Bright Housekeeping", phone: "9810000003", pan: "ABCDE1234F", tdsBasisPoints: 100, defaultAccountId: acc["5170"], ifsc: "DEMO0003333", bankAccount: "33334444555" }),
    vendors.create({ name: "Greenfield Properties", phone: "9810000004", pan: "PQRSX5678L", tdsBasisPoints: 1000, defaultAccountId: acc["5110"], ifsc: "DEMO0004444", bankAccount: "44445555666" }),
    vendors.create({ name: "Jio Fibre", phone: "9810000005", defaultAccountId: acc["5140"] }),
    vendors.create({ name: "Kumar Repairs", phone: "9810000006", defaultAccountId: acc["5120"] }),
  ]);

  const bills = new BillService(ctx);
  const make = async (v: { id: string }, no: string, back: number, dueIn: number, lines: [string, string, number][], submit: boolean) => {
    const b = await bills.save({ vendorId: v.id, billNo: no, billDate: at(-back), dueDate: at(dueIn), lines: lines.map(([a, label, r]) => ({ accountId: acc[a]!, label, amountPaise: r * R })) });
    if (submit) await bills.submit(b.id);
    return b;
  };
  const pay = new PaymentService(ctx);
  const payIt = (v: { id: string }, ids: { id: string }[], amounts: number[], m: "cash" | "bank_transfer" | "upi", ref?: string) =>
    pay.pay({ vendorId: v.id, method: m, reference: ref, allocations: ids.map((b, i) => ({ billId: b.id, amountPaise: amounts[i]! * R })) });

  const s1 = await make(stationers, "SS-1041", 40, -10, [["5130", "Registers and files", 18_000]], true);
  await make(stationers, "SS-1102", 12, 18, [["5130", "Exam paper and pens", 9_500]], true);
  await make(stationers, "SS-1130", 3, 27, [["5130", "Chart paper", 2_400]], false);
  const e1 = await make(electric, "CE-77", 30, -5, [["5120", "Classroom wiring repair", 14_000], ["5100", "Bulbs and fittings", 3_500]], true);
  const e2 = await make(electric, "CE-91", 5, 25, [["5120", "Generator service", 22_000]], true);
  const h1 = await make(housekeeping, "BH-310", 35, -20, [["5170", "Housekeeping, last month", 42_000]], true);
  await make(housekeeping, "BH-322", 6, 24, [["5170", "Housekeeping, this month", 42_000]], true);
  const l1 = await make(landlord, "GP-2611", 20, 10, [["5110", "Annexe rent", 60_000]], true);
  await make(landlord, "GP-2612", 2, 28, [["5110", "Annexe rent, next month", 60_000]], false);
  const j1 = await make(internet, "JF-8841", 25, -3, [["5140", "Broadband", 1_770]], true);
  const j2 = await make(internet, "JF-8902", 4, 26, [["5140", "Broadband", 1_770]], true);
  const k1 = await make(repairs, "KR-12", 15, 15, [["5120", "Roof leak repair", 75_000]], true);
  await make(repairs, "KR-13", 9, 21, [["5120", "Furniture repair", 6_200]], true);
  const k3 = await make(repairs, "KR-14", 8, 22, [["5120", "Gate paint", 4_000]], true);

  const approvals = new ApprovalService(ctx, expensesApprovals);
  const open = await approvals.list({ filters: { status: "pending", kind: "expenses.bill" }, pageSize: 50 });
  const rejected = open.rows.find((r) => r.refId === k1.id);
  if (rejected) await approvals.reject({ id: rejected.id, note: "The quote was not attached. Add the contractor's quote and send again." });
  await bills.cancel(k3.id, "Entered twice by mistake");

  await payIt(stationers, [s1], [18_000], "bank_transfer", "UTR600001");
  await payIt(electric, [e1], [17_500], "bank_transfer", "UTR600002");
  await payIt(housekeeping, [h1], [41_580], "bank_transfer", "UTR600003");
  await payIt(electric, [e2], [10_000], "bank_transfer", "UTR600004");
  await payIt(internet, [j1, j2], [1_770, 700], "upi", "UPI-4412");

  const petty = new PettyCashService(ctx);
  const float = await petty.create({ holderId: ctx.userId, name: "Office petty cash", limitPaise: 10_000 * R });
  await petty.topUp(float.id, { amountPaise: 5_000 * R, method: "cash" });
  await attempt(() => petty.spend(float.id, { amountPaise: 450 * R, accountId: acc["5130"], label: "Tea and sugar for the staff room" }, slip));

  const people = await withSchool(ctx.schoolId, (tx) => tx.select().from(users).where(and(eq(users.status, "active"), inArray(users.role, ["teacher", "accountant", "staff"]))).limit(3));
  const as = (u: (typeof people)[number]): Ctx => ({ ...ctx, userId: u.id, role: u.role, name: u.name });
  if (people[0]) await attempt(async () => {
    await new ClaimService(as(people[0]!)).submit({ title: "Lab chemicals bought in a hurry", spentOn: at(-4), amountPaise: 1_200 * R, accountId: acc["5130"], payWith: "now" }, slip);
    const own = new ClaimService(as(people[1] ?? people[0]!)), c2 = await own.submit({ title: "Taxi to the board office", spentOn: at(-9), amountPaise: 800 * R, accountId: acc["5140"], payWith: "salary" }, slip);
    const c3 = await new ClaimService(as(people[2] ?? people[0]!)).submit({ title: "Printing of sports day banners", spentOn: at(-14), amountPaise: 2_500 * R, accountId: acc["5130"], payWith: "now" }, slip);
    const mgr = new ClaimService(ctx);
    await mgr.approve(c2.id); await mgr.approve(c3.id); await mgr.pay(c3.id, { method: "cash" });
  });

  const fy = fyOf(today), budgets = new BudgetService(ctx);
  for (const [code, year, onOver] of [["5100", 120_000, "warn"], ["5110", 720_000, "warn"], ["5120", 200_000, "block"], ["5130", 90_000, "warn"], ["5170", 500_000, "warn"]] as const) await budgets.save({ fy, accountId: acc[code], yearlyPaise: year * R, onOver });

  const rec = new RecurringService(ctx);
  const first = `${addDays(today, 31).slice(0, 8)}01`;
  await rec.create({ vendorId: landlord.id, label: "Annexe rent", frequency: "monthly", nextOn: first, dueDays: 5, lines: [{ accountId: acc["5110"], label: "Annexe rent", amountPaise: 60_000 * R }] });
  await rec.create({ vendorId: internet.id, label: "Broadband", frequency: "monthly", nextOn: first, dueDays: 10, lines: [{ accountId: acc["5140"], label: "Broadband", amountPaise: 1_770 * R }] });

  const income = new IncomeService(ctx);
  await income.record({ date: at(-6), fromName: "Rotary Club", accountId: sys.other_income, label: "Hall rent for annual meet", amountPaise: 12_000 * R, method: "cash" });
  await income.record({ date: at(-2), fromName: "Demo Bank", accountId: sys.other_income, label: "Savings account interest", amountPaise: 3_200 * R, method: "bank_transfer" });
};

/** The slip photo needs file storage; a demo without storage still seeds everything else. */
async function attempt(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { console.warn(`expenses seed: skipped a step that needs file storage (${String(e).slice(0, 80)})`); }
}
export default seed;
