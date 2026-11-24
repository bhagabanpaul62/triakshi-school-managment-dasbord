import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { seal, unseal } from "@smw/feature-kit/secret";
import { finCostCentres } from "@smw/feature-finance/schema";
import { flag } from "@smw/feature-finance/services/common";
import { PayrollService, type Person } from "../base";
import { payConfigInput, type PayConfig } from "../config";
import { payAssignments, payConfig, payProfiles, payStructures } from "../schema";

export type Profile = typeof payProfiles.$inferSelect;
export interface Missing { code: "assignment" | "pan" | "bank" | "uan" | "esi" | "state"; text: string }

/** What is still needed before this person can be paid properly. One list for the people page, the run's blockers and the checklist. */
export function missingDetails(p: Profile | null, config: PayConfig, hasAssignment: boolean): Missing[] {
  const out: Missing[] = [];
  if (!hasAssignment) out.push({ code: "assignment", text: "No pay set up" });
  if (!p?.panSealed) out.push({ code: "pan", text: "No PAN" });
  if ((p?.payBy ?? "bank") === "bank" && !(p?.bankSealed && p.ifsc)) out.push({ code: "bank", text: "No bank account" });
  if ((p?.pfApplies ?? config.pf) && !p?.uanSealed) out.push({ code: "uan", text: "No UAN" });
  if ((p?.esiApplies ?? config.esi) && !p?.esiSealed) out.push({ code: "esi", text: "No ESI number" });
  if ((p?.ptApplies ?? config.pt) && !(p?.state ?? config.state)) out.push({ code: "state", text: "No state for professional tax" });
  return out;
}

/** "auto" = leave it to the school's settings. */
const tri = z.enum(["auto", "yes", "no"]).default("auto").transform((v) => (v === "auto" ? null : v === "yes"));
const optional = (re: RegExp, msg: string) => z.string().trim().toUpperCase().transform((v) => v.replace(/\s+/g, "")).pipe(z.union([z.literal(""), z.string().regex(re, msg)])).optional();
export const profileInput = z.object({
  pan: optional(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "A PAN looks like ABCDE1234F."),
  uan: optional(/^\d{12}$/, "A UAN has 12 digits."),
  esi: optional(/^\d{10,17}$/, "An ESI number has 10 to 17 digits."),
  bankAccount: optional(/^\d{9,18}$/, "An account number has 9 to 18 digits."),
  bankName: z.string().trim().max(80).optional(),
  ifsc: optional(/^[A-Z]{4}0[A-Z0-9]{6}$/, "An IFSC looks like HDFC0001234."),
  payBy: z.enum(["bank", "cash", "cheque"]).default("bank"),
  regime: z.enum(["new", "old"]).default("new"),
  state: z.string().trim().max(60).optional(),
  pfApplies: tri, esiApplies: tri, ptApplies: tri,
  costCentreId: z.uuid().optional(),
  pfOnFullWages: flag, skipMonthly: flag,
});
const FIELDS = { pan: ["panSealed", "panLast4"], uan: ["uanSealed", "uanLast4"], esi: ["esiSealed", "esiLast4"], bankAccount: ["bankSealed", "bankLast4"] } as const;
export type SealedField = keyof typeof FIELDS;

/** A profile as screens see it: only the last four characters of anything sealed. */
export type ProfileView = Omit<Profile, "panSealed" | "uanSealed" | "esiSealed" | "bankSealed"> & { has: Record<SealedField, boolean> };
const view = (p: Profile): ProfileView => {
  const { panSealed, uanSealed, esiSealed, bankSealed, ...rest } = p;
  return { ...rest, has: { pan: !!panSealed, uan: !!uanSealed, esi: !!esiSealed, bankAccount: !!bankSealed } };
};

export interface PersonRow extends Person { payBy: string; hasAssignment: boolean; grossPaise: number | null; structure: string | null; missing: Missing[] }

export class ProfileService extends PayrollService {
  /** Everyone on the staff list with what is missing for their pay. shortcut: filtered in memory, fine for a school's staff (hundreds); page in SQL if a school passes a few thousand. */
  async list(query: ListQuery = {}): Promise<Page<PersonRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const rows = await this.rows(tx);
      const needle = q.q?.toLowerCase();
      const hit = rows.filter((r) => (!needle || `${r.name} ${r.employeeId}`.toLowerCase().includes(needle)) && (!q.filters.department || r.department === q.filters.department)
        && (q.filters.state === "left" ? r.left : !r.left) && (q.filters.missing !== "1" || r.missing.length > 0));
      return toPage(hit.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), hit.length, q);
    });
  }

  /** Paid leave that could be cashed out today, when attendance is on. */
  async leaveBalance(userId: string): Promise<{ name: string; days: number }[]> {
    if (!this.attendanceOn) return [];
    return this.read("read", async (tx) => (await this.sources.days.encashable(tx, userId, new Date().toISOString().slice(0, 10))).map((e) => ({ name: e.name, days: e.halfDays / 2 })));
  }

  /** Active cost centres a person's salary can be charged to. */
  costCentres(): Promise<{ id: string; name: string }[]> { return this.read("read", (tx) => tx.select({ id: finCostCentres.id, name: finCostCentres.name }).from(finCostCentres).where(eq(finCostCentres.isActive, true)).orderBy(finCostCentres.name)); }

  /** Every active person, for CSV and the run's group pickers. */
  all(): Promise<PersonRow[]> { return this.read("read", async (tx) => (await this.rows(tx)).filter((r) => !r.left)); }

  async departments(): Promise<string[]> { return this.read("read", async (tx) => [...new Set([...(await this.people(tx)).values()].map((p) => p.department).filter((d): d is string => !!d))].sort()); }

  private async rows(tx: Tx): Promise<PersonRow[]> {
    const [people, profiles, assigns, structures, config] = await Promise.all([
      this.people(tx), tx.select().from(payProfiles), tx.select().from(payAssignments).orderBy(desc(payAssignments.fromDate)), tx.select().from(payStructures), this.config(tx),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const prof = profiles.find((x) => x.userId === p.id) ?? null;
      const a = assigns.find((x) => x.userId === p.id && x.fromDate <= today) ?? assigns.find((x) => x.userId === p.id) ?? null;
      return { ...p, payBy: prof?.payBy ?? "bank", hasAssignment: !!a, grossPaise: a ? Number(a.grossPaise) : null, structure: structures.find((s) => s.id === a?.structureId)?.name ?? null, missing: p.left ? [] : missingDetails(prof, config, !!a) };
    });
  }

  async get(userId: string): Promise<{ person: Person; profile: ProfileView | null; missing: Missing[] }> {
    return this.read("read", async (tx) => {
      const person = (await this.people(tx, [userId])).get(userId);
      if (!person) throw new NotFoundError("Person");
      const [p] = await tx.select().from(payProfiles).where(eq(payProfiles.userId, userId));
      const [a] = await tx.select({ id: payAssignments.id }).from(payAssignments).where(eq(payAssignments.userId, userId)).limit(1);
      return { person, profile: p ? view(p) : null, missing: missingDetails(p ?? null, await this.config(tx), !!a) };
    });
  }

  /** Save pay details. A blank sealed field keeps what is stored; the audit says which fields changed, never their values. */
  async save(userId: string, input: unknown): Promise<ProfileView> {
    this.authorize("manage", "write");
    const d = this.parse(profileInput, input);
    return this.write("manage", async (tx) => {
      if (!(await this.people(tx, [userId])).has(userId)) throw new NotFoundError("Person");
      await this.notSelf(tx, userId, "change your own pay details");
      const [before] = await tx.select().from(payProfiles).where(eq(payProfiles.userId, userId));
      const set: Partial<typeof payProfiles.$inferInsert> = { payBy: d.payBy, regime: d.regime, state: d.state || null, pfApplies: d.pfApplies, esiApplies: d.esiApplies, ptApplies: d.ptApplies, pfOnFullWages: d.pfOnFullWages, paysMonthly: !d.skipMonthly, costCentreId: d.costCentreId ?? null };
      if (d.costCentreId && !(await tx.select({ id: finCostCentres.id }).from(finCostCentres).where(eq(finCostCentres.id, d.costCentreId))).length) throw new ValidationError({ costCentreId: "Pick one of this school's cost centres." });
      if (d.bankName !== undefined) set.bankName = d.bankName || null;
      if (d.ifsc) set.ifsc = d.ifsc;
      for (const [k, [sealed, last4]] of Object.entries(FIELDS) as [SealedField, readonly [string, string]][]) {
        const v = d[k];
        if (v) Object.assign(set, { [sealed]: seal(v, this.ctx.schoolId), [last4]: v.slice(-4) });
      }
      // A new account number or IFSC is written to the audit log (last four only, old to new) and stamped, so runs can flag recent changes.
      const moved = (d.bankAccount && (!before?.bankSealed || unseal(before.bankSealed, this.ctx.schoolId) !== d.bankAccount)) || (d.ifsc && d.ifsc !== before?.ifsc);
      if (moved) set.bankChangedAt = new Date();
      const [row] = await tx.insert(payProfiles).values({ schoolId: this.ctx.schoolId, userId, ...set }).onConflictDoUpdate({ target: payProfiles.userId, set }).returning();
      if (moved) await this.audit(tx, { action: "bank_change", entity: "PayProfile", entityId: row!.id, summary: "Changed bank details", meta: { userId, account: `${before?.bankLast4 ? `••••${before.bankLast4}` : "none"} to ${row!.bankLast4 ? `••••${row!.bankLast4}` : "none"}`, ifsc: `${before?.ifsc ?? "none"} to ${row!.ifsc ?? "none"}` } });
      return row!;
    }, (r) => ({ action: "update", entity: "PayProfile", entityId: r.id, summary: "Updated pay details", meta: { userId, changed: Object.keys(d).filter((k) => d[k as keyof typeof d] !== undefined && d[k as keyof typeof d] !== "") } })).then(view);
  }

  /** Cash or cheque instead of the bank, from the run's blockers. */
  async switchPayBy(userId: string, payBy: "bank" | "cash" | "cheque"): Promise<void> {
    this.authorize("manage", "write");
    await this.write("manage", async (tx) => {
      await this.notSelf(tx, userId, "change how you are paid");
      await tx.insert(payProfiles).values({ schoolId: this.ctx.schoolId, userId, payBy }).onConflictDoUpdate({ target: payProfiles.userId, set: { payBy } });
    }, () => ({ action: "update", entity: "PayProfile", summary: `Pay by ${payBy}`, meta: { userId } }));
  }

  /** One sealed value in the clear, for the person looking at it. Every reveal is audited. */
  async reveal(userId: string, field: SealedField): Promise<string> {
    this.authorize("manage", "read");
    const col = FIELDS[field]?.[0];
    if (!col) throw new ValidationError({ field: "Unknown detail." });
    return this.write("manage", async (tx) => {
      const [p] = await tx.select().from(payProfiles).where(eq(payProfiles.userId, userId));
      const sealed = p?.[col];
      if (!sealed) throw new NotFoundError("Detail");
      await this.audit(tx, { action: "reveal", entity: "PayProfile", entityId: p.id, summary: `Viewed ${field} of a person`, meta: { userId, field } });
      return unseal(sealed, this.ctx.schoolId);
    });
  }
}

export class PayConfigService extends PayrollService {
  get(): Promise<PayConfig & { saved: boolean }> { return this.read("read", (tx) => this.config(tx)); }

  async save(input: unknown): Promise<PayConfig> {
    this.authorize("manage", "write");
    const config = this.parse(payConfigInput, input);
    return this.write("manage", async (tx) => {
      await tx.insert(payConfig).values({ schoolId: this.ctx.schoolId, config }).onConflictDoUpdate({ target: payConfig.schoolId, set: { config } });
      return config;
    }, () => ({ action: "update", entity: "PayConfig", summary: "Changed payroll settings", meta: config }));
  }
}
