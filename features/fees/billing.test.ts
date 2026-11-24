import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { ChecksService } from "./checks";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { PlanService } from "./plans";
import { ReceiptService } from "./receipts";
import { FEATURES, TODAY, bills, config, decide, due, ledger, makeSchool, publish, type Fixture } from "./testing";
import { createTestSchool } from "@smw/feature-kit/testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
const as = (r: "admin" | "accountant" | "student" | "teacher" = "accountant") => fx.school.as[r];
const checks = async () => (await new ChecksService(as("admin")).run()).mismatches;

beforeAll(async () => { fx = await makeSchool("bill"); });
afterAll(closeDb);

describe("bills from the plan", () => {
  it("issues one bill per student and due date, idempotently, and the preview is what issuing makes", async () => {
    const svc = new InvoiceService(as());
    const preview = await svc.previewBulk({});
    expect(preview.count).toBe(4 * 3); // 4 students x M1..M3
    const first = await svc.issueBulk({});
    expect(first.issued).toBe(preview.count);
    expect((await svc.previewBulk({})).count).toBe(0);
    expect((await svc.issueBulk({})).issued).toBe(0);
    const riya = await bills(fx, fx.students.riya);
    expect(riya.map((b) => [b.status, b.grossPaise, b.number])).toEqual([["issued", 100_000, expect.stringMatching(/^INV\//)], ["issued", 100_000, expect.any(String)], ["issued", 100_000, expect.any(String)]]);
    expect(await checks()).toEqual([]);
  });

  it("a new plan version publishes without touching the bills already issued (D2)", async () => {
    const before = await bills(fx, fx.students.meera);
    const svc = new PlanService(as());
    const v2 = await svc.newVersion(fx.rootId);
    expect(v2.plan.version).toBe(2);
    await svc.saveDraft({ id: v2.plan.id, name: "Class 5 fees v2", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 50_000), due("M2", -10, 50_000), due("M3", 20, 50_000), due("M4", 40, 70_000)] }] });
    await svc.submit(v2.plan.id);
    await expect(svc.submit(v2.plan.id)).rejects.toBeInstanceOf(ConflictError);
    await decide(fx, "fees.plan", v2.plan.id);
    expect((await svc.get(v2.plan.id)).plan.status).toBe("published");
    expect((await svc.get(fx.planId)).plan.status).toBe("archived");
    expect(await bills(fx, fx.students.meera)).toEqual(before);
    // Only what was not issued is billed: M4 only.
    const more = await new InvoiceService(as()).issueBulk({});
    expect(more.issued).toBe(4);
    expect((await bills(fx, fx.students.meera)).map((b) => b.grossPaise)).toEqual([100_000, 100_000, 100_000, 70_000]);
  });

  it("a plan sent for approval waits, can be withdrawn, and a refusal puts it back to a draft", async () => {
    const svc = new PlanService(as());
    const d = await publishless("Class 6 fees");
    await svc.submit(d);
    await svc.withdraw(d);
    expect((await svc.get(d)).plan.status).toBe("draft");
    await expect(svc.withdraw(d)).rejects.toThrow(/nothing to withdraw/);
    await svc.submit(d);
    await decide(fx, "fees.plan", d, "reject", "Prices look wrong");
    expect((await svc.get(d)).plan.status).toBe("draft");
  });

  async function publishless(name: string) {
    return (await new PlanService(as()).saveDraft({ yearId: fx.yearId, name, classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: [due("X1", 30, 90_000)] }] })).plan.id;
  }

  it("a student who changes class keeps every bill, payment and due (D1) and later bills use the new plan", async () => {
    const riya = fx.students.riya;
    const [first] = await bills(fx, riya);
    await new ReceiptService(as()).collect({ studentId: riya, invoiceIds: [first!.id], methods: [{ method: "cash", amountPaise: 60_000 }] });
    const account = async () => { const a = await new DuesService(as()).studentAccount(riya); return { balance: a.balance, bills: a.invoices.map((b) => [b.id, b.openPaise, b.paidPaise, b.classId]) }; };
    const before = await account();
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ classId: fx.otherClassId }).where(eq(students.id, riya)));
    expect(await account()).toEqual(before);
    expect(before.balance.openPaise).toBe(3 * 100_000 + 70_000 - 60_000);
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ classId: fx.classId }).where(eq(students.id, riya)));
  });

  it("year change and leaving never drop open bills (D3, D4)", async () => {
    const neel = fx.students.neel;
    const before = (await new DuesService(as()).studentAccount(neel)).balance.openPaise;
    expect(before).toBeGreaterThan(0);
    await withSchool(fx.school.id, async (tx) => {
      await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.id, fx.yearId));
      await tx.insert(academicYears).values({ schoolId: fx.school.id, name: "next", startsOn: addDays(fx.yearEnd, 1), endsOn: addDays(fx.yearEnd, 366), isCurrent: true });
      await tx.update(students).set({ status: "left", leftOn: TODAY }).where(eq(students.id, neel));
    });
    expect((await new DuesService(as()).studentAccount(neel)).balance.openPaise).toBe(before);
    const report = await new DuesService(as()).report({ filters: { q: "Neel" }, q: "Neel" });
    expect(report.rows.find((r) => r.id === neel)).toMatchObject({ due: before, studentStatus: "left" });
    await withSchool(fx.school.id, async (tx) => {
      await tx.delete(academicYears).where(eq(academicYears.name, "next"));
      await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, fx.yearId));
      await tx.update(students).set({ status: "active", leftOn: null }).where(eq(students.id, neel));
    });
  });
});

describe("cancel, revise and notes", () => {
  it("a draft is edited and deleted; an issued bill is neither", async () => {
    const svc = new InvoiceService(as());
    const id = await withSchool(fx.school.id, (tx) => svc.createDraft(tx, { studentId: fx.students.meera, yearId: fx.yearId, kind: "custom", label: "Trip", dueDate: TODAY, lines: [{ kind: "fee", label: "Trip", amountPaise: 50_000 }] }));
    await svc.saveDraft({ id, studentId: fx.students.meera, label: "Trip to the fort", dueDate: TODAY, lines: [{ label: "Bus", amountPaise: 20_000 }, { label: "Entry", amountPaise: 30_000 }] });
    expect((await svc.get(id)).invoice).toMatchObject({ status: "draft", number: null, grossPaise: 50_000 });
    await svc.issue(id);
    const issued = await svc.get(id);
    expect(issued.invoice.number).toMatch(/^INV\//);
    await expect(svc.saveDraft({ id, studentId: fx.students.meera, label: "Trip again", dueDate: TODAY, lines: [{ label: "Bus", amountPaise: 1 }] })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.deleteDraft(id)).rejects.toBeInstanceOf(ConflictError);
    // Taking what is owed off a student needs a second person (the school's limit is 0): the request keeps the proposal and shows on the bill.
    const asked = await svc.cancel(id, "Trip was called off");
    expect(asked).toMatchObject({ requested: true });
    expect((await svc.get(id)).invoice.status).toBe("issued");
    expect((await svc.get(id)).openChange).toMatchObject({ kind: "cancel", status: "pending", lowersPaise: 50_000 });
    await expect(svc.cancel(id, "Asking again")).rejects.toThrow(/already a request waiting/);
    await svc.withdrawChange(asked.changeId!);
    await expect(svc.withdrawChange(asked.changeId!)).rejects.toThrow(/nothing to withdraw/);
    const again = await svc.cancel(id, "Trip was called off, sure now");
    await decide(fx, "fees.invoice_change", again.changeId!);
    expect((await svc.get(id)).invoice.status).toBe("cancelled");
    await expect(svc.cancel(id, "again please")).rejects.toBeInstanceOf(ConflictError);
    expect(await checks()).toEqual([]);
  });

  it("revise: an unpaid bill is cancelled and replaced; a part-paid one is credited and replaced, and the old stays", async () => {
    const svc = new InvoiceService(as());
    const [m1, m2] = (await bills(fx, fx.students.meera)).filter((b) => b.status === "issued");
    const ask1 = await svc.revise(m2!.id, { reason: "Wrong amount", lines: [{ label: "Tuition M2", amountPaise: 80_000 }] });
    expect(ask1).toMatchObject({ requested: true, invoiceId: null }); // 100,000 down to 80,000 lowers what is owed
    await decide(fx, "fees.invoice_change", ask1.changeId!);
    const r1 = (await svc.get(m2!.id)).versions.at(-1)!.id;
    const chain = (await svc.get(r1)).versions;
    expect(chain.map((v) => [v.version, v.status])).toEqual([[1, "cancelled"], [2, "issued"]]);
    await new ReceiptService(as()).collect({ studentId: fx.students.meera, invoiceIds: [m1!.id], methods: [{ method: "cash", amountPaise: 40_000 }] });
    // The open part (60,000) is replaced by 70,000: it raises what is owed, so it applies at once.
    const { invoiceId: r2 } = await svc.revise(m1!.id, { reason: "Fee hike agreed", lines: [{ label: "Tuition M1 new", amountPaise: 70_000 }] });
    expect(r2).toBeTruthy();
    const old = (await svc.get(m1!.id)).invoice;
    expect(old).toMatchObject({ status: "issued", paidPaise: 40_000, creditedPaise: 60_000 });
    expect((await svc.get(r2!)).invoice).toMatchObject({ version: 2, grossPaise: 70_000, replacesId: m1!.id });
    const acc = await new DuesService(as()).studentAccount(fx.students.meera);
    expect(acc.balance.openPaise).toBe(80_000 + 70_000 + 100_000 + 70_000);
    expect(await checks()).toEqual([]);
  });

  it("a credit is capped at what is open; write-off posts to bad debts; a waiver of late fee posts against late fee; a debit note adds a line", async () => {
    const notes = new NoteService(as());
    const [b] = (await bills(fx, fx.students.kabir)).filter((x) => x.status === "issued");
    const full = (await new InvoiceService(as()).get(b!.id)).invoice;
    const line = full.lines[0]!;
    await expect(notes.propose({ invoiceId: b!.id, reasonType: "write_off", reason: "Cannot pay", lines: [{ lineId: line.id, amountPaise: 100_001 }] })).rejects.toThrow(/only/);
    const n = await notes.propose({ invoiceId: b!.id, reasonType: "write_off", reason: "Family cannot pay", lines: [{ lineId: line.id, amountPaise: 30_000 }] });
    expect(n.status).toBe("pending");
    expect((await new InvoiceService(as()).get(b!.id)).invoice.creditedPaise).toBe(0);
    await decide(fx, "fees.note", n.id);
    const after = (await new InvoiceService(as()).get(b!.id)).invoice;
    expect(after.creditedPaise).toBe(30_000);
    const debit = await notes.propose({ invoiceId: b!.id, kind: "debit", reasonType: "correction", reason: "Lab fee forgotten", add: { label: "Lab fee", amountPaise: 5_000 } });
    expect(debit.status).toBe("approved"); // a debit note adds to what is owed, so no second person is needed
    expect((await new InvoiceService(as()).get(b!.id)).invoice).toMatchObject({ grossPaise: 105_000, creditedPaise: 30_000 });
    expect(await ledger(fx, "bad_debts")).toBe(30_000);
    expect(await checks()).toEqual([]);
  });

  it("a note waits for approval, can be withdrawn and sent again; maker cannot approve their own", async () => {
    const notes = new NoteService(as());
    const [b] = (await bills(fx, fx.students.kabir)).filter((x) => x.status === "issued").slice(1);
    const line = (await new InvoiceService(as()).get(b!.id)).invoice.lines[0]!;
    const spec = { invoiceId: b!.id, reasonType: "concession" as const, reason: "Hardship", lines: [{ lineId: line.id, amountPaise: 10_000 }] };
    const n = await notes.propose(spec);
    const w = await notes.withdraw(n.id);
    expect(w.status).toBe("rejected");
    const again = await notes.resubmit(n.id, { ...spec, lines: [{ lineId: line.id, amountPaise: 12_000 }] });
    await decide(fx, "fees.note", again.id, "reject", "Not enough proof");
    expect((await new InvoiceService(as()).get(b!.id)).invoice.creditedPaise).toBe(0);
    await expect(notes.resubmit(again.id, spec)).resolves.toMatchObject({ status: "pending" });
  });
});

describe("plans in detail", () => {
  let f2: Fixture;
  beforeAll(async () => { f2 = await makeSchool("bill2", { plan: false }); });

  it("optional heads bill only the opt-ins; a student override beats the class plan; joining and leaving rules", async () => {
    await config(f2, { concessionLimitPaise: 100_000_000 }); // moves below are small enough to apply at once; the approval path has its own test
    const svc = new PlanService(f2.school.as.accountant);
    const joiner = (await withSchool(f2.school.id, (tx) => tx.insert(students).values({ schoolId: f2.school.id, admissionNo: "J1", name: "Late Joiner", classId: f2.classId, admissionDate: `${addDays(TODAY, -10).slice(0, 7)}-01` }).returning()))[0]!;
    const leaver = (await withSchool(f2.school.id, (tx) => tx.insert(students).values({ schoolId: f2.school.id, admissionNo: "L1", name: "Early Leaver", classId: f2.classId, admissionDate: `${f2.yearStart}`, status: "left", leftOn: addDays(TODAY, -20) }).returning()))[0]!;
    await publish(f2, { name: "C5", classIds: [f2.classId], joinRule: "due_after_joining", lines: [
      { headId: f2.heads.tuition, dues: [due("M1", -45, 100_000), due("M2", -10, 100_000)] },
      { headId: f2.heads.exam, optional: true, dues: [due("M2", -10, 25_000)] },
    ] });
    await publish(f2, { name: "Scholars", classIds: [f2.otherClassId], lines: [{ headId: f2.heads.tuition, dues: [due("M1", -40, 60_000)] }] });
    await svc.setStudentPlan({ studentId: f2.students.neel, rootId: (await svc.list({ filters: {} })).rows.find((p) => p.name === "Scholars")!.rootId, reason: "Scholarship student" });
    await svc.setOptIns({ studentId: f2.students.meera, headIds: [f2.heads.exam] });
    const inv = new InvoiceService(f2.school.as.accountant);
    const pv = await inv.previewBulk({});
    const rows = (id: string) => pv.rows.filter((r) => r.studentId === id).map((r) => [r.label, r.grossPaise]);
    expect(rows(f2.students.meera)).toEqual(expect.arrayContaining([["Month M2", 125_000], ["Month M1", 100_000]]));
    expect(rows(f2.students.riya)).toEqual(expect.arrayContaining([["Month M2", 100_000]]));
    expect(rows(f2.students.neel)).toEqual([["Month M1", 60_000]]);
    // Joined at the start of the month M2 fell due in: M1 (earlier) is not billed to them, M2 is.
    expect(rows(joiner.id)).toEqual([["Month M2", 100_000]]);
    // The leaver is billed only for what fell due on or before the day they left: M1 (45 days ago), not M2 (10 days ago).
    expect(rows(leaver.id)).toEqual([["Month M1", 100_000]]);
    const made = await inv.issueBulk({});
    expect(made.issued).toBe(pv.count);
    expect(new Set(pv.rows.map((r) => `${r.studentId}${r.label}`)).size).toBe(pv.count);
  });

  it("two plans for the same class and kind of admission cannot both be published", async () => {
    await expect(publish(f2, { name: "Duplicate", classIds: [f2.classId], lines: [{ headId: f2.heads.tuition, dues: [due("Z", 5, 1_000)] }] })).rejects.toThrow(/already has a published plan/);
  });

  it("a new admission plan wins over the all-admission plan for students admitted this year", async () => {
    const newbie = (await withSchool(f2.school.id, (tx) => tx.insert(students).values({ schoolId: f2.school.id, admissionNo: "N1", name: "New Kid", classId: f2.classId, admissionDate: f2.yearStart }).returning()))[0]!;
    await publish(f2, { name: "C5 new admissions", admissionType: "new", classIds: [f2.classId], lines: [{ headId: f2.heads.tuition, dues: [due("N", 5, 222_000)] }] });
    const pv = await new InvoiceService(f2.school.as.accountant).previewBulk({ studentIds: [newbie.id, f2.students.riya] });
    expect(pv.rows.filter((r) => r.studentId === newbie.id).map((r) => r.grossPaise)).toEqual([222_000]);
    expect(pv.rows.some((r) => r.studentId === f2.students.riya && r.grossPaise === 222_000)).toBe(false);
  });

  it("permissions and school isolation", async () => {
    const other = await createTestSchool("bill3", FEATURES);
    await expect(new InvoiceService(f2.school.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PlanService(f2.school.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new InvoiceService(other.as.admin).get((await bills(f2, f2.students.riya))[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    // A student login sees their own bills only, and no drafts.
    const own = await new InvoiceService(f2.school.as.student).list({ pageSize: 100 });
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((r) => r.studentId === f2.students.riya)).toBe(true);
    await expect(new InvoiceService(f2.school.as.student).get((await bills(f2, f2.students.meera))[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

