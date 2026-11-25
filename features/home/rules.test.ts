import { describe, expect, it } from "vitest";
import { addDays, ageOn, attendanceTone, changePct, changePoints, clock12, clockIST, dayLabel, dayWords, greeting, markPeriods, monthToDate, nextOpenDay, planTone, sameWeekdayAverage, timeOfDay, todayIST } from "./rules";

// 2026-11-17 is a Tuesday. IST = UTC + 5:30.
const at = (hhmmIST: string) => new Date(`2026-11-17T${hhmmIST}:00+05:30`);

describe("greeting", () => {
  it("follows India time, not the server's", () => {
    expect(greeting("Anita Verma", at("06:00"))).toBe("Good morning, Anita");
    expect(greeting("Anita Verma", at("11:59"))).toBe("Good morning, Anita");
    expect(greeting("Anita Verma", at("12:00"))).toBe("Good afternoon, Anita");
    expect(greeting("Anita Verma", at("17:00"))).toBe("Good evening, Anita");
    expect(timeOfDay(new Date("2026-11-17T18:45:00Z"))).toBe("morning"); // 00:15 IST the next day
  });
  it("labels the day and reads the clock in IST", () => {
    expect(dayLabel(at("09:00"))).toBe("Tuesday, 17 Nov");
    expect(todayIST(new Date("2026-11-17T20:00:00Z"))).toBe("2026-11-18");
    expect(clockIST(at("09:05"))).toBe("09:05");
    expect(clock12("09:05")).toBe("9:05 am");
    expect(clock12("00:30")).toBe("12:30 am");
    expect(clock12("13:40")).toBe("1:40 pm");
  });
});

describe("markPeriods", () => {
  const day = [
    { startsAt: "08:00", endsAt: "08:40", isBreak: false },
    { startsAt: "08:40", endsAt: "09:20", isBreak: false },
    { startsAt: "09:20", endsAt: "09:40", isBreak: true },
    { startsAt: "09:40", endsAt: "10:20", isBreak: false },
  ];
  const states = (t: string) => markPeriods(day, t).map((r) => r.state);

  it("marks the running period and the next one to come", () => {
    expect(states("08:10")).toEqual(["now", "next", "later", "later"]);
    expect(states("08:40")).toEqual(["done", "now", "later", "next"]);
  });
  it("never calls a break now or next", () => {
    expect(states("09:25")).toEqual(["done", "done", "later", "next"]);
  });
  it("before the day starts the first period is next; after it ends everything is done", () => {
    expect(states("07:00")).toEqual(["next", "later", "later", "later"]);
    expect(states("11:00")).toEqual(["done", "done", "done", "done"]);
  });
});

describe("tones", () => {
  it("attendance: green from 90, amber from 75 (the defaulter line), red below", () => {
    expect([attendanceTone(95), attendanceTone(90), attendanceTone(89.9), attendanceTone(75), attendanceTone(74.9)]).toEqual(["success", "success", "warning", "warning", "danger"]);
  });
  it("plan usage warns at 90% and turns red when the plan is full", () => {
    expect([planTone(80, 100), planTone(90, 100), planTone(99, 100), planTone(100, 100), planTone(5, 0)]).toEqual(["info", "warning", "warning", "danger", "info"]);
  });
});

describe("how a number moved (H4)", () => {
  it("percent change: money and counts, colour by good or bad, nothing when there is nothing to compare", () => {
    expect(changePct(120, 100)).toEqual({ text: "20%", direction: "up", tone: "success" });
    expect(changePct(80, 100)).toEqual({ text: "20%", direction: "down", tone: "danger" });
    expect(changePct(100, 100)).toEqual({ text: "same", direction: "flat", tone: "default" });
    expect(changePct(5, 10, true)).toEqual({ text: "50%", direction: "down", tone: "success" }); // fewer overdue is good
    expect(changePct(50, 0)).toBeNull();
    expect(changePct(50, null)).toBeNull();
  });
  it("points change: attendance against its own recent average", () => {
    expect(changePoints(91, 88.4)).toEqual({ text: "3 pts", direction: "up", tone: "success" });
    expect(changePoints(75, 87.5)).toEqual({ text: "13 pts", direction: "down", tone: "danger" }); // 75 against 88 as shown
    expect(changePoints(87, 88.4)).toEqual({ text: "1 pt", direction: "down", tone: "danger" });
    expect(changePoints(88.2, 88.4)).toEqual({ text: "same", direction: "flat", tone: "default" });
    expect(changePoints(90, null)).toBeNull();
  });
  it("averages the same weekday of the last four weeks, only from days that were marked", () => {
    const today = "2026-11-11"; // a Wednesday
    const pts = [{ date: "2026-11-04", pct: 90 }, { date: "2026-10-28", pct: 80 }, { date: "2026-10-14", pct: 70 }, { date: "2026-11-10", pct: 10 }, { date: "2026-10-07", pct: 0 }];
    expect(sameWeekdayAverage(pts, today)).toBe(80); // 11-04, 10-28 and 10-14 count; 10-21 was not marked; a Tuesday and five weeks back do not
    expect(sameWeekdayAverage([], today)).toBeNull();
  });
  it("collected so far this month against the same days of last month", () => {
    const days = [
      { key: "2026-10-01", paise: 100 }, { key: "2026-10-10", paise: 200 }, { key: "2026-10-11", paise: 400 }, { key: "2026-10-12", paise: 800 }, // 12 Oct is after "the 11th"
      { key: "2026-11-02", paise: 1000 }, { key: "2026-11-11", paise: 500 }, { key: "2026-11-12", paise: 9999 }, // tomorrow does not count
    ];
    expect(monthToDate(days, "2026-11-11")).toEqual({ thisMonth: 1500, lastMonthSame: 700 });
    expect(monthToDate([{ key: "2026-02-28", paise: 1 }], "2026-03-31")).toEqual({ thisMonth: 0, lastMonthSame: 1 }); // a short month is fine
  });
});

describe("days off and birthdays", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("says the next school day in words", () => {
    expect(dayWords("2026-11-16", "2026-11-15")).toBe("Monday"); // the day after a Sunday
    expect(dayWords("2026-11-30", "2026-11-15")).toBe("Monday, 30 Nov");
    expect(nextOpenDay(new Set(["2026-11-16", "2026-11-17"]), "2026-11-15")).toBe("2026-11-18");
    expect(nextOpenDay(new Set(["2026-11-16"]), "2026-11-15", 1)).toBeNull();
  });
  it("age on the day: not yet this year before the birthday", () => {
    expect(ageOn("2014-11-11", "2026-11-11")).toBe(12);
    expect(ageOn("2014-11-12", "2026-11-11")).toBe(11);
  });
});
