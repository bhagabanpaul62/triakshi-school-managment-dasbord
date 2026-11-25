import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { users, type Tx } from "@smw/db";
import { postJournal, type Poster } from "@smw/feature-finance/posting";
import { finAccounts, finApprovals } from "@smw/feature-finance/schema";
import { ExpenseService, checkAccount, checkCentre, cashFor, journalIdOf, journalIdSql, makerMayDecide, managers, need, onlyId, tell, closeApprovals } from "./base";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { ExpenseFiles, type UploadedFile } from "./files";
import { day, method, optionalId, paiseAmount } from "./inputs";
import { expClaims } from "./schema";

export type Claim = typeof expClaims.$inferSelect;

const claimInput = z.object({
  title: z.string().trim().min(3, "Say what it was for.").max(160),
  spentOn: day, amountPaise: paiseAmount, accountId: optionalId, costCentreId: optionalId,
  payWith: z.enum(["now", "salary"]).default("now"),
});
const decideInput = z.object({ accountId: optionalId, costCentreId: optionalId, note: z.string().trim().max(300).optional() });

/** Post an approved claim: the school owes the person. */
export async function postClaim(tx: Tx, by: Poster, c: Claim) {
  if (!c.accountId) throw new ValidationError({ accountId: "Choose which expense account this belongs to." });
  return postJournal(tx, by, {
    date: c.spentOn, sourceKey: `expenses:claim:${c.id}`, sourceType: "exp_claim", sourceId: c.id, memo: `Claim: ${c.title}`,
    lines: [{ account: { id: c.accountId }, debit: c.amountPaise, costCentreId: c.costCentreId, memo: c.title }, { account: "claims_payable", credit: c.amountPaise, party: { type: "staff", id: c.userId } }],
  });
}
/** Approve a claim that is waiting. Used by a direct approval and by the approval handler. */
export async function approveClaim(tx: Tx, by: Poster, id: string, pick: { accountId?: string | null; costCentreId?: string | null } = {}) {
  const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
  if (!c) throw new NotFoundError("Claim");
  if (c.status !== "submitted") throw new ConflictError(`This claim is already ${c.status}.`);
  const accountId = pick.accountId ?? c.accountId;
  if (accountId) await checkAccount(tx, accountId, "expense");
  const [row] = await tx.update(expClaims).set({ status: "approved", accountId: accountId ?? null, costCentreId: pick.costCentreId ?? c.costCentreId }).where(eq(expClaims.id, id)).returning();
  await postClaim(tx, by, row!);
  await NotificationWriter.done(tx, row!.schoolId, { type: "claim", id });
  return row!;
}

/** Claims that wait for the next salary run, for payroll to include. */
export async function openSalaryClaims(tx: Tx, userIds: string[]) {
  if (!userIds.length) return [];
  return tx.select({ id: expClaims.id, userId: expClaims.userId, title: expClaims.title, amountPaise: expClaims.amountPaise })
    .from(expClaims).where(and(inArray(expClaims.userId, userIds), eq(expClaims.status, "approved"), eq(expClaims.payWith, "salary")));
}
/**
 * Payroll calls this when a run that included them is paid. It marks them paid and does NOT post: the run's own entry
 * must debit Staff claims payable (party staff) for these amounts.
 */
export async function markClaimsPaid(tx: Tx, ids: string[], by: { runId: string; date: string }) {
  if (!ids.length) return 0;
  const rows = await tx.select().from(expClaims).where(inArray(expClaims.id, ids)).orderBy(expClaims.id).for("update");
  const open = rows.filter((c) => c.status === "approved" && c.payWith === "salary");
  if (open.length !== ids.length) throw new ConflictError("A claim in this run is no longer waiting for salary.");
  await tx.update(expClaims).set({ status: "paid", paidOn: by.date, payrollRef: by.runId }).where(inArray(expClaims.id, ids));
  return open.reduce((s, c) => s + c.amountPaise, 0);
}

export class ClaimService extends ExpenseService {
  private get files() { return new ExpenseFiles(this.ctx.schoolId); }
  private get all() { return this.can("manage"); }

  async list(query: ListQuery = {}): Promise<Page<Claim & { userName: string; state: string; journalId: string | null }>> {
    const q = listQuerySchema.parse(query), f = q.filters;
    const mine = !this.all || f.scope === "mine";
    return this.read(this.all ? "manage" : "claim", async (tx) => {
      const where = and(
        onlyId(expClaims.id, f.id),
        mine ? eq(expClaims.userId, this.ctx.userId) : undefined, f.status ? eq(expClaims.status, f.status as Claim["status"]) : undefined,
        q.q ? or(ilike(expClaims.title, `%${q.q}%`), ilike(users.name, `%${q.q}%`)) : undefined,
        f.from ? sql`${expClaims.spentOn} >= ${f.from}` : undefined, f.to ? sql`${expClaims.spentOn} <= ${f.to}` : undefined,
      );
      const [rows, [n]] = await Promise.all([
        tx.select({ c: expClaims, userName: users.name, journalId: journalIdSql("expenses:claim:", expClaims.id), waiting: sql<boolean>`exists (select 1 from fin_approvals a where a.ref_id = ${expClaims.id} and a.kind = 'expenses.claim' and a.status = 'pending')` })
          .from(expClaims).innerJoin(users, eq(users.id, expClaims.userId)).where(where).orderBy(desc(expClaims.spentOn), desc(expClaims.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(expClaims).innerJoin(users, eq(users.id, expClaims.userId)).where(where),
      ]);
      return toPage(await Promise.all(rows.map(async ({ c, userName, waiting, journalId }) => ({ ...c, userName, state: c.status === "submitted" && waiting ? "pending" : c.status, journalId }))), Number(n?.n ?? 0), q);
    });
  }

  /** One claim with its photo link, the reason when it was turned down, and who it waits for. Only the owner and managers may see it. */
  async get(id: string) {
    return this.read(this.all ? "manage" : "claim", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Claim");
      const c = need((await tx.select().from(expClaims).where(eq(expClaims.id, id)).limit(1))[0], "Claim");
      if (!this.all && c.userId !== this.ctx.userId) throw new NotFoundError("Claim");
      const [ap] = await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "expenses.claim"), eq(finApprovals.refId, id))).orderBy(desc(finApprovals.createdAt)).limit(1);
      const [who] = await tx.select({ name: users.name }).from(users).where(eq(users.id, c.userId));
      const [acc] = c.accountId ? await tx.select({ name: finAccounts.name }).from(finAccounts).where(eq(finAccounts.id, c.accountId)) : [];
      const waitingFor = ap?.status === "pending" ? (await tx.select({ name: users.name }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.name) : c.status === "submitted" ? ["an accountant or admin"] : [];
      return { claim: c, userName: who!.name, accountName: acc?.name ?? null, approval: ap ? { id: ap.id, status: ap.status, reason: ap.reason, note: ap.note } : null, waitingFor, journalId: await journalIdOf(tx, `expenses:claim:${id}`), fileUrl: await this.files.url(c.fileKey) };
    });
  }

  /** Submit your own claim (photo required), or change one that is waiting or was turned down and send it again. */
  async submit(input: unknown, photo?: UploadedFile, id?: string): Promise<Claim> {
    this.authorize("claim", "write");
    const d = this.parse(claimInput, input);
    if (d.spentOn > todayIST()) throw new ValidationError({ spentOn: "The date cannot be in the future." });
    if (!photo && !id) throw new ValidationError({ file: "Attach a photo of the bill or slip." });
    const stored = photo ? await this.files.put(photo) : null;
    try {
      const r = await this.write("claim", async (tx) => {
        if (d.accountId) await checkAccount(tx, d.accountId, "expense"); await checkCentre(tx, d.costCentreId);
        const vals = { title: d.title, spentOn: d.spentOn, amountPaise: d.amountPaise, accountId: d.accountId ?? null, costCentreId: d.costCentreId ?? null, payWith: d.payWith, status: "submitted" as const, ...(stored ? { fileKey: stored.fileKey } : {}) };
        let row: Claim, old: string | null = null;
        if (id) {
          const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
          if (!c || c.userId !== this.ctx.userId) throw new NotFoundError("Claim");
          if (c.status !== "submitted" && c.status !== "rejected") throw new ConflictError(`This claim is ${c.status} and cannot be changed.`);
          const [ap] = await tx.select({ id: finApprovals.id }).from(finApprovals).where(and(eq(finApprovals.kind, "expenses.claim"), eq(finApprovals.refId, id), eq(finApprovals.status, "pending")));
          if (ap) throw new ConflictError("This claim is waiting for approval. Withdraw it first to change it.");
          old = stored ? c.fileKey : null;
          row = (await tx.update(expClaims).set(vals).where(eq(expClaims.id, id)).returning())[0]!;
        } else {
          row = (await tx.insert(expClaims).values({ ...vals, schoolId: this.ctx.schoolId, userId: this.ctx.userId, fileKey: stored!.fileKey }).returning())[0]!;
          await tell(tx, this.ctx.schoolId, (await managers(tx)).filter((u) => u !== this.ctx.userId), "work.approval", "New expense claim", `${this.ctx.name}: ${d.title}, ${rupees(d.amountPaise)}`, "/app/expenses/claims", { subject: { type: "claim", id: row.id }, action: true });
        }
        return { row, old };
      }, ({ row }) => ({ action: id ? "resubmit" : "submit", entity: "Claim", entityId: row.id, summary: `Claim "${row.title}" of ${rupees(row.amountPaise)}` }));
      await this.files.remove([r.old]);
      return r.row;
    } catch (e) { await this.files.remove([stored?.fileKey ?? null]); throw e; }
  }

  /** The person takes their own claim back. It shows as turned down with that reason, and can be edited and sent again. */
  async withdraw(id: string) {
    return this.write("claim", async (tx) => {
      const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
      if (!c || c.userId !== this.ctx.userId) throw new NotFoundError("Claim");
      if (c.status !== "submitted") throw new ConflictError(`This claim is ${c.status}, so it cannot be withdrawn.`);
      await closeApprovals(tx, this.ctx, "expenses.claim", id);
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "claim", id });
      await this.record(tx, c, "withdrawn", "Withdrawn by the person who made it.");
      return (await tx.update(expClaims).set({ status: "rejected" }).where(eq(expClaims.id, id)).returning())[0]!;
    }, (c) => ({ action: "withdraw", entity: "Claim", entityId: c.id, summary: `Withdrew claim "${c.title}"` }));
  }

  /** A closed decision row, so a claim turned down has its reason in one place with bills and the rest. */
  private async record(tx: Tx, c: Claim, status: "rejected" | "withdrawn", note: string) {
    await tx.insert(finApprovals).values({ schoolId: this.ctx.schoolId, kind: "expenses.claim", refType: "exp_claim", refId: c.id, title: `Claim: ${c.title}`, amountPaise: c.amountPaise, reason: "Decision", href: "/app/expenses/claims", status, requestedBy: c.userId, decidedBy: this.ctx.userId, decidedAt: new Date(), note });
  }

  /** Accept a claim. Over the bill limit it goes to an approver first; otherwise it is approved now, by someone other than the claimer. */
  async approve(id: string, input: unknown = {}) {
    const pick = this.parse(decideInput, input);
    return this.write("manage", async (tx) => {
      const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
      if (!c) throw new NotFoundError("Claim");
      if (c.status !== "submitted") throw new ConflictError(`This claim is already ${c.status}.`);
      const own = await makerMayDecide(tx, this.ctx, [c.userId], pick.note);
      const accountId = pick.accountId ?? c.accountId;
      if (!accountId) throw new ValidationError({ accountId: "Choose which expense account this belongs to." });
      await checkAccount(tx, accountId, "expense"); await checkCentre(tx, pick.costCentreId);
      const settings = await this.settings(tx);
      if (c.amountPaise > settings.billLimitPaise) {
        await tx.update(expClaims).set({ accountId, costCentreId: pick.costCentreId ?? c.costCentreId }).where(eq(expClaims.id, id));
        const a = await this.askApproval(tx, { kind: "expenses.claim", refType: "exp_claim", refId: id, title: `Claim: ${c.title}`, amountPaise: c.amountPaise, reason: settings.billLimitPaise === 0 ? "Every claim needs an approver until a limit is set in Finance setup." : `Above the limit of ${rupees(settings.billLimitPaise)}.`, href: "/app/expenses/claims" });
        return { outcome: "pending" as const, claim: c, approvalId: a.id, own };
      }
      return { outcome: "approved" as const, claim: await approveClaim(tx, this.poster, id, { accountId, costCentreId: pick.costCentreId }), approvalId: null, own };
    }, (r) => ({ action: r.outcome === "approved" ? "approve" : "submit", entity: "Claim", entityId: r.claim.id, summary: `${r.outcome === "approved" ? "Approved" : "Sent for approval"}: claim "${r.claim.title}" of ${rupees(r.claim.amountPaise)}${r.own ? " (own claim, only admin)" : ""}` }));
  }

  async reject(id: string, reason: string) {
    const why = this.parse(z.string().trim().min(3, "Tell them why.").max(300), reason);
    return this.write("manage", async (tx) => {
      const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
      if (!c) throw new NotFoundError("Claim");
      if (c.status !== "submitted") throw new ConflictError(`This claim is already ${c.status}.`);
      await closeApprovals(tx, this.ctx, "expenses.claim", id);
      await this.record(tx, c, "rejected", why);
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "claim", id });
      await tell(tx, this.ctx.schoolId, [c.userId], "work.decision", "Claim not accepted", `${c.title}: ${why}`, "/app/expenses/claims", { subject: { type: "claim", id } });
      return (await tx.update(expClaims).set({ status: "rejected" }).where(eq(expClaims.id, id)).returning())[0]!;
    }, (c) => ({ action: "reject", entity: "Claim", entityId: c.id, summary: `Turned down claim "${c.title}"` }));
  }

  /** Pay an approved claim now from cash or bank. A claim marked "with salary" can still be paid now; it then leaves the salary queue. */
  async pay(id: string, input: unknown) {
    const d = this.parse(z.object({ date: day.optional(), method: method.exclude(["cheque"]).default("cash"), cashAccountId: optionalId }), input);
    return this.write("manage", async (tx) => {
      const [c] = await tx.select().from(expClaims).where(eq(expClaims.id, id)).for("update");
      if (!c) throw new NotFoundError("Claim");
      if (c.status !== "approved") throw new ConflictError(c.status === "paid" ? "This claim is already paid." : "Approve the claim before paying it.");
      const date = await this.moneyDate(tx, d.date);
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      await this.post(tx, { date, sourceKey: `expenses:claim-pay:${id}`, sourceType: "exp_claim", sourceId: id, memo: `Paid claim: ${c.title}`, lines: [{ account: "claims_payable", debit: c.amountPaise, party: { type: "staff", id: c.userId } }, { account: { id: cash.accountId }, credit: c.amountPaise }] });
      await tell(tx, this.ctx.schoolId, [c.userId], "work.decision", "Claim paid", `${c.title}: ${rupees(c.amountPaise)}`, "/app/expenses/claims", { subject: { type: "claim", id } });
      return (await tx.update(expClaims).set({ status: "paid", paidOn: date, cashAccountId: cash.id, payWith: "now" }).where(eq(expClaims.id, id)).returning())[0]!;
    }, (c) => ({ action: "pay", entity: "Claim", entityId: c.id, summary: `Paid claim "${c.title}" of ${rupees(c.amountPaise)}` }));
  }

  /** Approved claims that wait for salary, for the claims screen to say so. */
  async openSalary() { return this.read("manage", (tx) => tx.select().from(expClaims).where(and(eq(expClaims.status, "approved"), eq(expClaims.payWith, "salary")))); }
}
