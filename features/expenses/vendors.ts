import { z } from "zod";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { CrudService, ConflictError, type ListQuery, type Page } from "@smw/feature-kit";
import { seal, unseal } from "@smw/feature-kit/secret";
import type { Tx } from "@smw/db";
import expensesFeature from "./feature";
import { checkAccount, need, type ExpensePermission } from "./base";
import { expBills, expPayments, expRecurring, expVendors } from "./schema";
import { day } from "./inputs";

type Row = typeof expVendors.$inferSelect;
/** What leaves the service: never the sealed values, only the last 4 digits. */
export type Vendor = Omit<Row, "panSealed" | "bankSealed"> & { hasBank: boolean; owedPaise?: number; warnings?: string[] };
export interface StatementRow { date: string; kind: "bill" | "payment"; id: string; ref: string; creditPaise: number; debitPaise: number; balancePaise: number }

const text = (n: number) => z.string().trim().max(n).optional();
const fields = {
  name: z.string().trim().min(2, "Give the vendor a name.").max(120),
  contactName: text(80), phone: text(20), email: z.string().trim().email("That email does not look right.").optional(), address: text(300),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "A GSTIN has 15 characters, like 29ABCDE1234F1Z5.").optional(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "A PAN looks like ABCDE1234F.").optional(),
  bankAccount: z.string().trim().regex(/^\d{6,18}$/, "An account number is 6 to 18 digits.").optional(),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "An IFSC is 4 letters, a zero, then 6 characters.").optional(),
  upiId: z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/, "A UPI ID looks like name@bank.").optional(),
  tdsBasisPoints: z.coerce.number().int().min(0).max(3000).optional(),
  defaultAccountId: z.uuid().optional(),
};

/** Vendors. PAN and bank number are sealed per school; only the last 4 digits leave this class, and `reveal` is audited. */
export class VendorService extends CrudService<typeof expVendors, ExpensePermission, Vendor> {
  protected readonly feature = expensesFeature;
  protected readonly table = expVendors;
  protected readonly entityName = "Vendor";
  protected readonly readPermission = "read";
  protected readonly writePermission = "manage";
  protected readonly createSchema = z.object(fields);
  protected readonly updateSchema = z.object(fields).partial();
  protected searchColumns() { return [expVendors.name, expVendors.gstin, expVendors.phone]; }
  protected sortColumns() { return { createdAt: expVendors.createdAt, name: expVendors.name }; }
  protected defaultSort = "name";
  protected filterClauses(f: Record<string, string | undefined>) { return [f.active ? eq(expVendors.isActive, f.active === "1") : undefined]; }

  private view(r: Row): Vendor {
    const { panSealed: _p, bankSealed: _b, ...rest } = r;
    return { ...rest, hasBank: !!((r.bankLast4 && r.ifsc) || r.upiId) };
  }
  private async seals(data: Record<string, unknown>) {
    const { pan, bankAccount, ...rest } = data as { pan?: string; bankAccount?: string };
    const out: Record<string, unknown> = { ...rest };
    if (pan) Object.assign(out, { panSealed: seal(pan, this.ctx.schoolId), panLast4: pan.slice(-4) });
    if (bankAccount) Object.assign(out, { bankSealed: seal(bankAccount, this.ctx.schoolId), bankLast4: bankAccount.slice(-4) });
    return out;
  }
  private async clean(tx: Tx, data: Record<string, unknown>) {
    if (data.defaultAccountId) await checkAccount(tx, String(data.defaultAccountId), "expense", "defaultAccountId");
    return this.seals(data);
  }
  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) { return this.clean(tx, data); }
  protected async beforeUpdate(tx: Tx, _e: Vendor, data: Record<string, unknown>) { return this.clean(tx, data); }

  /** Other vendors with the same GSTIN or PAN, or a very similar name. A warning, not a refusal: one firm can be listed twice on purpose. */
  async warnings(tx: Tx, v: { name: string; gstin?: string | null; panLast4?: string | null; pan?: string }, exceptId?: string): Promise<string[]> {
    const others = await tx.select().from(expVendors).where(exceptId ? ne(expVendors.id, exceptId) : undefined);
    const out: string[] = [];
    for (const o of others) {
      if (v.gstin && o.gstin === v.gstin) out.push(`${o.name} has the same GSTIN.`);
      else if (v.pan && o.panLast4 === v.pan.slice(-4) && o.panSealed && unseal(o.panSealed, this.ctx.schoolId) === v.pan) out.push(`${o.name} has the same PAN.`);
      else if (o.name.toLowerCase().replace(/\W/g, "") === v.name.toLowerCase().replace(/\W/g, "")) out.push(`${o.name} has almost the same name.`);
    }
    return out;
  }

  async list(query: ListQuery = {}): Promise<Page<Vendor>> {
    const page = await super.list(query) as unknown as Page<Row>;
    const ids = page.rows.map((r) => r.id);
    const owed = new Map<string, number>();
    if (ids.length) await this.read("read", async (tx) => {
      const rows = await tx.select({ id: expBills.vendorId, v: sql<string>`sum(${expBills.grossPaise} - ${expBills.tdsPaise} - ${expBills.paidPaise})` })
        .from(expBills).where(and(inArray(expBills.vendorId, ids), eq(expBills.status, "approved"))).groupBy(expBills.vendorId);
      for (const r of rows) owed.set(r.id, Number(r.v));
    });
    return { ...page, rows: page.rows.map((r) => ({ ...this.view(r), owedPaise: owed.get(r.id) ?? 0 })) };
  }
  async get(id: string): Promise<Vendor> { return this.view(await super.get(id) as unknown as Row); }
  async create(input: unknown): Promise<Vendor> {
    const v = this.view(await super.create(input) as unknown as Row);
    const body = input as { name?: string; pan?: string };
    return { ...v, warnings: await this.read("read", (tx) => this.warnings(tx, { name: v.name, gstin: v.gstin, pan: body.pan }, v.id)) };
  }
  async update(id: string, input: unknown): Promise<Vendor> {
    const v = this.view(await super.update(id, input) as unknown as Row);
    const body = input as { pan?: string };
    return { ...v, warnings: await this.read("read", (tx) => this.warnings(tx, { name: v.name, gstin: v.gstin, pan: body.pan }, v.id)) };
  }
  protected async usage(tx: Tx, e: Vendor): Promise<[string, number][]> {
    const n = async (t: typeof expBills | typeof expPayments | typeof expRecurring) => Number((await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.vendorId, e.id)))[0]?.n ?? 0);
    return [["bills", await n(expBills)], ["payments", await n(expPayments)], ["recurring costs", await n(expRecurring)]];
  }

  async setActive(id: string, active: boolean) {
    return this.write("manage", async (tx) => {
      const [r] = await tx.update(expVendors).set({ isActive: active }).where(eq(expVendors.id, id)).returning();
      if (!r) throw new ConflictError("Vendor not found.");
      return this.view(r);
    }, (r) => ({ action: active ? "enable" : "disable", entity: "Vendor", entityId: r.id, summary: `${active ? "Switched on" : "Switched off"} vendor ${r.name}` }));
  }

  /** The full PAN and bank number, for a person who needs to see them. Audited every time. */
  async reveal(id: string): Promise<{ pan: string | null; bankAccount: string | null }> {
    return this.write("manage", async (tx) => {
      const [r] = await tx.select().from(expVendors).where(eq(expVendors.id, id)).limit(1);
      if (!r) throw new ConflictError("Vendor not found.");
      return { name: r.name, pan: r.panSealed ? unseal(r.panSealed, this.ctx.schoolId) : null, bankAccount: r.bankSealed ? unseal(r.bankSealed, this.ctx.schoolId) : null };
    }, (r) => ({ action: "reveal", entity: "Vendor", entityId: id, summary: `Viewed protected details of vendor ${r.name}` })).then(({ pan, bankAccount }) => ({ pan, bankAccount }));
  }

  /** Bills and payments of one vendor with a running balance (what the school owes). Opening = everything before `from`. */
  async statement(vendorId: string, range: { from?: string; to?: string } = {}) {
    const from = range.from ? day.parse(range.from) : undefined, to = range.to ? day.parse(range.to) : undefined;
    return this.read("read", async (tx) => {
      const vendor = this.view(need(await tx.select().from(expVendors).where(eq(expVendors.id, vendorId)).limit(1).then((r) => r[0]), "Vendor"));
      const bills = await tx.select().from(expBills).where(and(eq(expBills.vendorId, vendorId), eq(expBills.status, "approved")));
      const pays = await tx.select().from(expPayments).where(and(eq(expPayments.vendorId, vendorId), eq(expPayments.status, "valid")));
      const all = [
        ...bills.map((b) => ({ date: b.billDate, kind: "bill" as const, id: b.id, ref: b.billNo, creditPaise: b.grossPaise - b.tdsPaise, debitPaise: 0 })),
        ...pays.map((p) => ({ date: p.date, kind: "payment" as const, id: p.id, ref: p.number, creditPaise: 0, debitPaise: p.amountPaise })),
      ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
      let run = 0, openingPaise = 0;
      const rows: StatementRow[] = [];
      for (const r of all) {
        run += r.creditPaise - r.debitPaise;
        if (from && r.date < from) { openingPaise = run; continue; }
        if (to && r.date > to) continue;
        rows.push({ ...r, balancePaise: run });
      }
      return { vendor, openingPaise, rows, closingPaise: rows.at(-1)?.balancePaise ?? openingPaise };
    });
  }
}
