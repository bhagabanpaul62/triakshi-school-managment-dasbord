import { describe, expect, it } from "vitest";
import { attendanceTone, clock12, clockIST, dayLabel, greeting, markPeriods, planTone, timeOfDay, todayIST } from "./rules";

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
