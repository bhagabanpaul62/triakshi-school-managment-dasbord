import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { DuesService, PaymentService } from "./service";
import seed from "./seed";

// The dev database is shared with other builds running at the same time; give it room.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

let a: TestSchool;
const state: Record<string, unknown> = {};

beforeAll(async () => {
  ({ a } = await createSchoolPair(["students", "academics", "fees"], "seed"));
  await withSchool(a.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const cls = await tx.insert(classes).values([1, 4, 8].map((g) => ({ schoolId: a.id, name: `Class ${g}`, grade: g }))).returning();
    const rows = await tx.insert(students).values(Array.from({ length: 20 }, (_, i) => ({ schoolId: a.id, admissionNo: `S${i}`, name: `Student ${i}`, classId: cls[i % 3]!.id }))).returning();
    state.yearId = y!.id;
    state.classes = cls.map((c) => ({ id: c.id, name: c.name, grade: c.grade }));
    state.students = rows.map((s, i) => ({ id: s.id, name: s.name, classId: s.classId, guardianUserId: i < 6 ? `family-${i % 3}` : null }));
  });
  await seed(a.as.admin, state);
});
afterAll(closeDb);

describe("fees seed", () => {
  it("prices every class between ₹18,000 and ₹48,000 and sets state.feeStructures", async () => {
    const fs = state.feeStructures as { id: string; classId: string }[];
    expect(fs).toHaveLength(3);
    const dues = await new DuesService(a.as.admin).duesReport({ pageSize: 100 });
    const gross = new Set(dues.rows.map((r) => r.gross));
    expect(Math.min(...gross)).toBe(1_800_000);
    expect(Math.max(...gross)).toBe(4_800_000);
  });
  it("leaves a mix of paid, due and overdue students that reconcile", async () => {
    const dues = new DuesService(a.as.admin);
    const r = await dues.duesReport({ pageSize: 100 });
    expect(r.rows.some((x) => x.paid > 0)).toBe(true);
    expect(r.rows.some((x) => x.overdue > 0)).toBe(true);
    expect(r.rows.some((x) => x.concession > 0)).toBe(true);
    for (const x of r.rows) expect(x.gross - x.concession + x.late - x.paid).toBe(x.due);
    expect((await dues.summary()).overdueCount).toBeGreaterThan(0);
  });
  it("numbers receipts in date order", async () => {
    const all = await Promise.all((state.students as { id: string }[]).map((s) => new PaymentService(a.as.admin).forStudent(s.id)));
    const sorted = all.flat().sort((x, y) => x.receiptNo.localeCompare(y.receiptNo));
    expect(sorted.length).toBeGreaterThan(5);
    expect(sorted.map((p) => p.paidOn)).toEqual([...sorted.map((p) => p.paidOn)].sort());
  });
});
