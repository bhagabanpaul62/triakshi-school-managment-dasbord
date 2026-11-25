import { z } from "zod";
import { and, asc, eq, inArray, like, lte } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { addDays, addMonths, monthEnd, percentOf, todayIST } from "@smw/feature-kit/money";
import { invoices, type Tx } from "@smw/db";
import { dueOf } from "@smw/billing/amounts";
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
  const tdsOf = new Map((await tx.select({ id: expVendors.id, bps: expVendors.tdsBasisPoints }).from(expVendors)).map((v) => [v.id, v.bps]));
  let made = 0;
  for (const r of due) {
    let on = r.nextOn;
    for (let i = 0; i < 12 && on <= today && (!r.endsOn || on <= r.endsOn); i++) {
      const gross = r.lines.reduce((s, l) => s + l.amountPaise, 0);
      const [b] = await tx.insert(expBills).values({ schoolId, vendorId: r.vendorId, billNo: `${r.label} ${on.slice(0, 7)}`, billDate: on, dueDate: addDays(on, r.dueDays), grossPaise: gross, tdsPaise: percentOf(gross, tdsOf.get(r.vendorId) ?? 0), sourceKey: `expenses:recurring:${r.id}:${on}`, note: "Made from a recurring cost. Check the amount, then send it for approval." })
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

const TRIAKSHI_KEY = "triakshi:";

/** Our own vendor is found by the bills it made, never by name: a vendor a person named "Triakshi" is theirs. */
async function triakshiVendor(tx: Tx, schoolId: string): Promise<string> {
  const [made] = await tx.select({ vendorId: expBills.vendorId }).from(expBills).where(like(expBills.sourceKey, `${TRIAKSHI_KEY}%`)).limit(1);
  if (made) return made.vendorId;
  for (const name of ["Triakshi", "Triakshi (platform)"]) {
    const [v] = await tx.insert(expVendors).values({ schoolId, name, contactName: "Triakshi billing" }).onConflictDoNothing().returning({ id: expVendors.id });
    if (v) return v.id;
  }
  throw new ConflictError("Two vendors already use the names Triakshi and Triakshi (platform). Rename one so our subscription bills can be made.");
}

/**
 * Our Triakshi invoices become draft bills for what is still due, once each. A draft follows its invoice: a changed amount
 * updates it, a paid, voided or fully credited invoice cancels it. A bill already sent for approval is left to its approver.
 * Nothing posts until someone approves the bill. Answers how many drafts were made, changed or cancelled.
 */
export async function draftTriakshiBills(tx: Tx, schoolId: string) {
  const list = await tx.select().from(invoices).where(inArray(invoices.status, ["issued", "paid", "void"]));
  if (!list.length) return 0;
  const bills = new Map((await tx.select().from(expBills).where(like(expBills.sourceKey, `${TRIAKSHI_KEY}%`))).map((b) => [b.sourceKey, b]));
  let changed = 0, vendorId: string | undefined, accountId: string | undefined;
  for (const inv of list) {
    const due = dueOf(inv), bill = bills.get(`${TRIAKSHI_KEY}${inv.id}`);
    if (bill) {
      if (bill.status !== "draft") continue;
      if (due <= 0) await tx.update(expBills).set({ status: "cancelled", note: `${bill.note ?? ""}\nCancelled: the invoice is ${inv.status === "issued" ? "fully credited" : inv.status}.`.trim() }).where(eq(expBills.id, bill.id));
      else if (bill.grossPaise !== due) {
        await tx.update(expBills).set({ grossPaise: due }).where(eq(expBills.id, bill.id));
        await tx.update(expBillLines).set({ amountPaise: due }).where(eq(expBillLines.billId, bill.id));
      } else continue;
      changed++;
      continue;
    }
    if (due <= 0) continue;
    vendorId ??= await triakshiVendor(tx, schoolId);
    if (!accountId) {
      const [sub] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.code, "5150"));
      accountId = sub?.id ?? (await systemAccounts(tx, schoolId)).general_expense;
    }
    const date = (inv.createdAt ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [b] = await tx.insert(expBills).values({ schoolId, vendorId, billNo: inv.number, billDate: date, dueDate: inv.dueAt ? inv.dueAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : addDays(date, 14), grossPaise: due, sourceKey: `${TRIAKSHI_KEY}${inv.id}`, note: inv.description }).onConflictDoNothing().returning();
    if (!b) continue;
    await tx.insert(expBillLines).values({ schoolId, billId: b.id, accountId, label: inv.description, amountPaise: due });
    changed++;
  }
  return changed;
}

/** Everything the nightly job does for one school. */
export async function runRecurringJob(tx: Tx, schoolId: string) {
  const [recurring, triakshi] = [await draftRecurringBills(tx, schoolId), await draftTriakshiBills(tx, schoolId)];
  if (recurring + triakshi) await tell(tx, schoolId, await managers(tx), "work.update", "Draft bills are ready", `${recurring + triakshi} new draft bill(s) from recurring costs and Triakshi invoices need a look.`, "/app/expenses/bills?status=draft", { groupKey: "draft-bills", subject: { type: "bills", id: "draft" } });
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
