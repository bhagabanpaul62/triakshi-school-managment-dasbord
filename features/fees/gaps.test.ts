import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { addDays, monthStart } from "@smw/feature-kit/money";
import { createTestSchool } from "@smw/feature-kit/testing";
import { students } from "@smw/feature-students/schema";
import { ChequeService } from "./cheques";
import { ConcessionService } from "./concessions";
import { CounterService } from "./counter";
import { DeskService } from "./desk";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { PlanService } from "./plans";
import { PromiseService } from "./promises";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { ReminderService } from "./reminders";
import { FEATURES, LATE, TODAY, bills, config, decide, due, issueAll, makeSchool, newStudent, publish, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture, mainRoot: string, scholarshipRoot: string, noClassId: string, leftId: string;
const admin = () => fx.school.as.admin, acct = () => fx.school.as.accountant, teacher = () => fx.school.as.teacher;
const cash = (amountPaise: number) => [{ method: "cash" as const, amountPaise }];
const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 4)).toString() === "%PDF";
afterAll(closeDb);

beforeAll(async () => {
  fx = await makeSchool("gaps", { plan: false });
  const main = await publish(fx, { name: "Class 5 fees", classIds: [fx.classId], lateRule: LATE, lines: [
    { headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000), due("M3", 20, 100_000)] },
    { headId: fx.heads.exam, optional: true, dues: [due("M1", -30, 20_000)] },
  ] });
  mainRoot = main.plan.rootId;
  scholarshipRoot = (await publish(fx, { name: "Staff child", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 120_000), due("M2", -10, 120_000), due("M3", 20, 120_000)] }] })).plan.rootId;
  await config(fx, { concessionLimitPaise: 100_000_000 });
  [noClassId, leftId] = await withSchool(fx.school.id, async (tx) => {
    const base = { schoolId: fx.school.id, admissionDate: `${Number(fx.yearStart.slice(0, 4)) - 2}-04-10` };
    const [a, b] = await tx.insert(students).values([{ ...base, admissionNo: "X1", name: "No Class" }, { ...base, admissionNo: "X2", name: "Gone Girl", classId: fx.classId, status: "left", leftOn: addDays(TODAY, -100) }]).returning({ id: students.id });
    return [a!.id, b!.id];
  });
});

describe("what a bulk issue would leave out", () => {
  it("names each student, why, and where to fix it, before and after issuing", async () => {
    const p = await new InvoiceService(acct()).previewBulk({});
    const by = (r: string) => p.exceptions.filter((e) => e.reason === r);
    expect(by("no_plan").map((e) => e.studentId)).toEqual([noClassId]);
    expect(by("no_plan")[0]).toMatchObject({ studentName: "No Class", href: `/app/students/${noClassId}` });
    expect(by("left").map((e) => e.studentId)).toEqual([leftId]);
    expect(by("opted_out").map((e) => e.studentId).sort()).toEqual([fx.students.riya, fx.students.kabir, fx.students.meera, fx.students.neel].sort());
    expect(by("opted_out")[0]!.detail).toMatch(/Exam fee/);
    expect(p.skipped).toMatchObject({ noPlan: 1 });
    await issueAll(fx);
    const again = await new InvoiceService(acct()).previewBulk({});
    expect(new Set(again.rows.map((r) => r.label))).toEqual(new Set(["Month M3"])); // not billed yet: its bill date is still ahead
    expect(again.exceptions.filter((e) => e.reason === "already_billed").length).toBeGreaterThanOrEqual(4);
    await expect(new InvoiceService(teacher()).previewBulk({})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a late fee on a single bill", () => {
  const draft = (studentId: string, over: Record<string, unknown> = {}) => new InvoiceService(acct()).saveDraft({ studentId, label: "School trip", dueDate: addDays(TODAY, 10), lines: [{ label: "Trip", amountPaise: 50_000 }], ...over });

  it("defaults to the student's plan rule, and null means none", async () => {
    const svc = new InvoiceService(acct());
    expect((await svc.lateRuleFor(fx.students.riya)).rule).toMatchObject({ kind: "per_day", amountPaise: 1_000, graceDays: 5 });
    expect((await svc.lateRuleFor(noClassId)).rule).toBeNull();
    const a = await draft(fx.students.riya), b = await draft(fx.students.riya, { lateRule: null });
    expect((await svc.get(a)).invoice.lateRule).toMatchObject({ kind: "per_day", amountPaise: 1_000 });
    expect((await svc.get(b)).invoice.lateRule).toBeNull();
    await expect(draft(fx.students.riya, { lateRule: { kind: "nonsense" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("editing a draft keeps the rule unless one is given; a revision can change it", async () => {
    const svc = new InvoiceService(acct());
    const id = await draft(fx.students.kabir);
    await svc.saveDraft({ id, studentId: fx.students.kabir, label: "School trip 2", dueDate: addDays(TODAY, 10), lines: [{ label: "Trip", amountPaise: 60_000 }] });
    expect((await svc.get(id)).invoice.lateRule).toMatchObject({ kind: "per_day" });
    await svc.issue(id);
    const r = await svc.revise(id, { reason: "Wrong rule", lines: [{ label: "Trip", amountPaise: 60_000 }], lateRule: { kind: "flat", amountPaise: 5_000, graceDays: 2 } });
    expect(r.requested).toBe(false);
    expect((await svc.get(r.invoiceId!)).invoice.lateRule).toMatchObject({ kind: "flat", amountPaise: 5_000 });
    const keep = await svc.revise(r.invoiceId!, { reason: "Typo", lines: [{ label: "Trip", amountPaise: 60_000 }] });
    expect((await svc.get(keep.invoiceId!)).invoice.lateRule).toMatchObject({ kind: "flat" });
    await expect(new InvoiceService(teacher()).lateRuleFor(fx.students.riya)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("students on a plan by hand, and optional fees", () => {
  it("lists who was moved with why and since when, and takes them back", async () => {
    const plans = new PlanService(acct());
    expect((await plans.overrides(scholarshipRoot)).total).toBe(0);
    await plans.setStudentPlan({ studentId: fx.students.meera, rootId: scholarshipRoot, reason: "Staff child" });
    const page = await plans.overrides(scholarshipRoot);
    expect(page.rows).toMatchObject([{ studentId: fx.students.meera, name: "Meera Iyer", admissionNo: "R3", classLabel: "Class 5-A", reason: "Staff child" }]);
    expect(page.rows[0]!.since).toBeInstanceOf(Date);
    expect((await plans.overrides(scholarshipRoot, { q: "zzz" })).total).toBe(0);
    expect((await plans.overrides(scholarshipRoot, { q: "iyer" })).total).toBe(1);
    expect((await plans.removeOverride({ studentId: fx.students.meera })).requested).toBe(false);
    expect((await plans.overrides(scholarshipRoot)).total).toBe(0);
    await expect(plans.removeOverride({ studentId: fx.students.meera })).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists who takes the optional fees and drops one at a time", async () => {
    const plans = new PlanService(acct());
    await plans.setOptIns({ studentId: fx.students.kabir, headIds: [fx.heads.exam] });
    const page = await plans.optIns(mainRoot);
    expect(page.rows).toMatchObject([{ studentId: fx.students.kabir, name: "Kabir Sharma", heads: [{ id: fx.heads.exam, name: "Exam fee" }] }]);
    expect((await plans.optIns(mainRoot, { q: "nobody" })).total).toBe(0);
    await expect(plans.removeOptIn({ studentId: fx.students.riya, headId: fx.heads.exam })).rejects.toBeInstanceOf(ConflictError);
    await plans.removeOptIn({ studentId: fx.students.kabir, headId: fx.heads.exam });
    expect((await plans.optIns(mainRoot)).total).toBe(0);
  });

  it("is staff only and invisible to another school", async () => {
    await expect(new PlanService(teacher()).overrides(mainRoot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PlanService(fx.school.as.student).optIns(mainRoot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PlanService(teacher()).removeOverride({ studentId: fx.students.meera })).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestSchool("gaps-b", FEATURES);
    await expect(new PlanService(other.as.admin).overrides(mainRoot)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PlanService(other.as.admin).optIns(mainRoot)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the committee's approval file", () => {
  const key = (name = "decision.pdf") => `${fx.school.id}/fees/plan-approvals/${crypto.randomUUID()}-${name}`;
  it("is required to send a plan only when the school says so", async () => {
    const plans = new PlanService(acct());
    const draft = async (name: string) => (await plans.saveDraft({ name, admissionType: "new", classIds: [fx.classId], lines: [{ headId: fx.heads.exam, dues: [due("Z1", 5, 10_000)] }] })).plan.id;
    const a = await draft("Needs no file");
    await config(fx, { planNeedsFile: false });
    expect((await plans.get(a)).fileRequired).toBe(false);
    await plans.withdraw(a).catch(() => undefined);
    await config(fx, { planNeedsFile: true });
    const b = await draft("Needs a file");
    expect((await plans.get(b)).fileRequired).toBe(true);
    await expect(plans.submit(b)).rejects.toThrow(/approval file/);
    await expect(plans.setApprovalFile(b, `${crypto.randomUUID()}/x/y.pdf`)).rejects.toBeInstanceOf(ValidationError);
    const k = key();
    await plans.setApprovalFile(b, k);
    expect((await plans.get(b)).approvalFile).toEqual({ name: "decision.pdf", href: `/api/files/${k}` });
    expect((await plans.submit(b)).status).toBe("pending");
    await expect(plans.setApprovalFile(b, key())).rejects.toBeInstanceOf(ConflictError);
    expect((await plans.get(b)).approval).toMatchObject({ status: "pending", requestedByName: expect.any(String) });
    await config(fx, { planNeedsFile: false });
    await expect(new PlanService(teacher()).setApprovalFile(b, key())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saving the draft again does not lose the file", async () => {
    const plans = new PlanService(acct());
    const v = await plans.saveDraft({ name: "Keeps its file", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.exam, dues: [due("Y1", 5, 10_000)] }] });
    const k = key("kept.png");
    await plans.setApprovalFile(v.plan.id, k);
    await plans.saveDraft({ id: v.plan.id, name: "Keeps its file", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.exam, dues: [due("Y1", 5, 12_000)] }] });
    expect((await plans.get(v.plan.id)).approvalFile?.name).toBe("kept.png");
  });
});

describe("dues: months, age bands and reminders", () => {
  it("the overview carries billed, conceded and collected for this month and last", async () => {
    await new ReceiptService(acct()).collect({ studentId: fx.students.neel, methods: cash(30_000) });
    const o = await new DuesService(admin()).overview();
    expect(o.thisMonth).toMatchObject({ from: monthStart(TODAY), to: TODAY });
    expect(o.thisMonth.billedPaise).toBeGreaterThan(0);
    expect(o.thisMonth.bills).toBeGreaterThan(0);
    expect(o.thisMonth.collectedPaise).toBe(o.summary.collectedThisMonth);
    expect(o.lastMonth).toMatchObject({ billedPaise: 0, collectedPaise: 0, concededPaise: 0 });
    await expect(new DuesService(teacher()).overview()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters the dues report by how late, and says so for an unknown band", async () => {
    const dues = new DuesService(admin());
    const old = await newStudent(fx, "Old Dues", { issue: false });
    const inv = new InvoiceService(acct());
    await inv.issue(await inv.saveDraft({ studentId: old, label: "Old fee", dueDate: addDays(TODAY, -45), lines: [{ label: "Old fee", amountPaise: 50_000 }] }));
    const late = await dues.report({ filters: { age: "31-60" } });
    expect(late.rows.map((r) => r.id)).toEqual([old]);
    expect(late.rows[0]).toMatchObject({ inBand: 50_000 });
    expect(late.totals.ageing.d31_60).toBe(50_000);
    expect((await dues.report({ filters: { age: "0-30" } })).rows.length).toBeGreaterThanOrEqual(4);
    expect((await dues.report({ filters: { age: "90+" } })).total).toBe(0);
    expect((await dues.report({ filters: { age: "not-due" } })).rows.every((r) => r.inBand !== null)).toBe(true);
    expect((await dues.report({})).rows[0]!.inBand).toBeNull();
    await expect(dues.report({ filters: { age: "bogus" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("reminds by hand once a day per bill, and says who was skipped and why", async () => {
    const reminders = () => new ReminderService(acct());
    const [m1, m2] = await bills(fx, fx.students.riya);
    const first = await reminders().remindNow({ invoiceIds: [m1!.id] });
    expect(first.sent).toMatchObject([{ studentId: fx.students.riya, bills: 1 }]);
    expect((await reminders().remindNow({ invoiceIds: [m1!.id] })).skipped).toMatchObject([{ studentId: fx.students.riya, reason: "already_today" }]);
    const next = await reminders().remindNow({ studentIds: [fx.students.riya] });
    expect(next.sent).toMatchObject([{ bills: 1 }]); // only the bill not reminded today
    expect(m2).toBeTruthy();
    await new PromiseService(acct()).add({ studentId: fx.students.riya, promisedOn: addDays(TODAY, 5) });
    expect((await reminders().remindNow({ studentIds: [fx.students.riya] })).skipped[0]).toMatchObject({ reason: "promise" });
    await new PromiseService(acct()).stopReminders({ studentId: fx.students.meera, reason: "In talks" });
    const nobill = await newStudent(fx, "No Bill", { issue: false });
    const mix = await reminders().remindNow({ studentIds: [fx.students.meera, nobill, fx.students.kabir] });
    expect(Object.fromEntries(mix.skipped.map((s) => [s.studentId, s.reason]))).toEqual({ [fx.students.meera]: "stopped", [nobill]: "nothing_open", [fx.students.kabir]: "no_login" });
    expect(mix.sent).toEqual([]);
    await expect(reminders().remindNow({})).rejects.toBeInstanceOf(ValidationError);
    await expect(new ReminderService(teacher()).remindNow({ studentIds: [fx.students.riya] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requests carry who asked, who decides and what they wrote", () => {
  it("a bill, its notes, a receipt reversal, refunds and concessions", async () => {
    // A bill: cancel is asked for (limit 0 means everyone's cancel waits).
    await config(fx, { concessionLimitPaise: 0 });
    const [m1] = await bills(fx, fx.students.meera);
    const cancelled = await new InvoiceService(acct()).cancel(m1!.id, "Billed twice");
    expect(cancelled.requested).toBe(true);
    const bill = await new InvoiceService(acct()).get(m1!.id);
    expect(bill.openChange).toMatchObject({ approval: { status: "pending", requestedByName: expect.any(String), waitingFor: expect.arrayContaining([expect.any(String)]) } });
    expect((await new InvoiceService(fx.school.as.student).get((await bills(fx, fx.students.riya))[0]!.id)).changes).toEqual([]);

    // A receipt reversal.
    const receipt = await new ReceiptService(acct()).collect({ studentId: fx.students.meera, methods: cash(10_000) });
    await new ReceiptService(acct()).requestReversal(receipt.id, "Wrong student");
    expect((await new ReceiptService(acct()).get(receipt.id)).reversal).toMatchObject({ status: "pending", reason: "Wrong student" });
    expect((await new ReceiptService(fx.school.as.student).get((await new ReceiptService(admin()).list({ filters: { studentId: fx.students.riya } })).rows[0]?.id ?? receipt.id).catch(() => null))?.reversal ?? null).toBeNull();

    // A note and a concession, then a refund the approver refuses with a reason.
    const [, m2] = await bills(fx, fx.students.meera);
    const [line] = (await new InvoiceService(acct()).get(m2!.id)).invoice.lines;
    const note = await new NoteService(acct()).propose({ invoiceId: m2!.id, reasonType: "waiver", reason: "Bus strike", lines: [{ lineId: line!.id, amountPaise: 1_000 }] });
    expect((await new NoteService(acct()).list({ filters: { invoiceId: m2!.id } })).rows.find((n) => n.id === note.id)!.approval?.status).toBe("pending");
    const con = await new ConcessionService(acct()).propose({ studentId: fx.students.neel, mode: "percent", value: 1_000, reason: "Sibling" });
    expect((await new ConcessionService(acct()).list({ filters: { studentId: fx.students.neel } })).rows.find((c) => c.id === con.id)!.approval?.status).toBe("pending");

    await new ReceiptService(acct()).collect({ studentId: fx.students.neel, methods: cash(900_000) }); // pays everything and leaves an advance
    const refund = await new RefundService(acct()).propose({ studentId: fx.students.neel, source: "advance", amountPaise: 10_000, method: "cash", reason: "Left early" });
    await decide(fx, "fees.refund", refund.id, "reject", "Not yet, he is still here");
    const row = (await new RefundService(acct()).list({ filters: { studentId: fx.students.neel } })).rows.find((r) => r.id === refund.id)!;
    expect(row).toMatchObject({ studentName: "Neel Rao", admissionNo: "R4", classLabel: "Class 5-A", status: "rejected", approval: { status: "rejected", note: "Not yet, he is still here", decidedByName: expect.any(String) } });
    expect((await new RefundService(acct()).balances(fx.students.neel)).advancePaise).toBeGreaterThan(0);
    await expect(new RefundService(teacher()).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("printing a pile as one PDF", () => {
  it("merges receipts and bills, logs every print, and refuses what is not yours", async () => {
    const rc = new ReceiptService(acct());
    const [r1, r2] = [await rc.collect({ studentId: fx.students.riya, methods: cash(1_000) }), await rc.collect({ studentId: fx.students.kabir, methods: cash(1_000) })];
    const one = await rc.receiptFile(r1.id);
    const both = await rc.receiptsFile([r1.id, r2.id, r1.id]);
    expect(both.filename).toMatch(/^receipts-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(isPdf(both.bytes)).toBe(true);
    expect(both.bytes.length).toBeGreaterThan(one.bytes.length);
    expect((await rc.get(r1.id)).prints.map((p) => p.copyNo)).toEqual([1, 2]);
    expect((await rc.get(r2.id)).prints).toHaveLength(1);
    const [b1, b2] = await bills(fx, fx.students.riya);
    expect(isPdf((await new InvoiceService(acct()).invoicesFile([b1!.id, b2!.id])).bytes)).toBe(true);
    await expect(rc.receiptsFile([])).rejects.toBeInstanceOf(ValidationError);
    await expect(rc.receiptsFile(Array.from({ length: 101 }, () => crypto.randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    await expect(new ReceiptService(fx.school.as.student).receiptsFile([r1.id, r2.id])).rejects.toBeInstanceOf(NotFoundError);
    await expect(new InvoiceService(teacher()).invoicesFile([b1!.id])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the counter desk's own reads", () => {
  it("config says the office hours; find and family work for staff only", async () => {
    await config(fx, { officeHours: "Mon to Sat, 9 am to 1 pm" });
    const desk = new DeskService(acct());
    expect(await desk.config()).toMatchObject({ officeHours: "Mon to Sat, 9 am to 1 pm", school: { name: expect.any(String) }, upiOn: false });
    expect((await new DeskService(fx.school.as.student).config()).officeHours).toBe("Mon to Sat, 9 am to 1 pm");
    expect((await desk.find("riya")).map((r) => r.label)).toContain("Riya Sharma");
    expect((await desk.find("9820000001")).map((r) => r.label).sort()).toEqual(["Kabir Sharma", "Riya Sharma"]);
    expect(await desk.find("r")).toEqual([]);
    const fam = await desk.family(fx.students.riya);
    expect(fam.members.map((m) => m.name)).toEqual(["Riya Sharma", "Kabir Sharma"]);
    expect(fam.bills.length).toBeGreaterThan(0);
    expect(fam.bills[0]!.lines.length).toBeGreaterThan(0);
    await expect(new DeskService(teacher()).find("riya")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DeskService(fx.school.as.student).find("riya")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DeskService(teacher()).config()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the register filters by class and totals by method over every row", async () => {
    const rc = new ReceiptService(admin());
    const all = await rc.register({ filters: { classId: fx.classId } });
    expect(all.total).toBeGreaterThan(3);
    expect(all.byMethod.cash).toBe(all.totalPaise);
    expect((await rc.register({ filters: { classId: fx.otherClassId } })).total).toBe(0);
    expect((await rc.register({ pageSize: 2, filters: { classId: fx.classId } })).totalPaise).toBe(all.totalPaise);
    expect((await rc.cashiers()).length).toBeGreaterThan(0);
    await expect(new ReceiptService(fx.school.as.student).register({})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("counter history names the cashier and the difference; cheques are counted by state", async () => {
    const counter = new CounterService(acct());
    const opened = await counter.open({ floatPaise: 5_000 });
    await new ReceiptService(acct()).collect({ studentId: fx.students.neel, methods: cash(1_000) });
    await counter.close({ countedPaise: 6_000 });
    const [h] = await counter.history();
    expect(h).toMatchObject({ id: opened.id, cashier: expect.any(String), differencePaise: expect.any(Number) });
    expect(isPdf((await counter.slipFile(h!.id)).bytes)).toBe(true);
    await expect(new CounterService(teacher()).slipFile(h!.id)).rejects.toBeInstanceOf(ForbiddenError);

    const rc = await new ReceiptService(admin()).collect({ studentId: fx.students.neel, methods: [{ method: "cheque", amountPaise: 2_000, cheque: { chequeNo: "778899", bank: "SBI", chequeDate: TODAY } }] });
    expect(rc.status).toBe("clearing");
    const cheques = new ChequeService(admin());
    expect((await cheques.totals()).received).toMatchObject({ count: 1, paise: 2_000 });
    const board = await cheques.board();
    expect(board.received.rows).toHaveLength(1);
    expect(isPdf((await cheques.slipFile([board.received.rows[0]!.cheque.id])).bytes)).toBe(true);
    await expect(cheques.slipFile([crypto.randomUUID()])).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ChequeService(teacher()).totals()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the student record card carries the few numbers and refuses a student login", async () => {
    const card = await new DuesService(admin()).card(fx.students.riya);
    expect(card).toMatchObject({ billed: true, overduePaise: expect.any(Number), last: { number: expect.any(String) } });
    expect(card.owedPaise).toBeGreaterThan(0);
    expect((await new DuesService(admin()).card(noClassId)).billed).toBe(false);
    await expect(new DuesService(fx.school.as.student).card(fx.students.riya)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DuesService(admin()).card("not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
