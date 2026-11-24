import { describe, expect, it } from "vitest";
import { computePay, pfCeiling, share, slabTax, yearlyTax, type EngineComponent, type PayInput, type PayRates, type TaxRates } from "./engine";

const LAKH = 10_000_000;
const comp = (o: Partial<EngineComponent> & Pick<EngineComponent, "label" | "mode" | "value">): EngineComponent => ({ id: o.label, kind: "earning", isBasic: false, isWage: false, proRata: true, taxable: true, sort: 0, ...o });
const BASIC = comp({ label: "Basic", mode: "percent_of_gross", value: 5000, isBasic: true, isWage: true, sort: 1 });
const HRA = comp({ label: "HRA", mode: "percent_of_basic", value: 4000, sort: 2 });
const SPECIAL = comp({ label: "Special", mode: "remainder", value: 0, sort: 3 });
const STRUCT = [BASIC, HRA, SPECIAL];

const NEW_TAX: TaxRates = {
  slabs: [[4 * LAKH, 0], [8 * LAKH, 500], [12 * LAKH, 1000], [16 * LAKH, 1500], [20 * LAKH, 2000], [24 * LAKH, 2500], [null, 3000]],
  std: 75_000 * 100, rebate: { upTo: 12 * LAKH, max: 60_000 * 100, marginal: true }, cessBp: 400,
};
const OLD_TAX: TaxRates = { slabs: [[2.5 * LAKH, 0], [5 * LAKH, 500], [10 * LAKH, 2000], [null, 3000]], std: 50_000 * 100, rebate: { upTo: 5 * LAKH, max: 12_500 * 100, marginal: false }, cessBp: 400 };
const KARNATAKA = [{ over: 2_499_999, paise: 20_000, special: { month: 2, paise: 30_000 } }];
const MAHARASHTRA = [{ over: 750_000, paise: 17_500 }, { over: 1_000_000, paise: 20_000, special: { month: 2, paise: 30_000 } }];

const rates = (o: Partial<PayRates> = {}, on: Partial<PayRates["config"]> = {}): PayRates => ({
  pfCeilingSegments: [{ days: 30, paise: 2_500_000 }], pfEmployeeBp: 1200, pfEmployerBp: 1200, epsBp: 833, edliBp: 50, pfAdminBp: 50, wageExclusionBp: 5000,
  esiCeiling: 2_100_000, esiEmployeeBp: 75, esiEmployerBp: 325, pt: null, lwf: null, tax: null,
  config: { pf: false, esi: false, pt: false, lwf: false, tds: false, ...on },
  rounding: { esi_employee: "up", esi_employer: "up", pf_employee: "nearest", pf_employer: "nearest", eps: "nearest" }, ...o,
});
const run = (o: Partial<PayInput> & { gross?: number } = {}) => {
  const r = computePay({
    assignment: { grossPaise: o.gross ?? 4_000_000 }, components: STRUCT, days: { calendarDays: 30, unpaidHalfDays: 0 }, profile: { pan: true, regime: "new", pfApplies: null, esiApplies: null, ptApplies: null, pfOnFullWages: false },
    rates: rates(), month: "2026-11-01", ...o,
  });
  // The invariant every result keeps: lines add up to the totals.
  const by = (k: string) => r.lines.filter((l) => l.kind === k && l.code !== "claim").reduce((s, l) => s + l.amountPaise, 0);
  expect([r.grossPaise, r.deductionsPaise, r.employerPaise]).toEqual([by("earning"), by("deduction"), by("employer")]);
  expect(r.netPaise).toBe(r.grossPaise + r.claimsPaise - r.deductionsPaise);
  return r;
};
const amount = (r: ReturnType<typeof run>, code: string | null, label?: string) => r.lines.find((l) => l.code === code && (!label || l.label === label))?.amountPaise;

describe("earnings", () => {
  it("builds basic, percent of basic and remainder for a full month", () => {
    const r = run();
    expect(r.lines.map((l) => [l.label, l.amountPaise])).toEqual([["Basic", 2_000_000], ["HRA", 800_000], ["Special", 1_200_000]]);
    expect(r.grossPaise).toBe(4_000_000);
  });
  it("cuts 3 unpaid days to 90 percent, split exactly", () => {
    const r = run({ days: { calendarDays: 30, unpaidHalfDays: 6 } });
    expect(r.lines.map((l) => l.amountPaise)).toEqual([1_800_000, 720_000, 1_080_000]);
    expect(r.grossPaise).toBe(3_600_000);
  });
  it("a half day in a 31-day month: the odd paisa goes where the rounding left most", () => {
    const r = run({ days: { calendarDays: 31, unpaidHalfDays: 1 } });
    expect(r.lines.map((l) => l.amountPaise)).toEqual([1_967_742, 787_097, 1_180_645]);
    expect(r.grossPaise).toBe(3_935_484);
  });
  it("a month with every day unpaid pays nothing", () => expect(run({ days: { calendarDays: 30, unpaidHalfDays: 60 } }).grossPaise).toBe(0));
  it("a component marked not pro-rata is not cut", () => {
    const conv = comp({ label: "Conveyance", mode: "fixed", value: 160_000, proRata: false, sort: 4 });
    const r = run({ gross: 4_160_000, components: [...STRUCT, conv], days: { calendarDays: 30, unpaidHalfDays: 6 } });
    expect(amount(r, null, "Conveyance")).toBe(160_000);
    expect(r.grossPaise).toBe(3_600_000 + 160_000);
  });
  it("a typed override replaces a component for this person", () => {
    const r = run({ assignment: { grossPaise: 4_000_000, overrides: { HRA: 500_000 } } });
    expect(amount(r, null, "HRA")).toBe(500_000);
    expect(amount(r, null, "Special")).toBe(1_500_000);
  });
  it("percent of gross and fixed components", () => {
    const r = run({ gross: 3_000_000, components: [comp({ label: "Basic", mode: "percent_of_gross", value: 4000, isBasic: true }), comp({ label: "Allowance", mode: "fixed", value: 200_000, sort: 2 }), SPECIAL] });
    expect(r.lines.map((l) => l.amountPaise)).toEqual([1_200_000, 200_000, 1_600_000]);
  });
  it("a remainder never goes below zero and the mismatch is flagged", () => {
    const r = run({ gross: 1_000_000, components: [comp({ label: "Basic", mode: "fixed", value: 1_500_000, isBasic: true }), SPECIAL] });
    expect(amount(r, null, "Special")).toBe(0);
    expect(r.flags.map((f) => f.code)).toContain("gross_mismatch");
  });
  it("components that do not reach the gross are flagged, and the components win", () => {
    const r = run({ components: [BASIC] });
    expect(r.grossPaise).toBe(2_000_000);
    expect(r.flags.map((f) => f.code)).toContain("gross_mismatch");
  });
  it("no components: one Pay line, cut by days", () => {
    const r = run({ components: [], days: { calendarDays: 30, unpaidHalfDays: 20 } });
    expect(r.lines.map((l) => [l.label, l.amountPaise])).toEqual([["Pay", 2_666_667]]);
  });
  it("hourly staff are paid by hours, with no component maths", () => {
    const r = run({ assignment: { grossPaise: 0, hourlyPaise: 40_000 }, days: { calendarDays: 30, unpaidHalfDays: 0, hours: 12.5 } });
    expect(r.grossPaise).toBe(500_000);
    expect(r.lines).toHaveLength(1);
  });
  it("hourly with no hours is zero", () => expect(run({ assignment: { grossPaise: 0, hourlyPaise: 40_000 }, days: { calendarDays: 30, unpaidHalfDays: 0 } }).grossPaise).toBe(0));
});

describe("adjustments, claims and loans", () => {
  it("bonus and arrears add to gross; a deduction cuts the net", () => {
    const r = run({ adjustments: [{ kind: "earning", code: "bonus", label: "Diwali bonus", amountPaise: 500_000 }, { kind: "earning", code: "arrears", label: "Arrears", amountPaise: 100_000 }, { kind: "deduction", code: "adjustment", label: "Lost key", amountPaise: 20_000 }] });
    expect([r.grossPaise, r.deductionsPaise, r.netPaise]).toEqual([4_600_000, 20_000, 4_580_000]);
  });
  it("a claim is paid with salary but is not gross and not taxed", () => {
    const r = run({ claims: [{ id: "c1", amountPaise: 150_000, label: "Travel claim" }], rates: rates({ tax: NEW_TAX }, { tds: true }), month: "2027-03-01" });
    expect([r.grossPaise, r.claimsPaise, r.netPaise]).toEqual([4_000_000, 150_000, 4_000_000 + 150_000 - r.deductionsPaise]);
    expect(r.taxableGrossPaise).toBe(4_000_000);
  });
  it("a loan EMI is a deduction tied to the loan", () => {
    const r = run({ loans: [{ loanId: "L1", emiPaise: 300_000 }] });
    expect(r.lines.find((l) => l.code === "loan")).toMatchObject({ amountPaise: 300_000, refId: "L1" });
    expect(r.netPaise).toBe(3_700_000);
  });
  it("net below zero shows the shortfall and a flag, never a silent zero", () => {
    const r = run({ loans: [{ loanId: "L1", emiPaise: 4_500_000 }] });
    expect([r.netPaise, r.shortfallPaise]).toEqual([-500_000, 500_000]);
    expect(r.flags.map((f) => f.code)).toContain("net_negative");
  });
});

describe("provident fund", () => {
  const pf = { pf: true };
  it("12 percent of basic under the ceiling, with the pension share, EDLI and admin", () => {
    const r = run({ rates: rates({}, pf) });
    expect(amount(r, "pf_employee")).toBe(240_000);
    expect(amount(r, "eps_employer")).toBe(166_600);
    expect(amount(r, "pf_employer")).toBe(73_400);
    expect([amount(r, "edli"), amount(r, "pf_admin")]).toEqual([10_000, 10_000]);
  });
  it("wages are at least half of pay: allowances above the exclusion are added back", () => {
    const small = comp({ ...BASIC, value: 3000 });
    const r = run({ components: [small, SPECIAL], rates: rates({}, pf) });
    expect(r.pfWagesPaise).toBe(2_000_000);
    expect(amount(r, "pf_employee")).toBe(240_000);
  });
  it("the ceiling caps the contribution", () => {
    const r = run({ gross: 10_000_000, rates: rates({}, pf) });
    expect(amount(r, "pf_employee")).toBe(300_000);
    expect(amount(r, "eps_employer")).toBe(208_300);
    expect(amount(r, "pf_employer")).toBe(91_700);
    expect([amount(r, "edli"), amount(r, "pf_admin")]).toEqual([12_500, 12_500]);
  });
  it("pf on full wages lifts the contribution but not the pension share", () => {
    const r = run({ gross: 10_000_000, rates: rates({}, pf), profile: { pan: true, regime: "new", pfApplies: null, esiApplies: null, ptApplies: null, pfOnFullWages: true } });
    expect(amount(r, "pf_employee")).toBe(600_000);
    expect(amount(r, "eps_employer")).toBe(208_300);
    expect(amount(r, "pf_employer")).toBe(391_700);
    expect([amount(r, "edli"), amount(r, "pf_admin")]).toEqual([12_500, 25_000]);
  });
  it("September 2026 uses both ceilings by days", () => {
    const segments = [{ days: 16, paise: 1_500_000 }, { days: 14, paise: 2_500_000 }];
    expect(pfCeiling(segments)).toBe(1_966_667);
    const r = run({ rates: rates({ pfCeilingSegments: segments }, pf), month: "2026-09-01" });
    expect(amount(r, "pf_employee")).toBe(236_000);
  });
  it("a month wholly before the change uses the old ceiling", () => {
    const r = run({ gross: 10_000_000, rates: rates({ pfCeilingSegments: [{ days: 30, paise: 1_500_000 }] }, pf) });
    expect(amount(r, "pf_employee")).toBe(180_000);
  });
  it("the person's own setting wins over the school's", () => {
    const profile = { pan: true, regime: "new" as const, pfApplies: false, esiApplies: null, ptApplies: null, pfOnFullWages: false };
    expect(amount(run({ rates: rates({}, pf), profile }), "pf_employee")).toBeUndefined();
    expect(amount(run({ rates: rates(), profile: { ...profile, pfApplies: true } }), "pf_employee")).toBe(240_000);
  });
  it("school off and no personal setting means no PF", () => expect(run().lines.some((l) => l.code === "pf_employee")).toBe(false));
});

describe("ESI", () => {
  const esi = { esi: true };
  it("covers pay up to 21,000 and splits 0.75 and 3.25 percent", () => {
    const r = run({ gross: 2_100_000, rates: rates({}, esi) });
    expect([amount(r, "esi_employee"), amount(r, "esi_employer")]).toEqual([15_800, 68_300]);
  });
  it("21,001 is out", () => expect(run({ gross: 2_100_100, rates: rates({}, esi) }).lines.some((l) => l.code?.startsWith("esi"))).toBe(false));
  it("the school must turn it on, and a person can be left out", () => {
    expect(run({ gross: 2_000_000 }).lines.some((l) => l.code === "esi_employee")).toBe(false);
    const profile = { pan: true, regime: "new" as const, pfApplies: null, esiApplies: false, ptApplies: null, pfOnFullWages: false };
    expect(run({ gross: 2_000_000, rates: rates({}, esi), profile }).lines.some((l) => l.code === "esi_employee")).toBe(false);
  });
});

describe("professional tax and labour welfare fund", () => {
  const pt = { pt: true };
  it("Karnataka: 200 a month, 300 in February", () => {
    expect(amount(run({ rates: rates({ pt: KARNATAKA }, pt) }), "pt")).toBe(20_000);
    expect(amount(run({ rates: rates({ pt: KARNATAKA }, pt), month: "2027-02-01", days: { calendarDays: 28, unpaidHalfDays: 0 } }), "pt")).toBe(30_000);
  });
  it("below the first slab there is no line", () => expect(run({ gross: 2_000_000, rates: rates({ pt: KARNATAKA }, pt) }).lines.some((l) => l.code === "pt")).toBe(false));
  it("Maharashtra slabs by pay", () => {
    expect(amount(run({ gross: 900_000, rates: rates({ pt: MAHARASHTRA }, pt) }), "pt")).toBe(17_500);
    expect(amount(run({ gross: 1_100_000, rates: rates({ pt: MAHARASHTRA }, pt) }), "pt")).toBe(20_000);
    expect(amount(run({ gross: 1_100_000, rates: rates({ pt: MAHARASHTRA }, pt), month: "2027-02-01", days: { calendarDays: 28, unpaidHalfDays: 0 } }), "pt")).toBe(30_000);
  });
  it("an unknown state asks for the amount instead of guessing", () => {
    const r = run({ rates: rates({ pt: null }, pt) });
    expect(r.lines.find((l) => l.code === "pt")).toMatchObject({ amountPaise: 0, needsInput: true });
    expect(r.flags.some((f) => f.code === "needs_input" && f.line === "pt")).toBe(true);
  });
  it("a typed amount takes the place of the empty line", () => {
    const r = run({ rates: rates({ pt: null }, pt), typed: { pt: 15_000 } });
    expect(r.lines.find((l) => l.code === "pt")).toMatchObject({ amountPaise: 15_000, manual: true });
    expect(r.flags).toHaveLength(0);
  });
  it("LWF is typed unless a rate exists; months limit when it is due", () => {
    const lwf = { lwf: true };
    expect(run({ rates: rates({}, lwf) }).lines.find((l) => l.code === "lwf_employee")?.needsInput).toBe(true);
    const due = rates({ lwf: { employeePaise: 3000, employerPaise: 6000, months: [6, 12] } }, lwf);
    expect(run({ rates: due }).lines.some((l) => l.code?.startsWith("lwf"))).toBe(false);
    const dec = run({ rates: due, month: "2026-12-01", days: { calendarDays: 31, unpaidHalfDays: 0 } });
    expect([amount(dec, "lwf_employee"), amount(dec, "lwf_employer")]).toEqual([3000, 6000]);
  });
});

describe("income tax (TDS)", () => {
  const tds = (tax: TaxRates | null) => rates({ tax }, { tds: true });
  const april = (o: Parameters<typeof run>[0]) => run({ month: "2026-04-01", ...o });
  it("yearly tax: slabs, rebate, marginal relief and cess", () => {
    expect(slabTax(11_250_000 * 10, NEW_TAX.slabs)).toBe(5_250_000);
    expect(yearlyTax(112_500_000, NEW_TAX)).toBe(0);
    expect(yearlyTax(120_900_000, NEW_TAX)).toBe(936_000);
    expect(yearlyTax(232_500_000, NEW_TAX)).toBe(29_250_000);
  });
  it("1 lakh a month is under the 12 lakh rebate: nothing to deduct", () => expect(april({ gross: 10_000_000, rates: tds(NEW_TAX), days: { calendarDays: 30, unpaidHalfDays: 0 } }).lines.some((l) => l.code === "tds")).toBe(false));
  it("12.75 lakh a year is nil after the standard deduction", () => expect(april({ gross: 10_625_000, rates: tds(NEW_TAX) }).lines.some((l) => l.code === "tds")).toBe(false));
  it("just above it, marginal relief limits the tax to the extra income", () => expect(amount(april({ gross: 10_700_000, rates: tds(NEW_TAX) }), "tds")).toBe(78_000));
  it("20 lakh a month's worth: full slabs and cess", () => expect(amount(april({ gross: 20_000_000, rates: tds(NEW_TAX) }), "tds")).toBe(2_437_500));
  it("a joiner in October spreads the year over the six months left", () => expect(amount(run({ gross: 30_000_000, rates: tds(NEW_TAX), month: "2026-10-01", days: { calendarDays: 31, unpaidHalfDays: 0 } }), "tds")).toBe(2_513_333));
  it("the last month settles what is still owed after the year to date", () => {
    const r = run({ gross: 30_000_000, rates: tds(NEW_TAX), month: "2027-03-01", days: { calendarDays: 31, unpaidHalfDays: 0 }, ytd: { taxableGrossPaise: 330_000_000, tdsPaise: 25_000_000 } });
    expect(amount(r, "tds")).toBe(41_300_000);
  });
  it("pay and tax from a previous employer count", () => {
    const declaration = { otherIncomePaise: 0, deductionsPaise: 0, previousSalaryPaise: 60_000_000, previousTdsPaise: 5_000_000 };
    expect(amount(april({ gross: 30_000_000, rates: tds(NEW_TAX), declaration }), "tds")).toBe(6_668_333);
  });
  it("old regime takes the declared deductions; the new one ignores them", () => {
    const old = { pan: true, regime: "old" as const, pfApplies: null, esiApplies: null, ptApplies: null, pfOnFullWages: false };
    const declaration = { otherIncomePaise: 0, deductionsPaise: 15_000_000, previousSalaryPaise: 0, previousTdsPaise: 0 };
    expect(amount(april({ gross: 10_000_000, rates: tds(OLD_TAX), profile: old, declaration }), "tds")).toBe(975_000);
    expect(amount(april({ gross: 10_000_000, rates: tds(OLD_TAX), profile: old }), "tds")).toBe(1_365_000);
    expect(april({ gross: 10_000_000, rates: tds(NEW_TAX), profile: { ...old, regime: "new" }, declaration }).lines.some((l) => l.code === "tds")).toBe(false);
  });
  it("a missing PAN is flagged but the tax is still worked out", () => {
    const r = april({ gross: 20_000_000, rates: tds(NEW_TAX), profile: { pan: false, regime: "new", pfApplies: null, esiApplies: null, ptApplies: null, pfOnFullWages: false } });
    expect(r.flags.map((f) => f.code)).toContain("no_pan");
    expect(amount(r, "tds")).toBe(2_437_500);
  });
  it("a year with no slabs asks for the tax instead of guessing", () => {
    const r = april({ gross: 20_000_000, rates: tds(null) });
    expect(r.lines.find((l) => l.code === "tds")).toMatchObject({ needsInput: true, amountPaise: 0 });
  });
  it("a non-taxable component is left out of the projection", () => {
    const exempt = comp({ label: "Exempt", mode: "fixed", value: 1_000_000, taxable: false, sort: 4 });
    const r = april({ gross: 21_000_000, components: [BASIC, HRA, comp({ ...SPECIAL, mode: "remainder" }), exempt], rates: tds(NEW_TAX) });
    expect(r.taxableGrossPaise).toBe(r.grossPaise - 1_000_000);
  });
  it("TDS off in the school's settings means no line", () => expect(april({ gross: 20_000_000, rates: rates({ tax: NEW_TAX }) }).lines.some((l) => l.code === "tds")).toBe(false));
});

describe("rounding of contributions", () => {
  it("shares round as the rule says: to the paisa, to the nearest rupee, or up to the next rupee", () => {
    expect([share(2_500_000, 833, "paise"), share(2_500_000, 833, "nearest"), share(2_500_000, 833, "up")]).toEqual([208_250, 208_300, 208_300]);
    expect([share(2_100_100, 75, "up"), share(2_100_000, 75, "up"), share(1_999_900, 75, "nearest")]).toEqual([15_800, 15_800, 15_000]);
    expect(share(100, 75, "up")).toBe(100);
  });
  it("ESI goes up to the next rupee on each side; the boundary pay of exactly 21,000 stays covered", () => {
    const r = run({ gross: 1_500_033, rates: rates({}, { esi: true }) });
    expect([amount(r, "esi_employee"), amount(r, "esi_employer")]).toEqual([11_300, 48_800]);
  });
  it("the pension share is rounded first and employer PF is the rounded total less it", () => {
    const r = run({ gross: 10_000_100, rates: rates({}, { pf: true }) });
    // basic 5,000,050 is capped at 2,500,000: employee 300,000, total employer 300,000, pension 208,300
    expect([amount(r, "pf_employee"), amount(r, "eps_employer"), amount(r, "pf_employer")]).toEqual([300_000, 208_300, 91_700]);
  });
  it("the wages each contribution rests on come back with the result", () => {
    const r = run({ gross: 10_000_000, rates: rates({}, { pf: true, esi: true }) });
    expect([r.epfWagesPaise, r.epsWagesPaise, r.edliWagesPaise, r.esiWagesPaise]).toEqual([2_500_000, 2_500_000, 2_500_000, 0]);
    const s = run({ gross: 2_000_000, rates: rates({}, { pf: true, esi: true }) });
    expect([s.epfWagesPaise, s.esiWagesPaise]).toEqual([1_000_000, 2_000_000]);
  });
});

describe("a month with two rates", () => {
  const seg = (gross: number, label: string, days: number, outside: number, lop = 0) => ({ assignment: { grossPaise: gross }, components: STRUCT, label, days: { calendarDays: 30, unpaidHalfDays: 2 * outside + lop } });
  it("each part is paid for its own days and the lines add up to the paisa", () => {
    // 14 days at 3,000,000 and 16 days at 3,300,000 in a 30-day month
    const a = seg(3_000_000, "1 to 14 Nov", 14, 16), b = seg(3_300_000, "15 to 30 Nov", 16, 14);
    const r = run({ gross: 3_300_000, segments: [a, b] });
    const partA = Math.round((3_000_000 * 28) / 60), partB = Math.round((3_300_000 * 32) / 60);
    expect(r.grossPaise).toBe(partA + partB);
    expect(r.lines.map((l) => l.label)).toEqual(["Basic", "HRA", "Special"]);
    expect(r.lines[0]!.note).toBe("1 to 14 Nov: ₹7,000; 15 to 30 Nov: ₹8,800");
    expect(r.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(r.grossPaise);
  });
  it("unpaid days are shared between the parts by their days", () => {
    const a = seg(3_000_000, "first", 14, 16, 1), b = seg(3_300_000, "second", 16, 14, 1);
    expect(run({ gross: 3_300_000, segments: [a, b] }).grossPaise).toBe(Math.round((3_000_000 * 27) / 60) + Math.round((3_300_000 * 31) / 60));
  });
  it("a joiner is one part that starts late, with the days before it unpaid", () => {
    const r = run({ gross: 3_000_000, segments: [seg(3_000_000, "from 11 Nov", 20, 10)] });
    expect(r.grossPaise).toBe(Math.round((3_000_000 * 40) / 60));
    expect(r.lines[0]!.note).toBeNull();
  });
  it("statutory amounts are worked on the sum of the parts, not part by part", () => {
    const a = seg(3_000_000, "a", 14, 16), b = seg(3_300_000, "b", 16, 14);
    const r = run({ gross: 3_300_000, segments: [a, b], rates: rates({}, { pf: true }) });
    expect(amount(r, "pf_employee")).toBe(share(r.epfWagesPaise, 1200, "nearest"));
  });
});

describe("lines", () => {
  it("kinds and order: earnings, then deductions, then employer cost", () => {
    const r = run({ rates: rates({ pt: KARNATAKA }, { pf: true, pt: true }), loans: [{ loanId: "L", emiPaise: 100_000 }] });
    const order = r.lines.map((l) => l.kind);
    expect(order).toEqual([...order].sort((a, b) => ["earning", "deduction", "employer"].indexOf(a) - ["earning", "deduction", "employer"].indexOf(b)));
    expect(r.lines.map((l) => l.sort)).toEqual(r.lines.map((_, i) => i));
  });
  it("the school's own deduction and employer components are lines too", () => {
    const canteen = comp({ label: "Canteen", kind: "deduction", mode: "fixed", value: 50_000, proRata: false, sort: 5 });
    const gratuity = comp({ label: "Gratuity provision", kind: "employer", mode: "percent_of_basic", value: 481, sort: 6 });
    const r = run({ components: [...STRUCT, canteen, gratuity] });
    expect(amount(r, null, "Canteen")).toBe(50_000);
    expect(amount(r, null, "Gratuity provision")).toBe(96_200);
    expect(r.employerPaise).toBe(96_200);
  });
});

describe("tax on one-off pay and on the last month", () => {
  const tax = rates({ tax: NEW_TAX }, { tds: true });
  const ytd = { taxableGrossPaise: 7 * 25_000_000, tdsPaise: 0 };
  const taxOf = (income: number) => yearlyTax(Math.max(0, income - NEW_TAX.std), NEW_TAX);
  const base = (o: Partial<PayInput> = {}) => run({ gross: 25_000_000, components: [comp({ label: "Pay", mode: "fixed", value: 25_000_000, isBasic: true })], rates: tax, ytd, ...o });
  it("a bonus is added to the year once, not once for every month left", () => {
    const bonus = 10_000_000, left = 5;
    const r = base({ adjustments: [{ kind: "earning", code: "bonus", label: "Bonus", amountPaise: bonus }] });
    expect(r.oneOffTaxablePaise).toBe(bonus);
    expect(amount(r, "tds")).toBe(Math.round(taxOf(ytd.taxableGrossPaise + 25_000_000 * left + bonus) / left));
  });
  it("the last month withholds what is left of the year's tax", () => {
    const r = base({ finalMonth: true });
    expect(amount(r, "tds")).toBe(taxOf(ytd.taxableGrossPaise + 25_000_000));
  });
  it("an extra payment withholds the tax it adds to the year, and nothing else is deducted", () => {
    const bonus = 20_000_000, months = 5, monthlyPaise = 25_000_000;
    const r = run({ offCycle: true, assignment: { grossPaise: 0 }, components: [], rates: tax, ytd, taxBase: { monthlyPaise, months }, adjustments: [{ kind: "earning", code: "bonus", label: "Bonus", amountPaise: bonus }] });
    const year = ytd.taxableGrossPaise + monthlyPaise * months;
    expect(amount(r, "tds")).toBe(taxOf(year + bonus) - taxOf(year));
    expect(amount(r, "tds")).toBeGreaterThan(0);
    expect(r.grossPaise).toBe(bonus);
    expect(r.deductionsPaise).toBe(amount(r, "tds"));
  });
});

describe("a rate with no row is asked for, never taken as zero", () => {
  it("provident fund wants its wage rule for a month before the rule exists", () => {
    const r = run({ rates: rates({ missing: ["wage_exclusion_bp"] }, { pf: true }) });
    expect(amount(r, "pf_employee")).toBeUndefined();
    expect(r.flags).toContainEqual(expect.objectContaining({ code: "needs_input", line: "rates" }));
  });
  it("ESI wants its ceiling", () => {
    const r = run({ rates: rates({ missing: ["esi_ceiling"], esiCeiling: 0 }, { esi: true }), gross: 1_000_000 });
    expect(amount(r, "esi_employee")).toBeUndefined();
    expect(r.flags.map((f) => f.code)).toContain("needs_input");
  });
});
