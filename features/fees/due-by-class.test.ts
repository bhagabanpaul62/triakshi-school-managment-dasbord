import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { TODAY, issueAll, makeSchool, type Fixture } from "./testing";
import { addDays } from "@smw/feature-kit/money";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture, other: Fixture;
afterAll(closeDb);
beforeAll(async () => {
  fx = await makeSchool("dbc");
  other = await makeSchool("dbc-b");
  await issueAll(fx);
  await issueAll(other);
});

describe("DuesService.dueByClass (home: one query instead of one dues report per class)", () => {
  it("gives the same figure per class as the dues report asked class by class, and leaves out classes that owe nothing", async () => {
    const [s] = await withSchool(fx.school.id, (tx) => tx.insert(students).values({ schoolId: fx.school.id, admissionNo: "C6-1", name: "Six Student", classId: fx.otherClassId }).returning());
    const inv = new InvoiceService(fx.school.as.accountant);
    await inv.issue(await inv.saveDraft({ studentId: s!.id, label: "Class 6 fee", dueDate: addDays(TODAY, -3), lines: [{ label: "Class 6 fee", amountPaise: 70_000 }] }));
    await new ReceiptService(fx.school.as.accountant).collect({ studentId: fx.students.neel, methods: [{ method: "cash", amountPaise: 30_000 }] });

    const dues = new DuesService(fx.school.as.admin);
    const batch = await dues.dueByClass();
    const byClass = await Promise.all((await dues.classOptions()).map(async (c) => ({ c, r: await dues.report({ filters: { classId: c.id }, pageSize: 1 }) })));
    const want = byClass.filter((x) => x.r.total > 0).map((x) => ({ classId: x.c.id, name: x.c.name, duePaise: x.r.totals.due }));
    expect(batch).toEqual(want);
    expect(batch.map((b) => b.name)).toEqual(["Class 5", "Class 6"]);
    expect(batch.find((b) => b.name === "Class 6")!.duePaise).toBe(70_000);
  });

  it("worstOverdue gives the first rows of the overdue report, in its order, and its counts match the dashboard summary", async () => {
    const dues = new DuesService(fx.school.as.admin);
    const [s] = await withSchool(fx.school.id, (tx) => tx.insert(students).values({ schoolId: fx.school.id, admissionNo: "OD-1", name: "Overdue Owen", classId: fx.classId }).returning());
    const inv = new InvoiceService(fx.school.as.accountant);
    await inv.issue(await inv.saveDraft({ studentId: s!.id, label: "Late fee", dueDate: addDays(TODAY, -9), lines: [{ label: "Late fee", amountPaise: 90_000 }] }));
    const report = await dues.report({ filters: { overdue: "1" }, pageSize: 3 });
    const worst = await dues.worstOverdue(3);
    expect(worst.map(({ phone: _p, ...r }) => r)).toEqual(report.rows.map((r) => ({ id: r.id, name: r.name, classLabel: r.classLabel, overdue: r.overdue, nextDueDate: r.nextDueDate })));
    const all = await dues.worstOverdue(50);
    expect(all.find((w) => w.id === fx.students.riya)?.phone).toBe("9820000001"); // the primary guardian's number
    expect(all.find((w) => w.id === fx.students.neel)?.phone).toBeNull(); // no guardian on file
    expect(worst.length).toBeGreaterThan(0);
    expect((await dues.worstOverdue(50)).find((w) => w.id === s!.id)).toMatchObject({ overdue: 90_000 });
    const sum = await dues.summary();
    expect({ count: sum.overdueCount, amount: sum.overdueAmount }).toEqual({ count: report.total, amount: report.totals.overdue });
    await expect(new DuesService(fx.school.as.teacher).worstOverdue()).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new DuesService(other.school.as.admin).worstOverdue()).not.toContainEqual(expect.objectContaining({ id: s!.id }));
  });

  it("only for people who may read fees, and isolated to the school", async () => {
    await expect(new DuesService(fx.school.as.teacher).dueByClass()).rejects.toBeInstanceOf(ForbiddenError);
    const mine = await new DuesService(other.school.as.admin).dueByClass();
    expect(mine.map((m) => m.name)).toEqual(["Class 5"]);
    expect(mine[0]!.duePaise).not.toBe(0);
  });
});
