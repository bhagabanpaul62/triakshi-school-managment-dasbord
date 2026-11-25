import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, closeDb, schools, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { monthDays, encashable } from "./leave-api";
import { fmtDays, leaveYearEnd, leaveYearStart, proRataHalfDays, workingDays } from "./leave-days";
import { LeaveBalanceService } from "./leave-balances";
import { ensureCredit } from "./leave-ledger";
import { LeaveService } from "./leave-service";
import { LeaveTypeService } from "./leave-types";
import { attendanceHolidays, leaveLedger, leaveRequests, staffAttendance } from "./schema";
import { addDays, monthDays as datesOf, todayIST } from "./stats";

const FEATURES = ["students", "academics", "attendance", "notifications"];
let a: TestSchool, b: TestSchool, c: TestSchool;
const today = todayIST();
// The leave year starts in the current month, so every date used below (up to 11 months ahead) is inside the year that has credit.
const startMonth = Number(today.slice(5, 7));
const yearStart = `${today.slice(0, 7)}-01`;
const base = (() => { let x = addDays(today, 8); while (new Date(`${x}T00:00:00Z`).getUTCDay() !== 1) x = addDays(x, 1); return x; })();
const d = (n: number) => addDays(base, n);
const dow = (x: string) => new Date(`${x}T00:00:00Z`).getUTCDay();
const typeId = async (school: TestSchool, code: string) => (await new LeaveTypeService(school.as.admin).all()).find((t) => t.code === code)!.id;
const left = async (ctx: TestSchool["as"]["teacher"], code: string) => (await new LeaveBalanceService(ctx).mine()).find((r) => r.code === code)!;
const pdf = { name: "note.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([37, 80, 68, 70]) };

beforeAll(async () => {
  useServices({ email: new MemoryEmailSender(), storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(FEATURES, "lb"));
  c = await createTestSchool("lbc", FEATURES);
  await withConsole(async (tx) => { for (const s of [a, b, c]) await tx.update(schools).set({ academicYearStartMonth: startMonth }).where(eq(schools.id, s.id)); });
});
afterAll(closeDb);

describe("leave arithmetic", () => {
  it("counts working days over a holiday, a Sunday and a month end", () => {
    // Thu 29 Jan 2026 to Tue 3 Feb: Friday is a holiday, Sunday 1 Feb is skipped.
    expect(workingDays("2026-01-29", "2026-02-03", new Set(["2026-01-30", "2026-02-01"]))).toEqual(["2026-01-29", "2026-01-31", "2026-02-02", "2026-02-03"]);
    expect(workingDays("2026-02-01", "2026-02-01", new Set(["2026-02-01"]))).toEqual([]);
  });
  it("finds the leave year and pro-rates joiners by month", () => {
    expect(leaveYearStart("2026-03-31", 4)).toBe("2025-04-01");
    expect(leaveYearStart("2026-04-01", 4)).toBe("2026-04-01");
    expect(leaveYearEnd("2026-04-01")).toBe("2027-03-31");
    expect(leaveYearStart("2026-01-10", 1)).toBe("2026-01-01");
    expect(proRataHalfDays(24, "2026-10-15", "2026-04-01")).toBe(12);
    expect(proRataHalfDays(24, "2026-04-01", "2026-04-01")).toBe(24);
    expect(proRataHalfDays(24, null, "2026-04-01")).toBe(24);
    expect(proRataHalfDays(24, "2025-01-01", "2026-04-01")).toBe(24);
    expect(proRataHalfDays(24, "2027-04-01", "2026-04-01")).toBe(0);
    expect(fmtDays(3)).toBe("1.5");
  });
});

describe("types, credit and carry", () => {
  it("creates the four defaults once, and only for this school", async () => {
    const types = await new LeaveTypeService(c.as.admin).all();
    expect(types.map((t) => t.code)).toEqual(["CL", "SL", "EL", "LOP"]);
    expect(await new LeaveTypeService(c.as.admin).all()).toHaveLength(4);
    expect(types.find((t) => t.code === "LOP")).toMatchObject({ paid: false, yearlyHalfDays: 0 });
    expect(types.find((t) => t.code === "EL")).toMatchObject({ encashable: true, carryForwardHalfDays: 60 });
    const other = await new LeaveTypeService(b.as.admin).all();
    expect(other.map((t) => t.id).some((id) => types.some((t) => t.id === id))).toBe(false);
  });

  it("credits a full year, pro-rates a joiner, caps carry, and a second run adds nothing", async () => {
    const [yy, mm] = yearStart.split("-").map(Number) as [number, number];
    const joining = new Date(Date.UTC(yy, mm - 1 + 6, 1)).toISOString().slice(0, 10);
    const prevStart = `${yy - 1}-${String(mm).padStart(2, "0")}-01`;
    const types = await new LeaveTypeService(c.as.admin).all();
    const el = types.find((t) => t.code === "EL")!.id;
    await withSchool(c.id, async (tx) => {
      await tx.execute(sql`insert into staff_profiles (id, school_id, user_id, employee_id, joining_date) values (gen_random_uuid(), ${c.id}, ${c.users.teacher}, 'E1', ${joining})`);
      await tx.insert(leaveLedger).values([
        { schoolId: c.id, userId: c.users.admin, typeId: el, date: prevStart, halfDays: 50, kind: "credit" },
        { schoolId: c.id, userId: c.users.accountant, typeId: el, date: prevStart, halfDays: 80, kind: "credit" },
      ]);
    });
    const first = await withSchool(c.id, (tx) => ensureCredit(tx, c.id, today));
    expect(first).toBeGreaterThan(0);
    expect(await withSchool(c.id, (tx) => ensureCredit(tx, c.id, today))).toBe(0);

    expect((await left(c.as.admin, "CL")).entitled).toBe(24);
    expect((await left(c.as.teacher, "CL")).entitled).toBe(12); // joined six months into the year
    expect((await left(c.as.admin, "EL")).entitled).toBe(30 + 50); // carry under the cap
    expect((await left(c.as.accountant, "EL")).entitled).toBe(30 + 60); // carry capped at 30 days
    expect(await new LeaveBalanceService(c.as.student).mine()).toEqual([]);
  });

  it("adjusts by hand with a reason, never below zero, audited, manage only", async () => {
    const svc = new LeaveBalanceService(c.as.admin);
    const cl = await typeId(c, "CL");
    await svc.adjust({ userId: c.users.admin, typeId: cl, days: 1.5, reason: "Comp off" });
    expect((await left(c.as.admin, "CL")).left).toBe(24 + 3);
    await expect(svc.adjust({ userId: c.users.admin, typeId: cl, days: -100, reason: "Too much" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.adjust({ userId: c.users.admin, typeId: cl, days: 1, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new LeaveBalanceService(c.as.teacher).adjust({ userId: c.users.teacher, typeId: cl, days: 1, reason: "Self" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.adjust({ userId: c.users.student, typeId: cl, days: 1, reason: "Not staff" })).rejects.toBeInstanceOf(NotFoundError);
    const log = await withSchool(c.id, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.action, "adjust"), eq(auditLogs.module, "attendance"))));
    expect(log).toHaveLength(1);
    expect(log[0]!.summary).toContain("Comp off");
  });

  it("balances table and CSV list every person against every type; teachers cannot open them", async () => {
    const t = await new LeaveBalanceService(c.as.admin).table();
    expect(t.people.length).toBeGreaterThanOrEqual(3);
    expect(t.types.map((x) => x.code)).toEqual(["CL", "SL", "EL", "LOP"]);
    const csv = await new LeaveBalanceService(c.as.admin).csv();
    expect(csv.text.split("\n")[0]).toContain("Casual left");
    await expect(new LeaveBalanceService(c.as.teacher).table()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("apply, approve, reverse", () => {
  it("a staff request must name a type and holds the balance while waiting", async () => {
    const cl = await typeId(a, "CL");
    const svc = new LeaveService(a.as.teacher);
    await expect(svc.apply({ fromDate: d(0), toDate: d(1), reason: "Family" })).rejects.toBeInstanceOf(ValidationError);
    const r = await svc.apply({ fromDate: d(0), toDate: d(1), reason: "Family", typeId: cl });
    expect(r).toMatchObject({ kind: "staff", typeId: cl, status: "pending" });
    expect(await left(a.as.teacher, "CL")).toMatchObject({ entitled: 24, used: 0, pending: 4, left: 24 });
    const [mine] = await svc.mine();
    expect(mine).toMatchObject({ typeName: "Casual", waitingFor: "the admin" });
  });

  it("refuses an overlapping request", async () => {
    await expect(new LeaveService(a.as.teacher).apply({ fromDate: d(1), toDate: d(3), reason: "Again", typeId: await typeId(a, "CL") })).rejects.toBeInstanceOf(ValidationError);
  });

  it("approval takes the days off the balance and marks leave; reversal gives them back and clears the marks", async () => {
    const admin = new LeaveService(a.as.admin);
    const req = (await new LeaveService(a.as.teacher).mine())[0]!;
    await admin.decide({ id: req.id, decision: "approved" });
    expect(await left(a.as.teacher, "CL")).toMatchObject({ used: 4, pending: 0, left: 20 });
    const marks = () => withSchool(a.id, (tx) => tx.select().from(staffAttendance).where(eq(staffAttendance.userId, a.users.teacher)));
    expect((await marks()).filter((m) => m.status === "leave").map((m) => m.date).sort()).toEqual([d(0), d(1)]);
    await admin.reverse({ id: req.id });
    expect(await left(a.as.teacher, "CL")).toMatchObject({ used: 0, left: 24 });
    expect((await marks()).filter((m) => m.status === "leave")).toHaveLength(0);
    await admin.reverse({ id: req.id }); // rejected back to approved: used again
    expect(await left(a.as.teacher, "CL")).toMatchObject({ used: 4, left: 20 });
    await admin.reverse({ id: req.id });
    const net = await withSchool(a.id, async (tx) => (await tx.select({ n: sql<number>`sum(${leaveLedger.halfDays})::int` }).from(leaveLedger).where(eq(leaveLedger.requestId, req.id)))[0]!.n);
    expect(net).toBe(0);
  });

  it("a half day uses one half-day and marks the day as half day; many days cannot be half", async () => {
    const cl = await typeId(a, "CL");
    const svc = new LeaveService(a.as.teacher);
    const r = await svc.apply({ fromDate: d(2), toDate: d(2), reason: "Doctor", typeId: cl, halfDay: "first" });
    await new LeaveService(a.as.admin).decide({ id: r.id, decision: "approved" });
    expect((await left(a.as.teacher, "CL")).used).toBe(1);
    const [m] = await withSchool(a.id, (tx) => tx.select().from(staffAttendance).where(and(eq(staffAttendance.userId, a.users.teacher), eq(staffAttendance.date, d(2)))));
    expect(m?.status).toBe("half_day");
    await expect(svc.apply({ fromDate: d(4), toDate: d(5), reason: "Two days", typeId: cl, halfDay: "first" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a type that needs a document after N days refuses without one", async () => {
    const sl = await typeId(a, "SL");
    const svc = new LeaveService(a.as.teacher);
    const ask = { fromDate: d(21), toDate: d(23), reason: "Fever", typeId: sl };
    await expect(svc.apply(ask)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.apply(ask, pdf)).resolves.toMatchObject({ typeId: sl });
  });

  it("days beyond the balance go to unpaid only when the person ticks the split", async () => {
    const cl = await typeId(a, "CL"), lop = await typeId(a, "LOP");
    const svc = new LeaveService(a.as.admin);
    const ask = { fromDate: d(70), toDate: d(84), reason: "Long trip", typeId: cl }; // 13 working days = 26 half-days against 24
    const preview = await new LeaveBalanceService(a.as.admin).preview({ fromDate: ask.fromDate, toDate: ask.toDate, typeId: cl });
    expect(preview).toMatchObject({ workingDays: 13, halfDays: 26, short: 2, paidHalfDays: 24, unpaidHalfDays: 2, unpaidTypeName: "Unpaid" });
    await expect(svc.apply(ask)).rejects.toMatchObject({ fieldErrors: { split: expect.stringContaining("Take the other") } });
    expect(await withSchool(a.id, (tx) => tx.select().from(leaveRequests).where(eq(leaveRequests.userId, a.users.admin)))).toHaveLength(0);
    const first = await svc.apply({ ...ask, split: true });
    const rows = (await withSchool(a.id, (tx) => tx.select().from(leaveRequests).where(eq(leaveRequests.userId, a.users.admin)))).sort((x, y) => x.fromDate.localeCompare(y.fromDate));
    expect(rows).toHaveLength(2);
    expect(first.id).toBe(rows[0]!.id);
    expect(rows[0]).toMatchObject({ typeId: cl, fromDate: d(70), toDate: d(82) });
    expect(rows[1]).toMatchObject({ typeId: lop, fromDate: d(84), toDate: d(84) });
  });

  it("two approvals at once cannot spend the same days twice", async () => {
    const cl = await typeId(a, "CL");
    const svc = new LeaveService(a.as.accountant), admin = new LeaveService(a.as.admin);
    const r1 = await svc.apply({ fromDate: d(28), toDate: d(32), reason: "Trip A", typeId: cl }); // 5 days
    const r2 = await svc.apply({ fromDate: d(35), toDate: d(39), reason: "Trip B", typeId: cl });
    await new LeaveBalanceService(a.as.admin).adjust({ userId: a.users.accountant, typeId: cl, days: -6, reason: "Correction" }); // 24 - 12 = 12 half-days left, 10 needed each
    const out = await Promise.allSettled([admin.decide({ id: r1.id, decision: "approved" }), admin.decide({ id: r2.id, decision: "approved" })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(out.find((o) => o.status === "rejected")).toMatchObject({ reason: expect.any(ValidationError) });
    expect(await left(a.as.accountant, "CL")).toMatchObject({ used: 10, left: 2 });
  });

  it("student leave is unchanged: no type, no balance", async () => {
    const r = await new LeaveService(a.as.student).apply({ fromDate: d(0), toDate: d(0), reason: "Wedding" }).catch((e) => e);
    // The fixture has no student record for this login, so the refusal is the old one, not a type error.
    expect(r).toBeInstanceOf(NotFoundError);
  });

  it("encashable lists only encashable types with a positive balance", async () => {
    const out = await withSchool(a.id, (tx) => encashable(tx, a.users.teacher, today));
    expect(out).toEqual([expect.objectContaining({ code: "EL", halfDays: 30 })]);
  });
});

describe("types: guards, permissions, isolation, calendar", () => {
  it("a used type cannot be deleted or switched paid/unpaid; an unused one can", async () => {
    const svc = new LeaveTypeService(a.as.admin);
    const cl = await typeId(a, "CL");
    await expect(svc.remove(cl)).rejects.toBeInstanceOf(ConflictError);
    const body = { name: "Casual", code: "CL", yearlyDays: 12, carryDays: 0, halfDayAllowed: "true", isActive: "true" };
    await expect(svc.update(cl, body)).rejects.toBeInstanceOf(ValidationError); // paid unticked
    await expect(svc.update(cl, { ...body, paid: "true", yearlyDays: 13 })).resolves.toMatchObject({ yearlyHalfDays: 26 });
    const made = await svc.create({ name: "Study", code: "st", paid: "true", yearlyDays: 2, carryDays: 0 });
    expect(made.code).toBe("ST");
    await expect(svc.create({ name: "Study 2", code: "ST", yearlyDays: 1, carryDays: 0 })).rejects.toBeTruthy(); // code is unique
    await expect(svc.remove(made.id)).resolves.toEqual({ id: made.id });
  });

  it("only attendance:manage changes types; any leave user reads them", async () => {
    await expect(new LeaveTypeService(a.as.teacher).create({ name: "X", code: "X", yearlyDays: 1, carryDays: 0 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new LeaveTypeService(a.as.teacher).all()).length).toBeGreaterThan(0);
    expect((await new LeaveTypeService(a.as.teacher).all({ inactive: true })).every((t) => t.isActive)).toBe(true);
  });

  it("school B cannot see or adjust school A", async () => {
    await expect(new LeaveBalanceService(b.as.admin).adjust({ userId: a.users.teacher, typeId: await typeId(a, "CL"), days: 1, reason: "Sneaky" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(b.id, (tx) => tx.select().from(leaveLedger).where(eq(leaveLedger.userId, a.users.teacher)))).toHaveLength(0);
  });

  it("the calendar lists staff leave for approvers and hides it from others", async () => {
    const cal = await new LeaveBalanceService(a.as.admin).calendar(d(0).slice(0, 7));
    expect(cal.days.length).toBeGreaterThan(27);
    expect(cal.rows.some((r) => r.name === `teacher ${a.slug}`)).toBe(true);
    await expect(new LeaveBalanceService(a.as.accountant).calendar(d(0).slice(0, 7))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("monthDays for payroll", () => {
  // The month before today: every day is past, so marks are plain rows.
  const M = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const dates = datesOf(M);
  const nth = (day: number, n: number) => dates.filter((x) => dow(x) === day)[n]!;
  const holiday = nth(3, 0);
  const working = dates.filter((x) => dow(x) !== 0 && x !== holiday);

  it("counts present, late, absent, half, paid and unpaid leave, unmarked days, holidays and Sundays", async () => {
    const t = b.users.teacher;
    const cl = await typeId(b, "CL"), lop = await typeId(b, "LOP");
    const late = nth(1, 0), absent = nth(1, 1), half = nth(1, 2), paidDay = nth(2, 0), unpaidDay = nth(2, 1), unmarked = nth(2, 2);
    const special = new Map([[late, "late"], [absent, "absent"], [half, "half_day"], [paidDay, "leave"], [unpaidDay, "leave"]]);
    await withSchool(b.id, async (tx) => {
      await tx.insert(attendanceHolidays).values({ schoolId: b.id, date: holiday, name: "Founders day" });
      await tx.insert(staffAttendance).values(working.filter((x) => x !== unmarked).map((date) => ({ schoolId: b.id, userId: t, date, status: (special.get(date) ?? "present") as "present" })));
      const req = { schoolId: b.id, kind: "staff" as const, userId: t, requestedBy: t, reason: "x", status: "approved" as const };
      await tx.insert(leaveRequests).values([{ ...req, fromDate: paidDay, toDate: paidDay, typeId: cl }, { ...req, fromDate: unpaidDay, toDate: unpaidDay, typeId: lop }]);
    });
    const out = await withSchool(b.id, (tx) => monthDays(tx, [t], M));
    expect(out[t]).toEqual({
      calendarDays: dates.length, sundays: dates.filter((x) => dow(x) === 0).length, holidays: 1, workingDays: working.length,
      present: working.length - 6, lateDays: 1, half: 1, paidLeaveHalfDays: 2, unpaidLeaveHalfDays: 2, absentDays: 1.5, unmarkedDays: 1, comingDays: 0,
    });
  });

  it("counts a joiner only from the joining date and an approved but unmarked leave day as leave", async () => {
    const j = b.users.parent, joined = dates[14]!;
    const approvedDay = working.find((x) => x > joined)!;
    await withSchool(b.id, async (tx) => {
      await tx.execute(sql`insert into staff_profiles (id, school_id, user_id, employee_id, joining_date) values (gen_random_uuid(), ${b.id}, ${j}, 'J1', ${joined})`);
      await tx.insert(leaveRequests).values({ schoolId: b.id, kind: "staff", userId: j, requestedBy: j, reason: "x", status: "approved", fromDate: approvedDay, toDate: approvedDay, typeId: await typeId(b, "CL") });
    });
    const t = (await withSchool(b.id, (tx) => monthDays(tx, [j], M)))[j]!;
    const from = working.filter((x) => x >= joined);
    expect(t.workingDays).toBe(from.length);
    expect(t.unmarkedDays).toBe(from.length - 1);
    expect(t.paidLeaveHalfDays).toBe(2);
    expect(t.calendarDays).toBe(dates.length);
  });

  it("a person who left counts to the leaving date, or to the last marked day when none is given", async () => {
    const l = b.users.accountant, last = dates[9]!;
    await withSchool(b.id, async (tx) => {
      await tx.insert(staffAttendance).values(working.filter((x) => x <= last).map((date) => ({ schoolId: b.id, userId: l, date, status: "present" as const })));
      await tx.update(users).set({ status: "disabled" }).where(eq(users.id, l));
    });
    const early = working.filter((x) => x <= last).length;
    const guess = (await withSchool(b.id, (tx) => monthDays(tx, [l], M)))[l]!;
    expect(guess).toMatchObject({ workingDays: early, present: early, unmarkedDays: 0 });
    const leftOn = dates[19]!;
    const dated = (await withSchool(b.id, (tx) => monthDays(tx, [l], M, { leftOn: { [l]: leftOn } })))[l]!;
    expect(dated.unmarkedDays).toBe(working.filter((x) => x > last && x <= leftOn).length);
  });

  it("a person with no marks at all has every working day unmarked, and an empty list is fine", async () => {
    const t = (await withSchool(b.id, (tx) => monthDays(tx, [b.users.admin], M)))[b.users.admin]!;
    expect(t).toMatchObject({ unmarkedDays: working.length, present: 0 });
    expect(await withSchool(b.id, (tx) => monthDays(tx, [], M))).toEqual({});
  });
});
