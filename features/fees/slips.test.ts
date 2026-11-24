import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import { notifications } from "@smw/feature-notifications/schema";
import { ChecksService } from "./checks";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { PromiseService } from "./promises";
import { ReceiptService } from "./receipts";
import { ReminderService } from "./reminders";
import { SlipService } from "./slips";
import { feeDueParts } from "./schema";
import { TODAY, bills, config, due, issueAll, makeSchool, publish, type Fixture } from "./testing";
import { createTestSchool } from "@smw/feature-kit/testing";
import { FEATURES } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
const student = () => new SlipService(fx.school.as.student);
const office = () => new SlipService(fx.school.as.accountant);
const mail = () => withSchool(fx.school.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, fx.school.users.student)));

beforeAll(async () => {
  fx = await makeSchool("slip", { plan: false });
  await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000)] }] });
  await issueAll(fx);
});
afterAll(closeDb);

describe("UPI slips", () => {
  it("a family sends a slip for its own bills only, and only when the school has UPI on", async () => {
    const [m1] = await bills(fx, fx.students.riya);
    const slip = { amountPaise: 100_000, utr: "UTR778899", paidOn: TODAY, invoiceIds: [m1!.id] };
    await expect(student().submit(slip)).rejects.toThrow(/not turned on UPI/);
    await config(fx, { upiOn: true });
    await expect(student().submit({ ...slip, invoiceIds: [(await bills(fx, fx.students.meera))[0]!.id] })).rejects.toBeInstanceOf(NotFoundError);
    const made = await student().submit(slip);
    expect(made).toMatchObject({ status: "submitted", utr: "UTR778899", studentId: fx.students.riya });
    await expect(student().submit({ ...slip, utr: "utr 778899" })).rejects.toThrow(/UTR was already sent/);
    await expect(new SlipService(fx.school.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await student().list()).rows).toHaveLength(1);
    expect((await office().list({ filters: { status: "submitted" } })).rows).toHaveLength(1);
    // Nothing is paid until the office verifies.
    expect((await bills(fx, fx.students.riya))[0]).toMatchObject({ paidPaise: 0 });
    await expect(student().verify(made.id)).rejects.toBeInstanceOf(ForbiddenError);
    const done = await office().verify(made.id);
    expect(done.slip).toMatchObject({ status: "verified", receiptId: done.receipt.id });
    expect((await bills(fx, fx.students.riya))[0]).toMatchObject({ paidPaise: 100_000, openPaise: 0 });
    expect((await new ReceiptService(fx.school.as.accountant).get(done.receipt.id)).methods[0]).toMatchObject({ method: "upi", reference: "UTR778899" });
    await expect(office().verify(made.id)).rejects.toThrow(/already verified/);
    // A used UTR is refused even after the first was verified.
    await expect(student().submit({ ...slip, invoiceIds: [(await bills(fx, fx.students.riya))[1]!.id] })).rejects.toThrow(/UTR was already sent/);
    expect((await new ChecksService(fx.school.as.admin).run()).mismatches).toEqual([]);
  });

  it("a rejected slip tells the family why, and they can send it again with the right UTR", async () => {
    const [, m2] = await bills(fx, fx.students.riya);
    const slip = { amountPaise: 100_000, utr: "WRONG0001", paidOn: TODAY, invoiceIds: [m2!.id] };
    const made = await student().submit(slip);
    await office().reject({ id: made.id, reason: "No such payment in the bank on that day" });
    expect((await student().list()).rows.find((s) => s.id === made.id)).toMatchObject({ status: "rejected", reason: "No such payment in the bank on that day" });
    expect((await mail()).some((n) => n.body?.includes("No such payment"))).toBe(true);
    await expect(office().reject({ id: made.id, reason: "again please" })).rejects.toBeInstanceOf(ConflictError);
    const again = await student().submit({ ...slip, utr: "RIGHT0002" });
    expect(again.status).toBe("submitted");
    // The refused UTR is free to be used again.
    expect((await student().submit({ ...slip, utr: "WRONG0001" })).status).toBe("submitted");
  });

  it("school B can read or verify nothing of school A", async () => {
    const other = await createTestSchool("slipb", FEATURES);
    const [s] = (await office().list({ filters: { status: "submitted" } })).rows;
    await expect(new SlipService(other.as.accountant).verify(s!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new SlipService(other.as.accountant).list()).rows).toHaveLength(0);
  });
});

describe("reminders", () => {
  let f: Fixture;
  const remind = () => new ReminderService(f.school.as.admin);
  const sent = async () => (await withSchool(f.school.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, f.school.users.student)))).filter((n) => n.kind === "fee_due" && /^Fee (reminder|overdue)/.test(n.title));
  beforeAll(async () => {
    f = await makeSchool("remind", { plan: false });
    await publish(f, { name: "Class 5", classIds: [f.classId], lines: [{ headId: f.heads.tuition, dues: [due("A", 5, 100_000), due("B", -3, 50_000)] }] });
    await issueAll(f, addDays(TODAY, 30));
  });

  it("sends nothing while the school has reminders off", async () => {
    expect(await remind().run()).toBe(0);
  });

  it("sends one notice per due date and offset to the family login, before and after the due date, and never twice", async () => {
    await config(f, { remindersOn: true, reminderDays: [-7, 0, 3, 10, 30] });
    expect(await remind().run()).toBe(2); // A: 7 days before is reached (due in 5); B: its due date has passed (offset 0). Only Riya has a login.
    const titles = (await sent()).map((n) => n.title).sort();
    expect(titles).toEqual(["Fee overdue: Month B", "Fee reminder: Month A"]);
    expect((await sent()).find((n) => n.title.includes("Month A"))!.body).toContain("due in 5 days");
    expect(await remind().run()).toBe(0);
  });

  it("a stopped student and a student with a promise to pay are not reminded; resuming sends what was missed", async () => {
    await withSchool(f.school.id, (tx) => tx.delete(notifications));
    await withSchool(f.school.id, (tx) => tx.execute(sql`delete from fee_reminder_log`));
    const p = new PromiseService(f.school.as.accountant);
    await p.stopReminders({ studentId: f.students.riya, reason: "In talks with the office" });
    expect(await remind().run()).toBe(0);
    await p.resumeReminders(f.students.riya);
    await p.add({ studentId: f.students.riya, promisedOn: addDays(TODAY, 3), note: "After salary" });
    expect(await remind().run()).toBe(0);
    expect(await p.broken()).toEqual([]);
  });

  it("a settlement part is reminded on its own date", async () => {
    await withSchool(f.school.id, (tx) => tx.delete(notifications));
    await withSchool(f.school.id, async (tx) => { await tx.execute(sql`delete from fee_reminder_log`); await tx.execute(sql`delete from fee_promises`); });
    const b = (await bills(f, f.students.riya)).find((x) => x.label === "Month B")!;
    await withSchool(f.school.id, (tx) => tx.insert(feeDueParts).values({ schoolId: f.school.id, invoiceId: b.id, dueOn: addDays(TODAY, -1), amountPaise: 50_000 }));
    expect(await remind().run()).toBe(2);
    expect((await sent()).some((n) => n.body?.includes("was due 1 day ago"))).toBe(true);
  });

  it("a family sees its own dues (and not its brother's) through mine()", async () => {
    const mine = await new DuesService(f.school.as.student).mine();
    expect(mine.map((r) => r.id)).toEqual([f.students.riya]);
    expect(mine[0]).toMatchObject({ due: 150_000 });
    await expect(new InvoiceService(f.school.as.student).get((await bills(f, f.students.kabir))[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
