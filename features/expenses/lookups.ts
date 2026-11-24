import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { schools, users } from "@smw/db";
import { finAccounts, finCashAccounts, finCostCentres } from "@smw/feature-finance/schema";
import { ExpenseService } from "./base";
import { expVendors } from "./schema";

/** Choices for forms and pickers. Accounts and centres are open to anyone who may claim, so a claim form can list them. */
export class LookupService extends ExpenseService {
  accounts(type: "expense" | "income" = "expense") {
    return this.read("claim", (tx) => tx.select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, group: finAccounts.group }).from(finAccounts).where(and(eq(finAccounts.type, type), eq(finAccounts.isActive, true))).orderBy(asc(finAccounts.code)));
  }
  centres() { return this.read("claim", (tx) => tx.select({ id: finCostCentres.id, name: finCostCentres.name }).from(finCostCentres).where(eq(finCostCentres.isActive, true)).orderBy(asc(finCostCentres.name))); }
  cashAccounts() { return this.read("manage", (tx) => tx.select({ id: finCashAccounts.id, name: finCashAccounts.name, kind: finCashAccounts.kind, isDefault: finCashAccounts.isDefault }).from(finCashAccounts).where(eq(finCashAccounts.isActive, true)).orderBy(asc(finCashAccounts.name))); }
  /** Active people who can hold a petty cash float. */
  people() { return this.read("manage", (tx) => tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.status, "active"), sql`${users.role} in ('admin','accountant','teacher','staff')`)).orderBy(asc(users.name))); }
  /** Vendors matching what was typed, for the picker. */
  async vendors(q: string) {
    return this.read("read", async (tx) => (await tx.select({ id: expVendors.id, name: expVendors.name, gstin: expVendors.gstin, phone: expVendors.phone }).from(expVendors)
      .where(and(eq(expVendors.isActive, true), q.trim() ? or(ilike(expVendors.name, `%${q.trim()}%`), ilike(expVendors.gstin, `%${q.trim()}%`)) : undefined)).orderBy(asc(expVendors.name)).limit(10))
      .map((v) => ({ id: v.id, label: v.name, meta: [v.gstin, v.phone].filter(Boolean).join(" · ") || undefined })));
  }
  /** Transport vehicles, when transport is on. */
  async vehicles() {
    return this.read("manage", async (tx) => {
      const [t] = [...(await tx.execute(sql`select to_regclass('vehicles') as t`))] as { t: string | null }[];
      if (!t?.t) return [];
      return [...(await tx.execute(sql`select id, registration_no as name from vehicles order by registration_no`))] as { id: string; name: string }[];
    });
  }
  async schoolName() { return this.read("claim", async (tx) => (await tx.select({ n: schools.name }).from(schools).limit(1))[0]?.n ?? "School"); }
}
