import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, pgErrorCode } from "@smw/feature-kit";
import { createTestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { CertificateService } from "./certificates";
import { ChequeService } from "./cheques";
import { ConcessionService, ConcessionTypeService } from "./concessions";
import { CounterService } from "./counter";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { HeadService, PlanService } from "./plans";
import { PromiseService } from "./promises";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";
import { SetupService } from "./setup-status";
import { FEATURES, TODAY, bills, due, issueAll, makeSchool, publish, type Fixture } from "./testing";
import { feeInvoices } from "./schema";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture, other: Awaited<ReturnType<typeof createTestSchool>>;
let receiptId: string, invoiceId: string, planId: string;
afterAll(closeDb);

beforeAll(async () => {
  fx = await makeSchool("acc", { plan: false });
  planId = (await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -10, 100_000)] }] })).plan.id;
  await issueAll(fx);
  invoiceId = (await bills(fx, fx.students.riya))[0]!.id;
  receiptId = (await new ReceiptService(fx.school.as.accountant).collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 10_000 }] })).id;
  other = await createTestSchool("accb", FEATURES);
  await withSchool(other.id, async (tx) => { await tx.insert(academicYears).values({ schoolId: other.id, name: "x", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }); });
});

describe("who may do what", () => {
  it("a teacher and a student are refused every staff service; staff with read cannot collect or set up", async () => {
    for (const who of ["teacher", "student"] as const) {
      const ctx = fx.school.as[who];
      await expect(new PlanService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new HeadService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new DuesService(ctx).overview()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new DuesService(ctx).report()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new DuesService(ctx).family(fx.students.riya)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ConcessionService(ctx).suggestions()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new NoteService(ctx).propose({ invoiceId, reasonType: "waiver", reason: "x y z", lines: [{ lineId: invoiceId, amountPaise: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new RefundService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ChequeService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new CounterService(ctx).open({ floatPaise: 0 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SettlementService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new PromiseService(ctx).add({ studentId: fx.students.riya, promisedOn: TODAY })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new InvoiceService(ctx).issueBulk({})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ConcessionTypeService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
    }
    // A custom role with read only: sees, cannot collect, issue, or concede.
    const reader = { ...fx.school.as.accountant, grants: new Set(["fees:read"]) };
    await expect(new DuesService(reader).overview()).resolves.toBeTruthy();
    await expect(new ReceiptService(reader).collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new InvoiceService(reader).issueBulk({})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ConcessionService(reader).propose({ studentId: fx.students.riya, mode: "amount", value: 1, reason: "abc" })).rejects.toBeInstanceOf(ForbiddenError);
    // And the school's read-only switch stops every change.
    const frozen = { ...fx.school.as.admin, readOnly: true };
    await expect(new ReceiptService(frozen).collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 1 }] })).rejects.toMatchObject({ status: 423 });
  });

  it("a student sees only their own bills, receipts and account, and not a sibling's", async () => {
    const mine = fx.school.as.student;
    expect((await new ReceiptService(mine).list()).rows.map((r) => r.studentId)).toEqual([fx.students.riya]);
    await expect(new ReceiptService(mine).get(receiptId)).resolves.toBeTruthy();
    const kabirReceipt = (await new ReceiptService(fx.school.as.accountant).collect({ studentId: fx.students.kabir, methods: [{ method: "cash", amountPaise: 1_000 }] })).id;
    await expect(new ReceiptService(mine).get(kabirReceipt)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReceiptService(mine).receiptFile(kabirReceipt)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DuesService(mine).studentAccount(fx.students.kabir)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new CertificateService(mine).statement(fx.students.kabir)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new CertificateService(mine).noDues(fx.students.riya)).resolves.toMatchObject({ clear: false });
    await expect(new PromiseService(mine).forStudent(fx.students.kabir)).rejects.toBeInstanceOf(NotFoundError);
    const own = await new DuesService(mine).studentAccount(fx.students.riya);
    expect(own.invoices.every((i) => i.status !== "draft")).toBe(true);
  });
});

describe("school isolation", () => {
  it("school B sees and changes nothing of school A, by id or by listing", async () => {
    const admin = other.as.admin;
    await expect(new InvoiceService(admin).get(invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReceiptService(admin).get(receiptId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReceiptService(admin).receiptFile(receiptId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReceiptService(admin).requestReversal(receiptId, "It is not even ours")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PlanService(admin).get(planId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DuesService(admin).studentAccount(fx.students.riya)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new CertificateService(admin).tuition(fx.students.riya)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new InvoiceService(admin).list()).rows).toEqual([]);
    expect((await new ReceiptService(admin).list()).rows).toEqual([]);
    expect((await new DuesService(admin).report()).rows).toEqual([]);
    expect((await new DuesService(admin).overview()).summary).toMatchObject({ outstanding: 0, collectedToday: 0 });
    expect((await new HeadService(admin).list()).rows).toEqual([]);
  });

  it("an id from another school in an input is refused (foreign keys ignore row security, so the services look first)", async () => {
    const admin = other.as.admin;
    const head = (await new HeadService(admin).create({ name: "Their tuition", kind: "tuition" })).id;
    await expect(new ReceiptService(admin).collect({ studentId: fx.students.riya, methods: [{ method: "cash", amountPaise: 10 }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ReceiptService(fx.school.as.accountant).collect({ studentId: fx.students.riya, invoiceIds: [invoiceId, "00000000-0000-4000-8000-000000000009"], methods: [{ method: "cash", amountPaise: 10 }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new InvoiceService(fx.school.as.accountant).saveDraft({ studentId: fx.students.riya, label: "Bill", dueDate: TODAY, lines: [{ headId: head, label: "Sneaky", amountPaise: 1_000 }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ConcessionService(fx.school.as.accountant).propose({ studentId: fx.students.riya, typeId: (await new ConcessionTypeService(admin).create({ name: "Theirs", mode: "percent", value: 100 })).id, mode: "percent", value: 100, reason: "Sneaky" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PlanService(fx.school.as.accountant).saveDraft({ yearId: fx.yearId, name: "Bad plan", classIds: [(await withSchool(other.id, (tx) => tx.insert(classes).values({ schoolId: other.id, name: "Other", grade: 1 }).returning()))[0]!.id], lines: [{ headId: fx.heads.tuition, dues: [due("Z", 5, 100)] }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PromiseService(admin).add({ studentId: fx.students.riya, promisedOn: TODAY })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SettlementService(admin).propose({ studentId: fx.students.riya, reason: "Not ours", writeOffPaise: 100, parts: [] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("money records outlive everything", () => {
  it("a student, class or year that has money records cannot be deleted, even by SQL", async () => {
    const del = (fn: (tx: Parameters<Parameters<typeof withSchool>[1]>[0]) => Promise<unknown>) => withSchool(fx.school.id, fn).then(() => null, (e) => pgErrorCode(e));
    expect(await del((tx) => tx.delete(students).where(eq(students.id, fx.students.riya)))).toBe("23503");
    expect(await del((tx) => tx.delete(academicYears).where(eq(academicYears.id, fx.yearId)))).toBe("23503");
    expect(await del((tx) => tx.delete(classes).where(eq(classes.id, fx.classId)))).toBe("23503");
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeInvoices))).length).toBeGreaterThan(0);
  });

  it("the setup checklist says what is missing and where to go", async () => {
    const empty = await new SetupService((await createTestSchool("accc", FEATURES)).as.admin).status();
    expect(empty.steps.map((s) => [s.key, s.done])).toEqual([["year", false], ["cash", false], ["upi", false], ["heads", false], ["plan", false], ["issue", false], ["counter", false]]);
    expect(empty.next).toMatchObject({ key: "year", href: "/app/academics" });
    const done = await new SetupService(fx.school.as.admin).status();
    expect(done.steps.find((s) => s.key === "plan")!.done).toBe(true);
    expect(done.steps.find((s) => s.key === "issue")!.done).toBe(true);
    expect(done.complete).toBe(false);
    expect((await new SetupService(fx.school.as.accountant).status()).steps.find((s) => s.key === "plan")!.who).toBeNull();
  });
});
