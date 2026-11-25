import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, closeDb, eq, inArray, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { feeInvoiceLines, feeInvoices } from "@smw/feature-fees/schema";
import { DuesService } from "@smw/feature-fees/service";
import { ForbiddenError, ValidationError } from "@smw/feature-kit";
import { monthStarts, nextMonthStart } from "./rules";
import { RouteService, StudentTransportService, VehicleService } from "./service";
import { resyncSchoolTransport } from "./billing";
import { routeStops } from "./schema";
import { todayIST } from "./vehicle-care";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

// A10: the transport fee is a monthly line on the fee ledger, from the next full month, no pro-rata.
let a: TestSchool, b: TestSchool;
const today = todayIST();
const thisMonth = `${today.slice(0, 7)}-01`;
const nextMonth = nextMonthStart(today);
const yearEnd = `${Number(today.slice(0, 4)) + 1}-03-31`;
const lastMonth = (() => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`; })();
const monthsFrom = (d: string) => monthStarts(d, yearEnd).length;

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["students", "academics", "transport", "fees", "notifications"], "tb"));
  await withSchool(a.id, (tx) => tx.insert(academicYears).values({ schoolId: a.id, name: "Billing year", startsOn: lastMonth, endsOn: yearEnd, isCurrent: true }));
});
afterAll(closeDb);

let n = 0;
const makeStudent = (s: TestSchool) => withSchool(s.id, async (tx) => (await tx.insert(students).values({ schoolId: s.id, admissionNo: `B${++n}`, name: `Rider ${n}` }).returning())[0]!);
async function route(s: TestSchool, fees = [120_000, 80_000]) {
  const v = await new VehicleService(s.as.admin).create({ registrationNo: `KA 09 BB ${1000 + ++n}`, kind: "bus", capacity: 40, driverName: "Driver One", driverPhone: "9845012345" });
  const routes = new RouteService(s.as.admin);
  const r = await routes.create({ name: `Billing route ${++n}`, vehicleId: v.id, morningStart: "07:00", eveningStart: "14:30" });
  const s1 = await routes.addStop(r.id, { name: "First", morningTime: "07:00", eveningTime: "15:00", monthlyFeePaise: fees[0] });
  const s2 = await routes.addStop(r.id, { name: "Second", morningTime: "07:10", eveningTime: "15:10", monthlyFeePaise: fees[1] });
  return { r, s1, s2 };
}
const charges = (studentId: string) => withSchool(a.id, (tx) => tx.select().from(feeInvoices).where(and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.kind, "transport"))).orderBy(asc(feeInvoices.dueDate)));
const active = async (studentId: string) => (await charges(studentId)).filter((c) => c.status === "issued");
const both = { pickup: "true", drop: "true" };

describe("transport fee on the ledger", () => {
  it("starts from the first of next month, one line a month to the year end, at the stop's full fee", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    const rows = await active(st.id);
    expect(rows[0]).toMatchObject({ dueDate: nextMonth, grossPaise: 120_000, kind: "transport" });
    expect(rows).toHaveLength(monthsFrom(nextMonth));
    expect(rows.every((c) => c.grossPaise === 120_000 && c.dueDate.endsWith("-01"))).toBe(true);
  });

  it("one way costs half", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, pickup: "true", drop: "false" });
    expect((await active(st.id)).every((c) => c.grossPaise === 60_000)).toBe(true);
  });

  it("a free stop bills nothing", async () => {
    const { r, s1 } = await route(a, [0, 0]);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    expect(await charges(st.id)).toHaveLength(0);
  });

  it("a rider who started last month is billed from this month; moving changes the fee the month after, not this one", async () => {
    const { r, s1, s2 } = await route(a);
    const st = await makeStudent(a);
    const svc = new StudentTransportService(a.as.admin);
    await svc.assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both, startsOn: lastMonth });
    expect((await active(st.id))[0]).toMatchObject({ dueDate: thisMonth, grossPaise: 120_000 });
    await svc.assign({ studentId: st.id, routeId: r.id, stopId: s2.id, ...both }); // a move
    const rows = await active(st.id);
    expect(rows[0]).toMatchObject({ dueDate: thisMonth, grossPaise: 120_000 }); // this month is already billed
    expect(rows.slice(1).every((c) => c.grossPaise === 80_000)).toBe(true);
    expect(rows).toHaveLength(monthsFrom(thisMonth));
  });

  it("unassigning stops the fee from next month and keeps this month's", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    const svc = new StudentTransportService(a.as.admin);
    await svc.assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both, startsOn: lastMonth });
    await svc.unassign(st.id);
    expect((await active(st.id)).map((c) => c.dueDate)).toEqual([thisMonth]);
    expect((await charges(st.id)).filter((c) => c.status === "cancelled").length).toBe(monthsFrom(nextMonth));
    // joining again later starts a fresh run from next month
    await svc.assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    expect(await active(st.id)).toHaveLength(monthsFrom(thisMonth));
  });

  it("the dues and the student's ledger include the transport lines", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both, startsOn: lastMonth });
    const account = await new DuesService(a.as.accountant).studentAccount(st.id);
    const lines = account.invoices.filter((i) => i.kind === "transport").sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    expect(lines).toHaveLength(monthsFrom(thisMonth));
    expect(lines[0]!.label).toMatch(/^Transport, /);
    expect(account.balance.openPaise).toBe(120_000 * monthsFrom(thisMonth));
    expect((await new DuesService(a.as.accountant).report({ q: st.name })).rows.find((x) => x.id === st.id)?.due).toBe(120_000 * monthsFrom(thisMonth));
  });

  it("a school without an academic year can still assign (nothing to bill yet), and school B never sees A's lines", async () => {
    const { r, s1 } = await route(b);
    const st = await makeStudent(b);
    await new StudentTransportService(b.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    expect(await withSchool(b.id, (tx) => tx.select().from(feeInvoices))).toHaveLength(0);
  });
});

describe("monthly fee sync", () => {
  it("re-prices unpaid months from this month after a stop fee change, fills missing months, and runs twice safely", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    await withSchool(a.id, async (tx) => {
      await tx.update(routeStops).set({ monthlyFeePaise: 150_000 }).where(eq(routeStops.id, s1.id));
      // as if the year had just rolled over
      const mine = tx.select({ id: feeInvoices.id }).from(feeInvoices).where(eq(feeInvoices.studentId, st.id));
      await tx.delete(feeInvoiceLines).where(inArray(feeInvoiceLines.invoiceId, mine));
      await tx.delete(feeInvoices).where(eq(feeInvoices.studentId, st.id));
    });
    await resyncSchoolTransport(a.id, today);
    await resyncSchoolTransport(a.id, today);
    const rows = await active(st.id);
    expect(rows[0]!.dueDate).toBe(nextMonth); // joined this month, so billing still starts next month
    expect(rows).toHaveLength(monthsFrom(nextMonth));
    expect(rows.every((c) => c.grossPaise === 150_000)).toBe(true);
    // school B is untouched
    expect(await withSchool(b.id, (tx) => tx.select().from(feeInvoices))).toEqual([]);
  });
});

describe("a student who left", () => {
  it("is billed no more months: the unpaid ones from the month after they left are cancelled, and the monthly run does not bring them back", async () => {
    const { r, s1 } = await route(a);
    const st = await makeStudent(a);
    await new StudentTransportService(a.as.admin).assign({ studentId: st.id, routeId: r.id, stopId: s1.id, ...both });
    expect((await active(st.id)).length).toBeGreaterThan(0);
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left", leftOn: today }).where(eq(students.id, st.id)));
    await resyncSchoolTransport(a.id, today);
    expect((await active(st.id)).filter((c) => c.dueDate >= nextMonth)).toHaveLength(0);
    await resyncSchoolTransport(a.id, today);
    expect((await active(st.id)).filter((c) => c.dueDate >= nextMonth)).toHaveLength(0);
  });
});

describe("tracking link", () => {
  const base = { registrationNo: "KA 01 TR 1", capacity: 10, driverName: "Dri Ver", driverPhone: "9845012345" };
  it("only https is accepted", async () => {
    const svc = new VehicleService(a.as.admin);
    for (const bad of ["http://track.example.com/x", "javascript:alert(1)", "track.example.com", "ftp://x.example.com"]) {
      await expect(svc.create({ ...base, registrationNo: `KA 01 TR ${++n}`, trackingUrl: bad })).rejects.toBeInstanceOf(ValidationError);
    }
    const ok = await svc.create({ ...base, registrationNo: `KA 01 TR ${++n}`, trackingUrl: "https://track.example.com/bus/7" });
    expect(ok.trackingUrl).toBe("https://track.example.com/bus/7");
    await expect(svc.update(ok.id, { ...base, registrationNo: ok.registrationNo, trackingUrl: "http://nope.example.com" })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.update(ok.id, { ...base, registrationNo: ok.registrationNo, trackingUrl: "" })).trackingUrl).toBeNull();
  });

  it("shows on the student's my transport", async () => {
    const v = await new VehicleService(a.as.admin).create({ ...base, registrationNo: `KA 01 TR ${++n}`, trackingUrl: "https://track.example.com/mine" });
    const routes = new RouteService(a.as.admin);
    const r = await routes.create({ name: `Tracked ${++n}`, vehicleId: v.id, morningStart: "07:00", eveningStart: "14:30" });
    const stop = await routes.addStop(r.id, { name: "Gate", morningTime: "07:00", eveningTime: "15:00", monthlyFeePaise: 0 });
    const me = await withSchool(a.id, async (tx) => (await tx.insert(students).values({ schoolId: a.id, admissionNo: `B${++n}`, name: "Own Rider", userId: a.users.student }).returning())[0]!);
    await new StudentTransportService(a.as.admin).assign({ studentId: me.id, routeId: r.id, stopId: stop.id, ...both });
    expect((await new StudentTransportService(a.as.student).mine())[0]).toMatchObject({ trackingUrl: "https://track.example.com/mine" });
    await expect(new StudentTransportService(a.as.student).assign({ studentId: me.id, routeId: r.id, stopId: stop.id, ...both })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
