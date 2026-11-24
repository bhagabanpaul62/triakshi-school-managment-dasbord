import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { students } from "@smw/feature-students/schema";
import { checkDocument } from "@smw/feature-finance/templates/verify";
import { TemplateService } from "@smw/feature-finance/templates/service";
import { TOGGLEABLE } from "@smw/feature-finance/templates/config";
import { ChangeService } from "./changes";
import { CertificateService } from "./certificates";
import { ChecksService } from "./checks";
import { ConcessionService } from "./concessions";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { PlanService } from "./plans";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";
import { feesVerifyLookups } from "./verify";
import { receiptData } from "./documents";
import { feeConcessionUses, feeInvoices, feeReceipts } from "./schema";
import { TODAY, bills, config, decide, due, issueAll, makeSchool, openingApproved, publish, type Fixture } from "./testing";
import { readFileSync } from "node:fs";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
afterAll(closeDb);
const checks = (fx: Fixture) => new ChecksService(fx.school.as.admin).run().then((r) => r.mismatches);
const pdf = (b: Uint8Array) => Buffer.from(b.slice(0, 4)).toString();

describe("nobody lowers what a student owes alone", () => {
  let fx: Fixture;
  const acct = () => fx.school.as.accountant;
  const open = (id: string) => new DuesService(fx.school.as.admin).studentAccount(id).then((a) => a.balance.openPaise);
  beforeAll(async () => {
    fx = await makeSchool("ctl", { plan: false });
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [
      { headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000), due("M3", 20, 100_000)] },
      { headId: fx.heads.exam, optional: true, dues: [due("EX", 40, 25_000)] },
    ] });
    await issueAll(fx);
  });

  it("a cancel under the limit applies at once; above it, and as the pieces add up, it waits for a second person", async () => {
    await config(fx, { concessionLimitPaise: 150_000 });
    const svc = new InvoiceService(acct());
    const [a1, a2] = await bills(fx, fx.students.meera);
    expect(await svc.cancel(a1!.id, "Billed twice")).toMatchObject({ requested: false });
    const second = await svc.cancel(a2!.id, "Billed twice again"); // 100,000 + 100,000 is more than 150,000 together
    expect(second.requested).toBe(true);
    expect((await svc.get(a2!.id)).invoice.status).toBe("issued");
    expect(await open(fx.students.meera)).toBe(100_000); // M2 is still owed
    await decide(fx, "fees.invoice_change", second.changeId!);
    expect((await svc.get(a2!.id)).invoice.status).toBe("cancelled");
    expect(await new ChecksService(fx.school.as.admin).run().then((r) => r.mismatches)).toEqual([]);
  });

  it("a fix of the same value (date, label) applies at once; a lowering waits, can be refused, edited and sent again", async () => {
    await config(fx, { concessionLimitPaise: 0 });
    const svc = new InvoiceService(acct());
    const [b1, b2] = await bills(fx, fx.students.kabir);
    const same = await svc.revise(b1!.id, { reason: "Wrong label", label: "Tuition, April", lines: [{ label: "Tuition", amountPaise: 100_000 }] });
    expect(same).toMatchObject({ requested: false, invoiceId: expect.any(String) });
    const lower = await svc.revise(b2!.id, { reason: "Discount agreed on the phone", lines: [{ label: "Tuition", amountPaise: 60_000 }] });
    expect(lower).toMatchObject({ requested: true, invoiceId: null });
    expect((await svc.get(b2!.id)).openChange).toMatchObject({ kind: "revise", lowersPaise: 40_000 });
    await decide(fx, "fees.invoice_change", lower.changeId!, "reject", "Needs the principal's note");
    expect((await svc.get(b2!.id)).invoice.status).toBe("issued");
    const again = await svc.resubmitChange(lower.changeId!, { reason: "Principal's note attached", lines: [{ label: "Tuition", amountPaise: 60_000 }] });
    expect(again).toMatchObject({ requested: true });
    await decide(fx, "fees.invoice_change", (again as { changeId: string }).changeId);
    expect((await svc.get(b2!.id)).versions.at(-1)).toMatchObject({ version: 2, status: "issued" });
    expect(await open(fx.students.kabir)).toBe(100_000 + 60_000);
    await expect(svc.resubmitChange(lower.changeId!, {})).rejects.toThrow(); // the bill has moved on to version 2
  });

  it("a move to a cheaper plan waits; to a dearer one applies at once; the bills already issued are not billed again under the new plan", async () => {
    const plans = new PlanService(acct());
    const cheap = await publish(fx, { name: "Scholars", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 50_000), due("M3", 20, 30_000)] }] });
    const asked = await plans.setStudentPlan({ studentId: fx.students.neel, rootId: cheap.plan.rootId, reason: "Scholarship" });
    expect(asked.requested).toBe(true); // M3 would be 30,000 instead of 100,000
    await decide(fx, "fees.invoice_change", asked.changeId!);
    const pv = await new InvoiceService(acct()).previewBulk({ studentIds: [fx.students.neel], dueKeys: ["M1", "M3"] });
    expect(pv.rows.map((r) => [r.label, r.grossPaise])).toEqual([["Month M3", 30_000]]); // M1 was already billed: no second bill for the same month
    const dear = await publish(fx, { name: "Premium", classIds: [fx.otherClassId], admissionType: "new", lines: [{ headId: fx.heads.tuition, dues: [due("M3", 20, 300_000)] }] });
    expect((await plans.setStudentPlan({ studentId: fx.students.neel, rootId: dear.plan.rootId, reason: "Upgraded" })).requested).toBe(false);
  });

  it("dropping an optional fee that is still to be billed waits; taking one applies at once", async () => {
    const plans = new PlanService(acct());
    expect((await plans.setOptIns({ studentId: fx.students.riya, headIds: [fx.heads.exam] })).requested).toBe(false);
    const drop = await plans.setOptIns({ studentId: fx.students.riya, headIds: [] });
    expect(drop.requested).toBe(true);
    const still = await new InvoiceService(acct()).previewBulk({ studentIds: [fx.students.riya], dueKeys: ["EX"] });
    expect(still.rows[0]!.grossPaise).toBe(25_000); // not dropped until approved
    await decide(fx, "fees.invoice_change", drop.changeId!);
    expect((await new InvoiceService(acct()).previewBulk({ studentIds: [fx.students.riya], dueKeys: ["EX"] })).count).toBe(0);
  });

  it("switching a published plan off waits (it lowers what will be billed); a refused request can be withdrawn only by who asked", async () => {
    const plans = new PlanService(acct());
    const p = await publish(fx, { name: "Class 6 plan", classIds: [fx.classId], admissionType: "existing", lines: [{ headId: fx.heads.tuition, dues: [due("Q1", 30, 80_000)] }] });
    const asked = await plans.archive(p.plan.id);
    expect(asked.requested).toBe(true);
    expect((await plans.get(p.plan.id)).plan.status).toBe("published");
    await new ChangeService(acct()).withdraw(asked.changeId!);
    const again = await plans.archive(p.plan.id);
    await expect(new ChangeService(fx.school.as.admin).withdraw(again.changeId!)).resolves.toBeTruthy(); // an admin may withdraw too
  });

  it("small credit notes count together: the second one over the limit needs approval, a debit note never does", async () => {
    await config(fx, { concessionLimitPaise: 50_000 });
    const notes = new NoteService(acct());
    const [m3] = (await bills(fx, fx.students.riya)).filter((b) => b.status === "issued");
    const line = (await new InvoiceService(acct()).get(m3!.id)).invoice.lines[0]!;
    const spec = (amount: number) => ({ invoiceId: m3!.id, reasonType: "waiver" as const, reason: "Hardship", lines: [{ lineId: line.id, amountPaise: amount }] });
    expect((await notes.propose(spec(30_000))).status).toBe("approved");
    const second = await notes.propose(spec(30_000));
    expect(second.status).toBe("pending");
    expect((await notes.propose({ invoiceId: m3!.id, kind: "debit", reasonType: "correction", reason: "Forgot lab fee", add: { label: "Lab", amountPaise: 5_000 } })).status).toBe("approved");
    await config(fx, { concessionLimitPaise: 0 });
  });
});

describe("a yearly amount concession", () => {
  let fx: Fixture;
  const live = (id: string) => withSchool(fx.school.id, (tx) => tx.select().from(feeInvoices).where(eq(feeInvoices.studentId, id)).then((r) => r.filter((i) => i.status === "issued")));
  const uses = (id: string) => withSchool(fx.school.id, async (tx) => Number((await tx.execute<{ v: string }>(sql`select coalesce(sum(u.amount_paise), 0) v from fee_concession_uses u join fee_invoices i on i.id = u.invoice_id where i.student_id = ${id}::uuid`))[0]!.v));
  beforeAll(async () => {
    fx = await makeSchool("yearly", { plan: false });
    await publish(fx, { name: "Monthly", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: Array.from({ length: 12 }, (_, k) => due(`K${String(k + 1).padStart(2, "0")}`, -110 + k * 10, 100_000)) }] });
    await config(fx, { concessionLimitPaise: 100_000_000 });
  });

  it("gives exactly the amount across 12 monthly bills, takes back a cancelled bill's share and gives it to the reissued one", async () => {
    const id = fx.students.neel;
    const c = await new ConcessionService(fx.school.as.accountant).propose({ studentId: id, mode: "amount", per: "year", value: 600_000, reason: "Merit, Rs 6,000 for the year" });
    expect(c.status).toBe("approved"); // under the limit
    await issueAll(fx);
    const first = await live(id);
    expect(first).toHaveLength(12);
    expect(first.every((i) => i.concessionPaise === 50_000)).toBe(true);
    expect(await uses(id)).toBe(600_000);
    // Cancel one month: its 500 goes back, and the reissued bill takes exactly that.
    const gone = first[4]!;
    await new InvoiceService(fx.school.as.accountant).cancel(gone.id, "Billed in the wrong month");
    expect(await uses(id)).toBe(550_000);
    expect((await issueAll(fx)).issued).toBe(1);
    const after = await live(id);
    expect(after).toHaveLength(12);
    expect(after.reduce((s, i) => s + i.concessionPaise, 0)).toBe(600_000);
    expect(await uses(id)).toBe(600_000);
    expect(await checks(fx)).toEqual([]);
  });

  it("is capped by what the bills come to; a per-bill amount still comes off every bill", async () => {
    const big = await new ConcessionService(fx.school.as.accountant).propose({ studentId: fx.students.kabir, mode: "amount", per: "year", value: 2_000_000, reason: "More than the year" });
    await new ConcessionService(fx.school.as.accountant).propose({ studentId: fx.students.meera, mode: "amount", per: "bill", value: 10_000, reason: "Every month" });
    await issueAll(fx);
    const kabir = await live(fx.students.kabir);
    expect(kabir.reduce((s, i) => s + i.concessionPaise + i.creditedPaise, 0)).toBe(1_200_000); // all twelve bills are free; the rest of the 20,000 is not used
    expect(big.status).toBe("approved");
    expect((await live(fx.students.meera)).every((i) => i.concessionPaise + i.creditedPaise === 10_000)).toBe(true);
  });

  it("approved after bills are open, it is spread over them (and the ones to come) by credit notes", async () => {
    const fy = await makeSchool("yearly2", { plan: false });
    await publish(fy, { name: "Monthly", classIds: [fy.classId], lines: [{ headId: fy.heads.tuition, dues: Array.from({ length: 4 }, (_, k) => due(`K${k + 1}`, -20 + k * 10, 100_000)) }] });
    await issueAll(fy, undefined);
    await config(fy, { concessionLimitPaise: 0 });
    const c = await new ConcessionService(fy.school.as.accountant).propose({ studentId: fy.students.riya, mode: "amount", per: "year", value: 40_000, reason: "Staff child" });
    await decide(fy, "fees.concession", c.id);
    const rows = await withSchool(fy.school.id, (tx) => tx.select().from(feeInvoices).where(eq(feeInvoices.studentId, fy.students.riya)));
    expect(rows.reduce((s, i) => s + i.creditedPaise, 0)).toBe(40_000);
    expect(await withSchool(fy.school.id, (tx) => tx.select().from(feeConcessionUses))).toHaveLength(4);
    expect((await new ChecksService(fy.school.as.admin).run()).mismatches).toEqual([]);
  });
});

describe("settlement payments clear the earliest part across all bills first", () => {
  it("two bills with parts on the same dates: the first date is cleared on both bills before anything else", async () => {
    const fx = await makeSchool("parts", { plan: false });
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000)] }] });
    await issueAll(fx);
    const id = fx.students.riya;
    const first = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
    const second = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 40 * 86_400_000).toISOString().slice(0, 10);
    const svc = new SettlementService(fx.school.as.accountant);
    const s = await svc.propose({ studentId: id, reason: "Pay in two", parts: [{ dueOn: first, amountPaise: 150_000 }, { dueOn: second, amountPaise: 50_000 }] });
    await decide(fx, "fees.settlement", s.id);
    await new ReceiptService(fx.school.as.accountant).collect({ studentId: id, methods: [{ method: "upi", amountPaise: 150_000, reference: "PART1" }] });
    const [m1, m2] = await bills(fx, id);
    expect([m1!.openPaise, m2!.openPaise]).toEqual([0, 50_000]);
    expect((await new DuesService(fx.school.as.accountant).report({ q: "Riya" })).rows[0]).toMatchObject({ due: 50_000, overdue: 0, nextDueDate: second });
    expect((await new ChecksService(fx.school.as.admin).run()).mismatches).toEqual([]);
  });
});

describe("documents in the school's own layout", () => {
  let fx: Fixture;
  const acct = () => fx.school.as.accountant;
  beforeAll(async () => {
    fx = await makeSchool("docs", { plan: false });
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -10, 100_000)] }] });
    await issueAll(fx);
  });
  const token = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(feeReceipts).where(eq(feeReceipts.id, id)))[0]!);

  it("a receipt keeps the layout version it was issued with, reprints say DUPLICATE, and a family can print its own but not a sibling's", async () => {
    const rc = new ReceiptService(acct());
    const r1 = await rc.collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 10_000 }] });
    const t = new TemplateService(fx.school.as.admin);
    const cur = await t.current("receipt");
    await t.save("receipt", { ...cur.config, title: "Fee receipt, new look" });
    const r2 = await rc.collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 10_000 }] });
    expect([(await token(r1.id)).templateVersion, (await token(r2.id)).templateVersion]).toEqual([0, 1]);
    const f1 = await rc.receiptFile(r1.id);
    expect(pdf(f1.bytes)).toBe("%PDF");
    expect(f1.filename).toBe(`${r1.number.replace(/\//g, "-")}.pdf`);
    expect((await rc.receiptFile(r1.id)).filename).toContain("duplicate");
    expect(pdf((await new ReceiptService(fx.school.as.student).receiptFile(r2.id)).bytes)).toBe("%PDF");
    const kabir = await rc.collect({ studentId: fx.students.kabir, methods: [{ method: "cash", amountPaise: 1_000 }] });
    await expect(new ReceiptService(fx.school.as.student).receiptFile(kabir.id)).rejects.toThrow(/not found/);
  });

  it("an invoice prints once issued and not as a draft; the public check finds receipts and invoices by token, and says when one is reversed", async () => {
    const inv = new InvoiceService(acct());
    const [m1] = await bills(fx, fx.students.meera);
    expect(pdf((await inv.invoiceFile(m1!.id)).bytes)).toBe("%PDF");
    const draft = await withSchool(fx.school.id, (tx) => inv.createDraft(tx, { studentId: fx.students.meera, yearId: fx.yearId, kind: "custom", label: "Trip", dueDate: TODAY, lines: [{ kind: "fee", label: "Trip", amountPaise: 1_000 }] }));
    await expect(inv.invoiceFile(draft)).rejects.toThrow(/still a draft/);
    const invRow = await withSchool(fx.school.id, async (tx) => (await tx.select().from(feeInvoices).where(eq(feeInvoices.id, m1!.id)))[0]!);
    expect(invRow.templateVersion).toBe(0);
    expect(await checkDocument(feesVerifyLookups, fx.school.id, "invoice", invRow.verifyToken!)).toMatchObject({ ok: true, status: "Issued", number: invRow.number, maskedName: "M*** I***" });
    const r = await new ReceiptService(acct()).collect({ studentId: fx.students.neel, methods: [{ method: "cash", amountPaise: 5_000 }] });
    const tok = (await token(r.id)).verifyToken;
    expect(await checkDocument(feesVerifyLookups, fx.school.id, "receipt", tok)).toMatchObject({ ok: true, status: "Valid", amountPaise: 5_000 });
    await new ReceiptService(acct()).requestReversal(r.id, "Wrong student");
    await decide(fx, "fees.reversal", r.id);
    expect(await checkDocument(feesVerifyLookups, fx.school.id, "receipt", tok)).toMatchObject({ ok: false, status: "Reversed" });
    expect(await checkDocument(feesVerifyLookups, fx.school.id, "receipt", "0".repeat(32))).toBeNull();
    const other = await makeSchool("docs2", { plan: false });
    expect(await checkDocument(feesVerifyLookups, other.school.id, "receipt", tok)).toBeNull();
  });

  it("statement, tuition certificate, no-dues certificate and refund voucher", async () => {
    const certs = new CertificateService(fx.school.as.admin);
    expect(pdf((await certs.statementFile(fx.students.riya)).bytes)).toBe("%PDF");
    expect(pdf((await certs.certificateFile(fx.students.riya)).bytes)).toBe("%PDF");
    await expect(certs.noDuesFile(fx.students.meera)).rejects.toThrow(/still owes ₹1,000/);
    await new ReceiptService(acct()).collect({ studentId: fx.students.meera, methods: [{ method: "cash", amountPaise: 100_000 }] });
    expect((await certs.noDuesFile(fx.students.meera)).filename).toContain("no-dues");
    // A refund voucher from an advance.
    const adv = await new ReceiptService(acct()).collect({ studentId: fx.students.meera, methods: [{ method: "cash", amountPaise: 20_000 }] });
    expect(adv.advancePaise).toBe(20_000);
    const refunds = new RefundService(acct());
    const rf = await refunds.propose({ studentId: fx.students.meera, source: "advance", amountPaise: 20_000, method: "cash", reason: "Overpaid" });
    await expect(refunds.refundVoucherFile(rf.id)).rejects.toThrow(/no voucher yet/);
    await decide(fx, "fees.refund", rf.id);
    expect((await refunds.refundVoucherFile(rf.id)).filename).toMatch(/^PV-/);
  });

  it("the details a school may hide use exactly the labels the template editor lists", () => {
    const d = receiptData({ number: "R/1", date: TODAY, amountPaise: 1_000, advancePaise: 0, status: "valid", payerName: null, note: null, verifyUrl: "http://a.test/verify/receipt/x", balanceAfterPaise: 0,
      snapshot: { studentName: "A B", admissionNo: "1", classLabel: "5-A", guardian: "P Q" }, methods: [{ method: "upi", amountPaise: 1_000, reference: "UTR1" }], rows: [{ bill: "Month 1", feePaise: 1_000, latePaise: 0 }] });
    for (const label of TOGGLEABLE.receipt.facts) expect(d.facts.map(([k]) => k)).toContain(label);
    for (const label of TOGGLEABLE.receipt.totals) expect(d.totals.map(([k]) => k)).toContain(label);
    expect(d.qrSvg).toContain("<svg");
  });
});

describe("opening balances from a spreadsheet, and the dues report filters", () => {
  it("an .xlsx and a .csv with the same rows give the same result", async () => {
    const fx = await makeSchool("xlsx", { plan: false });
    await withSchool(fx.school.id, async (tx) => {
      for (const no of ["XL1", "XL2", "CS1", "CS2"]) await tx.insert(students).values({ schoolId: fx.school.id, admissionNo: no, name: `Sheet ${no}`, classId: fx.classId });
    });
    const inv = new InvoiceService(fx.school.as.accountant);
    const xlsx = { name: "opening.xlsx", bytes: new Uint8Array(readFileSync(new URL("./fixtures/opening.xlsx", import.meta.url))) };
    const csv = { name: "opening.csv", bytes: new TextEncoder().encode("admission_no,dues,advance,deposit,as_of\nCS1,5000,200,300,\nCS2,1250.5,,,\n") };
    const [a, b] = [await inv.importOpening(xlsx, true), await inv.importOpening(csv, true)];
    expect(a).toEqual(b);
    expect(a.totals).toEqual({ students: 2, duesPaise: 625_050, advancePaise: 20_000, depositPaise: 30_000 });
    await openingApproved(fx, xlsx);
    await openingApproved(fx, csv);
    const dues = new DuesService(fx.school.as.admin);
    const bal = async (name: string) => { const row = (await dues.report({ q: name })).rows[0]!; return [row.due, row.gross]; };
    expect(await bal("Sheet XL1")).toEqual(await bal("Sheet CS1"));
    expect(await bal("Sheet XL2")).toEqual(await bal("Sheet CS2"));
    expect((await dues.studentAccount((await withSchool(fx.school.id, (tx) => tx.select().from(students).where(eq(students.admissionNo, "XL1"))))[0]!.id)).balance).toMatchObject({ advancePaise: 20_000, depositPaise: 30_000 });
    expect((await new ChecksService(fx.school.as.admin).run()).mismatches).toEqual([]);
  });

  it("the report filters by head and by route", async () => {
    const fx = await makeSchool("filters", { plan: false });
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -10, 100_000)] }, { headId: fx.heads.exam, dues: [due("M1", -10, 20_000)] }] });
    await issueAll(fx);
    await new ReceiptService(fx.school.as.accountant).collect({ studentId: fx.students.riya, parts: [{ invoiceId: (await bills(fx, fx.students.riya))[0]!.id, amountPaise: 100_000 }], methods: [{ method: "cash", amountPaise: 100_000 }] });
    const dues = new DuesService(fx.school.as.admin);
    const byHead = await dues.report({ filters: { headId: fx.heads.exam }, pageSize: 50 });
    expect(byHead.rows.find((r) => r.id === fx.students.riya)!.due).toBe(20_000);
    expect(byHead.rows.find((r) => r.id === fx.students.meera)!.due).toBe(20_000);
    const route = await withSchool(fx.school.id, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(sql`insert into routes (id, school_id, name, morning_start, evening_start) values (gen_random_uuid(), ${fx.school.id}, 'Route 1', '07:00', '14:30') returning id`);
      const [s] = await tx.execute<{ id: string }>(sql`insert into route_stops (id, school_id, route_id, name, sequence, morning_time, evening_time) values (gen_random_uuid(), ${fx.school.id}, ${r!.id}::uuid, 'Stop', 1, '07:10', '15:00') returning id`);
      await tx.execute(sql`insert into student_transport (id, school_id, student_id, route_id, stop_id, starts_on) values (gen_random_uuid(), ${fx.school.id}, ${fx.students.neel}::uuid, ${r!.id}::uuid, ${s!.id}::uuid, '2026-04-01')`);
      return r!.id;
    });
    const onRoute = await dues.report({ filters: { routeId: route }, pageSize: 50 });
    expect(onRoute.rows.map((r) => r.id)).toEqual([fx.students.neel]);
  });
});
