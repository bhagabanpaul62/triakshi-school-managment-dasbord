import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { users } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { finAccounts, finApprovals, finCostCentres, finJournalDrafts, finJournalLines, finJournals } from "../schema";
import type { JOURNAL_KINDS } from "../schema";
import { FinanceService, day } from "./common";

/** Accounts whose balance other modules also keep by person or vendor. A free-hand line here would break that list, so the module that owns it must post. */
export const OWNED_BY_MODULES = ["student_dues", "student_advances", "deposits_payable", "vendor_dues", "staff_loans", "claims_payable", "cheques"];
/** What a person may undo by hand. Everything else is undone by the module that made it. */
const REVERSIBLE = ["manual", "transfer", "opening"];

const line = z.object({
  accountId: z.uuid("Choose an account."),
  debitPaise: z.coerce.number().int().min(0).default(0),
  creditPaise: z.coerce.number().int().min(0).default(0),
  costCentreId: z.uuid().optional(),
  memo: z.string().trim().max(200).optional(),
});
const proposeInput = z.object({
  date: day,
  memo: z.string().trim().min(3, "Say what this entry is for.").max(200),
  reason: z.string().trim().min(3, "Tell the approver why.").max(500),
  lines: z.array(line).min(2, "An entry needs at least two lines.").max(60),
});
const reverseInput = z.object({ reason: z.string().trim().min(3, "Say why it is being undone.").max(500) });

export type JournalRow = { id: string; number: string; date: string; kind: string; memo: string; sourceType: string; totalPaise: number; reversesId: string | null };
export interface JournalDetail {
  journal: typeof finJournals.$inferSelect;
  createdByName: string | null;
  lines: { id: string; accountId: string; code: string; account: string; debitPaise: number; creditPaise: number; partyType: string | null; partyId: string | null; costCentre: string | null; memo: string | null }[];
  reverses: { id: string; number: string } | null;
  reversedBy: { id: string; number: string } | null;
  reversalPending: boolean;
  canReverse: boolean;
}
export interface DraftView { id: string; date: string; memo: string; lines: { code: string; account: string; debitPaise: number; creditPaise: number }[] }

export class JournalService extends FinanceService {
  async list(query: ListQuery = {}): Promise<Page<JournalRow>> {
    const q = listQuerySchema.parse(query);
    const f = q.filters;
    return this.read("read", async (tx) => {
      const total = sql<string>`(select coalesce(sum(l.debit_paise), 0) from fin_journal_lines l where l.journal_id = fin_journals.id)`;
      const where = and(
        q.q ? or(ilike(finJournals.number, `%${q.q}%`), ilike(finJournals.memo, `%${q.q}%`)) : undefined,
        f.kind ? eq(finJournals.kind, f.kind as (typeof JOURNAL_KINDS)[number]) : undefined,
        f.account && z.uuid().safeParse(f.account).success ? sql`exists (select 1 from fin_journal_lines l where l.journal_id = fin_journals.id and l.account_id = ${f.account})` : undefined,
        f.from && day.safeParse(f.from).success ? gte(finJournals.date, f.from) : undefined,
        f.to && day.safeParse(f.to).success ? lte(finJournals.date, f.to) : undefined,
      );
      const [rows, [n]] = await Promise.all([
        tx.select({ id: finJournals.id, number: finJournals.number, date: finJournals.date, kind: finJournals.kind, memo: finJournals.memo, sourceType: finJournals.sourceType, reversesId: finJournals.reversesId, total })
          .from(finJournals).where(where).orderBy(desc(finJournals.date), desc(finJournals.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(finJournals).where(where),
      ]);
      return toPage(rows.map(({ total: t, ...r }) => ({ ...r, totalPaise: Number(t) })), Number(n?.n ?? 0), q);
    });
  }

  async get(id: string): Promise<JournalDetail> {
    return this.read("read", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Journal entry");
      const [journal] = await tx.select().from(finJournals).where(eq(finJournals.id, id)).limit(1);
      if (!journal) throw new NotFoundError("Journal entry");
      const [lines, [by], reverses, [reversedBy], [pending]] = await Promise.all([
        tx.select({
          id: finJournalLines.id, accountId: finJournalLines.accountId, code: finAccounts.code, account: finAccounts.name, debitPaise: finJournalLines.debitPaise, creditPaise: finJournalLines.creditPaise,
          partyType: finJournalLines.partyType, partyId: finJournalLines.partyId, costCentre: finCostCentres.name, memo: finJournalLines.memo,
        }).from(finJournalLines).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId)).leftJoin(finCostCentres, eq(finCostCentres.id, finJournalLines.costCentreId))
          .where(eq(finJournalLines.journalId, id)).orderBy(desc(finJournalLines.debitPaise), finAccounts.code),
        journal.createdBy ? tx.select({ name: users.name }).from(users).where(eq(users.id, journal.createdBy)).limit(1) : Promise.resolve([]),
        journal.reversesId ? tx.select({ id: finJournals.id, number: finJournals.number }).from(finJournals).where(eq(finJournals.id, journal.reversesId)) : Promise.resolve([]),
        tx.select({ id: finJournals.id, number: finJournals.number }).from(finJournals).where(eq(finJournals.reversesId, id)).limit(1),
        tx.select({ id: finApprovals.id }).from(finApprovals).where(and(eq(finApprovals.kind, "finance.reverse"), eq(finApprovals.refId, id), eq(finApprovals.status, "pending"))).limit(1),
      ]);
      return {
        journal, createdByName: by?.name ?? null, lines, reverses: reverses[0] ?? null, reversedBy: reversedBy ?? null, reversalPending: !!pending,
        canReverse: REVERSIBLE.includes(journal.kind) && !reversedBy && !pending,
      };
    });
  }

  /** The lines of manual entries waiting for a decision, for the approver to read before deciding. */
  async drafts(ids: string[]): Promise<Record<string, DraftView>> {
    return this.read("approve", async (tx) => {
      if (!ids.length) return {};
      const rows = await tx.select().from(finJournalDrafts).where(inArray(finJournalDrafts.id, ids));
      const accounts = new Map((await tx.select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name }).from(finAccounts)).map((a) => [a.id, a]));
      return Object.fromEntries(rows.map((r) => [r.id, {
        id: r.id, date: r.date, memo: r.memo,
        lines: r.lines.map((l) => ({ code: accounts.get(l.accountId)?.code ?? "", account: accounts.get(l.accountId)?.name ?? "Unknown", debitPaise: l.debitPaise, creditPaise: l.creditPaise })),
      }]));
    });
  }

  /** Ask for a manual entry. Nothing posts until someone else approves (handlers.ts). */
  async propose(input: unknown) {
    this.authorize("journal", "write");
    const d = this.parse(proposeInput, input);
    const bad: Record<string, string> = {};
    let debit = 0, credit = 0;
    for (const l of d.lines) {
      if ((l.debitPaise > 0) === (l.creditPaise > 0)) bad.lines = "Each line is either a debit or a credit, with an amount.";
      debit += l.debitPaise; credit += l.creditPaise;
    }
    if (!bad.lines && debit !== credit) bad.lines = `Debits ${rupees(debit)} and credits ${rupees(credit)} must be equal.`;
    if (Object.keys(bad).length) throw new ValidationError(bad);
    return this.write("journal", async (tx) => {
      const date = await this.moneyDate(tx, d.date);
      const ids = [...new Set(d.lines.map((l) => l.accountId))];
      const accounts = await tx.select({ id: finAccounts.id, name: finAccounts.name, key: finAccounts.systemKey, active: finAccounts.isActive }).from(finAccounts).where(inArray(finAccounts.id, ids));
      if (accounts.length !== ids.length) throw new ConflictError("An account in this entry does not exist.");
      const off = accounts.find((a) => !a.active);
      if (off) throw new ConflictError(`${off.name} is switched off.`);
      const owned = accounts.find((a) => a.key && OWNED_BY_MODULES.includes(a.key));
      if (owned) throw new ConflictError(`${owned.name} is kept by its own screens (fees, expenses or payroll). Post there so each person's balance stays right.`);
      const centres = [...new Set(d.lines.flatMap((l) => (l.costCentreId ? [l.costCentreId] : [])))];
      if (centres.length && (await tx.select({ id: finCostCentres.id }).from(finCostCentres).where(inArray(finCostCentres.id, centres))).length !== centres.length) throw new ConflictError("A cost centre in this entry does not exist.");
      const [draft] = await tx.insert(finJournalDrafts).values({ schoolId: this.ctx.schoolId, date, memo: d.memo, lines: d.lines, createdBy: this.ctx.userId }).returning({ id: finJournalDrafts.id });
      const approval = await this.askApproval(tx, { kind: "finance.journal", refType: "JournalDraft", refId: draft!.id, title: `Journal entry: ${d.memo}`, amountPaise: debit, reason: d.reason, href: "/app/finance/approvals" });
      return { draftId: draft!.id, approvalId: approval.id, amountPaise: debit };
    }, (r) => ({ action: "propose", entity: "Journal draft", entityId: r.draftId, summary: `Asked to post a journal entry of ${rupees(r.amountPaise)}`, meta: { amountPaise: r.amountPaise } }));
  }

  /** Ask to undo a manual entry, transfer or opening balance. Entries made by fees, expenses or payroll are undone from there. */
  async requestReversal(id: string, input: unknown) {
    this.authorize("journal", "write");
    const { reason } = this.parse(reverseInput, input);
    return this.write("journal", async (tx) => {
      const [j] = await tx.select().from(finJournals).where(eq(finJournals.id, id)).for("update");
      if (!j) throw new NotFoundError("Journal entry");
      if (!REVERSIBLE.includes(j.kind)) throw new ConflictError("Only manual entries, transfers and opening balances are undone here. Undo the document that made this one instead.");
      const [done] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.reversesId, id)).limit(1);
      if (done) throw new ConflictError("This entry was already undone.");
      const [t] = await tx.select({ total: sql<string>`coalesce(sum(${finJournalLines.debitPaise}), 0)` }).from(finJournalLines).where(eq(finJournalLines.journalId, id));
      const a = await this.askApproval(tx, { kind: "finance.reverse", refType: "Journal", refId: id, title: `Undo ${j.number}: ${j.memo}`, amountPaise: Number(t?.total ?? 0), reason, href: `/app/finance/journals/${id}` });
      return { approvalId: a.id, number: j.number };
    }, (r) => ({ action: "request-reversal", entity: "Journal", entityId: id, summary: `Asked to undo ${r.number}` }));
  }
}
