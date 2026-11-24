import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, users, withSchool } from "@smw/db";
import { monthStart, todayIST } from "@smw/feature-kit/money";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { staffProfiles } from "@smw/feature-staff/schema";
import seed from "./seed";
import { ExitService, LoanService, RunService, StructureService } from "./service";

let s: TestSchool;
beforeAll(async () => {
  s = await createTestSchool("payseed", ["finance", "staff", "payroll", "notifications", "attendance"]);
  await withSchool(s.id, async (tx) => {
    const roster = [["PGT", "Maths"], ["PGT", "Physics"], ["TGT", "English"], ["TGT", "Science"], ["PRT", "Primary"], ["", "Office"]] as const;
    for (const [i, [designation, department]] of roster.entries()) {
      const [u] = await tx.insert(users).values({ schoolId: s.id, role: "teacher", loginId: `seed${i}`, name: `Seed Person ${i}`, email: `seed${i}@x.test`, passwordHash: "x" }).returning();
      await tx.insert(staffProfiles).values({ schoolId: s.id, userId: u!.id, employeeId: `S${i}`, designation, department, joiningDate: "2018-04-01", employmentType: "permanent" });
    }
  });
});
afterAll(closeDb);

describe("demo data", () => {
  it("gives every person pay, three paid months, a draft with two blockers, a loan and an exit; fast and repeatable", async () => {
    const started = Date.now();
    await seed(s.as.admin, {});
    expect(Date.now() - started).toBeLessThan(15_000);
    expect((await new StructureService(s.as.admin).list()).map((x) => x.name).sort()).toEqual(["Support staff", "Teaching staff", "Visiting and hourly"]);
    const runs = (await new RunService(s.as.admin).list({})).rows;
    expect(runs.filter((r) => r.status === "paid")).toHaveLength(3);
    const draft = runs.find((r) => r.status === "draft")!;
    expect(draft.month).toBe(monthStart(todayIST()));
    const v = await new RunService(s.as.admin).get(draft.id);
    expect(v.blockers.map((b) => b.code)).toEqual(["unmarked", "unmarked"]);
    expect((await new LoanService(s.as.admin).list({})).rows.map((l) => l.status)).toEqual(["active"]);
    expect((await new ExitService(s.as.admin).list({})).rows.map((x) => x.status)).toEqual(["draft"]);
    const bad = await withSchool(s.id, async (tx) => [...(await tx.execute(sql`select journal_id from fin_journal_lines group by journal_id having sum(debit_paise) <> sum(credit_paise)`))]);
    expect(bad).toHaveLength(0);
    await seed(s.as.admin, {});
    expect((await new RunService(s.as.admin).list({})).rows).toHaveLength(runs.length);
  });
});
