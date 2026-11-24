import { and, asc, eq, gte, lte } from "drizzle-orm";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { finAccounts, finCashAccounts, finJournalLines, finJournals } from "../schema";
import { FinanceService, day, schoolName } from "./common";

const CAP = 50_000;
/** Tally's own groups for our system accounts; anything else follows its type. */
const GROUP_BY_KEY: Record<string, string> = { student_dues: "Sundry Debtors", govt_due: "Sundry Debtors", vendor_dues: "Sundry Creditors", fixed_assets: "Fixed Assets", opening: "Capital Account", surplus: "Reserves & Surplus" };
const GROUP_BY_TYPE = { asset: "Current Assets", liability: "Current Liabilities", equity: "Capital Account", income: "Indirect Incomes", expense: "Indirect Expenses" } as const;

/** Text safe inside an XML element: the five special characters escaped, characters XML forbids dropped. */
export const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const tallyDate = (d: string) => d.replaceAll("-", "");
const amount = (paise: number) => (paise / 100).toFixed(2);

export type VoucherType = "Receipt" | "Payment" | "Journal" | "Contra";
export interface TallyExport { xml: string; vouchers: number; fileName: string }

export class TallyExportService extends FinanceService {
  /**
   * Vouchers of a period for Tally Prime: the ledger masters used, then one voucher per entry. By the cash and bank lines: money in only is a
   * Receipt, money out only a Payment, both (a move between own accounts) a Contra, none a Journal. Debits are negative with ISDEEMEDPOSITIVE Yes, as Tally writes them.
   */
  async vouchers(input: { from: string; to: string }): Promise<TallyExport> {
    const from = day.safeParse(input.from), to = day.safeParse(input.to);
    if (!from.success || !to.success || input.from > input.to) throw new ValidationError({ from: "Choose a start date that is not after the end date." });
    return this.read("read", async (tx) => {
      const [school, cash, rows] = await Promise.all([
        schoolName(tx),
        tx.select({ accountId: finCashAccounts.accountId, kind: finCashAccounts.kind }).from(finCashAccounts),
        tx.select({ journalId: finJournals.id, number: finJournals.number, date: finJournals.date, memo: finJournals.memo, accountId: finAccounts.id, name: finAccounts.name, type: finAccounts.type, key: finAccounts.systemKey, debit: finJournalLines.debitPaise, credit: finJournalLines.creditPaise })
          .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId))
          .where(and(gte(finJournals.date, input.from), lte(finJournals.date, input.to))).orderBy(asc(finJournals.date), asc(finJournals.createdAt), asc(finJournals.id), asc(finJournalLines.id)).limit(CAP),
      ]);
      if (rows.length >= CAP) throw new ConflictError("That period has too many entries for one file. Export a shorter period, such as a month.");
      const cashKind = new Map(cash.map((c) => [c.accountId, c.kind]));
      const byJournal = new Map<string, typeof rows>();
      for (const r of rows) byJournal.set(r.journalId, [...(byJournal.get(r.journalId) ?? []), r]);

      const masters = new Map<string, string>();
      const body: string[] = [];
      for (const lines of byJournal.values()) {
        const head = lines[0]!;
        const money = lines.filter((l) => cashKind.has(l.accountId));
        const type: VoucherType = money.some((l) => l.debit) && money.some((l) => l.credit) ? "Contra" : money.some((l) => l.debit) ? "Receipt" : money.some((l) => l.credit) ? "Payment" : "Journal";
        const entries = lines.map((l) => {
          masters.set(l.name, cashKind.get(l.accountId) === "cash" ? "Cash-in-Hand" : cashKind.get(l.accountId) === "bank" ? "Bank Accounts" : (l.key && GROUP_BY_KEY[l.key]) || GROUP_BY_TYPE[l.type]);
          const debit = l.debit > 0;
          return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(l.name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? "-" : ""}${amount(debit ? l.debit : l.credit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        });
        body.push(`<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tallyDate(head.date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(head.number)}</VOUCHERNUMBER><NARRATION>${xml(head.memo.slice(0, 500))}</NARRATION>${entries.join("")}</VOUCHER></TALLYMESSAGE>`);
      }
      const ledgers = [...masters].map(([name, parent]) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(name)}" ACTION="Create"><NAME>${xml(name)}</NAME><PARENT>${xml(parent)}</PARENT></LEDGER></TALLYMESSAGE>`);
      const doc = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(school)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${[...ledgers, ...body].join("")}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
      return { xml: doc, vouchers: byJournal.size, fileName: `tally-vouchers-${input.from}-to-${input.to}.xml` };
    });
  }
}
