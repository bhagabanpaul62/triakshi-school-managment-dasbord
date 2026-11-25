import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { addDays, todayIST } from "@smw/feature-kit/money";
import { eq } from "drizzle-orm";
import { academicYears, sections } from "@smw/feature-academics/schema";
import { studentAttendance } from "@smw/feature-attendance/schema";
import { feeReceiptMethods, feeReceipts } from "@smw/feature-fees/schema";
import { issueAll, makeSchool, type Fixture } from "@smw/feature-fees/testing";
import { students } from "@smw/feature-students/schema";
import { HomeService } from "./home-service";
import { layoutOf, type PanelKey } from "./panels";

// The PRD's limit is 300 ms for a panel at 3,000 students. This builds that school and times every admin panel the way the page asks for it.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const N = 3000, PER = 50;
let fx: Fixture;
afterAll(closeDb);

beforeAll(async () => {
  if (!process.env.HOME_PERF) return;
  fx = await makeSchool("homeperf");
  const sid = fx.school.id, today = todayIST();
  await withSchool(sid, async (tx) => {
    const [year] = await tx.select().from(academicYears);
    const secs = await tx.insert(sections).values(Array.from({ length: N / PER }, (_, i) => ({ schoolId: sid, classId: fx.classId, yearId: year!.id, name: `P${i}` }))).returning();
    const kids: { id: string; sectionId: string | null }[] = [];
    for (let i = 0; i < N; i += 500) kids.push(...await tx.insert(students).values(Array.from({ length: 500 }, (_, k) => ({ schoolId: sid, admissionNo: `P-${i + k}`, name: `Perf Student ${i + k}`, classId: fx.classId, sectionId: secs[Math.floor((i + k) / PER)]!.id, admissionDate: "2024-04-10", dob: `2014-${String(1 + ((i + k) % 12)).padStart(2, "0")}-${String(1 + ((i + k) % 28)).padStart(2, "0")}` }))).returning({ id: students.id, sectionId: students.sectionId }));
    // The teacher is class teacher of two sections; the student login is the first student.
    for (const sec of secs.slice(0, 2)) await tx.update(sections).set({ classTeacherId: fx.school.users.teacher }).where(eq(sections.id, sec.id));
    await tx.update(students).set({ userId: fx.school.users.student }).where(eq(students.id, kids[0]!.id));
    const days = Array.from({ length: 30 }, (_, d) => addDays(today, -d)).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
    const rows = days.flatMap((date) => kids.map((k, i) => ({ schoolId: sid, studentId: k.id, sectionId: k.sectionId!, date, status: (i % 11 === 0 ? "absent" : "present") as "absent" | "present" })));
    for (let i = 0; i < rows.length; i += 5000) await tx.insert(studentAttendance).values(rows.slice(i, i + 5000));
    const snapshot = { studentName: "Perf", admissionNo: "P", classLabel: "5-A", guardian: null };
    const receipts = await tx.insert(feeReceipts).values(Array.from({ length: 1200 }, (_, i) => ({ schoolId: sid, number: `PR-${i}`, studentId: kids[i]!.id, date: addDays(today, -(i % 40)), amountPaise: 100_000, status: "valid" as const, snapshot, verifyToken: `pt-${i}` }))).returning({ id: feeReceipts.id });
    await tx.insert(feeReceiptMethods).values(receipts.map((r) => ({ schoolId: sid, receiptId: r.id, method: "upi" as const, amountPaise: 100_000 })));
  });
  await issueAll(fx);
  // A real school has had autovacuum look at its tables; a freshly bulk-loaded test database has not.
  await withSchool(sid, (tx) => tx.execute(sql`analyze`));
});

// Slow to seed (about a minute): run with HOME_PERF=1.
describe.skipIf(!process.env.HOME_PERF)("panel service time at 3,000 students", () => {
  it("every admin, accountant, teacher and family panel loads under the PRD's 300 ms", async () => {
    const features = new Set(["home", "students", "academics", "attendance", "fees", "finance", "notifications", "announcements", "events", "website", "support", "setup", "exams", "staff", "timetable", "assignments", "meetings", "messages", "library", "transport", "settings"]);
    const timings: string[] = [], slow: string[] = [];
    for (const ctx of [{ ...fx.school.as.admin, features }, { ...fx.school.as.accountant, features }, { ...fx.school.as.teacher, features }, { ...fx.school.as.student, features }]) {
      const keys = layoutOf(ctx) as PanelKey[];
      await new HomeService(ctx).panel(keys[0]!); // warm the connection and the plans
      for (const key of keys) {
        const home = new HomeService(ctx), t0 = performance.now();
        const slot = await home.panel(key);
        const ms = Math.round(performance.now() - t0);
        if (slot.state !== "off") timings.push(`${ctx.role}/${key}: ${ms} ms (${slot.state})`);
        if (slot.state !== "off") expect(slot.state, key).not.toBe("error");
        if (ms >= 300) slow.push(`${ctx.role}/${key}: ${ms} ms`);
      }
    }
    process.stderr.write(`\nPANEL TIMES at ${N} students\n${timings.join("\n")}`);
    expect(timings.length).toBeGreaterThan(10);
    expect(slow, "panels over 300 ms").toEqual([]);
  });
});
