import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, withConsole, withSchool } from "@smw/db";
import { nextNumber } from "@smw/feature-finance/posting";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { studentEnrollments, students } from "@smw/feature-students/schema";
import { systemCtx } from "@smw/feature-kit";
import { createTestSchool } from "@smw/feature-kit/testing";
import { ChecksService } from "../checks";
import { feeCharges, feeHeads, feePaymentAllocations, feePayments, feeStructureItems, feeStructures, installments, lateFeeRules, studentConcessions } from "../schema";
import { FEATURES } from "../testing";
import { FeeCalculator } from "./legacy-calculator";
import { legacyInput, type OldPayment } from "./plan";
import { FeeMover } from "./mover";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
afterAll(closeDb);

const TODAY = "2026-11-24";
const count = (schoolId: string, table: string, where = "true") => withSchool(schoolId, async (tx) => Number((await tx.execute<{ n: number }>(sql.raw(`select count(*)::int n from ${table} where ${where}`)))[0]!.n));

/** The school role can no longer write the old fee tables, so the old app's rows are made with the console role. */
const asOldApp: typeof withConsole = withConsole;

/** A school as the old app left it: two classes, one structure (Tuition 10,000.01 + Exam 2,500 in three instalments), and students in every awkward state. */
async function oldSchool(slug: string) {
  const school = await createTestSchool(slug, FEATURES);
  const id = school.id;
  const w = await asOldApp(async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c5, c6] = await tx.insert(classes).values([{ schoolId: id, name: "Class 5", grade: 5 }, { schoolId: id, name: "Class 6", grade: 6 }]).returning();
    const [tuition, exam] = await tx.insert(feeHeads).values([{ schoolId: id, name: "Tuition", kind: "tuition" }, { schoolId: id, name: "Exam", kind: "exam" }]).returning();
    const mk = (admissionNo: string, name: string, classId = c5!.id, extra: Partial<typeof students.$inferInsert> = {}) => ({ schoolId: id, admissionNo, name, classId, admissionDate: "2025-04-10", ...extra });
    const [alice, bob, cara, dan, eve] = await tx.insert(students).values([
      mk("A1", "Alice"), mk("A2", "Bob"), mk("A3", "Cara"), mk("A4", "Dan", c5!.id, { status: "left", leftOn: "2026-06-30" }), mk("A5", "Eve", c6!.id),
    ]).returning();
    await tx.insert(studentEnrollments).values([alice, bob, cara, dan].map((s) => ({ schoolId: id, studentId: s!.id, yearId: y!.id, classId: c5!.id })));
    const [st] = await tx.insert(feeStructures).values({ schoolId: id, yearId: y!.id, classId: c5!.id, name: "Class 5 fees" }).returning();
    await tx.insert(feeStructureItems).values([{ schoolId: id, structureId: st!.id, headId: tuition!.id, amountPaise: 1_000_001 }, { schoolId: id, structureId: st!.id, headId: exam!.id, amountPaise: 250_000 }]);
    const inst = await tx.insert(installments).values([
      { schoolId: id, structureId: st!.id, name: "Term 1", dueDate: "2026-04-10", amountPaise: 416_667 }, { schoolId: id, structureId: st!.id, name: "Term 2", dueDate: "2026-08-10", amountPaise: 416_667 }, { schoolId: id, structureId: st!.id, name: "Term 3", dueDate: "2026-12-10", amountPaise: 416_667 },
    ]).returning();
    await tx.insert(lateFeeRules).values({ schoolId: id, structureId: st!.id, installmentId: null, kind: "per_day", amountPaise: 5_000, graceDays: 5, maxPaise: 50_000 });
    return { y: y!, c5: c5!, c6: c6!, st: st!, inst: inst.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), tuition: tuition!, exam: exam!, alice: alice!, bob: bob!, cara: cara!, dan: dan!, eve: eve! };
  });

  let receipt = 0;
  /** Record a payment exactly the way the old service did: the old calculator spreads it. */
  const pay = async (studentId: string, paidOn: string, method: "cash" | "upi" | "cheque", amountPaise: number, o: { cancel?: string; asClass?: string } = {}) => {
    await asOldApp(async (tx) => {
      const old = await tx.select().from(feePayments).where(eq(feePayments.studentId, studentId));
      const structure = await loadStructure(tx, o.asClass ?? w.c5.id);
      const mine: OldPayment[] = [];
      for (const p of old.filter((x) => x.status === "valid")) mine.push({ id: p.id, paidOn: p.paidOn, amountPaise: p.amountPaise, allocations: (await tx.select().from(feePaymentAllocations).where(eq(feePaymentAllocations.paymentId, p.id))).map((a) => ({ installmentId: a.installmentId, chargeId: a.chargeId, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise })) });
      const concs = (await tx.select().from(studentConcessions).where(eq(studentConcessions.studentId, studentId))).map((c) => ({ id: c.id, headId: c.headId, kind: c.kind, value: c.value }));
      const charges = (await tx.select().from(feeCharges).where(eq(feeCharges.studentId, studentId))).filter((c) => c.status === "active").map((c) => ({ id: c.id, kind: c.kind, label: c.label, dueDate: c.dueDate, amountPaise: c.amountPaise, sourceKey: c.sourceKey }));
      const plan = new FeeCalculator(legacyInput(structure, charges, concs, mine, paidOn)).allocate(amountPaise, paidOn);
      expect(plan.unallocated).toBe(0);
      const [p] = await tx.insert(feePayments).values({ schoolId: id, studentId, yearId: w.y.id, receiptNo: `RCPT/2026-27/${String(++receipt).padStart(6, "0")}`, amountPaise, method, reference: method === "cash" ? null : "REF1", paidOn, status: o.cancel ? "cancelled" : "valid", cancelReason: o.cancel ?? null, cancelledAt: o.cancel ? new Date() : null }).returning();
      await tx.insert(feePaymentAllocations).values(plan.allocations.map((a) => ({ schoolId: id, paymentId: p!.id, installmentId: a.charge ? null : a.installmentId, chargeId: a.charge ? a.installmentId : null, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise })));
    });
  };
  const loadStructure = async (tx: Parameters<Parameters<typeof withSchool>[1]>[0], classId: string) => {
    const [s] = await tx.select().from(feeStructures).where(eq(feeStructures.classId, classId));
    const [items, insts, rules] = await Promise.all([tx.select().from(feeStructureItems).where(eq(feeStructureItems.structureId, s!.id)), tx.select().from(installments).where(eq(installments.structureId, s!.id)), tx.select().from(lateFeeRules).where(eq(lateFeeRules.structureId, s!.id))]);
    const names = new Map((await tx.select().from(feeHeads).where(eq(feeHeads.schoolId, id))).map((h) => [h.id, h]));
    return { id: s!.id, yearId: s!.yearId, classId: s!.classId, name: s!.name, items: items.map((i) => ({ headId: i.headId, headName: names.get(i.headId)!.name, headType: "income" as const, amountPaise: i.amountPaise })), installments: insts.map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise })), lateRules: rules.map((r) => ({ installmentId: r.installmentId, kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise })) };
  };
  const concede = (studentId: string, c: Partial<typeof studentConcessions.$inferInsert> & Pick<typeof studentConcessions.$inferInsert, "kind" | "value">) =>
    asOldApp((tx) => tx.insert(studentConcessions).values({ schoolId: id, studentId, yearId: w.y.id, reason: "test", ...c }));
  const charge = (studentId: string, key: string, dueDate: string, status: "active" | "cancelled" = "active") =>
    asOldApp((tx) => tx.insert(feeCharges).values({ schoolId: id, studentId, yearId: w.y.id, kind: "transport", label: `Transport ${dueDate.slice(0, 7)}`, dueDate, amountPaise: 123_457, status, sourceKey: key }));
  return { school, w, pay, concede, charge, mover: () => FeeMover.for(id) };
}

describe("moving the old fee tables", () => {
  it("moves every case, equal to the paisa, then does nothing the second time", async () => {
    const t = await oldSchool("mv-all");
    const { w } = t;
    await t.pay(w.alice.id, "2026-04-08", "cash", 416_667);                 // Term 1 on time
    await t.pay(w.alice.id, "2026-08-25", "upi", 300_000);                  // Term 2 late: late fee first, then part of the fee
    await t.concede(w.bob.id, { kind: "percent", value: 1_250 });           // 12.5% of the whole fee
    await t.concede(w.bob.id, { kind: "amount", value: 150_033, headId: w.exam.id });
    await t.pay(w.bob.id, "2026-04-09", "cheque", 200_000);
    await t.concede(w.bob.id, { kind: "percent", value: 10_000, headId: w.tuition.id }); // added after payment: money paid above the bill
    await t.pay(w.cara.id, "2026-04-09", "cash", 416_667);
    await t.pay(w.cara.id, "2026-04-10", "cash", 1_000, { cancel: "Wrong student" });
    await t.pay(w.eve.id, "2026-04-11", "cash", 400_000, { asClass: w.c5.id }); // class 5 money, student now in class 6: D1
    await t.charge(w.alice.id, "transport:alice:2026-07", "2026-07-01");
    await t.charge(w.alice.id, "transport:alice:2026-08", "2026-08-01");
    await t.charge(w.alice.id, "transport:alice:2026-09", "2026-09-01", "cancelled");
    await t.pay(w.alice.id, "2026-07-02", "cash", 123_457);
    const before = await count(t.school.id, "fee_payments");

    const report = await withSchool(t.school.id, (tx) => t.mover().run(tx, { today: TODAY }));
    expect(report.status).toBe("moved");
    // 3 instalments for alice, bob, cara; dan left before term 2 (only term 1); eve is in class 6, which has no structure; alice has 2 live charges.
    expect(await count(t.school.id, "fee_invoices", "kind = 'plan'")).toBe(3 + 3 + 3 + 1);
    expect(await count(t.school.id, "fee_invoices", "kind = 'transport'")).toBe(2);
    expect(await count(t.school.id, "fee_receipts")).toBe(before);
    expect(await count(t.school.id, "fee_receipts", "status = 'reversed'")).toBe(1);
    expect(report.totals.new.gross).toBe(report.totals.old.gross - report.totals.notBilled.gross);
    expect(report.notBilled.map((n) => n.student)).toEqual(["Dan (A4)"]);
    expect(report.credits.map((c) => c.student)).toEqual(["Bob (A2)"]);
    expect(report.orphans.map((o) => [o.student, o.paise])).toEqual([["Eve (A5)", 400_000]]);
    // the money: receipts keep their numbers and add up
    expect(report.receipts.oldValidPaise).toBe(report.receipts.newValidPaise);
    expect(await count(t.school.id, "fee_receipts", "number = 'RCPT/2026-27/000001'")).toBe(1);
    // the late fee alice paid is a late line, fully paid; the plan's source keys are the ones the nightly job uses
    expect(await count(t.school.id, "fee_invoice_lines", "kind = 'late' and paid_paise = amount_paise")).toBe(1);
    expect(await count(t.school.id, "fee_invoices", "source_key like 'plan:%'")).toBe(10);
    expect(await count(t.school.id, "fee_invoices", "source_key = 'transport:alice:2026-07' and status = 'issued'")).toBe(1);
    // the books agree and the numbers carry on
    expect(await withSchool(t.school.id, (tx) => new ChecksService(systemCtx(t.school.id, ["fees"])).runIn(tx))).toEqual([]);
    expect(await withSchool(t.school.id, (tx) => nextNumber(tx, t.school.id, "receipt", TODAY))).toBe(`RCPT/2026-27/${String(before + 1).padStart(6, "0")}`);
    // nothing old was touched
    expect(await count(t.school.id, "fee_payments")).toBe(before);

    const again = await withSchool(t.school.id, (tx) => t.mover().run(tx, { today: TODAY }));
    expect(again.status).toBe("already moved");
    expect(await count(t.school.id, "fee_receipts")).toBe(before);
  });

  it("a dry run changes nothing", async () => {
    const t = await oldSchool("mv-dry");
    await t.pay(t.w.alice.id, "2026-04-08", "cash", 100_000);
    await expect(withSchool(t.school.id, async (tx) => { await t.mover().run(tx, { today: TODAY }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await count(t.school.id, "fee_invoices")).toBe(0);
    expect(await count(t.school.id, "fee_receipts")).toBe(0);
    expect(await count(t.school.id, "fin_journals")).toBe(0);
    expect(await count(t.school.id, "audit_logs", "action = 'move-fees'")).toBe(0);
  });

  it("a payment that does not add up to its allocations stops the move and writes nothing", async () => {
    const t = await oldSchool("mv-bad");
    await t.pay(t.w.alice.id, "2026-04-08", "cash", 100_000);
    await asOldApp((tx) => tx.execute(sql`update fee_payments set amount_paise = amount_paise + 1 where school_id = ${t.school.id}`));
    await expect(withSchool(t.school.id, (tx) => t.mover().run(tx, { today: TODAY }))).rejects.toThrow(/allocations add up/);
    expect(await count(t.school.id, "fee_invoices")).toBe(0);
    expect(await count(t.school.id, "fee_plans")).toBe(0);
  });

  it("the school role reads the old tables but cannot write them, so nothing is recorded after the move", async () => {
    const t = await oldSchool("mv-locked");
    await expect(withSchool(t.school.id, (tx) => tx.execute(sql`update fee_payments set amount_paise = amount_paise + 1`))).rejects.toThrow();
    expect(await count(t.school.id, "fee_structures")).toBe(1);
  });

  it("a school with nothing old to move is left alone", async () => {
    const school = await createTestSchool("mv-none", FEATURES);
    const r = await withSchool(school.id, (tx) => FeeMover.for(school.id).run(tx, { today: TODAY }));
    expect(r.status).toBe("nothing to move");
  });
});
