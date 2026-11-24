import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { systemAccounts } from "./chart";
import { postJournal, reverseJournal } from "./posting";
import { finBankLines, finBankMatches, finJournalLines, finJournals } from "./schema";
import { ApprovalService, BankService, CashAccountService, autoPairs, financeApprovals, guessMapping, parseAmount, parseBankDate, reconciliationReport, referenceHit, reportToCsv } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["finance", "notifications"], "bank"));
  for (const s of [a, b]) await withSchool(s.id, (tx) => systemAccounts(tx, s.id));
});
afterAll(closeDb);

const bytes = (s: string) => new TextEncoder().encode(s);
const poster = (s: TestSchool) => ({ schoolId: s.id, userId: s.users.admin });
let seq = 0;
/** One entry that puts money into (positive) or takes it out of a bank account. Returns the journal id and the line on the bank ledger. */
async function book(s: TestSchool, ledger: string, date: string, paise: number, memo: string) {
  const key = `bank-test-${++seq}`;
  return withSchool(s.id, async (tx) => {
    const other = paise > 0 ? { account: "other_income" as const, credit: paise } : { account: "general_expense" as const, debit: -paise };
    const j = await postJournal(tx, poster(s), { date, sourceKey: key, sourceType: "test", memo, lines: [paise > 0 ? { account: { id: ledger }, debit: paise } : { account: { id: ledger }, credit: -paise }, other] });
    const lines = await tx.select().from(finJournalLines).where(eq(finJournalLines.journalId, j!.id));
    return { journalId: j!.id, lineId: lines.find((l) => l.accountId === ledger)!.id };
  });
}
const bankOf = async (s: TestSchool, name: string) => new CashAccountService(s.as.admin).create({ name, kind: "bank" });
const lines = async (s: TestSchool, id: string, status: "open" | "matched" | "all" = "all") => (await new BankService(s.as.accountant).lines(id, { status, pageSize: 100 })).rows;

describe("reading a bank sheet", () => {
  it("reads the dates, amounts and headings banks use", () => {
    expect(["05-11-2026", "05/11/2026", "2026-11-05", "5.11.26", "05-Nov-2026", "5 Nov 26", "2026-11-05 10:22:01"].map(parseBankDate)).toEqual(Array(7).fill("2026-11-05"));
    expect(["31-02-2026", "garbage", "13/13/2026"].map(parseBankDate)).toEqual([null, null, null]);
    expect(["1,200.50", "(300)", "-45", "Rs. 99", "500 Cr", "500 Dr", "", "abc", "1.234"].map(parseAmount)).toEqual([120_050, -30_000, -4_500, 9_900, 50_000, -50_000, 0, null, null]);
    expect(guessMapping(["value_date", "txn_date", "narration", "chq_ref_no", "withdrawal_amt.", "deposit_amt."])).toEqual({ date: "txn_date", description: "narration", reference: "chq_ref_no", amount: undefined, debit: "withdrawal_amt.", credit: "deposit_amt." });
    expect(guessMapping(["date", "particulars", "amount"])).toMatchObject({ date: "date", description: "particulars", amount: "amount" });
  });
});

describe("importing a statement", () => {
  it("takes .csv and .xlsx alike, in three date formats, and shows a dry run before saving", async () => {
    const acc = await bankOf(a, "Import bank"), svc = new BankService(a.as.accountant);
    const csv = bytes("Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt\n05-11-2026,UPI-GVS FEES-RCPT000001,UTR111,,5000.00\n06/11/2026,BANK CHARGES,,118.00,\n2026-11-07,NEFT VENDOR PAYMENT,UTR222,\"2,500.00\",\n,,,,\n");
    const dry = await svc.previewImport({ name: "nov.csv", bytes: csv }, { cashAccountId: acc.id });
    expect(dry).toMatchObject({ ready: true, total: 3, fresh: 3, duplicates: 0, from: "2026-11-05", to: "2026-11-07", inPaise: 500_000, outPaise: 261_800, mapping: { date: "txn_date", debit: "withdrawal_amt", credit: "deposit_amt" } });
    expect(await lines(a, acc.id)).toHaveLength(0);

    const xlsx = new Uint8Array(readFileSync(new URL("./fixtures/bank.xlsx", import.meta.url)));
    const fromXlsx = await svc.previewImport({ name: "nov.xlsx", bytes: xlsx }, { cashAccountId: acc.id });
    expect({ ...fromXlsx, sample: [] }).toEqual({ ...dry, sample: [] });

    const done = await svc.commitImport({ name: "nov.xlsx", bytes: xlsx }, { cashAccountId: acc.id });
    expect(done).toMatchObject({ imported: 3, duplicates: 0 });
    expect((await lines(a, acc.id)).map((l) => l.amountPaise).sort((x, y) => x - y)).toEqual([-250_000, -11_800, 500_000]);
  });

  it("a signed amount column and Cr/Dr suffixes work; one bad row stops everything", async () => {
    const acc = await bankOf(a, "Signed bank"), svc = new BankService(a.as.accountant);
    await svc.commitImport({ name: "s.csv", bytes: bytes("Date,Particulars,Amount\n01-10-2026,Deposit,\"1,000.00 Cr\"\n02-10-2026,Cheque out,200 Dr\n03-10-2026,Refund,-50\n") }, { cashAccountId: acc.id });
    expect((await lines(a, acc.id)).map((l) => l.amountPaise).sort((x, y) => x - y)).toEqual([-20_000, -5_000, 100_000]);
    const bad = bytes("Date,Particulars,Amount\n04-10-2026,Fine,10\nnot a date,Broken,20\n");
    await expect(svc.commitImport({ name: "bad.csv", bytes: bad }, { cashAccountId: acc.id })).rejects.toBeInstanceOf(ValidationError);
    expect(await lines(a, acc.id)).toHaveLength(3);
    const dry = await svc.previewImport({ name: "bad.csv", bytes: bad }, { cashAccountId: acc.id });
    expect(dry).toMatchObject({ ready: false, errorCount: 1, errors: [{ line: 3 }] });
    await expect(svc.commitImport({ name: "x.csv", bytes: bytes("Foo,Bar\n1,2\n") }, { cashAccountId: acc.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("importing the same or an overlapping file adds only what is new; two identical lines in one file both stay", async () => {
    const acc = await bankOf(a, "Overlap bank"), svc = new BankService(a.as.accountant);
    const first = "Date,Narration,Amount\n01-09-2026,Fee,100\n01-09-2026,Charge,-10\n01-09-2026,Charge,-10\n";
    expect(await svc.commitImport({ name: "1.csv", bytes: bytes(first) }, { cashAccountId: acc.id })).toMatchObject({ imported: 3, duplicates: 0 });
    expect(await svc.commitImport({ name: "1.csv", bytes: bytes(first) }, { cashAccountId: acc.id })).toMatchObject({ imported: 0, duplicates: 3, statementId: null });
    const second = `${first}02-09-2026,Fee,200\n`;
    expect(await svc.commitImport({ name: "2.csv", bytes: bytes(second) }, { cashAccountId: acc.id })).toMatchObject({ imported: 1, duplicates: 3 });
    expect(await lines(a, acc.id)).toHaveLength(4);
  });

  it("only the reconcile permission imports, only into a bank account of this school", async () => {
    const acc = await bankOf(a, "Guarded bank"), file = { name: "g.csv", bytes: bytes("Date,Narration,Amount\n01-09-2026,Fee,100\n") };
    await expect(new BankService(a.as.teacher).commitImport(file, { cashAccountId: acc.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BankService(b.as.admin).commitImport(file, { cashAccountId: acc.id })).rejects.toBeInstanceOf(NotFoundError);
    const box = (await new CashAccountService(a.as.admin).list()).find((x) => x.kind === "cash") ?? (await new CashAccountService(a.as.admin).create({ name: "Petty box", kind: "cash" }));
    await expect(new BankService(a.as.accountant).commitImport(file, { cashAccountId: box.id })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("matching", () => {
  it("matches at import what is unambiguous (amount, sign, within 5 days) and leaves the rest", async () => {
    const acc = await bankOf(a, "Match bank");
    await book(a, acc.accountId, "2026-11-04", 500_000, "Fee receipt RCPT000001");
    await book(a, acc.accountId, "2026-11-07", -250_000, "Vendor payment");
    await book(a, acc.accountId, "2026-11-20", 700_000, "Not on the statement yet");
    const done = await new BankService(a.as.accountant).commitImport({ name: "m.csv", bytes: bytes("Date,Narration,Ref,Debit,Credit\n05-11-2026,UPI FEES RCPT000001,UTR1,,5000\n06-11-2026,BANK CHARGES,,118,\n07-11-2026,NEFT OUT,UTR2,2500,\n") }, { cashAccountId: acc.id });
    expect(done).toMatchObject({ imported: 3, autoMatched: 2 });
    const open = await lines(a, acc.id, "open");
    expect(open.map((l) => l.description)).toEqual(["BANK CHARGES"]);
    expect((await lines(a, acc.id, "matched")).every((l) => l.matchedTo.length === 1)).toBe(true);
  });

  it("two lines that fit two entries equally are left to a person, unless a reference decides", () => {
    const books = [
      { lineId: "j1", journalId: "x", number: "JV/1", date: "2026-11-05", memo: "Receipt A", sourceKey: "k1", amountPaise: 1000 },
      { lineId: "j2", journalId: "y", number: "JV/2", date: "2026-11-05", memo: "Receipt B", sourceKey: "k2", amountPaise: 1000 },
    ];
    const bank = (id: string, ref: string | null, description = "DEPOSIT") => ({ id, date: "2026-11-05", amountPaise: 1000, reference: ref, description });
    expect(autoPairs([bank("b1", null), bank("b2", null)], books)).toEqual([]);
    expect(autoPairs([bank("b1", null)], books)).toEqual([]);
    expect(autoPairs([bank("b1", "RECEIPTB")], books)).toEqual([{ bankId: "b1", lineId: "j2" }]);
    // One entry cannot settle two bank lines.
    expect(autoPairs([bank("b1", null), bank("b2", null)], [books[0]!])).toEqual([]);
    // Six days apart, or the other direction, is not a match.
    expect(autoPairs([{ ...bank("b1", null), date: "2026-11-11" }], [books[0]!])).toEqual([]);
    expect(autoPairs([{ ...bank("b1", null), amountPaise: -1000 }], [books[0]!])).toEqual([]);
    expect(referenceHit({ reference: "UTR-9", description: "x" }, books[0]!)).toBe(false);
    expect(referenceHit({ reference: null, description: "paid against jv/1 thanks" }, books[0]!)).toBe(false);
    expect(referenceHit({ reference: null, description: "RCPT/2026-27/000007 fees" }, { number: "RCPT/2026-27/000007", memo: "", sourceKey: "" })).toBe(true);
  });

  it("matches by hand, shows suggestions, and refuses a wrong amount, side or an entry already used", async () => {
    const acc = await bankOf(a, "Manual bank"), svc = new BankService(a.as.accountant);
    const near = await book(a, acc.accountId, "2026-10-10", 80_000, "Tuition by transfer UTR777");
    const far = await book(a, acc.accountId, "2026-09-01", 80_000, "Same amount, a month earlier");
    const pay = await book(a, acc.accountId, "2026-10-10", -80_000, "A payment of the same size");
    await svc.commitImport({ name: "h.csv", bytes: bytes("Date,Narration,Ref,Amount\n20-10-2026,CREDIT,UTR777,800\n") }, { cashAccountId: acc.id });
    const [line] = await lines(a, acc.id, "open");
    expect(line!.suggestion).toMatchObject({ lineId: near.lineId, why: expect.arrayContaining(["reference found"]) });
    const cand = await svc.candidates(line!.id);
    expect(cand.suggestions.map((s) => s.lineId)).toContain(near.lineId);
    expect(cand.suggestions.map((s) => s.lineId)).not.toContain(pay.lineId);

    await expect(svc.match(line!.id, [pay.lineId])).rejects.toBeInstanceOf(ConflictError);
    const wrong = await book(a, acc.accountId, "2026-10-20", 79_000, "Almost");
    await expect(svc.match(line!.id, [wrong.lineId])).rejects.toThrow(/add up to/);
    await svc.match(line!.id, [far.lineId]);
    expect((await lines(a, acc.id, "matched"))[0]!.matchedTo[0]!.lineId).toBe(far.lineId);
    await expect(svc.match(line!.id, [near.lineId])).rejects.toThrow(/already matched/);
    await svc.commitImport({ name: "h2.csv", bytes: bytes("Date,Narration,Amount\n21-10-2026,CREDIT TWO,800\n") }, { cashAccountId: acc.id });
    const [second] = await lines(a, acc.id, "open");
    await expect(svc.match(second!.id, [far.lineId])).rejects.toThrow(/already matched/);
  });

  it("a split deposit settles one bank line with several entries that add up; unmatch frees them all", async () => {
    const acc = await bankOf(a, "Split bank"), svc = new BankService(a.as.accountant);
    const e1 = await book(a, acc.accountId, "2026-10-01", 100_000, "Receipt one"), e2 = await book(a, acc.accountId, "2026-10-01", 200_000, "Receipt two"), e3 = await book(a, acc.accountId, "2026-10-02", 50_000, "Receipt three");
    await svc.commitImport({ name: "sp.csv", bytes: bytes("Date,Narration,Amount\n03-10-2026,CASH DEPOSIT SLIP 41,3000\n") }, { cashAccountId: acc.id });
    const [dep] = await lines(a, acc.id, "open");
    await expect(svc.match(dep!.id, [e1.lineId, e3.lineId])).rejects.toThrow(/add up to/);
    await svc.match(dep!.id, [e1.lineId, e2.lineId]);
    const [done] = await lines(a, acc.id, "matched");
    expect(done!.matchedTo.map((m) => m.lineId).sort()).toEqual([e1.lineId, e2.lineId].sort());
    const rows = await withSchool(a.id, (tx) => tx.select().from(finBankMatches).where(eq(finBankMatches.bankLineId, dep!.id)));
    expect(rows).toHaveLength(2);
    // The same entry cannot sit under another bank line.
    await svc.commitImport({ name: "sp2.csv", bytes: bytes("Date,Narration,Amount\n04-10-2026,OTHER,1000\n") }, { cashAccountId: acc.id });
    const [other] = await lines(a, acc.id, "open");
    await expect(svc.match(other!.id, [e1.lineId])).rejects.toThrow(/already matched/);
    await svc.unmatch(dep!.id);
    expect(await withSchool(a.id, (tx) => tx.select().from(finBankMatches).where(eq(finBankMatches.bankLineId, dep!.id)))).toHaveLength(0);
    expect((await lines(a, acc.id, "open")).map((l) => l.id)).toContain(dep!.id);
    await expect(svc.unmatch(dep!.id)).rejects.toBeInstanceOf(ConflictError);
    await svc.match(dep!.id, [e1.lineId, e2.lineId]);
    const [j1] = await withSchool(a.id, (tx) => tx.select({ key: finJournals.sourceKey }).from(finJournals).where(eq(finJournals.id, e1.journalId)));
    await expect(withSchool(a.id, (tx) => reverseJournal(tx, poster(a), j1!.key, { date: "2026-10-06", memo: "undo" }))).rejects.toThrow(/matched to a bank statement line/);
  });

  it("an entry that is matched cannot be undone until it is unmatched", async () => {
    const acc = await bankOf(a, "Reversal bank"), svc = new BankService(a.as.accountant);
    const e = await book(a, acc.accountId, "2026-10-05", 30_000, "Reversible receipt");
    await svc.commitImport({ name: "r.csv", bytes: bytes("Date,Narration,Amount\n05-10-2026,CREDIT,300\n") }, { cashAccountId: acc.id });
    const [l] = await lines(a, acc.id, "matched");
    expect(l!.matchedTo[0]!.lineId).toBe(e.lineId);
    const key = `bank-test-${seq}`;
    await expect(withSchool(a.id, (tx) => reverseJournal(tx, poster(a), key, { date: "2026-10-06", memo: "undo" }))).rejects.toThrow(/matched to a bank statement line/);
    await svc.unmatch(l!.id);
    await withSchool(a.id, (tx) => reverseJournal(tx, poster(a), key, { date: "2026-10-06", memo: "undo" }));
    const [back] = await withSchool(a.id, (tx) => tx.select().from(finBankLines).where(eq(finBankLines.id, l!.id)));
    expect(back!.matchedAt).toBeNull();
  });
});

describe("making an entry from a bank line", () => {
  it("a charge, interest and a transfer post at once and match the line; the wrong direction is refused", async () => {
    const acc = await bankOf(a, "Entry bank"), other = await bankOf(a, "Savings"), svc = new BankService(a.as.accountant);
    await svc.commitImport({ name: "e.csv", bytes: bytes("Date,Narration,Amount\n02-10-2026,SMS CHARGES,-23.60\n03-10-2026,SAVINGS INTEREST,41.25\n04-10-2026,TO SAVINGS,-1000\n05-10-2026,MYSTERY,77\n") }, { cashAccountId: acc.id });
    const by = Object.fromEntries((await lines(a, acc.id, "open")).map((l) => [l.description, l]));
    await expect(svc.createEntry(by["SMS CHARGES"]!.id, { action: "interest" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createEntry(by["SAVINGS INTEREST"]!.id, { action: "charge" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createEntry(by["TO SAVINGS"]!.id, { action: "transfer" })).rejects.toBeInstanceOf(ValidationError);
    const charge = await svc.createEntry(by["SMS CHARGES"]!.id, { action: "charge" });
    await svc.createEntry(by["SAVINGS INTEREST"]!.id, { action: "interest" });
    await svc.createEntry(by["TO SAVINGS"]!.id, { action: "transfer", toCashAccountId: other.id });
    const acct = await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
    const posted = await withSchool(a.id, (tx) => tx.select().from(finJournalLines).where(eq(finJournalLines.journalId, charge.journalId!)));
    expect(posted.map((l) => [l.accountId === acct.bank_charges, l.debitPaise, l.creditPaise]).sort()).toContainEqual([true, 2_360, 0]);
    const kinds = await withSchool(a.id, (tx) => tx.select({ k: finJournals.kind, t: finJournals.sourceType }).from(finJournals).where(eq(finJournals.sourceType, "transfer")));
    expect(kinds.some((k) => k.k === "transfer")).toBe(true);
    expect((await lines(a, acc.id, "open")).map((l) => l.description)).toEqual(["MYSTERY"]);
    const savings = (await new CashAccountService(a.as.admin).list()).find((x) => x.id === other.id)!;
    expect(savings.balancePaise).toBe(100_000);
  });

  it("another entry is a manual journal that waits for a second person, and matches the line once approved", async () => {
    const acc = await bankOf(a, "Other bank"), svc = new BankService(a.as.accountant), chart = await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
    await svc.commitImport({ name: "o.csv", bytes: bytes("Date,Narration,Amount\n05-10-2026,DONATION,5000\n") }, { cashAccountId: acc.id });
    const [l] = await lines(a, acc.id, "open");
    await expect(svc.createEntry(l!.id, { action: "other", accountId: chart.student_dues, reason: "x" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createEntry(l!.id, { action: "other", accountId: chart.other_income })).rejects.toBeInstanceOf(ValidationError);
    const ask = await svc.createEntry(l!.id, { action: "other", accountId: chart.other_income, reason: "A parent donated" });
    expect(ask.approvalId).toBeTruthy();
    expect((await lines(a, acc.id, "open"))[0]).toMatchObject({ id: l!.id, pendingApprovalId: ask.approvalId });
    await expect(svc.createEntry(l!.id, { action: "other", accountId: chart.other_income, reason: "again" })).rejects.toBeInstanceOf(ConflictError);
    await new ApprovalService(a.as.admin, financeApprovals).approve({ id: ask.approvalId, note: "ok" });
    expect(await lines(a, acc.id, "open")).toHaveLength(0);
    const [done] = await lines(a, acc.id, "matched");
    expect(done!.matchedTo).toHaveLength(1);
  });

  it("a refused request frees the line to be asked again", async () => {
    const acc = await bankOf(a, "Refused bank"), svc = new BankService(a.as.accountant), chart = await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
    await svc.commitImport({ name: "x.csv", bytes: bytes("Date,Narration,Amount\n06-10-2026,UNKNOWN,-900\n") }, { cashAccountId: acc.id });
    const [l] = await lines(a, acc.id, "open");
    const first = await svc.createEntry(l!.id, { action: "other", accountId: chart.general_expense, reason: "Office" });
    await new ApprovalService(a.as.admin, financeApprovals).reject({ id: first.approvalId, note: "Needs a bill" });
    const again = await svc.createEntry(l!.id, { action: "other", accountId: chart.general_expense, reason: "Office, with the bill" });
    expect(again.approvalId).not.toBe(first.approvalId);
  });
});

describe("statement of reconciliation", () => {
  it("book balance, uncredited receipts, unpresented payments and bank-only items explain the bank balance", async () => {
    const acc = await bankOf(a, "Statement bank"), svc = new BankService(a.as.accountant);
    await book(a, acc.accountId, "2026-08-01", 1_000_000, "Opening deposit");
    await book(a, acc.accountId, "2026-08-10", 200_000, "Receipt not credited yet");
    await book(a, acc.accountId, "2026-08-12", -50_000, "Cheque not presented");
    await book(a, acc.accountId, "2026-08-14", -300_000, "Payment that cleared");
    await svc.commitImport({ name: "rec.csv", bytes: bytes("Date,Narration,Amount\n02-08-2026,DEPOSIT,10000\n14-08-2026,NEFT,-3000\n20-08-2026,BANK CHARGES,-118\n") }, { cashAccountId: acc.id });
    const r = await svc.reconciliation(acc.id, { asOn: "2026-08-31" });
    expect(r.bookPaise).toBe(1_000_000 + 200_000 - 50_000 - 300_000);
    expect([r.uncredited.map((k) => k.amountPaise), r.unpresented.map((k) => k.amountPaise), r.bankOnly.map((k) => k.amountPaise)]).toEqual([[200_000], [-50_000], [-11_800]]);
    expect(r.expectedBankPaise).toBe(850_000 - 200_000 + 50_000 - 11_800);
    expect(r.differencePaise).toBeNull();
    const ok = await svc.reconciliation(acc.id, { asOn: "2026-08-31", bankBalancePaise: r.expectedBankPaise });
    expect(ok.differencePaise).toBe(0);
    expect((await svc.reconciliation(acc.id, { asOn: "2026-08-31", bankBalancePaise: r.expectedBankPaise + 500 })).differencePaise).toBe(500);
    // Before the charge reached the bank, it is not on the statement yet.
    expect((await svc.reconciliation(acc.id, { asOn: "2026-08-15" })).bankOnly).toHaveLength(0);
    // An auditor may read it; it is a report.
    const auditor = { ...a.as.teacher, grants: new Set(["finance:read"]) };
    expect((await new BankService(auditor).reconciliation(acc.id, { asOn: "2026-08-31" })).bookPaise).toBe(r.bookPaise);
    await expect(new BankService(auditor).lines(acc.id)).rejects.toBeInstanceOf(ForbiddenError);
    const csv = reportToCsv(reconciliationReport(ok));
    expect(csv).toContain("Balance the bank statement should show");
    expect(csv).toContain("Reconciled: no difference");
  });
});

describe("isolation", () => {
  it("school B cannot match, unmatch, list or read school A's bank lines", async () => {
    const acc = await bankOf(a, "Private bank"), mine = await book(a, acc.accountId, "2026-10-01", 1000, "Private");
    await new BankService(a.as.accountant).commitImport({ name: "p.csv", bytes: bytes("Date,Narration,Amount\n20-10-2026,X,50\n") }, { cashAccountId: acc.id });
    const [line] = await lines(a, acc.id, "open");
    const spy = new BankService(b.as.accountant);
    await expect(spy.lines(acc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(spy.reconciliation(acc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(spy.match(line!.id, [mine.lineId])).rejects.toBeInstanceOf(NotFoundError);
    await expect(spy.unmatch(line!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(spy.createEntry(line!.id, { action: "charge" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
