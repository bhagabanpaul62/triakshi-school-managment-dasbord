// Copying a fee plan to another year moves the labels that name a month and year; the approval request names the yearly total.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { finApprovals } from "@smw/feature-finance/schema";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { PlanService } from "./plans";
import { TODAY, bills, issueAll, makeSchool, publish, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
beforeAll(async () => { fx = await makeSchool("copyplan", { plan: false }); });
afterAll(closeDb);

describe("copying a plan to another year", () => {
  it("moves month and year labels, keeps free text and wrong labels, and the bills made from the copy carry them", async () => {
    const y = Number(fx.yearStart.slice(0, 4));
    await withSchool(fx.school.id, (tx) => tx.insert(academicYears).values({ schoolId: fx.school.id, name: `${y - 1}-${String(y).slice(2)}`, startsOn: `${y - 1}-04-01`, endsOn: `${y}-03-31`, isCurrent: false }));
    const prior = await withSchool(fx.school.id, async (tx) => (await tx.select().from(academicYears).where(eq(academicYears.startsOn, `${y - 1}-04-01`)))[0]!);
    const dueOf = (key: string, label: string, amountPaise: number, day = 10) => ({ dueKey: key, label, billOn: `${y - 1}-04-01`, dueOn: `${y - 1}-04-${day}`, amountPaise });
    const plans = new PlanService(fx.school.as.admin);
    const src = await plans.saveDraft({ yearId: prior.id, name: "Class 6 last year", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: [
      dueOf("A", `April ${y - 1}`, 100_000), dueOf("B", `Term 1 ${y - 1}-${String(y).slice(2)}`, 50_000, 11), dueOf("C", "Admission fee", 20_000, 12), dueOf("D", `April ${y - 4}`, 10_000, 13),
    ] }] });
    const copy = await plans.copy(src.plan.id, { yearId: fx.yearId });
    const labels = Object.fromEntries(copy.lines[0]!.dues.map((d) => [d.dueKey, d.label]));
    expect(labels).toEqual({ A: `April ${y}`, B: `Term 1 ${y}-${String(y + 1).slice(2)}`, C: "Admission fee", D: `April ${y - 4}` });
    // The source keeps its own words.
    expect((await plans.get(src.plan.id)).lines[0]!.dues.map((d) => d.label)).toContain(`April ${y - 1}`);

    await publish(fx, { name: "Class 6 this year", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: copy.lines[0]!.dues.map((d) => ({ dueKey: d.dueKey, label: d.label, billOn: d.billOn, dueOn: d.dueOn, amountPaise: d.amountPaise })) }] });
    const kid = await withSchool(fx.school.id, async (tx) => (await tx.insert(students).values({ schoolId: fx.school.id, admissionNo: "C6-1", name: "Copy Kid", classId: fx.otherClassId, sectionId: fx.sectionId, admissionDate: `${y - 2}-04-10` }).returning({ id: students.id }))[0]!.id);
    await issueAll(fx);
    expect((await bills(fx, kid)).map((b) => b.label)).toEqual([`April ${y}`, `Term 1 ${y}-${String(y + 1).slice(2)}`, "Admission fee", `April ${y - 4}`]);
    expect(TODAY >= `${y}-04-13`).toBe(true);
  });
});

describe("the approval request of a plan", () => {
  it("carries the yearly total per child: optional fees and deposits are not in it", async () => {
    const plans = new PlanService(fx.school.as.admin);
    const d = (key: string, amountPaise: number) => ({ dueKey: key, label: key, billOn: fx.yearStart, dueOn: fx.yearStart, amountPaise });
    const saved = await plans.saveDraft({ yearId: fx.yearId, name: "Total check", admissionType: "new", classIds: [fx.classId], lines: [
      { headId: fx.heads.tuition, dues: [d("T1", 1_200_000), d("T2", 1_500_000)] }, { headId: fx.heads.exam, optional: true, dues: [d("E", 90_000)] }, { headId: fx.heads.deposit, dues: [d("D", 500_000)] },
    ] });
    await plans.submit(saved.plan.id);
    const [a] = await withSchool(fx.school.id, (tx) => tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "fees.plan"), eq(finApprovals.refId, saved.plan.id))));
    expect(a!.amountPaise).toBe(2_700_000);
  });
});
