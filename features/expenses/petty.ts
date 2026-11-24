import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, allows } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { users, type Tx } from "@smw/db";
import type { PostLine } from "@smw/feature-finance/posting";
import { finAccounts } from "@smw/feature-finance/schema";
import { ExpenseService, checkAccount, checkCentre, cashFor, journalIdSql, need } from "./base";
import { ExpenseFiles, type UploadedFile } from "./files";
import { day, method, optionalId, paiseAmount } from "./inputs";
import { expPettyEntries, expPettyFloats } from "./schema";

export type PettyFloat = typeof expPettyFloats.$inferSelect;
const entrySign = { top_up: 1, return: -1, spend: -1 } as const;

const floatInput = z.object({ holderId: z.uuid("Choose who holds it."), name: z.string().trim().min(2, "Give it a name.").max(60), limitPaise: paiseAmount });
const topUp = z.object({ amountPaise: paiseAmount, date: day.optional(), method: method.exclude(["cheque"]).default("cash"), cashAccountId: optionalId });
const spend = z.object({ amountPaise: paiseAmount, date: day.optional(), accountId: z.uuid("Choose what it was spent on."), costCentreId: optionalId, label: z.string().trim().min(2, "Say what it was for.").max(160) });
const giveBack = z.object({ amountPaise: paiseAmount, date: day.optional(), method: method.exclude(["cheque"]).default("cash"), cashAccountId: optionalId });

/** Imprest floats held by staff. Balance = top-ups minus spends and returns, never below zero and never above the float's limit. */
export class PettyCashService extends ExpenseService {
  private get files() { return new ExpenseFiles(this.ctx.schoolId); }

  private balanceSql() {
    return sql<string>`coalesce((select sum(case e.kind when 'top_up' then e.amount_paise else -e.amount_paise end) from exp_petty_entries e where e.float_id = ${expPettyFloats.id} and e.status = 'posted'), 0)`;
  }

  /** Floats with their balance. A holder who only has `claim` sees their own float. */
  async floats() {
    const all = this.can("read");
    if (!all && !this.can("claim")) throw new ForbiddenError();
    return this.read(all ? "read" : "claim", async (tx) => {
      const rows = await tx.select({ f: expPettyFloats, holderName: users.name, balance: this.balanceSql() }).from(expPettyFloats).innerJoin(users, eq(users.id, expPettyFloats.holderId))
        .where(all ? undefined : eq(expPettyFloats.holderId, this.ctx.userId)).orderBy(asc(expPettyFloats.name));
      return rows.map(({ f, holderName, balance }) => ({ ...f, holderName, balancePaise: Number(balance) }));
    });
  }

  async create(input: unknown) {
    const d = this.parse(floatInput, input);
    return this.write("manage", async (tx) => {
      const [h] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, d.holderId), eq(users.status, "active")));
      if (!h) throw new ValidationError({ holderId: "Choose an active person of this school." });
      try { return (await tx.insert(expPettyFloats).values({ schoolId: this.ctx.schoolId, ...d }).returning())[0]!; }
      catch { throw new ConflictError(`A float called ${d.name} already exists.`); }
    }, (r) => ({ action: "create", entity: "Petty cash float", entityId: r.id, summary: `Opened float ${r.name} with limit ${rupees(r.limitPaise)}` }));
  }

  async setLimit(id: string, limitPaise: number) {
    const v = this.parse(paiseAmount, limitPaise);
    return this.write("manage", async (tx) => {
      const f = await this.lock(tx, id);
      const bal = await this.balance(tx, id);
      if (v < bal) throw new ConflictError(`The float already holds ${rupees(bal)}. Take some back first.`);
      return (await tx.update(expPettyFloats).set({ limitPaise: v }).where(eq(expPettyFloats.id, f.id)).returning())[0]!;
    }, (r) => ({ action: "update", entity: "Petty cash float", entityId: r.id, summary: `Set limit of ${r.name} to ${rupees(r.limitPaise)}` }));
  }

  private async lock(tx: Tx, id: string) {
    return need((await tx.select().from(expPettyFloats).where(eq(expPettyFloats.id, id)).for("update"))[0], "Float");
  }
  private async balance(tx: Tx, id: string) {
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(case ${expPettyEntries.kind} when 'top_up' then ${expPettyEntries.amountPaise} else -${expPettyEntries.amountPaise} end), 0)` }).from(expPettyEntries).where(and(eq(expPettyEntries.floatId, id), eq(expPettyEntries.status, "posted")));
    return Number(r?.v ?? 0);
  }
  private async entry(tx: Tx, f: PettyFloat, kind: keyof typeof entrySign, v: { amountPaise: number; date?: string; label: string; accountId?: string | null; costCentreId?: string | null; cashAccountId?: string | null; fileKey?: string | null }) {
    const bal = await this.balance(tx, f.id);
    if (kind !== "top_up" && v.amountPaise > bal) throw new ConflictError(`${f.name} holds ${rupees(bal)}. Top it up first.`);
    if (kind === "top_up" && bal + v.amountPaise > f.limitPaise) throw new ConflictError(`${f.name} can hold ${rupees(f.limitPaise)}, so at most ${rupees(f.limitPaise - bal)} can go in now.`);
    const date = await this.moneyDate(tx, v.date);
    const [e] = await tx.insert(expPettyEntries).values({ schoolId: this.ctx.schoolId, floatId: f.id, kind, date, amountPaise: v.amountPaise, accountId: v.accountId ?? null, costCentreId: v.costCentreId ?? null, cashAccountId: v.cashAccountId ?? null, label: v.label, fileKey: v.fileKey ?? null, createdBy: this.ctx.userId }).returning();
    return e!;
  }
  private postFor(tx: Tx, f: PettyFloat, e: typeof expPettyEntries.$inferSelect, lines: { debit?: boolean; account: PostLine["account"]; costCentreId?: string | null }[], memo: string) {
    const party = { type: "staff" as const, id: f.holderId };
    return this.post(tx, { date: e.date, sourceKey: `expenses:petty:${e.id}`, sourceType: "exp_petty", sourceId: e.id, memo, lines: lines.map((l) => ({ account: l.account, [l.debit ? "debit" : "credit"]: e.amountPaise, party: (typeof l.account === "string" && l.account === "petty_cash") ? party : undefined, costCentreId: l.costCentreId })) });
  }

  async topUp(floatId: string, input: unknown) {
    const d = this.parse(topUp, input);
    return this.write("manage", async (tx) => {
      const f = await this.lock(tx, floatId);
      if (!f.isActive) throw new ConflictError(`${f.name} is switched off.`);
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      const e = await this.entry(tx, f, "top_up", { ...d, label: `Top-up from ${cash.name}`, cashAccountId: cash.id });
      await this.postFor(tx, f, e, [{ debit: true, account: "petty_cash" }, { account: { id: cash.accountId } }], `Petty cash top-up for ${f.name}`);
      return e;
    }, (e) => ({ action: "top-up", entity: "Petty cash", entityId: e.id, summary: `Topped up a float by ${rupees(e.amountPaise)}` }));
  }

  /** A spend with the photo of the slip. The holder or a manager may record it. */
  async spend(floatId: string, input: unknown, photo?: UploadedFile) {
    this.authorize("claim", "write");
    const d = this.parse(spend, input);
    if (!photo) throw new ValidationError({ file: "Attach a photo of the slip." });
    const stored = await this.files.put(photo);
    try {
      return await this.write("claim", async (tx) => {
        const f = await this.lock(tx, floatId);
        if (f.holderId !== this.ctx.userId && !allows(this.ctx, this.feature, "manage")) throw new ForbiddenError("Only the person who holds this float, or an accountant, can spend from it.");
        if (!f.isActive) throw new ConflictError(`${f.name} is switched off.`);
        await checkAccount(tx, d.accountId, "expense"); await checkCentre(tx, d.costCentreId);
        const e = await this.entry(tx, f, "spend", { ...d, fileKey: stored.fileKey });
        await this.postFor(tx, f, e, [{ debit: true, account: { id: d.accountId }, costCentreId: d.costCentreId ?? null }, { account: "petty_cash" }], `Petty cash: ${d.label}`);
        return e;
      }, (e) => ({ action: "spend", entity: "Petty cash", entityId: e.id, summary: `Spent ${rupees(e.amountPaise)} from petty cash: ${e.label}` }));
    } catch (e) { await this.files.remove([stored.fileKey]); throw e; }
  }

  /** Unspent cash goes back to the cash box or bank. */
  async giveBack(floatId: string, input: unknown) {
    const d = this.parse(giveBack, input);
    return this.write("claim", async (tx) => {
      const f = await this.lock(tx, floatId);
      if (f.holderId !== this.ctx.userId && !allows(this.ctx, this.feature, "manage")) throw new ForbiddenError("Only the person who holds this float, or an accountant, can return cash.");
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      const e = await this.entry(tx, f, "return", { ...d, label: `Returned to ${cash.name}`, cashAccountId: cash.id });
      await this.postFor(tx, f, e, [{ debit: true, account: { id: cash.accountId } }, { account: "petty_cash" }], `Petty cash returned by ${f.name}`);
      return e;
    }, (e) => ({ action: "return", entity: "Petty cash", entityId: e.id, summary: `Returned ${rupees(e.amountPaise)} from a float` }));
  }

  /** Undo an entry with a mirror entry. Refused when the float would end below zero or above its limit. */
  async reverseEntry(id: string) {
    return this.write("manage", async (tx) => {
      const [e0] = await tx.select().from(expPettyEntries).where(eq(expPettyEntries.id, id));
      if (!e0) throw new NotFoundError("Entry");
      const f = await this.lock(tx, e0.floatId);
      const [e] = await tx.select().from(expPettyEntries).where(eq(expPettyEntries.id, id)).for("update");
      if (e!.status === "reversed") throw new ConflictError("This entry is already reversed.");
      const after = (await this.balance(tx, f.id)) - entrySign[e!.kind] * e!.amountPaise;
      if (after < 0) throw new ConflictError(`Reversing this would leave ${f.name} with less than nothing. Reverse the later spends first.`);
      if (after > f.limitPaise) throw new ConflictError(`Reversing this would take ${f.name} above its limit of ${rupees(f.limitPaise)}.`);
      await this.reverse(tx, `expenses:petty:${id}`, `Reversed petty cash entry: ${e!.label}`);
      return (await tx.update(expPettyEntries).set({ status: "reversed" }).where(eq(expPettyEntries.id, id)).returning())[0]!;
    }, (e) => ({ action: "reverse", entity: "Petty cash", entityId: e.id, summary: `Reversed petty cash entry ${e.label}` }));
  }

  async entries(floatId: string) {
    return this.read(this.can("read") ? "read" : "claim", async (tx) => {
      const f = need((await tx.select().from(expPettyFloats).where(eq(expPettyFloats.id, floatId)))[0], "Float");
      if (!this.can("read") && f.holderId !== this.ctx.userId) throw new NotFoundError("Float");
      const rows = await tx.select({ e: expPettyEntries, accountName: finAccounts.name, journalId: journalIdSql("expenses:petty:", expPettyEntries.id) }).from(expPettyEntries).leftJoin(finAccounts, eq(finAccounts.id, expPettyEntries.accountId)).where(eq(expPettyEntries.floatId, floatId)).orderBy(desc(expPettyEntries.date), desc(expPettyEntries.createdAt));
      return Promise.all(rows.map(async ({ e, accountName, journalId }) => ({ ...e, accountName, journalId, fileUrl: await this.files.url(e.fileKey) })));
    });
  }
}
