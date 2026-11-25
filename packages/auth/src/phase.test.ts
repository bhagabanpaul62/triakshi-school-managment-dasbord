import { describe, expect, it } from "vitest";
import { accessOf, addDays, istDay, LEFT_ACCESS_DAYS, leftAccessUntil, longDate, mayHear, startsMessage, type StudentPhase } from "./phase";

const left = (leftOn: string | null, status: StudentPhase["status"] = "left"): StudentPhase => ({ status, leftOn, joinsOn: null });
// 2027-03-01 12:00 IST
const noon = (day: string) => new Date(`${day}T12:00:00+05:30`);

describe("accessOf", () => {
  it("no student row, staff and active students are full", () => {
    expect(accessOf(null).kind).toBe("full");
    expect(accessOf(undefined).kind).toBe("full");
    expect(accessOf({ status: "active", leftOn: null, joinsOn: null }).kind).toBe("full");
  });
  it("a left or alumni student is limited until 90 days after the last day, in IST", () => {
    expect(LEFT_ACCESS_DAYS).toBe(90);
    expect(leftAccessUntil("2026-12-01")).toBe("2027-03-01");
    expect(accessOf(left("2026-12-01"), noon("2026-12-02"))).toEqual({ kind: "left", until: "2027-03-01" });
    expect(accessOf(left("2026-12-01", "alumni"), noon("2027-03-01"))).toEqual({ kind: "left", until: "2027-03-01" });
    expect(accessOf(left("2026-12-01"), noon("2027-03-02")).kind).toBe("closed");
  });
  it("the 90th day ends at midnight IST, not midnight UTC", () => {
    // 23:59 IST on the 90th day is 18:29 UTC: still open. 00:01 IST the next day is 18:31 UTC the same UTC day: closed.
    expect(accessOf(left("2026-12-01"), new Date("2027-03-01T23:59:00+05:30")).kind).toBe("left");
    expect(accessOf(left("2026-12-01"), new Date("2027-03-02T00:01:00+05:30")).kind).toBe("closed");
    expect(istDay(new Date("2027-03-01T18:31:00Z"))).toBe("2027-03-02");
  });
  it("no last day is closed", () => {
    expect(accessOf(left(null)).kind).toBe("closed");
    expect(accessOf(left(null, "alumni")).kind).toBe("closed");
  });
  it("a joining student has not started", () => {
    expect(accessOf({ status: "joining", leftOn: null, joinsOn: "2027-04-01" })).toEqual({ kind: "joining", joinsOn: "2027-04-01" });
  });
});

describe("mayHear", () => {
  it("a left student hears fees, results and account security only; closed hears nothing; others hear everything", () => {
    const p = left("2026-12-01");
    const now = noon("2026-12-10");
    expect(mayHear(p, "fees.due", now)).toBe(true);
    expect(mayHear(p, "exam.result", now)).toBe(true);
    expect(mayHear(p, "account.security", now)).toBe(true);
    for (const t of ["notice.published", "message.new", "urgent.alert", "event.invite", "attendance.absence"]) expect(mayHear(p, t, now)).toBe(false);
    expect(mayHear(p, "fees.due", noon("2027-06-01"))).toBe(false);
    expect(mayHear(null, "notice.published", now)).toBe(true);
  });
});

describe("words", () => {
  it("dates and the not-started sentence have no ISO and no em dash", () => {
    expect(longDate("2027-01-12")).toBe("12 Jan 2027");
    expect(startsMessage("2027-01-12")).toBe("This login starts on 12 Jan 2027.");
    expect(startsMessage(null)).not.toMatch(/—/);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
