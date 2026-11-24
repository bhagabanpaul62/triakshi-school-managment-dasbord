import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { ChecksService } from "./checks";
import { DuesService } from "./dues";
import seed from "./seed";
import { feeHeads } from "./schema";
import { makeSchool } from "./testing";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });
afterAll(closeDb);

describe("demo seed", () => {
  it("makes plans, bills, receipts of every kind, a clearing cheque, an advance, a concession and a slip, and the books agree", async () => {
    const fx = await makeSchool("seed", { plan: false });
    const kids = await withSchool(fx.school.id, async (tx) => {
      await tx.delete(feeHeads); // the seed makes its own
      const cls = await tx.select().from(classes);
      for (let i = 0; i < 26; i++) await tx.insert(students).values({ schoolId: fx.school.id, admissionNo: `S${i}`, name: `Seed Kid ${i}`, classId: fx.classId, sectionId: fx.sectionId, admissionDate: `${Number(fx.yearStart.slice(0, 4)) - 1}-04-10` });
      return { cls, rows: await tx.select().from(students) };
    });
    const state: Record<string, unknown> = { classes: kids.cls.map((c) => ({ id: c.id, name: c.name, grade: c.grade })), students: kids.rows.map((s) => ({ id: s.id, name: s.name, classId: s.classId })) };
    const t0 = performance.now();
    await seed(fx.school.as.admin, state);
    const ms = performance.now() - t0;
    console.info(`seed: ${ms.toFixed(0)} ms for ${kids.rows.length} students`);
    const count = (table: string, where = "true") => withSchool(fx.school.id, async (tx) => Number((await tx.execute<{ n: number }>(sql.raw(`select count(*)::int n from ${table} where ${where}`)))[0]!.n));
    expect(await count("fee_plans", "status = 'published'")).toBe(2);
    expect(await count("fee_invoices", "status = 'issued'")).toBeGreaterThan(100);
    expect(await count("fee_receipts")).toBeGreaterThan(20);
    expect(await count("fee_receipt_methods", "method = 'cheque'")).toBeGreaterThan(0);
    expect(await count("fee_cheques", "status in ('received', 'deposited')")).toBeGreaterThan(0);
    expect(await count("fee_advances", "kind = 'receipt'")).toBeGreaterThan(0);
    expect(await count("fee_concessions", "status = 'approved'")).toBe(1);
    expect(await count("fee_invoices", "concession_paise > 0")).toBeGreaterThan(0);
    expect(await count("fee_upi_slips", "status = 'submitted'")).toBe(1);
    const o = await new DuesService(fx.school.as.admin).overview();
    expect(o.summary.overdueCount).toBeGreaterThan(0);
    expect(o.summary.collectedThisYear).toBeGreaterThan(0);
    expect((await new ChecksService(fx.school.as.admin).run()).mismatches).toEqual([]);
    expect(ms).toBeLessThan(60_000);
  });
});
