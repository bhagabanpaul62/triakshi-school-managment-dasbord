import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { countStudents } from "@smw/billing";
import type { StaffCtx } from "@smw/feature-kit";
import { SchoolAdminService } from "./index";

vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

describe("plan usage", () => {
  it("counts active children only: a joining child and a left child with a kept section are not on the plan", async () => {
    const owner: StaffCtx = { staffId: crypto.randomUUID(), role: "owner", name: "Test owner" };
    const r = await new SchoolAdminService(owner).create({ name: "Count School", slug: `cnt${Date.now().toString(36)}`, adminName: "Asha Rao", adminEmail: "cnt@x.test" });
    await withSchool(r.schoolId, async (tx) => {
      for (const [i, status] of (["active", "joining", "left", "alumni"] as const).entries()) {
        await tx.execute(sql`insert into students (id, school_id, admission_no, name, status) values (${uuidv7()}, ${r.schoolId}, ${"C" + i}, ${"Kid " + i}, ${status})`);
      }
    });
    expect((await new SchoolAdminService(owner).detail(r.schoolId)).studentCount).toBe(1);
    expect(await withSchool(r.schoolId, (tx) => countStudents(tx, r.schoolId))).toBe(1);
  });
});
