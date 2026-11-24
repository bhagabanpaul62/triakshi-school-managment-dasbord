import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, migrateDb, withSchool } from "@smw/db";
import { DuesService } from "./dues";
import { makeSchool, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
let fx: Fixture;
afterAll(closeDb);

// 2,000 students x 6 bills made with set-based SQL (the services would take minutes), then the dashboard is timed.
beforeAll(async () => {
  fx = await makeSchool("perf", { plan: false });
  const [sid, year, cls] = [fx.school.id, fx.yearId, fx.classId];
  await withSchool(sid, async (tx) => {
    await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status) select gen_random_uuid(), ${sid}::uuid, 'P' || g, 'Perf Student ' || g, ${cls}::uuid, ${fx.sectionId}::uuid, 'active' from generate_series(1, 2000) g`);
    await tx.execute(sql`insert into fee_invoices (id, school_id, student_id, year_id, class_id, kind, status, source_key, number, label, issue_date, due_date, snapshot, gross_paise, paid_paise)
      select gen_random_uuid(), ${sid}::uuid, s.id, ${year}::uuid, ${cls}::uuid, 'plan', 'issued', 'perf:' || s.id || ':' || k, 'PERF/' || row_number() over (), 'Month ' || k, current_date - 100, current_date + (k * 15 - 60),
             jsonb_build_object('studentName', s.name, 'admissionNo', s.admission_no, 'classLabel', 'Class 5-A', 'guardian', null), 100000, case when (hashtext(s.id::text) + k) % 10 < 7 then 100000 else 0 end
      from students s cross join generate_series(1, 6) k where s.admission_no like 'P%'`);
    await tx.execute(sql`insert into fee_invoice_lines (id, school_id, invoice_id, kind, label, amount_paise, paid_paise) select gen_random_uuid(), ${sid}::uuid, i.id, 'fee', i.label, i.gross_paise, i.paid_paise from fee_invoices i where i.source_key like 'perf:%'`);
    await tx.execute(sql`insert into fee_receipts (id, school_id, number, student_id, date, amount_paise, snapshot, verify_token)
      select gen_random_uuid(), ${sid}::uuid, 'PR/' || n, i.student_id, current_date - ((n % 30)::int), i.paid_paise, i.snapshot, 'tok' || n from (select i.*, row_number() over () n from fee_invoices i where i.paid_paise > 0 limit 20000) i`);
    await tx.execute(sql`insert into fee_receipt_methods (id, school_id, receipt_id, method, amount_paise) select gen_random_uuid(), ${sid}::uuid, r.id, 'upi', r.amount_paise from fee_receipts r`);
  });
  // A school that has been running has table statistics; a bulk load has none until the database gets to it.
  await migrateDb().execute(sql`analyze`);
  // A school that has been running has table statistics; a bulk load has none until the database gets to it.

});

describe("the dashboard at school size", () => {
  it("overview() answers in under 1.5 seconds with 2,000 students and 12,000 bills", async () => {
    const svc = new DuesService(fx.school.as.admin);
    await svc.overview(); // warm the connection and plans
    const t0 = performance.now();
    const o = await svc.overview();
    const ms = performance.now() - t0;
    console.info(`overview(): ${ms.toFixed(0)} ms for 2000 students x 6 bills`);
    expect(ms).toBeLessThan(1500);
    expect(o.summary.studentsWithDues).toBeGreaterThan(500);
    expect(o.summary.outstanding).toBeGreaterThan(0);
    expect(o.chase).toHaveLength(8);
  });

  it("the dues report page and the collection reports are fast too", async () => {
    const svc = new DuesService(fx.school.as.admin);
    const t0 = performance.now();
    const page = await svc.report({ pageSize: 20 });
    const rep = await svc.collection({ from: "2000-01-01", to: "2999-12-31", by: "day" });
    const ms = performance.now() - t0;
    console.info(`report + collection: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
    expect(page.total).toBeGreaterThan(500);
    expect(rep.rows.length).toBeGreaterThan(0);
  });
});
