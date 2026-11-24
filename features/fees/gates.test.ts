import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createTestSchool } from "@smw/feature-kit/testing";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { finApprovals } from "@smw/feature-finance/schema";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { notifications } from "@smw/feature-notifications/schema";
import { feesApprovals } from "./approval-handlers";
import { ChecksService } from "./checks";
import { CounterService } from "./counter";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { OpeningImport } from "./opening";
import { feeCounters, feeOpeningBatches } from "./schema";
import { FEATURES, config, decide, ledger, makeSchool, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
afterAll(closeDb);
beforeAll(async () => { fx = await makeSchool("gates", { plan: false }); });

const [admin, accountant] = [() => fx.school.as.admin, () => fx.school.as.accountant];
const checks = async () => (await new ChecksService(admin()).run()).mismatches;
const csv = (rows: string[][]) => ({ name: "opening.csv", bytes: new TextEncoder().encode(["admission_no,dues,advance,deposit,as_of", ...rows.map((r) => r.join(","))].join("\n")) });
const send = (rows: string[][]) => new InvoiceService(accountant()).importOpening(csv(rows), false);
const approvalOf = (kind: string, refId: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, kind), eq(finApprovals.refId, refId))).orderBy(sql`created_at desc`))[0]!);
const decider = (as = admin()) => new ApprovalService(as, feesApprovals);
const batchStatus = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(feeOpeningBatches).where(eq(feeOpeningBatches.id, id)))[0]!.status);
const balance = (id: string) => new DuesService(admin()).studentAccount(id).then((a) => a.balance);

describe("opening balances need approval", () => {
  it("a good sheet is only saved: nothing posts, one request asks for the total, a dry run saves nothing", async () => {
    const dry = await new InvoiceService(accountant()).importOpening(csv([["R1", "5000", "200", "300", ""]]), true);
    expect(dry).toMatchObject({ applied: false, submitted: false, batchId: null, totals: { students: 1 } });
    const r = await send([["R1", "5000", "200", "300", ""]]);
    expect(r).toMatchObject({ applied: false, submitted: true, errors: [], totals: { students: 1, duesPaise: 500_000, advancePaise: 20_000, depositPaise: 30_000 } });
    expect(await approvalOf("fees.opening", r.batchId!)).toMatchObject({ status: "pending", amountPaise: 550_000, requestedBy: fx.school.users.accountant });
    expect(await balance(fx.students.riya)).toMatchObject({ openPaise: 0, advancePaise: 0, depositPaise: 0 });
    expect([await ledger(fx, "opening"), await ledger(fx, "student_dues"), await ledger(fx, "student_advances"), await ledger(fx, "deposits_payable")]).toEqual([0, 0, 0, 0]);
    expect(await checks()).toEqual([]);
    // Another sheet for the same student is refused while this one waits.
    expect(await send([["R1", "1", "", "", ""]])).toMatchObject({ submitted: false, errors: [{ message: expect.stringContaining("waiting for approval") }] });
    const list = await new OpeningImport(accountant()).batches();
    expect(list[0]).toMatchObject({ id: r.batchId, status: "pending", approval: { status: "pending" } });
  });

  it("reject keeps the reason and posts nothing; resubmit asks again; approve posts everything once", async () => {
    const [batch] = await new OpeningImport(accountant()).batches();
    await decide(fx, "fees.opening", batch!.id, "reject", "Wrong year");
    expect(await batchStatus(batch!.id)).toBe("rejected");
    expect(await approvalOf("fees.opening", batch!.id)).toMatchObject({ status: "rejected", note: "Wrong year" });
    expect((await new OpeningImport(accountant()).batches())[0]).toMatchObject({ approval: { status: "rejected", note: "Wrong year" } });
    expect(await balance(fx.students.riya)).toMatchObject({ openPaise: 0 });
    await new OpeningImport(accountant()).resubmit(batch!.id);
    await expect(new OpeningImport(accountant()).resubmit(batch!.id)).rejects.toBeInstanceOf(ConflictError);
    await decide(fx, "fees.opening", batch!.id);
    expect(await batchStatus(batch!.id)).toBe("approved");
    expect(await balance(fx.students.riya)).toMatchObject({ openPaise: 500_000, advancePaise: 20_000, depositPaise: 30_000 });
    expect(await ledger(fx, "student_dues", fx.students.riya)).toBe(500_000);
    expect(await checks()).toEqual([]);
    expect(await send([["R1", "1", "", "", ""]])).toMatchObject({ submitted: false, errors: [{ message: expect.stringContaining("already has opening balances") }] });
    await expect(decider().approve({ id: (await approvalOf("fees.opening", batch!.id)).id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("withdraw takes it back and posts nothing; it can be sent again; withdrawing twice is refused", async () => {
    const r = await send([["R2", "", "1000", "", ""]]);
    const batches = new OpeningImport(accountant());
    await batches.withdraw(r.batchId!);
    expect(await approvalOf("fees.opening", r.batchId!)).toMatchObject({ status: "withdrawn" });
    expect(await batchStatus(r.batchId!)).toBe("rejected");
    await expect(batches.withdraw(r.batchId!)).rejects.toThrow(/nothing to withdraw/);
    expect(await balance(fx.students.kabir)).toMatchObject({ advancePaise: 0 });
    await batches.resubmit(r.batchId!);
    await decide(fx, "fees.opening", r.batchId!);
    expect(await balance(fx.students.kabir)).toMatchObject({ advancePaise: 100_000 });
    expect(await checks()).toEqual([]);
  });

  it("two approvals at once post it once", async () => {
    const r = await send([["R3", "2000", "", "", ""]]);
    const id = (await approvalOf("fees.opening", r.batchId!)).id;
    const out = await Promise.allSettled([decider().approve({ id }), decider().approve({ id })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await ledger(fx, "student_dues", fx.students.meera)).toBe(200_000);
    expect(await checks()).toEqual([]);
  });

  it("approving checks every row again: a student who is gone refuses the whole batch and nothing posts", async () => {
    const r = await send([["R4", "3000", "", "", ""]]);
    await withSchool(fx.school.id, (tx) => tx.delete(students).where(eq(students.id, fx.students.neel)));
    await expect(decide(fx, "fees.opening", r.batchId!)).rejects.toThrow(/no longer a student/);
    expect(await batchStatus(r.batchId!)).toBe("pending");
    expect(await approvalOf("fees.opening", r.batchId!)).toMatchObject({ status: "pending" });
    expect(await ledger(fx, "student_dues")).toBe(500_000 + 200_000);
    await expect(new OpeningImport(accountant()).resubmit(r.batchId!)).rejects.toBeInstanceOf(ConflictError);
  });

  it("only setup roles send it; the maker cannot approve it; another school sees nothing and cannot decide it", async () => {
    const t = fx.school.as.teacher;
    await expect(new InvoiceService(t).importOpening(csv([["R1", "1", "", "", ""]]), false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new OpeningImport(fx.school.as.student).batches()).rejects.toBeInstanceOf(ForbiddenError);
    const r = await send([["R2", "1", "", "", ""]]).catch((e) => e); // R2 is done, so this is only an error row
    expect(r).toMatchObject({ submitted: false });
    const [open] = (await new OpeningImport(accountant()).batches()).filter((b) => b.status === "pending");
    const a = await approvalOf("fees.opening", open!.id);
    await expect(decider(accountant()).approve({ id: a.id })).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestSchool("gatesb", FEATURES);
    await withSchool(other.id, async (tx) => { await tx.insert(academicYears).values({ schoolId: other.id, name: "x", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }); });
    expect(await new OpeningImport(other.as.accountant).batches()).toEqual([]);
    await expect(decider(other.as.admin).approve({ id: a.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new OpeningImport(other.as.accountant).withdraw(open!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("a counter difference needs approval", () => {
  const counter = (as = accountant()) => new CounterService(as);
  const row = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(feeCounters).where(eq(feeCounters.id, id)))[0]!);
  /** Open, count and close one session; `age` pushes it to an earlier day so the same person can open another. */
  let ago = 0;
  const age = (id: string) => withSchool(fx.school.id, (tx) => tx.update(feeCounters).set({ day: sql`(current_date - ${++ago}::int)` }).where(eq(feeCounters.id, id)));
  const session = async (counted: number, o: { as?: ReturnType<typeof accountant>; keep?: boolean } = {}) => {
    const c = counter(o.as);
    await c.open({ floatPaise: 100_000 });
    const r = await c.close({ countedPaise: counted, differenceReason: counted === 100_000 ? undefined : "Counted by hand" });
    if (!o.keep) await age(r.counter.id);
    return r;
  };
  const notice = (userId: string) => withSchool(fx.school.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));

  it("a shortage closes with the counted cash, waits as pending, posts nothing, and the controls stay clean", async () => {
    const r = await session(90_000);
    expect(r).toMatchObject({ expectedPaise: 100_000, differencePaise: -10_000 });
    const c = await row(r.counter.id);
    expect(c).toMatchObject({ differenceState: "pending", countedPaise: 90_000 });
    expect(await approvalOf("fees.counter_difference", c.id)).toMatchObject({ status: "pending", amountPaise: 10_000, id: c.differenceApprovalId });
    expect([await ledger(fx, "cash_difference"), await ledger(fx, "cash"), await ledger(fx, "cashier_dues")]).toEqual([0, 0, 0]);
    expect(await checks()).toEqual([]);
    // Only the cashier or an admin may take it back; a teacher cannot.
    await expect(counter(fx.school.as.teacher).withdraw(c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await decide(fx, "fees.counter_difference", c.id);
    expect(await row(c.id)).toMatchObject({ differenceState: "posted" });
    expect([await ledger(fx, "cash_difference"), await ledger(fx, "cash")]).toEqual([10_000, -10_000]);
    expect(await checks()).toEqual([]);
    await expect(decider().approve({ id: c.differenceApprovalId! })).rejects.toBeInstanceOf(ConflictError);
    expect(await ledger(fx, "cash_difference")).toBe(10_000);
  });

  it("a refused shortage stays with the cashier (staff loan, in their name), is told to them, and posts once", async () => {
    const r = await session(95_000);
    await decide(fx, "fees.counter_difference", r.counter.id, "reject", "Check the till again");
    expect(await row(r.counter.id)).toMatchObject({ differenceState: "cashier" });
    expect(await ledger(fx, "cashier_dues", fx.school.users.accountant)).toBe(5_000);
    expect([await ledger(fx, "cash_difference"), await ledger(fx, "cash")]).toEqual([10_000, -15_000]);
    expect((await notice(fx.school.users.accountant)).some((n) => /not approved/.test(n.title) && /owed by you/.test(n.body ?? ""))).toBe(true);
    expect(await checks()).toEqual([]);
  });

  it("withdraw leaves it unbooked; ask again, then approve; two decisions at once book it once", async () => {
    const r = await session(80_000);
    await counter().withdraw(r.counter.id);
    expect(await row(r.counter.id)).toMatchObject({ differenceState: "recount" });
    expect(await ledger(fx, "cash_difference")).toBe(10_000);
    expect(await checks()).toEqual([]);
    await expect(counter().withdraw(r.counter.id)).rejects.toBeInstanceOf(ConflictError);
    await counter().askAgain(r.counter.id);
    const id = (await row(r.counter.id)).differenceApprovalId!;
    const out = await Promise.allSettled([decider().approve({ id }), decider().reject({ id, note: "No" })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const state = (await row(r.counter.id)).differenceState;
    expect(state === "posted" ? await ledger(fx, "cash_difference") : await ledger(fx, "cashier_dues", fx.school.users.accountant)).toBe(state === "posted" ? 30_000 : 25_000);
    expect(await checks()).toEqual([]);
  });

  it("extra cash: refused keeps it unbooked and tells them to count again; they reopen the same day and close right; or ask again and it posts as income", async () => {
    const before = await ledger(fx, "cash_difference");
    const r = await session(110_000, { keep: true });
    await decide(fx, "fees.counter_difference", r.counter.id, "reject", "Recount please");
    expect(await row(r.counter.id)).toMatchObject({ differenceState: "recount" });
    expect([await ledger(fx, "cash_difference"), await checks()]).toEqual([before, []]);
    expect((await notice(fx.school.users.accountant)).some((n) => /Count again/.test(n.body ?? ""))).toBe(true);
    await expect(counter(admin()).reopen(r.counter.id)).rejects.toBeInstanceOf(ForbiddenError); // only their own session
    await counter().reopen(r.counter.id);
    expect(await row(r.counter.id)).toMatchObject({ closedAt: null, countedPaise: null, differenceState: null });
    expect(await counter().current()).toMatchObject({ expectedPaise: 100_000 });
    const again = await counter().close({ countedPaise: 100_000 });
    expect(again.differencePaise).toBe(0);
    expect(await row(r.counter.id)).toMatchObject({ differenceState: null });
    expect(await checks()).toEqual([]);
    await age(r.counter.id);

    const over = await session(104_000);
    await decide(fx, "fees.counter_difference", over.counter.id);
    expect(await ledger(fx, "cash_difference")).toBe(before - 4_000);
    expect(await checks()).toEqual([]);
  });

  it("a recount is only for the same day", async () => {
    const r = await session(120_000, { keep: true });
    await decide(fx, "fees.counter_difference", r.counter.id, "reject", "Recount");
    await age(r.counter.id);
    await expect(counter().reopen(r.counter.id)).rejects.toThrow(/own day/);
    await counter().askAgain(r.counter.id);
    expect(await checks()).toEqual([]);
  });

  it("within the school's limit it posts at once with no request; above it, it waits", async () => {
    await config(fx, { counterDifferenceLimitPaise: 20_000 });
    const small = await session(88_000);
    expect(await row(small.counter.id)).toMatchObject({ differenceState: "posted", differenceApprovalId: null });
    expect(await withSchool(fx.school.id, (tx) => tx.select().from(finApprovals).where(eq(finApprovals.refId, small.counter.id)))).toEqual([]);
    expect(await checks()).toEqual([]);
    const big = await session(70_000);
    expect(await row(big.counter.id)).toMatchObject({ differenceState: "pending" });
    await config(fx, { counterDifferenceLimitPaise: 0 });
    expect(await checks()).toEqual([]);
  });

  it("the controls notice a decided difference that is missing from the books, and one booked too early", async () => {
    const r = await session(99_000);
    await withSchool(fx.school.id, (tx) => tx.update(feeCounters).set({ differenceState: "posted" }).where(eq(feeCounters.id, r.counter.id)));
    expect((await checks()).map((m) => m.check)).toEqual(["counters"]);
    await withSchool(fx.school.id, (tx) => tx.update(feeCounters).set({ differenceState: "pending" }).where(eq(feeCounters.id, r.counter.id)));
    expect(await checks()).toEqual([]);
  });

  it("a day with no difference needs nothing; a teacher cannot close or reopen", async () => {
    const r = await session(100_000);
    expect(await row(r.counter.id)).toMatchObject({ differenceState: null, differenceApprovalId: null });
    await expect(counter(fx.school.as.teacher).close({ countedPaise: 0 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(counter(fx.school.as.teacher).reopen(r.counter.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
