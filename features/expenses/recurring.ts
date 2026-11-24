import { z } from "zod";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { NotFoundError } from "@smw/feature-kit";
import { addDays, addMonths, monthEnd, todayIST } from "@smw/feature-kit/money";
import { invoices, type Tx } from "@smw/db";
import { systemAccounts } from "@smw/feature-finance/chart";
import { finAccounts } from "@smw/feature-finance/schema";
import { FREQUENCIES } from "./constants";
import { ExpenseService, checkAccount, checkCentre, managers, need, tell } from "./base";
import { day, optionalId, paiseAmount } from "./inputs";
import { expBillLines, expBills, expRecurring, expVendors } from "./schema";

export type Recurring = typeof expRecurring.$inferSelect;
const STEP: Record<(typeof FREQUENCIES)[number], number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/** The same day-of-month some months on; "31st" falls on the last day of a shorter month. */
export function nextDate(from: string, frequency: (typeof FREQUENCIES)[number]): string {
  const first = addMonths(from, STEP[frequency]);
  return `${first.slice(0, 8)}${String(Math.min(+from.slice(8), +monthEnd(first).slice(8))).padStart(2, "0")}`;
}

const lineInput = z.object({ accountId: z.uuid(), costCentreId: optionalId, label: z.string().trim().min(1).max(160), amountPaise: paiseAmount });
const fields = z.object({
  vendorId: z.uuid("Choose a vendor."), label: z.string().trim().min(2, "Name it, like Office rent.").max(80), frequency: z.enum(FREQUENCIES),
  nextOn: day, endsOn: day.optional(), dueDays: z.coerce.number().int().min(0).max(120).default(7),
  lines: z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.array(lineInput).min(1, "Add at least one line.").max(20)),
});

/** Draft one bill per due period for every active recurring cost. Safe to run any number of times a day: the source key makes a period one bill. */
export async function draftRecurringBills(tx: Tx, schoolId: string, today = todayIST()) {
  const due = await tx.select().from(expRecurring).where(and(eq(expRecurring.isActive, true), lte(expRecurring.nextOn, today))).orderBy(asc(expRecurring.nextOn)).for("update");
  let made = 0;
  for (const r of due) {
    let on = r.nextOn;
    for (let i = 0; i < 12 && on <= today && (!r.endsOn || on <= r.endsOn); i++) {
      const gross = r.lines.reduce((s, l) => s + l.amountPaise, 0);
      const [b] = await tx.insert(expBills).values({ schoolId, vendorId: r.vendorId, billNo: `${r.label} ${on.slice(0, 7)}`, billDate: on, dueDate: addDays(on, r.dueDays), grossPaise: gross, sourceKey: `expenses:recurring:${r.id}:${on}`, note: "Made from a recurring cost. Check the amount, then send it for approval." })
        .onConflictDoNothing().returning();
      if (b) {
        await tx.insert(expBillLines).values(r.lines.map((l, k) => ({ schoolId, billId: b.id, accountId: l.accountId, costCentreId: l.costCentreId ?? null, label: l.label, amountPaise: l.amountPaise, sort: k })));
        made++;
      }
      on = nextDate(on, r.frequency);
    }
    await tx.update(expRecurring).set({ nextOn: on, isActive: r.endsOn ? on <= r.endsOn : true }).where(eq(expRecurring.id, r.id));
  }
  return made;
}

/** The school's own Triakshi invoices become draft bills, once each. Nothing posts until someone approves the bill. */
export async function draftTriakshiBills(tx: Tx, schoolId: string) {
  const list = await tx.select().from(invoices).where(inArray(invoices.status, ["issued", "paid"]));
  if (!list.length) return 0;
  let [vendor] = await tx.select().from(expVendors).where(eq(expVendors.name, "Triakshi"));
  vendor ??= (await tx.insert(expVendors).values({ schoolId, name: "Triakshi", contactName: "Triakshi billing" }).onConflictDoNothing().returning())[0] ?? (await tx.select().from(expVendors).where(eq(expVendors.name, "Triakshi")))[0]!;
  const [sub] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.code, "5150"));
  const accountId = sub?.id ?? (await systemAccounts(tx, schoolId)).general_expense;
  let made = 0;
  for (const inv of list) {
    if (!inv.totalPaise) continue;
    const date = (inv.createdAt ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [b] = await tx.insert(expBills).values({ schoolId, vendorId: vendor.id, billNo: inv.number, billDate: date, dueDate: inv.dueAt ? inv.dueAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : addDays(date, 14), grossPaise: inv.totalPaise, sourceKey: `triakshi:${inv.id}`, note: inv.description }).onConflictDoNothing().returning();
    if (!b) continue;
    await tx.insert(expBillLines).values({ schoolId, billId: b.id, accountId, label: inv.description, amountPaise: inv.totalPaise });
    made++;
  }
  return made;
}

/** Everything the nightly job does for one school. */
export async function runRecurringJob(tx: Tx, schoolId: string) {
  const [recurring, triakshi] = [await draftRecurringBills(tx, schoolId), await draftTriakshiBills(tx, schoolId)];
  if (recurring + triakshi) await tell(tx, schoolId, await managers(tx), "Draft bills are ready", `${recurring + triakshi} new draft bill(s) from recurring costs and Triakshi invoices need a look.`, "/app/expenses/bills?status=draft");
  return { recurring, triakshi };
}

export class RecurringService extends ExpenseService {
  async list() {
    return this.read("read", async (tx) => (await tx.select({ r: expRecurring, vendorName: expVendors.name }).from(expRecurring).innerJoin(expVendors, eq(expVendors.id, expRecurring.vendorId)).orderBy(asc(expRecurring.nextOn)))
      .map(({ r, vendorName }) => ({ ...r, vendorName, amountPaise: r.lines.reduce((s, l) => s + l.amountPaise, 0) })));
  }
  async get(id: string) {
    return this.read("read", async (tx) => need((await tx.select().from(expRecurring).where(eq(expRecurring.id, id)))[0], "Recurring cost"));
  }
  private async check(tx: Tx, d: z.infer<typeof fields>) {
    need((await tx.select({ id: expVendors.id }).from(expVendors).where(eq(expVendors.id, d.vendorId)))[0], "Vendor");
    for (const l of d.lines) { await checkAccount(tx, l.accountId, "expense", "lines"); await checkCentre(tx, l.costCentreId, "lines"); }
  }
  async create(input: unknown) {
    const d = this.parse(fields, input);
    return this.write("manage", async (tx) => { await this.check(tx, d); return (await tx.insert(expRecurring).values({ schoolId: this.ctx.schoolId, ...d, endsOn: d.endsOn ?? null }).returning())[0]!; },
      (r) => ({ action: "create", entity: "Recurring cost", entityId: r.id, summary: `Added recurring cost ${r.label}` }));
  }
  async update(id: string, input: unknown) {
    const d = this.parse(fields, input);
    return this.write("manage", async (tx) => { await this.check(tx, d); return (await tx.update(expRecurring).set({ ...d, endsOn: d.endsOn ?? null, isActive: true }).where(eq(expRecurring.id, id)).returning())[0] ?? (() => { throw new NotFoundError("Recurring cost"); })(); },
      (r) => ({ action: "update", entity: "Recurring cost", entityId: r.id, summary: `Updated recurring cost ${r.label}` }));
  }
  async setActive(id: string, active: boolean) {
    return this.write("manage", async (tx) => (await tx.update(expRecurring).set({ isActive: active }).where(eq(expRecurring.id, id)).returning())[0] ?? (() => { throw new NotFoundError("Recurring cost"); })(),
      (r) => ({ action: active ? "enable" : "pause", entity: "Recurring cost", entityId: r.id, summary: `${active ? "Resumed" : "Paused"} recurring cost ${r.label}` }));
  }
  async remove(id: string) {
    return this.write("manage", async (tx) => { const [r] = await tx.delete(expRecurring).where(eq(expRecurring.id, id)).returning(); if (!r) throw new NotFoundError("Recurring cost"); return r; },
      (r) => ({ action: "delete", entity: "Recurring cost", entityId: r.id, summary: `Removed recurring cost ${r.label}` }));
  }

  /** Make the drafts that are due now, for a person who does not want to wait for the night. */
  async runNow() { return this.write("manage", (tx) => runRecurringJob(tx, this.ctx.schoolId), (r) => ({ action: "run", entity: "Recurring cost", summary: `Made ${r.recurring + r.triakshi} draft bill(s)` })); }

  /** What will come due in the next months, for the calendar. */
  async calendar(months = 6) {
    const end = addMonths(todayIST(), months);
    return (await this.list()).filter((r) => r.isActive).flatMap((r) => {
      const out: { date: string; label: string; vendorName: string; amountPaise: number; id: string }[] = [];
      for (let on = r.nextOn; on < end && (!r.endsOn || on <= r.endsOn) && out.length < 24; on = nextDate(on, r.frequency)) out.push({ date: on, label: r.label, vendorName: r.vendorName, amountPaise: r.amountPaise, id: r.id });
      return out;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
}
