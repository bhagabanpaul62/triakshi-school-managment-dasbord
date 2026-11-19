import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { createTestSchool } from "@smw/feature-kit/testing";
import { students } from "@smw/feature-students/schema";
import seed from "./seed";
import { BookService, LibraryStats, LoanService } from "./service";

afterAll(closeDb);

describe("library seed", () => {
  it("makes 60 books with 1-3 copies and 30 loans, some overdue", async () => {
    const s = await createTestSchool("seedl", ["students", "academics", "library"]);
    const rows = await withSchool(s.id, (tx) => tx.insert(students).values(Array.from({ length: 50 }, (_, i) => ({ schoolId: s.id, admissionNo: `S${i}`, name: `Kid ${i}` }))).returning({ id: students.id }));
    await seed(s.as.admin, { students: rows, teachers: [{ userId: s.users.teacher }] });
    const stats = await new LibraryStats(s.as.admin).summary();
    expect(stats.titles).toBe(60);
    expect(stats.copies).toBeGreaterThanOrEqual(60);
    expect(stats.copies).toBeLessThanOrEqual(180);
    expect(stats.issuedNow).toBe(18);
    expect(stats.overdue).toBe(8);
    expect((await new LoanService(s.as.admin).list({ pageSize: 100 })).total).toBe(30);
    expect((await new BookService(s.as.admin).list({ pageSize: 100 })).total).toBe(60);
  });
});
