import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, accession, limitFor, parseAccession, addDays, daysBetween, daysLate, fineFor, loanStatus, payable, todayIST } from "./rules";

describe("library rules", () => {
  it("constants match the policy", () => {
    expect(DEFAULT_SETTINGS).toEqual({ loanDays: 14, studentLimit: 2, staffLimit: 5, finePerDayPaise: 200, renewalsAllowed: 1 });
    expect(limitFor(DEFAULT_SETTINGS, "student")).toBe(2);
    expect(limitFor(DEFAULT_SETTINGS, "staff")).toBe(5);
  });

  it("date maths crosses months, years and leap days", () => {
    expect(addDays("2026-11-18", 14)).toBe("2026-12-02");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2028-02-20", 14)).toBe("2028-03-05");
    expect(addDays("2026-03-10", -10)).toBe("2026-02-28");
    expect(daysBetween("2026-11-18", "2026-11-25")).toBe(7);
    expect(daysBetween("2026-11-25", "2026-11-18")).toBe(-7);
  });

  it("IST date, not UTC", () => {
    expect(todayIST(new Date("2026-11-18T20:00:00Z"))).toBe("2026-11-19"); // 1:30 am next day in India
    expect(todayIST(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11-18");
  });

  it("fine is Rs. 2 for every day past the due date, nothing on time", () => {
    expect(daysLate("2026-11-18", "2026-11-18")).toBe(0);
    expect(daysLate("2026-11-18", "2026-11-10")).toBe(0);
    expect(fineFor("2026-11-18", "2026-11-18")).toBe(0);
    expect(fineFor("2026-11-18", "2026-11-19")).toBe(200);
    expect(fineFor("2026-11-18", "2026-12-08")).toBe(20 * 200);
  });

  it("payable: running while open, stored once returned, zero when waived", () => {
    const open = { dueOn: "2026-11-01", returnedOn: null, finePaise: 0, fineWaived: false };
    expect(payable(open, "2026-11-11")).toBe(2000);
    expect(payable({ ...open, returnedOn: "2026-11-06", finePaise: 1000 }, "2026-11-30")).toBe(1000);
    expect(payable({ ...open, fineWaived: true }, "2026-11-11")).toBe(0);
    expect(payable({ ...open, returnedOn: "2026-11-06", finePaise: 1000, fineWaived: true }, "2026-11-30")).toBe(0);
  });

  it("status", () => {
    expect(loanStatus({ dueOn: "2026-11-18", returnedOn: null }, "2026-11-18")).toBe("open");
    expect(loanStatus({ dueOn: "2026-11-18", returnedOn: null }, "2026-11-19")).toBe("overdue");
    expect(loanStatus({ dueOn: "2026-11-01", returnedOn: "2026-11-20" }, "2026-11-30")).toBe("returned");
  });

  it("the fine rate is a setting", () => {
    expect(fineFor("2026-11-18", "2026-11-21", 500)).toBe(1500);
    expect(payable({ dueOn: "2026-11-01", returnedOn: null, finePaise: 0, fineWaived: false }, "2026-11-03", 300)).toBe(600);
  });

  it("parses scanned or typed accession numbers", () => {
    expect(parseAccession("ACC-00012")).toBe(12);
    expect(parseAccession(" acc-12 ")).toBe(12);
    expect(parseAccession("12")).toBe(12);
    expect(parseAccession("Wings of Fire")).toBeNull();
    expect(parseAccession("")).toBeNull();
  });

  it("accession label", () => {
    expect(accession(7)).toBe("ACC-00007");
    expect(accession(123456)).toBe("ACC-123456");
  });
});
