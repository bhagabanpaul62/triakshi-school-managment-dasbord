import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, eq, users, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { FeeReminderJob, FeeReminders } from "./reminders";
import { ConcessionService, DuesService, FeeHeadService, FeeStructureService, PaymentService } from "./service";

// The dev database is shared with other builds running at the same time; give it room.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

let a: TestSchool, b: TestSchool;
let classId: string, otherClassId: string, studentId: string, siblingId: string, strangerId: string;
let tuitionId: string, examId: string, structureId: string;

const REAL_DAY = "2026-04-08";
const structureInput = (over: Record<string, unknown> = {}) => ({
  classId, name: "Class 5 fees",
  items: [{ headId: tuitionId, amountPaise: 3_000_000 }, { headId: examId, amountPaise: 600_000 }],
  installments: [
    { name: "Term 1", dueDate: "2026-04-10", amountPaise: 1_200_000 },
    { name: "Term 2", dueDate: "2026-08-10", amountPaise: 1_200_000 },
    { name: "Term 3", dueDate: "2026-12-10", amountPaise: 1_200_000 },
  ],
  lateRules: [{ kind: "per_day", amountPaise: 5_000, graceDays: 5, maxPaise: 50_000 }],
  ...over,
});

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["students", "academics", "fees"]));
  await withSchool(b.id, (tx) => tx.insert(academicYears).values({ schoolId: b.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }));
  await withSchool(a.id, async (tx) => {
    await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true });
    const [c1, c2] = await tx.insert(classes).values([{ schoolId: a.id, name: "Class 5", grade: 5 }, { schoolId: a.id, name: "Class 6", grade: 6 }]).returning();
    classId = c1!.id; otherClassId = c2!.id;
    const [year] = await tx.select().from(academicYears);
    const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId, yearId: year!.id, name: "A" }).returning();
    const base = { schoolId: a.id, classId, sectionId: sec!.id };
    const [s1, s2, s3] = await tx.insert(students).values([
      { ...base, admissionNo: "A1", name: "Riya Sharma", userId: a.users.student },
      { ...base, admissionNo: "A2", name: "Kabir Sharma" },
      { ...base, admissionNo: "A3", name: "Meera Iyer" },
    ]).returning();
    studentId = s1!.id; siblingId = s2!.id; strangerId = s3!.id;
  });
  const heads = new FeeHeadService(a.as.admin);
  tuitionId = (await heads.create({ name: "Tuition", kind: "tuition" })).id;
  examId = (await heads.create({ name: "Exam", kind: "exam", isRecurring: "true" })).id;
  structureId = (await new FeeStructureService(a.as.accountant).save(structureInput())).id;
});
afterAll(closeDb);

describe("fee structures", () => {
  it("rejects installments that do not add up to the fees, with both numbers", async () => {
    const bad = structureInput({ classId: otherClassId, installments: [{ name: "Only", dueDate: "2026-04-10", amountPaise: 3_000_000 }] });
    await expect(new FeeStructureService(a.as.admin).save(bad)).rejects.toMatchObject({ fieldErrors: { installments: expect.stringContaining("₹30,000") } });
  });
  it("one structure per class per year", async () => {
    await expect(new FeeStructureService(a.as.admin).save(structureInput())).rejects.toBeInstanceOf(ConflictError);
  });
  it("copies to another class, then refuses to copy over an existing one", async () => {
    const svc = new FeeStructureService(a.as.admin);
    const copy = await svc.copyTo({ id: structureId, classId: otherClassId });
    expect(copy.total).toBe(3_600_000);
    expect(copy.installments).toHaveLength(3);
    expect(copy.lateRules[0]).toMatchObject({ kind: "per_day", graceDays: 5 });
    await expect(svc.copyTo({ id: structureId, classId: otherClassId })).rejects.toBeInstanceOf(ConflictError);
    await svc.remove(copy.id);
  });
  it("editing keeps recorded payments pointing at their installment", async () => {
    const svc = new FeeStructureService(a.as.admin);
    const before = await svc.get(structureId);
    await svc.save({ ...structureInput({ installments: before.installments }), id: structureId, name: "Class 5 fees (2026-27)" });
    const after = await svc.get(structureId);
    expect(after.installments.map((i) => i.id)).toEqual(before.installments.map((i) => i.id));
    expect(after.name).toBe("Class 5 fees (2026-27)");
  });
  it("a fee head in use cannot be deleted", async () => {
    await expect(new FeeHeadService(a.as.admin).remove(tuitionId)).rejects.toBeInstanceOf(ConflictError);
  });
  it("overview lists every class with its structure", async () => {
    const o = await new FeeStructureService(a.as.admin).overview();
    expect(o.classes.find((c) => c.id === classId)?.structure?.total).toBe(3_600_000);
    expect(o.classes.find((c) => c.id === otherClassId)?.structure).toBeNull();
  });
});

describe("payments", () => {
  it("numbers receipts per financial year, allocates oldest first and totals to the paisa", async () => {
    const svc = new PaymentService(a.as.accountant);
    const one = await svc.record({ studentId, amountPaise: 1_200_000, method: "cash", paidOn: REAL_DAY });
    expect(one.payment.receiptNo).toBe("RCPT/2026-27/000001");
    expect(one.plan.allocations).toEqual([expect.objectContaining({ name: "Term 1", amountPaise: 1_200_000, lateFeePaise: 0 })]);

    // Term 2 paid late: Aug 20 is 10 days after the due date, 5 of them free => 5 x Rs 50 late fee, paid first.
    const two = await svc.record({ studentId, amountPaise: 1_200_000, method: "upi", reference: "UPI123", paidOn: "2026-08-20" });
    expect(two.payment.receiptNo).toBe("RCPT/2026-27/000002");
    expect(two.plan.allocations[0]).toMatchObject({ name: "Term 2", lateFeePaise: 25_000, amountPaise: 1_175_000 });

    const ledger = await new DuesService(a.as.accountant).studentLedger(studentId, "2026-08-21");
    const t = ledger.statement.totals;
    expect(t.paid).toBe(2_400_000);
    expect(t.gross - t.concession + t.late - t.paid).toBe(t.due);
    expect(ledger.statement.lines.map((l) => l.status)).toEqual(["paid", "overdue", "pending"]);
  });

  it("installments match by id: dropping a paid one is refused, dropping an unpaid one keeps the others' payments", async () => {
    const svc = new FeeStructureService(a.as.admin);
    const cur = await svc.get(structureId);
    const keep = (i: { id: string; name: string; dueDate: string; amountPaise: number }) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: i.amountPaise });
    const [t1, t2, t3] = cur.installments;
    // Term 1 (paid) removed while Term 2, 3 stay: refused.
    const noT1 = [{ ...keep(t2!), amountPaise: t2!.amountPaise + t1!.amountPaise }, keep(t3!)];
    await expect(svc.save({ ...structureInput(), id: structureId, installments: noT1 })).rejects.toBeInstanceOf(ConflictError);
    // Term 3 (unpaid) removed: Term 1 and 2 keep their ids, so their payments stay put.
    const noT3 = [keep(t1!), { ...keep(t2!), amountPaise: t2!.amountPaise + t3!.amountPaise }];
    const saved = await svc.save({ ...structureInput(), id: structureId, installments: noT3 });
    expect(saved.installments.map((i) => i.id)).toEqual([t1!.id, t2!.id]);
    expect((await new DuesService(a.as.admin).studentLedger(studentId, "2026-08-21")).statement.lines[0]).toMatchObject({ name: "Term 1", status: "paid" });
    await svc.save({ ...structureInput(), id: structureId, installments: [...saved.installments.map(keep).map((i, k) => (k === 1 ? { ...i, amountPaise: 1_200_000 } : i)), { name: "Term 3", dueDate: "2026-12-10", amountPaise: 1_200_000 }] });
  });
  it("saving keeps a per-installment late fee", async () => {
    const svc = new FeeStructureService(a.as.admin);
    const cur = await svc.get(structureId);
    const withRule = { ...structureInput(), id: structureId, installments: cur.installments, lateRules: [{ kind: "flat", amountPaise: 10_000, graceDays: 0 }, { installmentIndex: 0, kind: "flat", amountPaise: 20_000, graceDays: 0 }] };
    const saved = await svc.save(withRule);
    expect(saved.lateRules.filter((r) => r.installmentId === saved.installments[0]!.id)).toHaveLength(1);
    await svc.save({ ...structureInput(), id: structureId, installments: saved.installments });
  });
  it("refuses more than is owed and a missing reference for non-cash", async () => {
    const svc = new PaymentService(a.as.admin);
    await expect(svc.record({ studentId: strangerId, amountPaise: 99_999_999, method: "cash" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.record({ studentId: strangerId, amountPaise: 1000, method: "cheque" })).rejects.toMatchObject({ fieldErrors: { reference: expect.any(String) } });
    await expect(svc.record({ studentId: strangerId, amountPaise: 1000, method: "cash", paidOn: "2999-01-01" })).rejects.toMatchObject({ fieldErrors: { paidOn: expect.any(String) } });
  });

  it("a class with no structure cannot take payments", async () => {
    const [x] = await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, admissionNo: "A9", name: "No Plan", classId: otherClassId }).returning());
    await expect(new PaymentService(a.as.admin).record({ studentId: x!.id, amountPaise: 1000, method: "cash" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("cancelling puts the money back on the dues and keeps the receipt", async () => {
    const svc = new PaymentService(a.as.admin);
    const { payment } = await svc.record({ studentId: strangerId, amountPaise: 500_000, method: "cash", paidOn: REAL_DAY });
    const dues = new DuesService(a.as.admin);
    expect((await dues.studentLedger(strangerId, REAL_DAY)).statement.totals.paid).toBe(500_000);
    await svc.cancel({ id: payment.id, reason: "Wrong student" });
    const after = await dues.studentLedger(strangerId, REAL_DAY);
    expect(after.statement.totals.paid).toBe(0);
    expect(after.payments[0]).toMatchObject({ receiptNo: payment.receiptNo, status: "cancelled", cancelReason: "Wrong student" });
    await expect(svc.cancel({ id: payment.id, reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a concession cannot point at another school's fee head, and fee names ignore wildcards and case", async () => {
    const foreign = await new FeeHeadService(b.as.admin).create({ name: "Bus" });
    await expect(new ConcessionService(a.as.admin).create({ studentId, headId: foreign.id, kind: "amount", amountPaise: 100, reason: "Cross school" })).rejects.toBeInstanceOf(NotFoundError);
    await new FeeHeadService(b.as.admin).remove(foreign.id);
    await expect(new FeeHeadService(a.as.admin).create({ name: "tuition" })).rejects.toBeInstanceOf(ConflictError);
    await expect(new FeeHeadService(a.as.admin).update(examId, { name: "T%" })).resolves.toMatchObject({ name: "T%" });
    await new FeeHeadService(a.as.admin).update(examId, { name: "Exam", kind: "exam" });
  });

  it("a concession lowers what is due, to the paisa", async () => {
    await new ConcessionService(a.as.admin).create({ studentId: siblingId, kind: "percent", percent: "12.5", reason: "Sibling discount" });
    const t = (await new DuesService(a.as.admin).studentLedger(siblingId, REAL_DAY)).statement.totals;
    expect(t.concession).toBe(450_000);
    expect(t.due).toBe(3_600_000 - 450_000);
  });

  it("produces a PDF receipt", async () => {
    const [p] = await new PaymentService(a.as.admin).forStudent(studentId);
    const pdf = await new PaymentService(a.as.admin).receiptPdf(p!.id);
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe("%PDF");
    const file = await new PaymentService(a.as.admin).receiptFile(p!.id);
    expect(file.filename).toMatch(/^RCPT-2026-27-\d{6}\.pdf$/);
  });
});

describe("dues", () => {
  it("reports totals, overdue filter and summary", async () => {
    const dues = new DuesService(a.as.accountant);
    const all = await dues.duesReport();
    expect(all.total).toBe(3); // Riya, Kabir, Meera have a structure; "No Plan" does not
    expect(all.totals.due).toBe(all.rows.reduce((s, r) => s + r.due, 0));
    const overdue = await dues.duesReport({ filters: { overdue: "1" } });
    expect(overdue.rows.every((r) => r.overdue > 0)).toBe(true);
    expect((await dues.duesReport({ q: "kabir" })).rows.map((r) => r.name)).toEqual(["Kabir Sharma"]);
    const s = await dues.summary();
    expect(s.outstanding).toBe(all.totals.due);
    expect(s.overdueCount).toBe(overdue.total);
  });

  it("the overview agrees with the summary and ranks who to chase", async () => {
    const dues = new DuesService(a.as.accountant);
    const o = await dues.overview();
    expect(o.summary).toEqual(await dues.summary());
    expect(o.byClass.reduce((s, c) => s + c.due, 0)).toBe(o.summary.outstanding);
    expect(o.chase.every((r) => r.overdue > 0)).toBe(true);
    expect(o.chase.map((r) => r.overdue)).toEqual([...o.chase.map((r) => r.overdue)].sort((x, y) => y - x));
    expect(o.today.receipts.length).toBe(o.summary.receiptsToday);
  });

  it("the collection trend is zero-filled and counts only valid payments", async () => {
    const months = await new DuesService(a.as.admin).collectionTrend("month", 36);
    expect(months).toHaveLength(36);
    expect(months.reduce((s, m) => s + m.paise, 0)).toBe(2_400_000); // the cancelled one is not counted
  });
});

describe("students", () => {
  it("a student sees only themself: ledger and receipts, not a sibling's or a stranger's", async () => {
    const dues = new DuesService(a.as.student);
    expect((await dues.mine()).map((r) => r.name)).toEqual(["Riya Sharma"]);
    expect((await dues.studentLedger(studentId)).student.name).toBe("Riya Sharma");
    await expect(dues.studentLedger(siblingId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dues.studentLedger(strangerId)).rejects.toBeInstanceOf(NotFoundError);
    const [p] = await new PaymentService(a.as.student).forStudent(studentId);
    expect((await new PaymentService(a.as.student).receiptPdf(p!.id)).length).toBeGreaterThan(500);
  });
  it("a legacy parent login sees nothing", async () => {
    await expect(new DuesService(a.as.parent).mine()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("permissions", () => {
  it("only admin and accountant manage fees", async () => {
    for (const who of [a.as.teacher, a.as.student, a.as.parent]) {
      await expect(new PaymentService(who).record({ studentId, amountPaise: 1000, method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new FeeHeadService(who).create({ name: "Hack" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new FeeStructureService(who).save(structureInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new PaymentService(who).cancel({ id: studentId, reason: "Hack" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ConcessionService(who).create({ studentId, kind: "amount", amountPaise: 100, reason: "Hack" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
  it("students, parents and teachers cannot read school-wide dues", async () => {
    for (const who of [a.as.teacher, a.as.student, a.as.parent]) {
      await expect(new DuesService(who).duesReport()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new DuesService(who).summary()).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(new DuesService(a.as.teacher).studentLedger(studentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PaymentService(a.as.teacher).receiptPdf("x")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("isolation", () => {
  it("school B cannot list, get, update, delete or print school A's fee data", async () => {
    const [p] = await new PaymentService(a.as.admin).forStudent(studentId);
    const concession = await new ConcessionService(a.as.admin).create({ studentId, kind: "amount", amountPaise: 100, reason: "Isolation check" });

    const heads = new FeeHeadService(b.as.admin);
    expect((await heads.list()).rows).toHaveLength(0);
    await expect(heads.get(tuitionId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(heads.update(tuitionId, { name: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(heads.remove(tuitionId)).rejects.toBeInstanceOf(NotFoundError);

    const structs = new FeeStructureService(b.as.admin);
    expect((await structs.overview()).classes).toHaveLength(0);
    await expect(structs.get(structureId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(structs.remove(structureId)).rejects.toBeInstanceOf(NotFoundError);

    const concessions = new ConcessionService(b.as.admin);
    expect((await concessions.list()).rows).toHaveLength(0);
    await expect(concessions.remove(concession.id)).rejects.toBeInstanceOf(NotFoundError);

    const pay = new PaymentService(b.as.admin);
    await expect(pay.receiptPdf(p!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pay.cancel({ id: p!.id, reason: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(pay.record({ studentId, amountPaise: 1000, method: "cash" })).rejects.toBeInstanceOf(NotFoundError);

    const dues = new DuesService(b.as.admin);
    await expect(dues.studentLedger(studentId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await dues.duesReport()).total).toBe(0);
    expect((await dues.summary()).collectedThisMonth).toBe(0);
    expect((await dues.collectionTrend("month", 36)).reduce((s, m) => s + m.paise, 0)).toBe(0);
  });
});

const notesOf = (school: TestSchool, userId: string) => withSchool(school.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));

describe("fee notifications", () => {
  it("recording a payment tells the student login once, with the receipt, and not the cashier or a parent login", async () => {
    const before = (await notesOf(a, a.users.student)).length;
    const r = await new PaymentService(a.as.accountant).record({ studentId, amountPaise: 100_000, method: "cash", paidOn: REAL_DAY });
    const note = (await notesOf(a, a.users.student)).slice(before);
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({ kind: "fee_due", title: expect.stringContaining("₹1,000"), body: expect.stringContaining(r.payment.receiptNo), href: `/app/fees/students/${studentId}` });
    expect(await notesOf(a, a.users.accountant)).toHaveLength(0);
    expect(await notesOf(a, a.users.parent)).toHaveLength(0);
    expect(await notesOf(b, b.users.student)).toHaveLength(0);
  });
});

describe("overdue reminders", () => {
  it("remind each student login once per overdue installment, however often the job runs", async () => {
    // Kabir (the sibling) paid only part of Term 1; give him a login so there is someone to tell.
    const kabir = await withSchool(a.id, async (tx) => {
      const [u] = await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: "kabir-fees", name: "Kabir Sharma", passwordHash: "x" }).returning();
      await tx.update(students).set({ userId: u!.id }).where(eq(students.id, siblingId));
      return u!;
    });
    const before = (await notesOf(a, kabir.id)).length;
    // Term 1 fell due on 2026-04-10: the day after, it is overdue for everyone who has not paid it. Only students with a login are told.
    const sent = await new FeeReminders(a.as.admin).run("2026-04-11");
    expect(sent).toBeGreaterThan(0);
    const fresh = (await notesOf(a, kabir.id)).slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((n) => n.title === "Fee overdue: Term 1" && n.href?.startsWith("/app/fees/students/"))).toBe(true);
    expect(await new FeeReminders(a.as.admin).run("2026-04-11")).toBe(0);
    expect(await new FeeReminders(a.as.admin).run("2026-04-12")).toBe(0);
    expect((await notesOf(a, kabir.id)).length).toBe(before + fresh.length);
    expect(await notesOf(a, a.users.parent)).toHaveLength(0);
  });

  it("a school with nobody to remind is fine, and the job reports every school", async () => {
    expect(await new FeeReminders(b.as.admin).run("2026-04-11")).toBe(0);
    await expect(new FeeReminderJob([a.id, b.id], "2026-04-11").run()).resolves.toMatchObject({ schools: 2, failed: 0 });
  });
});
