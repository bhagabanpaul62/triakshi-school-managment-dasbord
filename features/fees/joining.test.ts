import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import { createTestSchool } from "@smw/feature-kit/testing";
import { academicYears } from "@smw/feature-academics/schema";
import { studentEnrollments, studentGuardians, students } from "@smw/feature-students/schema";
import { ConcessionService } from "./concessions";
import { kindFor } from "./plans";
import { DeskService } from "./desk";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { ReminderService } from "./reminders";
import { FEATURES, TODAY, bills, makeSchool, publish, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
let y2 = "", y3 = "", y2Start = "";
const as = () => fx.school.as.accountant;
const slot = (key: string, billOn: string, dueOn: string, amountPaise: number) => ({ dueKey: key, label: `Month ${key}`, billOn, dueOn, amountPaise });
const make = async (o: Record<string, unknown>) => withSchool(fx.school.id, async (tx) => (await tx.insert(students).values({ schoolId: fx.school.id, classId: fx.classId, ...o } as typeof students.$inferInsert).returning())[0]!);
let joiner: typeof students.$inferSelect;

beforeAll(async () => {
  fx = await makeSchool("join", { plan: false });
  const next = Number(fx.yearStart.slice(0, 4)) + 1;
  y2Start = `${next}-04-01`;
  const years = await withSchool(fx.school.id, async (tx) => (await tx.insert(academicYears).values([
    { schoolId: fx.school.id, name: `${next}-next`, startsOn: y2Start, endsOn: `${next + 1}-03-31`, isCurrent: false },
    { schoolId: fx.school.id, name: `${next + 1}-after`, startsOn: `${next + 1}-04-01`, endsOn: `${next + 2}-03-31`, isCurrent: false },
  ]).returning({ id: academicYears.id })).map((y) => y.id));
  y2 = years[0]!; y3 = years[1]!;
  // This year: one plan for class 5. Next year: an all-students plan and a (dearer) plan for new admissions, both for class 5.
  await publish(fx, { name: "C5 now", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [slot("M1", addDays(TODAY, -40), addDays(TODAY, -30), 100_000), slot("M2", addDays(TODAY, -20), addDays(TODAY, -10), 100_000)] }] });
  const dues = [slot("A", `${next}-04-01`, `${next}-04-15`, 90_000), slot("B", `${next}-06-01`, `${next}-06-15`, 90_000), slot("C", `${next}-08-01`, `${next}-08-15`, 90_000)];
  await publish(fx, { yearId: y2, name: "C5 next", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues }] });
  await publish(fx, { yearId: y2, name: "C5 next new", admissionType: "new", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: dues.map((d) => ({ ...d, amountPaise: 150_000 })) }] });
  joiner = await make({ admissionNo: "JN1", name: "Joy Joiner", status: "joining", joinsOn: `${next}-06-10`, joinsYearId: y2, admissionDate: addDays(TODAY, -3) });
});
afterAll(closeDb);

describe("a child who is joining", () => {
  it("is billed for the joining year by the new-admission plan, counted from the day they join", async () => {
    const pv = await new InvoiceService(as()).previewBulk({ yearId: y2 });
    const mine = pv.rows.filter((r) => r.studentId === joiner.id);
    // April is before the month they join; June and August are theirs. The new-admission plan wins although their admission date is outside the year.
    expect(mine.map((r) => [r.label, r.grossPaise])).toEqual([["Month B", 150_000], ["Month C", 150_000]]);
    expect(pv.exceptions.some((e) => e.studentId === joiner.id)).toBe(false);
    // Existing students are billed on the plan for everyone.
    expect(pv.rows.filter((r) => r.studentId === fx.students.riya).map((r) => r.grossPaise)).toEqual([90_000, 90_000, 90_000]);
  });

  it("is never billed in the current year, and is not flagged as left", async () => {
    const pv = await new InvoiceService(as()).previewBulk({});
    expect(pv.rows.some((r) => r.studentId === joiner.id)).toBe(false);
    expect(pv.exceptions.some((e) => e.studentId === joiner.id)).toBe(false);
    expect(pv.skipped.left).toBe(0);
    await new InvoiceService(as()).issueBulk({});
    expect(await bills(fx, joiner.id)).toEqual([]);
  });

  it("bulk issue for the joining year makes their bills, once", async () => {
    const svc = new InvoiceService(as());
    const out = await svc.issueBulk({ yearId: y2 });
    expect(out.issued).toBe(4 * 3 + 2);
    expect((await bills(fx, joiner.id)).map((b) => [b.status, b.yearId, b.classId])).toEqual([["issued", y2, fx.classId], ["issued", y2, fx.classId]]);
    expect((await svc.issueBulk({ yearId: y2 })).issued).toBe(0);
  });

  it("can pay, shows a Joining chip on the desk, the dues list and the picker, and is in the family at the counter", async () => {
    const [first] = await bills(fx, joiner.id);
    await new ReceiptService(as()).collect({ studentId: joiner.id, invoiceIds: [first!.id], methods: [{ method: "cash", amountPaise: 50_000 }] });
    const found = await new DeskService(as()).find("Joy Joiner");
    expect(found[0]!.meta).toMatch(/JN1 · Class 5 · Joining 10 Jun \d{4} · .*due/);
    const report = await new DuesService(as()).report({ q: "Joy" });
    expect(report.rows[0]).toMatchObject({ id: joiner.id, studentStatus: "joining", due: 250_000, tag: expect.stringMatching(/^Joining 10 Jun/) });
    expect(((await new DuesService(as()).report({ filters: { status: "joining" } })).rows).map((r) => r.id)).toEqual([joiner.id]);
    const account = await new DuesService(as()).studentAccount(joiner.id);
    expect(account.student.joinsOn).toBe(`${y2Start.slice(0, 4)}-06-10`);
  });

  it("a custom bill or a charge goes to the joining year, not the current one", async () => {
    const svc = new InvoiceService(as());
    const id = await svc.saveDraft({ studentId: joiner.id, label: "Uniform", dueDate: addDays(TODAY, 5), lines: [{ label: "Uniform", kind: "fee", amountPaise: 20_000 }] });
    const [row] = (await bills(fx, joiner.id)).filter((b) => b.id === id);
    expect(row?.yearId).toBe(y2);
    const [ok] = await svc.chargeMany({ studentIds: [joiner.id], label: "Books", dueDate: addDays(TODAY, 5), lines: [{ label: "Books", kind: "fee", amountPaise: 10_000 }] });
    expect((await bills(fx, joiner.id)).find((b) => b.id === ok)?.yearId).toBe(y2);
  });

  it("is ranked after the brothers and sisters already at school, and only in the year they join", async () => {
    await withSchool(fx.school.id, (tx) => tx.insert(studentGuardians).values({ schoolId: fx.school.id, studentId: joiner.id, guardianId: fx.guardianId, isPrimary: false }));
    const svc = new ConcessionService(fx.school.as.admin);
    const next = (await svc.suggestions(y2)).filter((s) => s.kind === "sibling");
    expect(next.map((s) => s.studentId)).toContain(joiner.id);
    expect(next).toHaveLength(2); // three children in the family: everyone after the first
    expect((await svc.suggestions()).filter((s) => s.kind === "sibling").map((s) => s.studentId)).not.toContain(joiner.id);
    expect((await svc.suggestions()).filter((s) => s.kind === "sibling")).toHaveLength(1);
  });

  it("whose class has no plan is listed with the day they join; a year with no plan says so", async () => {
    const six = await make({ admissionNo: "JN2", name: "Sixth Joiner", classId: fx.otherClassId, status: "joining", joinsOn: `${y2Start.slice(0, 4)}-06-10`, joinsYearId: y2 });
    const pv = await new InvoiceService(as()).previewBulk({ yearId: y2, studentIds: [six.id] });
    expect(pv.exceptions).toEqual([expect.objectContaining({ studentId: six.id, reason: "no_plan", detail: expect.stringMatching(/^Joins on 10 Jun \d{4}\. No published plan covers this class$/) })]);
    const far = await make({ admissionNo: "JN3", name: "Far Joiner", status: "joining", joinsOn: `${Number(y2Start.slice(0, 4)) + 1}-06-10`, joinsYearId: y3 });
    const none = await new InvoiceService(as()).previewBulk({ yearId: y3 });
    expect(none.count).toBe(0);
    expect(none.exceptions).toEqual([expect.objectContaining({ studentId: far.id, reason: "no_plan", detail: expect.stringMatching(/Joins on 10 Jun \d{4}\. No fee plan is published for/) })]);
  });

  it("with the full join rule is billed every month of the year", async () => {
    const next = Number(y2Start.slice(0, 4));
    await publish(fx, { yearId: y3, name: "C5 later", classIds: [fx.classId], joinRule: "full", lines: [{ headId: fx.heads.tuition, dues: [slot("P", `${next + 1}-04-01`, `${next + 1}-04-15`, 70_000), slot("Q", `${next + 1}-09-01`, `${next + 1}-09-15`, 70_000)] }] });
    const far = (await withSchool(fx.school.id, (tx) => tx.select().from(students).where(eq(students.admissionNo, "JN3"))))[0]!;
    const pv = await new InvoiceService(as()).previewBulk({ yearId: y3, studentIds: [far.id] });
    expect(pv.rows.map((r) => r.label)).toEqual(["Month P", "Month Q"]);
  });

  it("who withdrew before joining is not billed, not chased, and shows as such", async () => {
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ status: "left", leftReason: "withdrew before joining", leftOn: null }).where(eq(students.id, joiner.id)));
    const pv = await new InvoiceService(as()).previewBulk({ yearId: y2, studentIds: [joiner.id] });
    expect(pv.rows).toEqual([]);
    expect(pv.exceptions).toEqual([]);
    const row = (await new DuesService(as()).report({ q: "Joy" })).rows[0]!;
    expect(row).toMatchObject({ studentStatus: "left", tag: "Withdrew before joining" });
    const sent = await new ReminderService(as()).remindNow({ studentIds: [joiner.id] });
    expect(sent.sent).toEqual([]);
    expect(sent.skipped[0]).toMatchObject({ studentId: joiner.id, detail: expect.stringMatching(/Withdrew before joining/) });
    expect((await new DuesService(as()).worstOverdue(50)).some((r) => r.id === joiner.id)).toBe(false);
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ status: "joining", leftReason: null }).where(eq(students.id, joiner.id)));
  });

  it("stays a new admission of that year after the first day: same plan, months and amounts before and after Start now, existing the year after", async () => {
    const next = Number(y2Start.slice(0, 4));
    const kid = await make({ admissionNo: "JN4", name: "Stay New", status: "joining", joinsOn: `${next}-06-10`, joinsYearId: y2, admissionDate: addDays(TODAY, -3) });
    const view = async () => (await new InvoiceService(as()).previewBulk({ yearId: y2, studentIds: [kid.id] })).rows.map((r) => [r.label, r.grossPaise, r.dueOn]);
    const before = await view();
    expect(before.map((r) => [r[0], r[1]])).toEqual([["Month B", 150_000], ["Month C", 150_000]]);
    // The day comes: active, admission date = the first day (or the real first day when started early), the joining columns stay.
    for (const admissionDate of [`${next}-06-10`, addDays(TODAY, -1)]) {
      await withSchool(fx.school.id, (tx) => tx.update(students).set({ status: "active", admissionDate }).where(eq(students.id, kid.id)));
      expect(await view()).toEqual(before);
    }
    // The following year they are an existing student.
    expect(kindFor({ status: "active", admissionDate: `${next}-06-10`, joinsYearId: y2 }, { id: y3, startsOn: `${next + 1}-04-01`, endsOn: `${next + 2}-03-31` })).toBe("existing");
    expect(kindFor({ status: "active", admissionDate: `${next}-06-10`, joinsYearId: y2 }, { id: y2, startsOn: y2Start, endsOn: `${next + 1}-03-31` })).toBe("new");
  });

  it("who started early in a year after the current one: a manual bill and a group charge use that year (bounce and opening bills share billYearOf)", async () => {
    const early = await make({ admissionNo: "JN5", name: "Early Bird", status: "active", joinsOn: addDays(TODAY, 1), joinsYearId: y2, admissionDate: TODAY });
    await withSchool(fx.school.id, (tx) => tx.insert(studentEnrollments).values({ schoolId: fx.school.id, studentId: early.id, yearId: y2, classId: fx.classId, outcome: "studying" } as never));
    const svc = new InvoiceService(as());
    const id = await svc.saveDraft({ studentId: early.id, label: "Early uniform", dueDate: addDays(TODAY, 5), lines: [{ label: "Uniform", kind: "fee", amountPaise: 20_000 }] });
    expect((await bills(fx, early.id)).find((b) => b.id === id)?.yearId).toBe(y2);
    const [ok] = await svc.chargeMany({ studentIds: [early.id], label: "Books", dueDate: addDays(TODAY, 5), lines: [{ label: "Books", kind: "fee", amountPaise: 10_000 }] });
    expect((await bills(fx, early.id)).find((b) => b.id === ok)?.yearId).toBe(y2);
    // An ordinary active student still bills in the current year.
    const [plain] = await svc.chargeMany({ studentIds: [fx.students.riya], label: "Books", dueDate: addDays(TODAY, 5), lines: [{ label: "Books", kind: "fee", amountPaise: 10_000 }] });
    expect((await bills(fx, fx.students.riya)).find((b) => b.id === plain)?.yearId).not.toBe(y2);
  });

  it("who withdrew before joining: owed money stays in the totals, but is not chased, aged, or counted in a class or a month", async () => {
    const kid = await make({ admissionNo: "JN6", name: "Never Came", status: "joining", joinsOn: `${y2Start.slice(0, 4)}-06-10`, joinsYearId: y2 });
    const issued = await new InvoiceService(as()).issueBulk({ yearId: y2, studentIds: [kid.id] });
    expect(issued.issued).toBe(2);
    await withSchool(fx.school.id, (tx) => tx.execute(sql`update fee_invoices set due_date = ${addDays(TODAY, -45)}::date where student_id = ${kid.id}`));
    const d = new DuesService(as());
    const num = async () => ({ row: (await d.report({ q: "Never Came" })).rows[0]!, sum: await d.summary(), cls: (await d.dueByClass()).reduce((a, c) => a + c.duePaise, 0), report: (await d.report({ pageSize: 100 })).totals });
    const before = await num();
    expect(before.row.overdue).toBe(300_000);
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ status: "left", leftReason: "withdrew before joining", leftOn: null }).where(eq(students.id, kid.id)));
    const after = await num();
    expect(after.row).toMatchObject({ due: 300_000, overdue: 0, status: "due", neverStarted: true, ageing: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 } });
    expect(after.sum.outstanding).toBe(before.sum.outstanding); // owed money stays visible
    expect(before.sum.overdueAmount - after.sum.overdueAmount).toBe(300_000);
    expect(before.sum.overdueCount - after.sum.overdueCount).toBe(1);
    expect(before.sum.billedThisYear - after.sum.billedThisYear).toBe(300_000);
    expect(before.cls - after.cls).toBe(300_000);
    expect(after.report.due).toBe(before.report.due);
    expect(after.report.neverStarted - before.report.neverStarted).toBe(300_000);
    expect(before.report.ageing.d31_60 - after.report.ageing.d31_60).toBe(300_000);
    const ov = await d.overview();
    expect(ov.chase.some((r) => r.id === kid.id)).toBe(false);
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ status: "joining", leftReason: null }).where(eq(students.id, kid.id)));
  });

  it("is isolated to its school", async () => {
    const other = await createTestSchool("join-b", FEATURES);
    await expect(new DuesService(other.as.admin).studentAccount(joiner.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await new DeskService(other.as.admin).find("Joy Joiner")).toEqual([]);
  });
});

describe("a student who left and kept the section", () => {
  it("is billed to the day they left, tagged with it, and still listed when they owe", async () => {
    const leftOn = addDays(TODAY, -20);
    const gone = await make({ admissionNo: "LF1", name: "Leaver Kept", sectionId: fx.sectionId, status: "left", leftOn, admissionDate: fx.yearStart });
    const pv = await new InvoiceService(as()).previewBulk({ studentIds: [gone.id] });
    expect(pv.rows.map((r) => r.label)).toEqual(["Month M1"]);
    expect(pv.exceptions).toEqual([expect.objectContaining({ reason: "left", detail: `Left on ${leftOn}` })]);
    await new InvoiceService(as()).issueBulk({ studentIds: [gone.id] });
    const row = (await new DuesService(as()).report({ q: "Leaver" })).rows[0]!;
    expect(row).toMatchObject({ studentStatus: "left", tag: expect.stringMatching(/^Left /) });
  });
});
