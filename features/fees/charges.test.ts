import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { FeeCalculator } from "./calculator";
import { cancelCharge, cancelUnpaidCharges, chargeFor, postCharges } from "./charges";
import { feeCharges, feePaymentAllocations, feePayments } from "./schema";
import { ConcessionService, DuesService, FeeHeadService, FeeStructureService, PaymentService } from "./service";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe("charge lines in the calculator", () => {
  const input = {
    today: "2026-09-20", payments: [],
    items: [{ headId: "h", amountPaise: 100_000 }],
    installments: [
      { id: "t1", name: "Term 1", dueDate: "2026-04-10", amountPaise: 100_000 },
      { id: "c1", name: "Transport, Sep 2026", dueDate: "2026-09-01", amountPaise: 20_000, charge: true },
    ],
    concessions: [{ headId: null, kind: "percent" as const, value: 5000 }],
    lateRules: [{ installmentId: null, kind: "flat" as const, amountPaise: 5_000, graceDays: 0, maxPaise: null }],
  };
  it("takes no concession and no late fee, and adds to what is due", () => {
    const st = new FeeCalculator(input).statement();
    const charge = st.lines.find((l) => l.charge)!;
    expect(charge).toMatchObject({ gross: 20_000, concession: 0, net: 20_000, lateFee: 0, due: 20_000, overdue: true });
    expect(st.lines.find((l) => !l.charge)).toMatchObject({ concession: 50_000, lateFee: 5_000 });
    expect(st.totals.due).toBe(50_000 + 5_000 + 20_000);
  });
  it("a payment spreads over the oldest line first, charge lines included", () => {
    const plan = new FeeCalculator(input).allocate(75_000, "2026-09-20");
    expect(plan.allocations.map((a) => [a.installmentId, a.charge, a.amountPaise + a.lateFeePaise])).toEqual([["t1", false, 55_000], ["c1", true, 20_000]]);
  });
});

describe("charges on the ledger", () => {
  let a: TestSchool, b: TestSchool, yearId: string, studentId: string, classId: string;
  beforeAll(async () => {
    ({ a, b } = await createSchoolPair(["students", "academics", "fees"], "ch"));
    await withSchool(a.id, async (tx) => {
      const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      yearId = y!.id;
      const [c] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 5", grade: 5 }).returning();
      classId = c!.id;
      studentId = (await tx.insert(students).values({ schoolId: a.id, admissionNo: "CH1", name: "Charge Student", classId }).returning())[0]!.id;
    });
  });
  afterAll(closeDb);
  const post = (key: string, amountPaise = 30_000, dueDate = "2026-05-01") =>
    withSchool(a.id, (tx) => postCharges(tx, a.id, yearId, [{ studentId, kind: "transport", label: `Transport ${key}`, dueDate, amountPaise, sourceKey: key }]));

  it("a student with only charges shows in the dues, can pay one and gets a receipt", async () => {
    await post("t:2026-05");
    const dues = new DuesService(a.as.accountant);
    expect((await dues.duesReport()).rows.find((r) => r.id === studentId)).toMatchObject({ due: 30_000, status: "overdue" });
    const paid = await new PaymentService(a.as.accountant).record({ studentId, amountPaise: 30_000, method: "cash" });
    expect(paid.plan.allocations[0]).toMatchObject({ charge: true });
    expect((await dues.studentLedger(studentId)).statement.totals).toMatchObject({ due: 0, paid: 30_000 });
    expect((await new PaymentService(a.as.accountant).receiptPdf(paid.payment.id)).length).toBeGreaterThan(500);
    expect((await dues.studentLedger(studentId)).payments[0]!.allocations[0]!.name).toBe("Transport t:2026-05");
  });

  it("posting twice is one line; a cancelled line comes back; a paid line never cancels", async () => {
    await post("t:2026-06", 10_000, "2026-06-01");
    await post("t:2026-06", 99_999, "2026-06-01"); // same key: unchanged
    expect(await withSchool(a.id, (tx) => chargeFor(tx, "t:2026-06"))).toMatchObject({ status: "active", paidPaise: 0 });
    expect(await withSchool(a.id, (tx) => cancelCharge(tx, "t:2026-06"))).toBe(true);
    await post("t:2026-06", 12_000, "2026-06-01");
    const book = await new DuesService(a.as.accountant).studentLedger(studentId);
    expect(book.statement.lines.filter((l) => l.name === "Transport t:2026-06")).toMatchObject([{ gross: 12_000 }]);
    await new PaymentService(a.as.accountant).record({ studentId, amountPaise: 12_000, method: "cash" });
    expect(await withSchool(a.id, (tx) => cancelCharge(tx, "t:2026-06"))).toBe(false);
    expect(await withSchool(a.id, (tx) => cancelUnpaidCharges(tx, studentId, "transport", "2026-01-01"))).toBe(0);
  });

  it("a concession does not touch a charge line", async () => {
    const heads = new FeeHeadService(a.as.admin);
    const head = await heads.create({ name: "Tuition", kind: "tuition" });
    await new FeeStructureService(a.as.admin).save({ classId, name: "C5", items: [{ headId: head.id, amountPaise: 100_000 }], installments: [{ name: "T1", dueDate: "2026-04-10", amountPaise: 100_000 }], lateRules: [] });
    await new ConcessionService(a.as.admin).create({ studentId, kind: "percent", percent: "50", reason: "Sibling" });
    await post("t:2026-07", 20_000, "2026-07-01");
    const lines = (await new DuesService(a.as.admin).studentLedger(studentId)).statement.lines;
    expect(lines.find((l) => l.name === "Transport t:2026-07")).toMatchObject({ concession: 0, net: 20_000 });
    expect(lines.find((l) => l.name === "T1")).toMatchObject({ concession: 50_000 });
  });

  it("a cancel waits for a payment that holds the student lock, then sees its money", async () => {
    await post("t:2026-08", 15_000, "2026-08-01");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => (locked = r));
    // Stands in for PaymentService.record: lock the student, allocate to the charge, commit later.
    const payer = withSchool(a.id, async (tx) => {
      await tx.select({ id: students.id }).from(students).where(eq(students.id, studentId)).for("update");
      locked();
      await gate;
      const [p] = await tx.insert(feePayments).values({ schoolId: a.id, studentId, yearId, receiptNo: "RACE/1", amountPaise: 15_000, method: "cash", paidOn: "2026-08-02" }).returning();
      const [c] = await tx.select({ id: feeCharges.id }).from(feeCharges).where(eq(feeCharges.sourceKey, "t:2026-08"));
      await tx.insert(feePaymentAllocations).values({ schoolId: a.id, paymentId: p!.id, chargeId: c!.id, amountPaise: 15_000, lateFeePaise: 0 });
    });
    await hasLock;
    let done = false;
    const waiver = withSchool(a.id, (tx) => cancelCharge(tx, "t:2026-08")).then((r) => ((done = true), r));
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false); // blocked on the student lock
    release();
    await payer;
    expect(await waiver).toBe(false); // sees the committed payment, so nothing is cancelled
    expect(await withSchool(a.id, (tx) => chargeFor(tx, "t:2026-08"))).toMatchObject({ status: "active", paidPaise: 15_000 });
  });

  it("school B sees nothing of school A's charges", async () => {
    expect(await withSchool(b.id, (tx) => tx.select().from(feeCharges))).toHaveLength(0);
    expect(await withSchool(b.id, (tx) => chargeFor(tx, "t:2026-05"))).toBeNull();
  });
});
